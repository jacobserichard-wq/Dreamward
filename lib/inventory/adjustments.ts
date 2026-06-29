// lib/inventory/adjustments.ts
//
// Sub-session 33 Tier 1 commit 2 of 4. Inventory ledger helpers.
// Every change to stock (sale, receive, manual, recount, correction)
// goes through one of these functions so the ledger and the
// skus.quantity_on_hand cache stay in lockstep.
//
// Architectural rules:
//
//   1. recordSaleAdjustments + reverseSaleAdjustments handle the
//      SALES path — invoked from the line-item insert/resolve/unresolve
//      hooks in lib/cogs/lineItems.ts + lib/cogs/aliases.ts. Callers
//      do NOT pass reason — it's always 'sale' here.
//
//   2. recordManualAdjustment handles every other path — manual
//      receive ("got a shipment"), recount ("counted today, off by 3"),
//      and correction ("undo that bad entry from yesterday"). The
//      Commit 3 receive-stock API route is the first caller.
//
//   3. All functions accept an optional `dbClient` so callers in
//      a wider transaction can pass theirs. The ledger insert + the
//      skus.quantity_on_hand UPDATE MUST run in the same transaction
//      so a crash between them can't desync the two layers.
//
// Negative-stock policy (per roadmap §"Open questions for Tier 1"):
//   ALLOWED with no special handling. Merchants who map a long-
//   selling SKU before setting initial stock will see negative
//   quantity_on_hand — that's honest information about a data-quality
//   gap, not an error. UI (Commit 4) renders negative values as red
//   so the issue surfaces visually.

import type { PoolClient } from "pg";
import pool from "@/lib/db";
import { consumeFifo, restoreConsumptions } from "./costLayers";

export type AdjustmentReason =
  | "sale"
  | "receive"
  | "manual"
  | "recount"
  | "correction"
  | "production_in"
  | "production_out";

/** One row to write to the ledger from a sale event. quantity is
 *  positive — the helper converts to negative delta internally. */
export interface SaleAdjustmentInput {
  /** The processed_item_line_items.id this adjustment originates
   *  from. UNIQUE-indexed in the DB so re-runs are no-ops. */
  lineItemId: number;
  /** The resolved skus.id to decrement. Caller must filter out
   *  line items with matched_sku_id IS NULL before calling. */
  skuId: number;
  /** Units sold. Will be negated and stored as delta. Fractional
   *  supported (Tier 2 — delta is NUMERIC) for weighed goods. */
  quantity: number;
  /** YYYY-MM-DD sale date. When set, FIFO consumes only layers acquired
   *  on/before it (era-correct COGS for retroactively-resolved historical
   *  sales). Omit for live sales — they consume all open layers. */
  soldAt?: string;
}

/**
 * Record sale adjustments for one or more line items and decrement
 * the corresponding SKUs' quantity_on_hand. Atomic per call.
 *
 * Idempotent: the partial UNIQUE index on
 * inventory_adjustments.source_line_item_id (WHERE NOT NULL) rejects
 * any second sale-row for the same line_item_id. We swallow that
 * specific duplicate-key error so webhook redelivery + backfill
 * resumption stay clean; any OTHER error propagates.
 *
 * Returns the count of new sale adjustments inserted (excludes
 * duplicates).
 */
