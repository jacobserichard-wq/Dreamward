// lib/inventory/costRollup.ts
//
// Inventory Pass 2 — component (BOM) cost rollup engine.
//
// A finished SKU can cost two ways (skus.costing_method):
//   'estimated'  — a flat per-unit cost the maker types in. Flows to
//                  COGS via sku_cost_history exactly as before.
//   'components' — cost is BUILT from the recipe: Σ(component
//                  quantity_per_unit × that component's current cost).
//
// Design decision (see session-notes + the Pass 2 plan): rather than
// teach the COGS SQL to roll up BOMs live (which would break the
// effective-date audit trail in lib/cogs/compute.ts), we MATERIALIZE
// the rolled-up cost back into sku_cost_history as a normal
// effective-dated row. Everything downstream (COGS dashboard, the
// /api/cogs/drill audit trail, inventory valuation, the cost modal,
// the card's "current cost") then keeps working unchanged, and
// historical COGS is never silently rewritten — the rolled-up row is
// always dated today.
//
// Integrity rule (no silent fallbacks): a rollup is only written when
// EVERY component has a cost. If any component is unpriced the rollup
// would understate COGS, so we DON'T touch the product's cost — we
// report `skipped: "incomplete"` and let the UI nudge the maker to
// finish pricing. computeBomUnitCost still returns the partial figure
// for a live preview, with missingCostCount so the preview can warn.

import type { PoolClient } from "pg";
import pool from "@/lib/db";

const DEFAULT_CURRENCY = "USD";

export interface BomCostLine {
  componentSkuId: number;
  code: string;
  name: string;
  unit: string;
  quantityPerUnit: number;
  /** Component's current effective unit cost (newest sku_cost_history
   *  row with effective_date <= today), or null when it has none. */
  unitCost: number | null;
  /** quantityPerUnit × (unitCost ?? 0). */
  lineCost: number;
  currency: string;
}

export interface BomCostResult {
  /** Σ lineCost. Components with no cost contribute 0 and are counted
   *  in missingCostCount — so this figure is a LOWER BOUND when
   *  missingCostCount > 0. */
  unitCost: number;
  lines: BomCostLine[];
  /** Components with no cost set. > 0 → unitCost is incomplete. */
  missingCostCount: number;
}

export type MaterializeSkip =
  | "not-component-costed"
  | "no-recipe"
  | "incomplete"
  | "unchanged";

export interface MaterializeResult {
  /** The computed rollup (may be partial when missingCostCount > 0). */
  unitCost: number;
  missingCostCount: number;
  /** True when a sku_cost_history row was written/updated. */
  written: boolean;
  /** Why nothing was written (absent when written === true). */
  skipped?: MaterializeSkip;
}

/** Round to the 4-dp precision of sku_cost_history.cost NUMERIC(12,4). */
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

/**
 * Compute the per-unit cost of a finished SKU from its recipe, using
 * each component's CURRENT effective cost (newest sku_cost_history row
 * with effective_date <= today).
 *
 * One level deep by design: a component that is itself component-costed
 * already has its own rolled-up cost sitting in sku_cost_history, so
 * reading its current cost composes correctly — provided leaves are
 * recomputed before parents (recomputeParentsUsing walks bottom-up).
 */
export async function computeBomUnitCost(
  skuId: number,
  clientId: number,
  dbClient?: PoolClient
): Promise<BomCostResult> {
  const db = dbClient ?? pool;
  const res = await db.query<{
    component_sku_id: number;
    code: string;
    name: string;
    unit: string;
    quantity_per_unit: string;
    unit_cost: string | null;
    currency: string | null;
  }>(
    `SELECT b.component_sku_id,
            s.code, s.name, s.unit,
            b.quantity_per_unit,
            ch.cost     AS unit_cost,
            ch.currency AS currency
       FROM bom_components b
       JOIN skus s ON s.id = b.component_sku_id
       LEFT JOIN LATERAL (
         SELECT cost, currency FROM sku_cost_history
          WHERE sku_id = b.component_sku_id
            AND effective_date <= CURRENT_DATE
          ORDER BY effective_date DESC
          LIMIT 1
       ) ch ON true
      WHERE b.parent_sku_id = $1
        AND b.client_id = $2
      ORDER BY s.name ASC`,
    [skuId, clientId]
  );

  let unitCost = 0;
  let missingCostCount = 0;
  const lines: BomCostLine[] = res.rows.map((r) => {
    const qty = Number(r.quantity_per_unit) || 0;
    const uc = r.unit_cost != null ? Number(r.unit_cost) : null;
    if (uc == null) missingCostCount += 1;
    const lineCost = round4(qty * (uc ?? 0));
    unitCost += lineCost;
    return {
      componentSkuId: r.component_sku_id,
      code: r.code,
      name: r.name,
      unit: r.unit,
      quantityPerUnit: qty,
      unitCost: uc,
      lineCost,
      currency: r.currency || DEFAULT_CURRENCY,
    };
  });

  return { unitCost: round4(unitCost), lines, missingCostCount };
}

