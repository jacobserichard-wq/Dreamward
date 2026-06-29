// lib/inventory/costLayers.ts
//
// The FIFO (first-in, first-out) costing engine. Stock acquired at a
// known unit cost becomes a "layer" with a remaining quantity; consuming
// stock drains the oldest layers first and records exactly which layer
// each draw-down hit. This is what makes COGS follow the actual units:
// old stock is costed at its real purchase price until depleted, then the
// next purchase's price takes over, and a single draw that spans two
// layers (e.g. 30 left at the old price + 20 at the new) blends them.
//
// Tables (migration 0037):
//   cost_layers       — the batches, drained via remaining_qty.
//   cost_consumptions — per-layer audit of every draw-down (reversible).
//
// All functions take the caller's PoolClient (`dbClient`) and MUST run
// inside that caller's transaction, so a stock move + its cost move + its
// consumption ledger all commit or roll back together.

import type { Pool, PoolClient } from "pg";

/** Either a pooled client (inside a transaction) or the shared pool.
 *  Both expose .query; consumeFifo's FOR UPDATE is only meaningful inside
 *  a transaction, so callers that mutate should pass a PoolClient. */
type Db = Pool | PoolClient;

/** Round a quantity to the DB's NUMERIC(14,4) scale to avoid FP drift. */
function q4(n: number): number {
  return Math.round((n + Number.EPSILON) * 1e4) / 1e4;
}
/** Round a cost to the DB's NUMERIC(14,6) scale. */
function c6(n: number): number {
  return Math.round((n + Number.EPSILON) * 1e6) / 1e6;
}

export type LayerSource = "receive" | "production" | "opening" | "manual";
export type ConsumeReason =
  | "production_out"
  | "sale"
  | "manual_out"
  | "correction";

/**
 * Add a cost layer — a batch of `quantity` units acquired at `unitCost`.
 * Returns the new layer id. Quantity must be > 0; a zero/negative receipt
 * is a no-op caller error and throws.
 */
export async function addCostLayer(opts: {
  dbClient: Db;
  clientId: number;
  skuId: number;
  source: LayerSource;
  sourceRefId?: number | null;
  /** YYYY-MM-DD — the FIFO ordering key (when the stock was acquired). */
  acquiredAt: string;
  quantity: number;
  unitCost: number;
  notes?: string | null;
}): Promise<number> {
  const quantity = q4(opts.quantity);
  const unitCost = c6(Math.max(0, opts.unitCost));
  if (!(quantity > 0)) {
    throw new Error(`addCostLayer: quantity must be > 0 (got ${opts.quantity})`);
  }
  const res = await opts.dbClient.query<{ id: number }>(
    `INSERT INTO cost_layers
       (client_id, sku_id, source, source_ref_id, acquired_at,
        original_qty, remaining_qty, unit_cost, notes)
     VALUES ($1, $2, $3, $4, $5, $6, $6, $7, $8)
     RETURNING id`,
    [
      opts.clientId,
      opts.skuId,
      opts.source,
      opts.sourceRefId ?? null,
      opts.acquiredAt,
      quantity,
      unitCost,
      opts.notes ?? null,
    ]
  );
  return res.rows[0].id;
}

/**
 * The most recent cost basis for a SKU, used as the fallback unit cost
 * when a draw-down out-runs available layers (negative stock). Tries, in
 * order: the newest layer's unit_cost (even if drained), then the newest
 * sku_cost_history cost, then 0. A 0 here always travels with an
 * is_estimated flag — never a silent zero.
 */
export async function lastKnownUnitCost(
  db: Db,
  skuId: number
): Promise<number> {
  const layer = await db.query<{ unit_cost: string }>(
    `SELECT unit_cost FROM cost_layers
      WHERE sku_id = $1
      ORDER BY acquired_at DESC, id DESC
      LIMIT 1`,
    [skuId]
  );
  if (layer.rowCount && layer.rows[0].unit_cost != null) {
    return Number(layer.rows[0].unit_cost) || 0;
  }
  const hist = await db.query<{ cost: string }>(
    `SELECT cost FROM sku_cost_history
      WHERE sku_id = $1
      ORDER BY effective_date DESC
      LIMIT 1`,
    [skuId]
  );
  if (hist.rowCount && hist.rows[0].cost != null) {
    return Number(hist.rows[0].cost) || 0;
  }
  return 0;
}

export interface ConsumeResult {
  /** Total cost of the consumed quantity (sum across layers + any
   *  negative-stock fallback). */
  totalCost: number;
  /** Blended per-unit cost (totalCost / quantity), or 0 if quantity is 0. */
  unitCost: number;
  /** True when the draw-down out-ran available layers and part of the
   *  cost is a last-known-cost fallback. The caller must surface this
   *  (e.g. cogs_is_estimated on the line item). */
  isEstimated: boolean;
}