export async function recordSaleAdjustments(opts: {
  dbClient?: PoolClient;
  items: SaleAdjustmentInput[];
}): Promise<number> {
  if (opts.items.length === 0) return 0;
  const db = opts.dbClient ?? pool;

  // Tier 2: fractional quantities flow through unchanged (delta is
  // NUMERIC now). Just take the absolute value — the negation to a
  // decrement happens when we build the delta below. Drop any
  // non-positive quantities defensively.
  const normalized = opts.items
    .map((it) => ({
      lineItemId: it.lineItemId,
      skuId: it.skuId,
      quantity: Math.abs(it.quantity),
      soldAt: it.soldAt,
    }))
    .filter((it) => it.quantity > 0);

  if (normalized.length === 0) return 0;

  // Per-line sale date (for era-correct FIFO on retroactive resolution).
  // Empty for live sales → consumeFifo consumes all open layers as before.
  const soldAtByLine = new Map<number, string | undefined>(
    normalized.map((it) => [it.lineItemId, it.soldAt])
  );

  // ── 1. Insert the ledger rows ────────────────────────────────
  // ON CONFLICT DO NOTHING on the partial UNIQUE index handles
  // webhook re-delivery without throwing. RETURNING gives us the
  // rows that were actually new so we know which SKUs to decrement.
  const insertValues: unknown[] = [];
  const insertPlaceholders = normalized
    .map((it, idx) => {
      const base = insertValues.length;
      insertValues.push(it.skuId, -it.quantity, it.lineItemId);
      return `($${base + 1}, $${base + 2}, 'sale', $${base + 3})`;
    })
    .join(",");

  // delta comes back as a STRING (pg serializes NUMERIC as text) —
  // parseFloat before any arithmetic, or "+= row.delta" would
  // string-concatenate.
  const inserted = await db.query<{
    sku_id: number;
    delta: string;
    source_line_item_id: number;
  }>(
    `INSERT INTO inventory_adjustments (sku_id, delta, reason, source_line_item_id)
     VALUES ${insertPlaceholders}
     ON CONFLICT (source_line_item_id) WHERE source_line_item_id IS NOT NULL DO NOTHING
     RETURNING sku_id, delta, source_line_item_id`,
    insertValues
  );

  if (inserted.rowCount === 0) return 0;

  // ── 2. Aggregate deltas per SKU then UPDATE each one once ────
  // Multiple line items for the same SKU (rare but possible — e.g.,
  // a Square ring-up that splits a quantity-3 candle into 3 separate
  // lines) get collapsed into one UPDATE per SKU. Reduces lock
  // churn on the skus row.
  const perSku = new Map<number, number>();
  for (const row of inserted.rows) {
    perSku.set(
      row.sku_id,
      (perSku.get(row.sku_id) ?? 0) + parseFloat(row.delta)
    );
  }

  for (const [skuId, totalDelta] of perSku) {
    await db.query(
      `UPDATE skus SET quantity_on_hand = quantity_on_hand + $1 WHERE id = $2`,
      [totalDelta, skuId]
    );
  }

  // ── 3. Stamp FIFO COGS on each newly-inserted line item ──────
  // Only genuinely-new rows are costed (ON CONFLICT skipped re-deliveries),
  // so a webhook retry or backfill resume can't double-consume layers.
  // consumeFifo drains the finished good's layers oldest-first; a product
  // sold without a logged production run has no layers, so it falls back to
  // the rolled-up cost and flags the line item estimated. Each line item is
  // costed independently and in order, so two lines of the same SKU drain
  // sequentially (correct FIFO).
  for (const row of inserted.rows) {
    const qty = Math.abs(parseFloat(row.delta));
    if (!(qty > 0)) continue;
    const draw = await consumeFifo({
      dbClient: db,
      skuId: row.sku_id,
      quantity: qty,
      reason: "sale",
      lineItemId: row.source_line_item_id,
      asOf: soldAtByLine.get(row.source_line_item_id) ?? null,
    });
    await db.query(
      `UPDATE processed_item_line_items
          SET cogs_amount = $1, cogs_is_estimated = $2
        WHERE id = $3`,
      [draw.totalCost, draw.isEstimated, row.source_line_item_id]
    );
  }

  return inserted.rowCount ?? 0;
}

