// app/api/square/backfill/route.ts
//
// Phase 11c. Chunked + resumable Square Payments backfill. Mirrors
// the Wix Phase 10c pattern with Square-specific differences:
//   - Encrypted access + refresh tokens (decrypt then auto-refresh
//     if within 24h of expiry; persist rotated refresh token back)
//   - Cursor pagination on /v2/payments (similar shape to Wix's
//     /ecom/v1/orders)
//   - No cap (mirrors Wix decision — Square stores cover broader
//     volume but per-merchant historical sizes are still bookkeeper-
//     scale; revisit if abuse appears)

import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getSessionClient } from "@/lib/getClient";
import { decryptFromDb, encryptForDb } from "@/lib/crypto";
import {
  fetchPaymentsPage,
  mapPaymentToProcessedItem,
  refreshAccessToken,
  getOrder,
  extractSquareLineItems,
} from "@/lib/square";
import { bulkInsertLineItemsAcrossParents } from "@/lib/cogs/lineItems";
import { isPayingTier } from "@/lib/plans";

// Vercel Pro 60s limit, 10s headroom for the final UPDATE.
const TIME_BUDGET_MS = 50_000;

// Pre-emptively refresh when the token has less than this much time
// left. 24h is plenty of slack — token expires in 30 days so this
// triggers once near end-of-life. If we just hit expiry exactly, a
// long-running backfill would 401 mid-loop.
const TOKEN_REFRESH_THRESHOLD_MS = 24 * 60 * 60 * 1000;

interface ConnectionRow {
  id: number;
  merchant_id: string;
  access_token_ciphertext: Buffer;
  access_token_iv: Buffer;
  access_token_auth_tag: Buffer;
  access_token_expires_at: string;
  refresh_token_ciphertext: Buffer;
  refresh_token_iv: Buffer;
  refresh_token_auth_tag: Buffer;
  backfill_cursor: string | null;
  backfill_completed_at: string | null;
  backfill_payments_imported: number;
  import_start_date: string | null;
}

