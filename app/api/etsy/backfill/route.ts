// app/api/etsy/backfill/route.ts
//
// Etsy integration commit 4. Chunked + resumable receipts backfill.
// Mirrors the Square backfill with two Etsy simplifications and one
// quirk:
//   - Line items ("transactions") come NESTED in each receipt — no
//     per-order second fetch like Square's getOrder.
//   - Pagination is integer offset (backfill_cursor INTEGER), sorted
//     ASCENDING so offsets stay stable while new orders arrive
//     mid-backfill.
//   - Access tokens live ONE HOUR — ensureFreshToken runs before the
//     loop and we persist the rotated pair immediately (Etsy rotates
//     the refresh token on every refresh).
//
// POST /api/etsy/backfill → { done, receiptsImported, totalSeen }
// The client re-calls until done=true (same contract the platform
// cards use).

import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getSessionClient } from "@/lib/getClient";
import { decryptFromDb, encryptForDb } from "@/lib/crypto";
import {
  ensureFreshToken,
  fetchReceiptsPage,
  mapReceiptToProcessedItem,
  mapTransactionsToLineItems,
  ETSY_RECEIPTS_PAGE_SIZE,
} from "@/lib/etsy";
import { bulkInsertLineItemsAcrossParents } from "@/lib/cogs/lineItems";
import { isPayingTier } from "@/lib/plans";

// Vercel 60s limit, headroom for the final UPDATE.
const TIME_BUDGET_MS = 50_000;

interface ConnectionRow {
  id: number;
  shop_id: string;
  access_token_ciphertext: Buffer;
  access_token_iv: Buffer;
  access_token_auth_tag: Buffer;
  access_token_expires_at: string;
  refresh_token_ciphertext: Buffer;
  refresh_token_iv: Buffer;
  refresh_token_auth_tag: Buffer;
  backfill_cursor: number | null;
  backfill_done: boolean;
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
        { error: "This feature requires an active subscription." },
        { status: 403 }
      );
    }

    const found = await pool.query<ConnectionRow>(
      `SELECT id, shop_id,
              access_token_ciphertext, access_token_iv, access_token_auth_tag,
              access_token_expires_at,
              refresh_token_ciphertext, refresh_token_iv, refresh_token_auth_tag,
              backfill_cursor, backfill_done
         FROM etsy_connections
        WHERE client_id = $1`,
      [client.id]
    );
    if (found.rowCount === 0) {
      return NextResponse.json(
        { error: "No Etsy connection. Connect your shop first." },
        { status: 404 }
      );
    }
    const conn = found.rows[0];
    if (conn.backfill_done) {
      return NextResponse.json({ done: true, receiptsImported: 0 });
    }

    // ── Fresh access token (1-hour life; refresh + persist) ─────
    let accessToken: string;
    try {
      const fresh = await ensureFreshToken({
        accessToken: decryptFromDb({
          ciphertext: conn.access_token_ciphertext,
          iv: conn.access_token_iv,
          authTag: conn.access_token_auth_tag,
        }),
        refreshToken: decryptFromDb({
          ciphertext: conn.refresh_token_ciphertext,
          iv: conn.refresh_token_iv,
          authTag: conn.refresh_token_auth_tag,
        }),
        expiresAt: new Date(conn.access_token_expires_at),
      });
      accessToken = fresh.accessToken;
      if (fresh.rotated) {
        const a = encryptForDb(fresh.rotated.access_token);
        const r = encryptForDb(fresh.rotated.refresh_token);
        await pool.query(
          `UPDATE etsy_connections
              SET access_token_ciphertext = $1, access_token_iv = $2,
                  access_token_auth_tag = $3,
                  access_token_expires_at = NOW() + ($4 || ' seconds')::interval,
                  refresh_token_ciphertext = $5, refresh_token_iv = $6,
                  refresh_token_auth_tag = $7,
                  refresh_token_obtained_at = NOW(),
                  updated_at = NOW()
            WHERE id = $8`,
          [
            a.ciphertext,
            a.iv,
            a.authTag,
            String(fresh.rotated.expires_in),
            r.ciphertext,
            r.iv,
            r.authTag,
            conn.id,
          ]
        );
      }
    } catch (err) {
      console.error("Etsy backfill: token refresh failed:", err);
      return NextResponse.json(
        {
          error:
            "Etsy token refresh failed. Try disconnecting and reconnecting your shop.",
        },
        { status: 502 }
      );
    }

    // ── Chunked import loop ──────────────────────────────────────
    let offset = conn.backfill_cursor ?? 0;
    let receiptsImported = 0;
    let done = false;

    while (Date.now() - startMs < TIME_BUDGET_MS) {
      const page = await fetchReceiptsPage({
        accessToken,
        shopId: conn.shop_id,
        offset,
        sortOrder: "asc", // oldest first — stable offsets
      });

      if (page.receipts.length === 0) {
        done = true;
        break;
      }

      // Bulk INSERT with the cross-source dedup ON CONFLICT — the
      // same partial-index pattern the Wix/Square backfills use.
      const rows = page.receipts.map(mapReceiptToProcessedItem);
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

      // Fan line items for the freshly-inserted parents. Etsy nests
      // transactions in the receipt — no extra API calls.
      if (insertRes.rowCount && insertRes.rowCount > 0) {
        const receiptByRef = new Map(
          page.receipts.map((r) => [String(r.receipt_id), r])
        );
        const parents = insertRes.rows.flatMap((row) => {
          const receipt = receiptByRef.get(row.source_ref_id);
          if (!receipt) return [];
          const items = mapTransactionsToLineItems(receipt);
          if (items.length === 0) return [];
          return [
            {
              parentId: row.id,
              soldAt: new Date(receipt.create_timestamp * 1000)
                .toISOString()
                .slice(0, 10),
              items,
            },
          ];
        });
        if (parents.length > 0) {
          await bulkInsertLineItemsAcrossParents({
            clientId: client.id,
            platform: "etsy",
            parents,
          });
        }
        receiptsImported += insertRes.rowCount;
      }

      offset += page.receipts.length;

      await pool.query(
        `UPDATE etsy_connections
            SET backfill_cursor = $1, updated_at = NOW()
          WHERE id = $2`,
        [offset, conn.id]
      );

      // Short page = we've reached the end.
      if (page.receipts.length < ETSY_RECEIPTS_PAGE_SIZE) {
        done = true;
        break;
      }
    }

    if (done) {
      await pool.query(
        `UPDATE etsy_connections
            SET backfill_done = TRUE, backfill_cursor = NULL,
                updated_at = NOW()
          WHERE id = $1`,
        [conn.id]
      );
    }

    return NextResponse.json({ done, receiptsImported, totalSeen: offset });
  } catch (err) {
    console.error("Etsy backfill error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Backfill failed" },
      { status: 500 }
    );
  }
}
