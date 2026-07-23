// app/api/shopify/reimport-line-items/route.ts
//
// Phase 12g commit 2 of 4. Closes the Phase 12c gap: Shopify
// orders that were ingested BEFORE the line-item fan-out shipped
// have no rows in processed_item_line_items. This endpoint walks
// the merchant's processed_items, finds parents missing line items,
// re-fetches each order from Shopify, and fans the line items in.
//
// POST /api/shopify/reimport-line-items
//   Returns: { done, processed, lineItemsAdded, totalRemaining }
//
// Chunked + time-budgeted (50s) like backfill — the frontend polls
// + re-POSTs until done=true. Resume key: the highest
// processed_items.id we've already touched, tracked by walking
// `WHERE id > $cursor`. Each chunk's response includes the new
// cursor so the next POST can continue.
//
// Idempotency: the UNIQUE (processed_item_id, external_id) index
// on processed_item_line_items makes the fan-out safe to re-run.
// We still SKIP parents that already have any line items to avoid
// the per-row Shopify API hit when nothing's needed.
//
// Pro-gated. Tenant-scoped on every query.

import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getSessionClient } from "@/lib/getClient";
import { getShopifyAccessToken } from "@/lib/shopifyToken";
import { extractShopifyLineItems, getOrder } from "@/lib/shopify";
import { bulkInsertLineItemsForParent } from "@/lib/cogs/lineItems";
import { isPayingTier } from "@/lib/plans";

const TIME_BUDGET_MS = 50_000;

interface ConnectionRow {
  id: number;
  shop_domain: string;
}

interface ParentRow {
  id: number;
  source_ref_id: string;
  due_date: string;
}

// Single-order fetch now lives in lib/shopify.getOrder (GraphQL).

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

    // Optional ?cursor=<lastProcessedId> for chunked resume.
    const url = new URL(req.url);
    const cursor = Number(url.searchParams.get("cursor") ?? "0") || 0;

    const connRes = await pool.query<ConnectionRow>(
      `SELECT id, shop_domain
         FROM shopify_connections
        WHERE client_id = $1`,
      [client.id]
    );
    if (connRes.rowCount === 0) {
      return NextResponse.json(
        { error: "No Shopify connection." },
        { status: 404 }
      );
    }
    const conn = connRes.rows[0];
    const accessToken = await getShopifyAccessToken(conn.id);

    // Pull a page of parents that don't already have line items.
    // The NOT EXISTS keeps the query fast — once a parent gets line
    // items, it never shows up here again. 50 per chunk keeps the
    // per-request Shopify call count well under the rate limit.
    const PARENTS_PER_CHUNK = 50;
    const parentsRes = await pool.query<ParentRow>(
      `SELECT pi.id, pi.source_ref_id, pi.due_date::text
         FROM processed_items pi
        WHERE pi.client_id = $1
          AND pi.source = 'shopify'
          AND pi.id > $2
          AND pi.source_ref_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM processed_item_line_items pili
             WHERE pili.processed_item_id = pi.id
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
      const order = await getOrder({
        shopDomain: conn.shop_domain,
        accessToken,
        orderId: parent.source_ref_id,
      });
      processed++;
      if (!order) continue; // deleted on Shopify side
      const items = extractShopifyLineItems(order);
      if (items.length === 0) continue;
      const added = await bulkInsertLineItemsForParent({
        parentId: parent.id,
        clientId: client.id,
        platform: "shopify",
        soldAt: parent.due_date,
        items,
      });
      lineItemsAdded += added;
    }

    // done? when the last query returned fewer rows than the page
    // size (and we got through them all), there's nothing left.
    if (
      parentsRes.rowCount === 0 ||
      (parentsRes.rowCount! < PARENTS_PER_CHUNK &&
        Date.now() - startMs <= TIME_BUDGET_MS)
    ) {
      done = true;
    }

    // Count remaining for the progress UI.
    const remainingRes = await pool.query<{ remaining: number }>(
      `SELECT COUNT(*)::int AS remaining
         FROM processed_items pi
        WHERE pi.client_id = $1
          AND pi.source = 'shopify'
          AND pi.source_ref_id IS NOT NULL
          AND pi.id > $2
          AND NOT EXISTS (
            SELECT 1 FROM processed_item_line_items pili
             WHERE pili.processed_item_id = pi.id
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
    console.error("Shopify reimport-line-items error:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Re-import failed",
      },
      { status: 500 }
    );
  }
}
