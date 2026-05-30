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
}): Promise<{ order: WixOrder | null; debug: Record<string, unknown> }> {
  // Wix's eCommerce v1 namespace is the right home for Orders —
  // /stores/v3/ is for Catalog/Products only. The backfill flow
  // hits /ecom/v1/orders/search; single-order GET is the
  // corresponding /ecom/v1/orders/{id} (Get Order endpoint).
  // Previously this used /stores/v3/orders/{id} → 404.
  const url = `https://www.wixapis.com/ecom/v1/orders/${encodeURIComponent(opts.orderId)}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${opts.accessToken}`,
      Accept: "application/json",
    },
  });
  if (res.status === 404) {
    return { order: null, debug: { status: 404 } };
  }
  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(
      `Wix order ${opts.orderId} fetch failed: HTTP ${res.status} ${txt.slice(0, 200)}`
    );
  }
  const data = (await res.json().catch(() => null)) as
    | (Partial<WixOrder> & { order?: WixOrder })
    | null;
  // Temporary debug surface (sub-session 31 smoke test). Captures
  // the top-level keys + whether order is wrapped vs bare, so the
  // reimport endpoint response can carry the shape back to the UI
  // for inspection. Stripped once the response shape is confirmed.
  const debug: Record<string, unknown> = {
    status: res.status,
    top_keys: data ? Object.keys(data) : [],
    has_order_wrapper: !!(data && data.order),
    has_top_level_id: !!(data && typeof data.id === "string"),
    line_items_count: Array.isArray((data?.order ?? data)?.lineItems)
      ? (data?.order ?? data)!.lineItems!.length
      : null,
  };
  if (!data) return { order: null, debug };
  if (data.order && typeof data.order.id === "string") {
    return { order: data.order, debug };
  }
  if (typeof data.id === "string") return { order: data as WixOrder, debug };
  return { order: null, debug };
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
    if (client.plan !== "pro") {
      return NextResponse.json(
        { error: "SKU catalog is a Pro feature." },
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
    const debugPerParent: Array<{
      parentId: number;
      sourceRefId: string;
      itemsExtracted: number;
      fetchDebug: Record<string, unknown>;
    }> = [];

    for (const parent of parentsRes.rows) {
      if (Date.now() - startMs > TIME_BUDGET_MS) break;
      lastTouchedId = parent.id;
      const { order, debug: fetchDebug } = await fetchWixOrder({
        accessToken,
        orderId: parent.source_ref_id,
      });
      processed++;
      const items = order ? extractWixLineItems(order) : [];
      debugPerParent.push({
        parentId: parent.id,
        sourceRefId: parent.source_ref_id,
        itemsExtracted: items.length,
        fetchDebug,
      });
      if (!order) continue;
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
      // sub-session 31 smoke-test diagnostic
      debug: debugPerParent,
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
