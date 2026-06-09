// app/api/wix/reimport-line-items/route.ts
//
// Phase 12g commit 2 of 4. Same closes-the-12c-gap pattern as the
// Shopify equivalent, scoped to Wix orders.
//
// POST /api/wix/reimport-line-items?cursor=<lastProcessedId>
//   Returns: { done, processed, lineItemsAdded, cursor, totalRemaining }
//
// Wix uses Client Credentials — accessToken minted fresh per
// request via mintAccessToken, no decrypt-and-refresh dance.
// Per-order fetch hits /stores/v3/orders/{id}.
//
// Pro-gated. Tenant-scoped.

import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getSessionClient } from "@/lib/getClient";
import {
  mintAccessToken,
  extractWixLineItems,
  type WixOrder,
} from "@/lib/wix";
import { bulkInsertLineItemsForParent } from "@/lib/cogs/lineItems";
import { isPayingTier } from "@/lib/plans";

const TIME_BUDGET_MS = 50_000;

interface ConnectionRow {
  instance_id: string;
}

interface ParentRow {
  id: number;
  source_ref_id: string;
  due_date: string;
}

async function fetchWixOrder(opts: {
  accessToken: string;
  orderId: string;
}): Promise<WixOrder | null> {
  // Wix's eCommerce v1 namespace is the right home for Orders —
  // /stores/v3/ is for Catalog/Products only. The backfill flow
  // hits /ecom/v1/orders/search; single-order GET is the
  // corresponding /ecom/v1/orders/{id} (Get Order endpoint).
  // An earlier commit hit /stores/v3/orders/{id} → 404 (see
  // commit e1c74f3 for the URL fix).
  //
  // Response shape: Wix returns the order at the top level
  // (NOT wrapped in { order: ... } the way the search endpoint
  // wraps its results in { orders: [...] }). The dual-shape
  // parse below was confirmed by the sub-session 31 smoke test;
  // see commit 30e656c for the type-cast fix that made the full
  // re-import pipeline succeed.
  const url = `https://www.wixapis.com/ecom/v1/orders/${encodeURIComponent(opts.orderId)}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${opts.accessToken}`,
      Accept: "application/json",
    },
  });
  if (res.status === 404) return null;
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(
      `Wix order ${opts.orderId} fetch failed: HTTP ${res.status} ${txt.slice(0, 200)}`
    );
  }
  const data = (await res.json().catch(() => null)) as
    | (Partial<WixOrder> & { order?: WixOrder })
    | null;
  if (!data) return null;
  if (data.order && typeof data.order.id === "string") return data.order;
  if (typeof data.id === "string") return data as WixOrder;
  return null;
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
      `SELECT instance_id FROM wix_connections WHERE client_id = $1`,
      [client.id]
    );
    if (connRes.rowCount === 0) {
      return NextResponse.json(
        { error: "No Wix connection." },
        { status: 404 }
      );
    }
    const { accessToken } = await mintAccessToken({
      instanceId: connRes.rows[0].instance_id,
    });

    const PARENTS_PER_CHUNK = 50;
    const parentsRes = await pool.query<ParentRow>(
      `SELECT pi.id, pi.source_ref_id, pi.due_date::text
         FROM processed_items pi
        WHERE pi.client_id = $1
          AND pi.source = 'wix'
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
      const order = await fetchWixOrder({
        accessToken,
        orderId: parent.source_ref_id,
      });
      processed++;
      if (!order) continue;
      const items = extractWixLineItems(order);
      if (items.length === 0) continue;
      const added = await bulkInsertLineItemsForParent({
        parentId: parent.id,
        clientId: client.id,
        platform: "wix",
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
          AND pi.source = 'wix'
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
    console.error("Wix reimport-line-items error:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Re-import failed",
      },
      { status: 500 }
    );
  }
}
