// lib/cogs/lineItems.ts
//
// Phase 12c shared library. One module that the Shopify, Wix, and
// Square write paths all call to fan order/payment line items out
// into processed_item_line_items (migration 0018) and resolve
// matched_sku_id from sku_aliases (migration 0017).
//
// Design goals:
//
//   - Platform-agnostic intermediate type (InternalLineItem) so
//     bulk-insert + alias-resolution code is shared across all
//     three integrations. Each platform contributes a small mapper
//     that converts its raw line item to this shape.
//
//   - Bulk insert per parent row. The caller hands us all the line
//     items for a single processed_items row + that row's id; we
//     emit one INSERT statement that handles ON CONFLICT idempotency
//     via the (processed_item_id, external_id) UNIQUE constraint
//     from migration 0018.
//
//   - Alias resolution happens server-side via the same INSERT. We
//     LEFT JOIN sku_aliases on (platform, external_item_id) to fill
//     matched_sku_id automatically. Items with no alias yet get
//     matched_sku_id = NULL and surface in the Unmatched UI
//     (Phase 12d). Tenant-scoped via skus.client_id check in the
//     JOIN's ON clause.
//
//   - Caller passes a PoolClient when this is wired into a larger
//     transaction (backfill chunks BEGIN/COMMIT around the whole
//     page). For webhook handlers that don't need a transaction,
//     they pass the shared pool.

import type { PoolClient } from "pg";
import pool from "@/lib/db";

/** The intermediate shape every platform mapper returns. Mirrors
 *  the processed_item_line_items column set 1:1 minus the FK +
 *  date + matched_sku_id fields that the inserter fills in. */
export interface InternalLineItem {
  /** Platform's line-item identifier (Shopify line_item.id,
   *  Wix lineItem.id, Square line_item.uid). Used for the
   *  ON CONFLICT (processed_item_id, external_id) dedup. */
  externalId: string;
  /** Platform's product/variant identifier — what sku_aliases
   *  JOINs on. NULL for ad-hoc items (e.g., Square POS "Custom $5"
   *  ring-ups with no catalog reference). */
  externalItemId: string | null;
  /** Platform-side SKU code string, display only. */
  externalSku: string | null;
  /** Display name at time of sale. */
  name: string;
  /** Quantity sold. Fractional supported for weighed goods. */
  quantity: number;
  /** Per-unit price at time of sale. */
  unitPrice: number;
  /** ISO currency code (USD, EUR, etc.). */
  currency: string;
}

/** Platform tag used for sku_aliases JOIN + the platform column on
 *  processed_item_line_items. */
export type LineItemPlatform = "shopify" | "wix" | "square";

/**
 * Bulk-insert a batch of line items for a single parent
 * processed_items row.
 *
 * Resolves matched_sku_id in the same INSERT statement via a
 * LEFT JOIN to sku_aliases. The JOIN is tenant-safe — sku_aliases
 * is joined through skus on s.client_id = $clientId so a forged
 * external_id can't accidentally cross tenants.
 *
 * Idempotency: the UNIQUE (processed_item_id, external_id) index
 * from migration 0018 means re-running this for the same parent
 * (e.g., webhook redelivery) is a no-op via ON CONFLICT DO NOTHING.
 *
 * Returns the count of rows actually inserted (new line items;
 * duplicates that were skipped don't count).
 */
export async function bulkInsertLineItemsForParent(opts: {
  /** When part of a larger transaction, pass the PoolClient that
   *  owns BEGIN/COMMIT. Otherwise omit to use the shared pool. */
  dbClient?: PoolClient;
  parentId: number;
  clientId: number;
  platform: LineItemPlatform;
  /** Denormalized from the parent processed_items row. Stored as
   *  YYYY-MM-DD so cost-history lookups in the COGS query can join
   *  on sku_cost_history.effective_date without timezone churn. */
  soldAt: string;
  items: InternalLineItem[];
}): Promise<number> {
  const { parentId, clientId, platform, soldAt, items } = opts;
  if (items.length === 0) return 0;

  const db = opts.dbClient ?? pool;

  // Per-row params: parent_id, client_id, platform, external_id,
  // external_item_id, external_sku, name, quantity, unit_price,
  // currency, sold_at — 11 fields. matched_sku_id is filled by
  // the LATERAL join (NULL when no matching alias).
  const fieldsPerRow = 11;
  const values: unknown[] = [];
  const placeholders = items
    .map((it) => {
      const base = values.length;
      values.push(
        parentId,
        clientId,
        platform,
        it.externalId,
        it.externalItemId,
        it.externalSku,
        it.name,
        it.quantity,
        it.unitPrice,
        it.currency,
        soldAt
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

  // `incoming` is the multi-row VALUES list. We LEFT JOIN
  // sku_aliases (via skus to scope by client_id) on
  // (platform, external_item_id). When external_item_id is NULL,
  // the join naturally misses → matched_sku_id stays NULL.
  //
  // ON CONFLICT DO NOTHING — repeat of (processed_item_id,
  // external_id) is the idempotent skip path for webhook
  // redelivery + chunked backfill resumption.
  const result = await db.query<{ id: number }>(
    `INSERT INTO processed_item_line_items (
       processed_item_id, client_id, platform, external_id,
       external_item_id, external_sku, name, quantity, unit_price,
       currency, sold_at, matched_sku_id
     )
     SELECT
       i.processed_item_id, i.client_id, i.platform, i.external_id,
       i.external_item_id, i.external_sku, i.name, i.quantity, i.unit_price,
       i.currency, i.sold_at, a.sku_id
       FROM ( VALUES ${placeholders} ) AS i(
         processed_item_id, client_id, platform, external_id,
         external_item_id, external_sku, name, quantity, unit_price,
         currency, sold_at
       )
       LEFT JOIN sku_aliases a
              ON a.platform = i.platform
             AND a.external_id = i.external_item_id
       LEFT JOIN skus s
              ON s.id = a.sku_id
             AND s.client_id = i.client_id
     ON CONFLICT (processed_item_id, external_id) DO NOTHING
     RETURNING id`,
    values
  );

  return result.rowCount ?? 0;
}

/**
 * Backfill helper: a single processed_items page often has many
 * orders, each with its own line items. This wrapper iterates
 * (parent → items) tuples and calls bulkInsertLineItemsForParent
 * for each parent. One INSERT per parent keeps the SQL simple +
 * lets the per-parent UNIQUE constraint stay clean.
 *
 * Returns the total number of NEW line items inserted across all
 * parents (does not count rows skipped by ON CONFLICT).
 */
export async function bulkInsertLineItemsAcrossParents(opts: {
  dbClient?: PoolClient;
  clientId: number;
  platform: LineItemPlatform;
  parents: Array<{
    parentId: number;
    soldAt: string;
    items: InternalLineItem[];
  }>;
}): Promise<number> {
  let total = 0;
  for (const p of opts.parents) {
    const n = await bulkInsertLineItemsForParent({
      dbClient: opts.dbClient,
      parentId: p.parentId,
      clientId: opts.clientId,
      platform: opts.platform,
      soldAt: p.soldAt,
      items: p.items,
    });
    total += n;
  }
  return total;
}