/**
 * If `skuId` is component-costed and its recipe is fully priced,
 * recompute its rolled-up unit cost and write it to sku_cost_history
 * (effective today) when it differs from the SKU's current effective
 * cost. See the integrity rule at the top of the file for why an
 * incomplete recipe is left untouched.
 *
 * Pass the caller's `dbClient` to run inside a wider transaction.
 */
export async function materializeBomCost(
  skuId: number,
  clientId: number,
  dbClient?: PoolClient
): Promise<MaterializeResult> {
  const db = dbClient ?? pool;

  // Only component-costed SKUs auto-materialize. Verify + tenant scope.
  const skuRes = await db.query<{ costing_method: string }>(
    `SELECT costing_method FROM skus WHERE id = $1 AND client_id = $2`,
    [skuId, clientId]
  );
  if (skuRes.rowCount === 0) {
    return { unitCost: 0, missingCostCount: 0, written: false, skipped: "not-component-costed" };
  }
  if (skuRes.rows[0].costing_method !== "components") {
    return { unitCost: 0, missingCostCount: 0, written: false, skipped: "not-component-costed" };
  }

  const { unitCost, lines, missingCostCount } = await computeBomUnitCost(
    skuId,
    clientId,
    dbClient
  );

  // No recipe → nothing to roll up; leave any existing cost alone.
  if (lines.length === 0) {
    return { unitCost: 0, missingCostCount: 0, written: false, skipped: "no-recipe" };
  }

  // Incomplete recipe → would understate COGS. Don't write.
  if (missingCostCount > 0) {
    return { unitCost, missingCostCount, written: false, skipped: "incomplete" };
  }

  // Current effective cost (newest row <= today).
  const curRes = await db.query<{ cost: string }>(
    `SELECT cost FROM sku_cost_history
      WHERE sku_id = $1 AND effective_date <= CURRENT_DATE
      ORDER BY effective_date DESC LIMIT 1`,
    [skuId]
  );
  const current = curRes.rowCount! > 0 ? Number(curRes.rows[0].cost) : null;

  // Unchanged → don't spam history with duplicate rows. Half a tenth
  // of a cent tolerance covers float noise within NUMERIC(.,4).
  if (current != null && Math.abs(current - unitCost) < 0.00005) {
    return { unitCost, missingCostCount: 0, written: false, skipped: "unchanged" };
  }

  // Write today's rolled-up cost. UNIQUE(sku_id, effective_date) means
  // a second recompute on the same day updates the row in place rather
  // than stacking duplicates.
  await db.query(
    `INSERT INTO sku_cost_history (sku_id, cost, currency, effective_date, notes)
     VALUES ($1, $2, $3, CURRENT_DATE, $4)
     ON CONFLICT (sku_id, effective_date)
     DO UPDATE SET cost = EXCLUDED.cost, notes = EXCLUDED.notes`,
    [skuId, unitCost, DEFAULT_CURRENCY, "Built from components"]
  );
  return { unitCost, missingCostCount: 0, written: true };
}

/**
 * After a material (component) SKU's cost changes, re-roll every
 * component-costed product that uses it — and, when that actually
 * changes a product's cost, propagate further up (a rolled-up product
 * can itself be a component of something bigger).
 *
 * Walks bottom-up breadth-first. A visited set + depth cap defend
 * against recipe cycles and pathologically deep trees. Returns the
 * number of products whose cost was rewritten.
 */
export async function recomputeParentsUsing(
  componentSkuId: number,
  clientId: number,
  dbClient?: PoolClient
): Promise<number> {
  const db = dbClient ?? pool;
  const MAX_DEPTH = 20;
  const visited = new Set<number>();
  let recomputed = 0;
  let frontier: number[] = [componentSkuId];
  let depth = 0;

  while (frontier.length > 0 && depth < MAX_DEPTH) {
    const parentsRes = await db.query<{ parent_sku_id: number }>(
      `SELECT DISTINCT b.parent_sku_id
         FROM bom_components b
         JOIN skus s ON s.id = b.parent_sku_id
        WHERE b.component_sku_id = ANY($1::int[])
          AND b.client_id = $2
          AND s.costing_method = 'components'`,
      [frontier, clientId]
    );

    const next: number[] = [];
    for (const row of parentsRes.rows) {
      const pid = row.parent_sku_id;
      if (visited.has(pid)) continue;
      visited.add(pid);
      const result = await materializeBomCost(pid, clientId, dbClient);
      if (result.written) {
        recomputed += 1;
        next.push(pid); // its cost moved → its own parents may need a re-roll
      }
    }
    frontier = next;
    depth += 1;
  }

  return recomputed;
}