export async function POST() {
  const startMs = Date.now();
  try {
    const client = await getSessionClient();
    if (!client) {
      return NextResponse.json(
        { error: "Not authenticated" },
        { status: 401 }
      );
    }
    if (!isPayingTier(client.plan)) {
      return NextResponse.json(
        { error: "Square integration is a Pro feature." },
        { status: 403 }
      );
    }

    // ── Load connection state ──────────────────────────────────
    const found = await pool.query<ConnectionRow>(
      `SELECT id, merchant_id,
              access_token_ciphertext, access_token_iv, access_token_auth_tag,
              access_token_expires_at,
              refresh_token_ciphertext, refresh_token_iv, refresh_token_auth_tag,
              backfill_cursor, backfill_completed_at, backfill_payments_imported,
              import_start_date::text AS import_start_date
         FROM square_connections
        WHERE client_id = $1`,
      [client.id]
    );
    if (found.rows.length === 0) {
      return NextResponse.json(
        { error: "No Square connection. Connect an account first." },
        { status: 404 }
      );
    }
    const conn = found.rows[0];

    if (conn.backfill_completed_at) {
      return NextResponse.json({
        done: true,
        paymentsImported: 0,
        totalImported: conn.backfill_payments_imported,
      });
    }

    // ── Decrypt tokens + pre-emptive refresh if needed ─────────
    let accessToken = decryptFromDb({
      ciphertext: conn.access_token_ciphertext,
      iv: conn.access_token_iv,
      authTag: conn.access_token_auth_tag,
    });
    const refreshToken = decryptFromDb({
      ciphertext: conn.refresh_token_ciphertext,
      iv: conn.refresh_token_iv,
      authTag: conn.refresh_token_auth_tag,
    });

    const expiresAtMs = new Date(conn.access_token_expires_at).getTime();
    if (expiresAtMs - Date.now() < TOKEN_REFRESH_THRESHOLD_MS) {
      try {
        const refreshed = await refreshAccessToken({ refreshToken });
        accessToken = refreshed.access_token;
        // Square rotates refresh tokens — persist BOTH back.
        const newAccessBlob = encryptForDb(refreshed.access_token);
        const newRefreshBlob = encryptForDb(refreshed.refresh_token);
        await pool.query(
          `UPDATE square_connections
              SET access_token_ciphertext = $1,
                  access_token_iv = $2,
                  access_token_auth_tag = $3,
                  access_token_expires_at = $4,
                  refresh_token_ciphertext = $5,
                  refresh_token_iv = $6,
                  refresh_token_auth_tag = $7,
                  updated_at = NOW()
            WHERE id = $8`,
          [
            newAccessBlob.ciphertext,
            newAccessBlob.iv,
            newAccessBlob.authTag,
            refreshed.expires_at,
            newRefreshBlob.ciphertext,
            newRefreshBlob.iv,
            newRefreshBlob.authTag,
            conn.id,
          ]
        );
      } catch (err) {
        console.error(
          `Square backfill: token refresh failed for connection ${conn.id}:`,
          err
        );
        await pool.query(
          `UPDATE square_connections
              SET last_sync_status = 'failed',
                  last_sync_error = $1,
                  updated_at = NOW()
            WHERE id = $2`,
          [
            err instanceof Error ? err.message.slice(0, 500) : "refresh failed",
            conn.id,
          ]
        );
        throw err;
      }
    }

    // ── Mark backfill as started (idempotent) ──────────────────
    await pool.query(
      `UPDATE square_connections
          SET backfill_started_at = COALESCE(backfill_started_at, NOW()),
              last_sync_status = 'in_progress',
              updated_at = NOW()
        WHERE id = $1`,
      [conn.id]
    );

    let cursor: string | null = conn.backfill_cursor;
    let totalImported = conn.backfill_payments_imported;
    let paymentsThisRun = 0;
    let done = false;

    // "Import from" cutoff → Square begin_time (RFC3339). Must be passed
    // identically on every page when paginating with a cursor. undefined =
    // all history.
    const beginTime = conn.import_start_date
      ? new Date(`${conn.import_start_date}T00:00:00Z`).toISOString()
      : undefined;

    while (true) {
      if (Date.now() - startMs > TIME_BUDGET_MS) break;

      let page: Awaited<ReturnType<typeof fetchPaymentsPage>>;
      try {
        page = await fetchPaymentsPage({
          accessToken,
          cursor,
          limit: 100,
          sortOrder: "ASC", // oldest first for backfill
          beginTime,
        });
      } catch (err) {
        await pool.query(
          `UPDATE square_connections
              SET last_sync_status = 'failed',
                  last_sync_error = $1,
                  updated_at = NOW()
            WHERE id = $2`,
          [
            err instanceof Error ? err.message.slice(0, 500) : "unknown",
            conn.id,
          ]
        );
        throw err;
      }

      if (page.payments.length === 0) {
        done = true;
        break;
      }

      // Bulk INSERT with the same partial-index-matching ON CONFLICT
      // pattern from Wix backfill (commit 23b42a0). 13 fields per row.
      const rows = page.payments.map(mapPaymentToProcessedItem);
      const fieldsPerRow = 13;
      const values: unknown[] = [];
      const placeholders = rows
        .map((r) => {
          const base = values.length;
          values.push(
            r.vendor,
            r.invoice_number,
            r.amount,
            r.due_date,
            r.status,
            r.category,
            r.source,
            r.source_ref_id,
            r.channel,
            r.confidence,
            r.summary,
            JSON.stringify(r.extracted_data),
            client.id
          );
          return (
            "(" +
            Array.from(
              { length: fieldsPerRow },
              (_, j) => `$${base + j + 1}`
            ).join(",") +
            ")"
          );
        })
        .join(",");

      // Phase 12c: RETURNING (id, source_ref_id) so we can fan
      // line items into processed_item_line_items for every
      // freshly-inserted parent. For Square, line items live on
      // the Order (not the Payment), so we make one extra
      // /v2/orders/{order_id} call per payment that has an
      // order_id. Square's documented rate limit is ~100 RPS;
      // a 100-payment chunk = 100 extra calls = well under quota.
      const insertRes = await pool.query<{
        id: number;
        source_ref_id: string;
      }>(
        `INSERT INTO processed_items (
           vendor, invoice_number, amount, due_date, status,
           category, source, source_ref_id, channel, confidence,
           summary, extracted_data, client_id
         ) VALUES ${placeholders}
         ON CONFLICT (client_id, source, source_ref_id)
           WHERE source_ref_id IS NOT NULL
         DO NOTHING
         RETURNING id, source_ref_id`,
        values
      );

      if (insertRes.rowCount && insertRes.rowCount > 0) {
        const paymentById = new Map<string, typeof page.payments[number]>();
        for (const p of page.payments) paymentById.set(p.id, p);

        type Parent = {
          parentId: number;
          soldAt: string;
          items: ReturnType<typeof extractSquareLineItems>;
        };
        const parents: Parent[] = [];

        for (const r of insertRes.rows) {
          const payment = paymentById.get(r.source_ref_id);
          if (!payment) continue;
          if (!payment.order_id) continue;
          const order = await getOrder({
            accessToken,
            orderId: payment.order_id,
          });
          if (!order) continue;
          const items = extractSquareLineItems(order);
          if (items.length === 0) continue;
          const mapped = mapPaymentToProcessedItem(payment);
          parents.push({
            parentId: r.id,
            soldAt: mapped.due_date,
            items,
          });
        }

        if (parents.length > 0) {
          await bulkInsertLineItemsAcrossParents({
            clientId: client.id,
            platform: "square",
            parents,
          });
        }
      }

      totalImported += rows.length;
      paymentsThisRun += rows.length;
      cursor = page.nextCursor;

      await pool.query(
        `UPDATE square_connections
            SET backfill_payments_imported = $1,
                backfill_cursor = $2,
                last_sync_at = NOW(),
                updated_at = NOW()
          WHERE id = $3`,
        [totalImported, cursor, conn.id]
      );

      if (cursor === null) {
        done = true;
        break;
      }
    }

    if (done) {
      await pool.query(
        `UPDATE square_connections
            SET backfill_completed_at = NOW(),
                backfill_cursor = NULL,
                last_sync_status = 'success',
                last_sync_error = NULL,
                updated_at = NOW()
          WHERE id = $1`,
        [conn.id]
      );
    }

    return NextResponse.json({
      done,
      paymentsImported: paymentsThisRun,
      totalImported,
    });
  } catch (err) {
    console.error("Square backfill error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Backfill failed" },
      { status: 500 }
    );
  }
}