/**
 * Reverse sale adjustments for the given line item ids and credit
 * the stock back. Used when an alias is removed (deleteAliasAndUnresolve)
 * so historical sales that were decrementing stock through that
 * mapping return their units to the on-hand count.
 *
 * Hard-deletes the adjustment rows — the reconciliation invariant
 * (SUM(delta) per sku == quantity_on_hand) stays satisfied because
 * we simultaneously credit the cache. The processed_item_line_items
 * row itself stays in place; only its inventory side-effect is
 * undone.
 *
 * Returns the count of adjustments deleted.
 */
export async function reverseSaleAdjustments(opts: {
  dbClient?: PoolClient;
  lineItemIds: number[];
}): Promise<number> {
  if (opts.lineItemIds.length === 0) return 0;
  const db = opts.dbClient ?? pool;

  // ── 1. Delete the sale adjustments and capture what we removed
  // so we can credit each SKU back by the right amount.
  // delta returns as a STRING (NUMERIC) — parseFloat before math.
  const deleted = await db.query<{ sku_id: number; delta: string }>(
    `DELETE FROM inventory_adjustments
      WHERE reason = 'sale'
        AND source_line_item_id = ANY($1)
     RETURNING sku_id, delta`,
    [opts.lineItemIds]
  );

  if (deleted.rowCount === 0) return 0;

  // ── 2. Credit stock back per SKU. delta was negative (sale) so
  // we subtract it to add the absolute value back — equivalent to
  // adding -delta.
  const perSku = new Map<number, number>();
  for (const row of deleted.rows) {
    perSku.set(
      row.sku_id,
      (perSku.get(row.sku_id) ?? 0) - parseFloat(row.delta)
    );
  }

  for (const [skuId, credit] of perSku) {
    await db.query(
      `UPDATE skus SET quantity_on_hand = quantity_on_hand + $1 WHERE id = $2`,
      [credit, skuId]
    );
  }

  // FIFO: restore the layers each reversed line item consumed and clear
  // its stamped COGS, so re-mapping later re-costs cleanly.
  for (const id of opts.lineItemIds) {
    await restoreConsumptions({ dbClient: db, lineItemId: id });
  }
  await db.query(
    `UPDATE processed_item_line_items
        SET cogs_amount = NULL, cogs_is_estimated = FALSE
      WHERE id = ANY($1)`,
    [opts.lineItemIds]
  );

  return deleted.rowCount ?? 0;
}

/**
 * Manual stock adjustment — receive, recount, manual, correction.
 * Called from the Commit 3 receive-stock UI and from any future
 * support tooling that needs to fix a desynced count.
 *
 * Always provided in absolute delta terms (positive = add stock,
 * negative = remove). reason must be one of the non-'sale' enum
 * values; sale path goes through recordSaleAdjustments instead
 * so the UNIQUE-by-line_item idempotency applies.
 *
 * Returns the new quantity_on_hand after the adjustment.
 */
export async function recordManualAdjustment(opts: {
  dbClient?: PoolClient;
  skuId: number;
  delta: number;
  reason: Exclude<AdjustmentReason, "sale">;
  notes?: string | null;
}): Promise<number> {
  if (opts.delta === 0) {
    throw new Error("delta must be non-zero");
  }
  const db = opts.dbClient ?? pool;

  await db.query(
    `INSERT INTO inventory_adjustments (sku_id, delta, reason, notes)
     VALUES ($1, $2, $3, $4)`,
    [opts.skuId, opts.delta, opts.reason, opts.notes ?? null]
  );

  // quantity_on_hand returns as a STRING (NUMERIC) — parse to number
  // for the caller.
  const updated = await db.query<{ quantity_on_hand: string }>(
    `UPDATE skus
        SET quantity_on_hand = quantity_on_hand + $1
      WHERE id = $2
      RETURNING quantity_on_hand`,
    [opts.delta, opts.skuId]
  );

  if (updated.rowCount === 0) {
    throw new Error(`SKU ${opts.skuId} not found`);
  }
  return parseFloat(updated.rows[0].quantity_on_hand);
}