/**
 * Consume `quantity` units of a SKU, oldest layer first. Decrements each
 * layer's remaining_qty, writes a cost_consumptions row per layer touched,
 * and returns the blended cost.
 *
 * Negative stock (D5 — allowed): if the layers can't cover `quantity`, the
 * shortfall is costed at lastKnownUnitCost and the result is flagged
 * isEstimated. The shortfall has no layer to attach to, so it gets no
 * consumption row — it lives only in the returned cost + the flag (and the
 * line item's cogs_is_estimated). On reversal there's nothing to restore
 * for it, which is correct.
 *
 * Rows are locked FOR UPDATE so two concurrent consumers can't double-spend
 * the same layer.
 */
export async function consumeFifo(opts: {
  dbClient: Db;
  /** Not used in SQL (layers scope by sku_id) — accepted for symmetry
   *  with addCostLayer and so callers can pass it harmlessly. */
  clientId?: number;
  skuId: number;
  quantity: number;
  reason: ConsumeReason;
  productionRunId?: number | null;
  lineItemId?: number | null;
  /** When set (YYYY-MM-DD), only consume layers acquired ON OR BEFORE this
   *  date — so a retroactively-resolved historical sale draws the cost
   *  layers that existed at sale time, not today's newer ones. Omit for
   *  live sales/production (consume all open layers, oldest first). */
  asOf?: string | null;
}): Promise<ConsumeResult> {
  const db = opts.dbClient;
  let need = q4(opts.quantity);
  if (!(need > 0)) {
    return { totalCost: 0, unitCost: 0, isEstimated: false };
  }

  const layers = await db.query<{
    id: number;
    remaining_qty: string;
    unit_cost: string;
  }>(
    `SELECT id, remaining_qty, unit_cost
       FROM cost_layers
      WHERE sku_id = $1 AND remaining_qty > 0
        ${opts.asOf ? "AND acquired_at <= $2" : ""}
      ORDER BY acquired_at, id
      FOR UPDATE`,
    opts.asOf ? [opts.skuId, opts.asOf] : [opts.skuId]
  );

  let totalCost = 0;
  for (const layer of layers.rows) {
    if (need <= 0) break;
    const available = Number(layer.remaining_qty) || 0;
    const unit = Number(layer.unit_cost) || 0;
    const take = q4(Math.min(available, need));
    if (take <= 0) continue;

    await db.query(
      `UPDATE cost_layers SET remaining_qty = remaining_qty - $1 WHERE id = $2`,
      [take, layer.id]
    );
    await db.query(
      `INSERT INTO cost_consumptions
         (layer_id, sku_id, consumed_qty, unit_cost, reason,
          production_run_id, line_item_id, is_estimated)
       VALUES ($1, $2, $3, $4, $5, $6, $7, FALSE)`,
      [
        layer.id,
        opts.skuId,
        take,
        c6(unit),
        opts.reason,
        opts.productionRunId ?? null,
        opts.lineItemId ?? null,
      ]
    );
    totalCost += take * unit;
    need = q4(need - take);
  }

  let isEstimated = false;
  if (need > 0) {
    // Negative stock: cost the shortfall at the last-known unit cost and
    // flag it. No layer exists to record a consumption against.
    const fallback = await lastKnownUnitCost(db, opts.skuId);
    totalCost += need * fallback;
    isEstimated = true;
  }

  totalCost = q4(totalCost);
  const consumed = q4(opts.quantity);
  return {
    totalCost,
    unitCost: consumed > 0 ? c6(totalCost / consumed) : 0,
    isEstimated,
  };
}

/**
 * Reverse the layer draw-downs caused by one event — a production run
 * (productionRunId) or a sold/voided line item (lineItemId). Credits each
 * consumed quantity back to its layer's remaining_qty, then deletes the
 * consumption rows. Idempotent: a second call finds no rows and no-ops.
 */
export async function restoreConsumptions(opts: {
  dbClient: Db;
  productionRunId?: number;
  lineItemId?: number;
}): Promise<void> {
  const db = opts.dbClient;
  const col = opts.productionRunId != null ? "production_run_id" : "line_item_id";
  const val = opts.productionRunId ?? opts.lineItemId;
  if (val == null) return;

  const rows = await db.query<{ layer_id: number; consumed_qty: string }>(
    `SELECT layer_id, consumed_qty FROM cost_consumptions WHERE ${col} = $1`,
    [val]
  );
  for (const r of rows.rows) {
    await db.query(
      `UPDATE cost_layers SET remaining_qty = remaining_qty + $1 WHERE id = $2`,
      [Number(r.consumed_qty) || 0, r.layer_id]
    );
  }
  await db.query(`DELETE FROM cost_consumptions WHERE ${col} = $1`, [val]);
}

/**
 * Has the finished-goods layer created by a production run already been
 * (partly) consumed — i.e. sold? Used to BLOCK reversing a production run
 * whose output has shipped (reversing would orphan a sale's COGS). True if
 * any production-sourced layer for that run has remaining_qty < original_qty.
 */
export async function productionOutputConsumed(
  db: Db,
  productionRunId: number
): Promise<boolean> {
  const res = await db.query<{ consumed: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM cost_layers
        WHERE source = 'production'
          AND source_ref_id = $1
          AND remaining_qty < original_qty
     ) AS consumed`,
    [productionRunId]
  );
  return res.rows[0]?.consumed ?? false;
}
