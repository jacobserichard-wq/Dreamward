// app/api/square/reimport-line-items/route.ts
//
// Phase 12g commit 2 of 4. Closes-the-12c-gap for Square. Pattern
// matches Shopify + Wix re-import endpoints but with Square's
// quirks: the parent processed_items row is a PAYMENT, but line
// items live on the ORDER — so we need TWO Square API calls per
// parent: GET /v2/payments/{id} to recover the order_id (since
// the original ingest stored it in extracted_data but we don't
// trust that for the re-import flow), then GET /v2/orders/{order_id}
// to fetch the actual line items.
//
// Actually — we DO have order_id stored in extracted_data, and
// it's the source of truth from the original ingest. Reading it
// from the row's extracted_data->>'order_id' avoids the extra
// payment fetch per parent. Skip rows where it's null (rare
// payments without a parent Order).
//
// POST /api/square/reimport-line-items?cursor=<lastProcessedId>
//   Returns: { done, processed, lineItemsAdded, cursor, totalRemaining }
//
// Token handling: decrypt + refresh if needed (same pattern as
// backfill). Refresh runs once per request, not per parent.
//
// Pro-gated. Tenant-scoped.

import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getSessionClient } from "@/lib/getClient";
import { decryptFromDb, encryptForDb } from "@/lib/crypto";
import {
  refreshAccessToken,
  getOrder,
  extractSquareLineItems,
  extractSquareOrderMoney,
} from "@/lib/square";
import { bulkInsertLineItemsForParent } from "@/lib/cogs/lineItems";
import { isPayingTier } from "@/lib/plans";

const TIME_BUDGET_MS = 50_000;
const TOKEN_REFRESH_THRESHOLD_MS = 60 * 60 * 1000;

interface ConnectionRow {
  id: number;
  access_token_ciphertext: Buffer;
  access_token_iv: Buffer;
  access_token_auth_tag: Buffer;
  access_token_expires_at: string;
  refresh_token_ciphertext: Buffer;
  refresh_token_iv: Buffer;
  refresh_token_auth_tag: Buffer;
}

interface ParentRow {
  id: number;
  due_date: string;
  /** Square order_id pulled from extracted_data. NULL when the
   *  payment was made via the raw Payments API (no Order
   *  attached) — we skip those during re-import. */
  order_id: string | null;
}

export async function POST(req: Request) {
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

    const url = new URL(req.url);
    const cursor = Number(url.searchParams.get("cursor") ?? "0") || 0;

    const connRes = await pool.query<ConnectionRow>(
      `SELECT id,
              access_token_ciphertext, access_token_iv, access_token_auth_tag,
              access_token_expires_at,
              refresh_token_ciphertext, refresh_token_iv, refresh_token_auth_tag
         FROM square_connections
        WHERE client_id = $1`,
      [client.id]
    );
    if (connRes.rowCount === 0) {
      return NextResponse.json(
        { error: "No Square connection." },
        { status: 404 }
      );
    }
    const conn = connRes.rows[0];

    // Decrypt + pre-emptive refresh
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
      const refreshed = await refreshAccessToken({ refreshToken });
      accessToken = refreshed.access_token;
      const newA = encryptForDb(refreshed.access_token);
      const newR = encryptForDb(refreshed.refresh_token);
      await pool.query(
        `UPDATE square_connections
            SET access_token_ciphertext = $1, access_token_iv = $2, access_token_auth_tag = $3,
                access_token_expires_at = $4,
                refresh_token_ciphertext = $5, refresh_token_iv = $6, refresh_token_auth_tag = $7,
                updated_at = NOW()
          WHERE id = $8`,
        [
          newA.ciphertext, newA.iv, newA.authTag,
          refreshed.expires_at,
          newR.ciphertext, newR.iv, newR.authTag,
          conn.id,
        ]
      );
    }

    // Pull a chunk of parents that need line items. Filter to
    // those with an order_id in extracted_data — payments with no
    // attached order have no line items to recover.
    const PARENTS_PER_CHUNK = 50;
    const parentsRes = await pool.query<ParentRow>(
      `SELECT pi.id,
              pi.due_date::text,
              (pi.extracted_data->>'order_id') AS order_id
         FROM processed_items pi
        WHERE pi.client_id = $1
          AND pi.source = 'square'
          AND pi.id > $2
          AND pi.source_ref_id IS NOT NULL
          AND (
            pi.tax_amount IS NULL
            OR pi.service_charge_amount IS NULL
            OR NOT EXISTS (
              SELECT 1 FROM processed_item_line_items pili
               WHERE pili.processed_item_id = pi.id
            )
          )
        ORDER BY pi.id ASC
        LIMIT $3`,
      [client.id, cursor, PARENTS_PER_CHUNK]
    );

    let processed = 0;
    let lineItemsAdded = 0;
    let lastTouchedId = cursor;
    let done = false;

    for (const parent of parentsRes.rows) {
      if (Date.now() - startMs > TIME_BUDGET_MS) break;
      lastTouchedId = parent.id;
      processed++;
      if (!parent.order_id) continue; // standalone payment, no order
      const order = await getOrder({ accessToken, orderId: parent.order_id });
      if (!order) continue;
      // Backfill the full money breakdown from the order (set even when
      // there are no parseable line items, so the row stops re-qualifying).
      const { tax, tip, service, discount } = extractSquareOrderMoney(order);
      await pool.query(
        `UPDATE processed_items
            SET tax_amount = $1, tip_amount = $2,
                service_charge_amount = $3, discount_amount = $4
          WHERE id = $5 AND client_id = $6`,
        [tax, tip, service, discount, parent.id, client.id]
      );
      const items = extractSquareLineItems(order);
      if (items.length === 0) continue;
      const added = await bulkInsertLineItemsForParent({
        parentId: parent.id,
        clientId: client.id,
        platform: "square",
        soldAt: parent.due_date,
        items,
      });
      lineItemsAdded += added;
    }

    if (
      parentsRes.rowCount === 0 ||
      (parentsRes.rowCount! < PARENTS_PER_CHUNK &&
        Date.now() - startMs <= TIME_BUDGET_MS)
    ) {
      done = true;
    }

    const remainingRes = await pool.query<{ remaining: number }>(
      `SELECT COUNT(*)::int AS remaining
         FROM processed_items pi
        WHERE pi.client_id = $1
          AND pi.source = 'square'
          AND pi.source_ref_id IS NOT NULL
          AND pi.id > $2
          AND (
            pi.tax_amount IS NULL
            OR pi.service_charge_amount IS NULL
            OR NOT EXISTS (
              SELECT 1 FROM processed_item_line_items pili
               WHERE pili.processed_item_id = pi.id
            )
          )`,
      [client.id, lastTouchedId]
    );

    return NextResponse.json({
      done,
      processed,
      lineItemsAdded,
      cursor: lastTouchedId,
      totalRemaining: remainingRes.rows[0]?.remaining ?? 0,
    });
  } catch (err) {
    console.error("Square reimport-line-items error:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Re-import failed",
      },
      { status: 500 }
    );
  }
}
