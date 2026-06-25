// lib/inventory/production.ts
//
// Tier 2 commit 4. The production-run engine — "I made a batch."
// Records a run, adds finished-goods stock, and draws down the
// recipe's component materials, all in one transaction. Every stock
// move is tagged with the run id so the whole thing reverses
// cleanly.
//
// Decisions (session-notes/design-tier2-bom.md):
//   D1  sales don't deduct components — only production runs do.
//   D5  negative stock allowed (honest data) — a run that over-draws
//       a component leaves it negative + visibly red. No block.
//   D7  no-recipe run → allowed + flagged (hadRecipe=false in the
//       result). The finished stock is added; nothing is deducted.
//
// Owns its own transaction via pool.connect() (unlike the
// adjustments helpers, which accept a caller's dbClient) — a
// production run is a self-contained unit of work.

import pool from "@/lib/db";
import {
  addCostLayer,
  consumeFifo,
  lastKnownUnitCost,
  restoreConsumptions,
  productionOutputConsumed,
} from "./costLayers";

export interface ProductionRunResult {
  runId: number;
  finishedSkuId: number;
  quantityProduced: number;
  /** False when the finished SKU had no recipe — stock was added
   *  but no materials were deducted (D7). UI surfaces a nudge. */
  hadRecipe: boolean;
  componentsConsumed: Array<{
    componentSkuId: number;
    code: string;
    name: string;
    unit: string;
    consumed: number;
  }>;
}

/**
 * Record a production run. Adds quantityProduced to the finished
 * SKU and deducts each recipe component × quantityProduced.
 * Transactional — either the whole batch applies or none of it.
 */
export async function recordProductionRun(opts: {
  clientId: number;
  finishedSkuId: number;
  quantityProduced: number;
  runDate: string; // YYYY-MM-DD
  notes?: string | null;
}): Promise<ProductionRunResult> {
  const { clientId, finishedSkuId, quantityProduced, runDate } = opts;
  const notes = opts.notes ?? null;

  const db = await pool.connect();
  try {
    await db.query("BEGIN");

    // Confirm the finished SKU belongs to the client (tenant scope).
    const owns = await db.query(
      `SELECT id FROM skus WHERE id = $1 AND client_id = $2`,
      [finishedSkuId, clientId]
    );
    if (owns.rowCount === 0) {
      throw new Error("Finished SKU not found");
    }

    // Load the recipe (with component metadata for the result).
    const recipe = await db.query<{
      component_sku_id: number;
      quantity_per_unit: string;
      code: string;
      name: string;
      unit: string;
    }>(
      `SELECT b.component_sku_id, b.quantity_per_unit,
              s.code, s.name, s.unit
         FROM bom_components b
         JOIN skus s ON s.id = b.component_sku_id
        WHERE b.parent_sku_id = $1
          AND b.client_id = $2`,
      [finishedSkuId, clientId]
    );

    // 1. The run row.
    const runRes = await db.query<{ id: number }>(
      `INSERT INTO production_runs
         (client_id, finished_sku_id, quantity_produced, run_date, notes)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [clientId, finishedSkuId, quantityProduced, runDate, notes]
    );
    const runId = runRes.rows[0].id;

    // 2. Finished goods +quantityProduced (production_in).
    await db.query(
      `INSERT INTO inventory_adjustments
         (sku_id, delta, reason, production_run_id, notes)
       VALUES ($1, $2, 'production_in', $3, $4)`,
      [finishedSkuId, quantityProduced, runId, notes]
    );
    await db.query(
      `UPDATE skus SET quantity_on_hand = quantity_on_hand + $1 WHERE id = $2`,
      [quantityProduced, finishedSkuId]
    );

    // 3. Each component −(quantityProduced × qtyPerUnit) (production_out).
    //    Quantity moves via inventory_adjustments; cost drains the
    //    component's oldest FIFO layers (consumeFifo) so the finished
    //    batch is costed at the real price of the stock actually used —
    //    blended automatically when a draw spans old + new layers.
    const componentsConsumed: ProductionRunResult["componentsConsumed"] = [];
    let totalComponentCost = 0;
    let anyEstimated = false;
    for (const c of recipe.rows) {
      const perUnit = parseFloat(c.quantity_per_unit);
      const consumed = quantityProduced * perUnit;
      await db.query(
        `INSERT INTO inventory_adjustments
           (sku_id, delta, reason, production_run_id)
         VALUES ($1, $2, 'production_out', $3)`,
        [c.component_sku_id, -consumed, runId]
      );
      await db.query(
        `UPDATE skus SET quantity_on_hand = quantity_on_hand - $1 WHERE id = $2`,
        [consumed, c.component_sku_id]
      );
      const draw = await consumeFifo({
        dbClient: db,
        clientId,
        skuId: c.component_sku_id,
        quantity: consumed,
        reason: "production_out",
        productionRunId: runId,
      });
      totalComponentCost += draw.totalCost;
      if (draw.isEstimated) anyEstimated = true;
      componentsConsumed.push({
        componentSkuId: c.component_sku_id,
        code: c.code,
        name: c.name,
        unit: c.unit,
        consumed,
      });
    }

    // 4. Stamp the finished batch as its own FIFO layer at the real
    //    blended cost (Σ component FIFO cost ÷ units produced). A sale
    //    later drains these finished layers oldest-first. With no recipe,
    //    fall back to the finished SKU's last-known cost so an estimated-
    //    cost product still gets a sensible basis.
    let finishedUnitCost =
      quantityProduced > 0 ? totalComponentCost / quantityProduced : 0;
    if (recipe.rowCount! === 0) {
      finishedUnitCost = await lastKnownUnitCost(db, finishedSkuId);
    }
    await addCostLayer({
      dbClient: db,
      clientId,
      skuId: finishedSkuId,
      source: "production",
      sourceRefId: runId,
      acquiredAt: runDate,
      quantity: quantityProduced,
      unitCost: finishedUnitCost,
      notes: anyEstimated
        ? "Cost partly estimated (a component had no cost basis)"
        : null,
    });

    await db.query("COMMIT");

    return {
      runId,
      finishedSkuId,
      quantityProduced,
      hadRecipe: recipe.rowCount! > 0,
      componentsConsumed,
    };
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  } finally {
    db.release();
  }
}

/**
 * Reverse a production run: undo every stock move it caused and
 * delete the run. Credits components back, removes the finished
 * stock. Transactional + tenant-scoped.
 *
 * Returns true if a run was reversed, false if it didn't exist /
 * belonged to another client.
 */
export async function reverseProductionRun(opts: {
  clientId: number;
  runId: number;
}): Promise<boolean> {
  const { clientId, runId } = opts;

  const db = await pool.connect();
  try {
    await db.query("BEGIN");

    // Tenant-scoped existence check.
    const run = await db.query(
      `SELECT id FROM production_runs WHERE id = $1 AND client_id = $2`,
      [runId, clientId]
    );
    if (run.rowCount === 0) {
      await db.query("ROLLBACK");
      return false;
    }

    // Guard: if this run's finished output has already been (partly) sold,
    // its FIFO layer is consumed — reversing would orphan a sale's COGS.
    if (await productionOutputConsumed(db, runId)) {
      await db.query("ROLLBACK");
      throw new Error(
        "Can't reverse this run — some of its finished goods have already been sold."
      );
    }

    // Reverse each adjustment's stock effect, then delete the
    // adjustments — BEFORE deleting the run (the FK is ON DELETE
    // SET NULL, so deleting the run first would orphan the link).
    const adjustments = await db.query<{ sku_id: number; delta: string }>(
      `SELECT sku_id, delta FROM inventory_adjustments
        WHERE production_run_id = $1`,
      [runId]
    );
    for (const a of adjustments.rows) {
      // Subtract the delta to undo it (delta was + for finished,
      // − for components).
      await db.query(
        `UPDATE skus SET quantity_on_hand = quantity_on_hand - $1 WHERE id = $2`,
        [parseFloat(a.delta), a.sku_id]
      );
    }
    await db.query(
      `DELETE FROM inventory_adjustments WHERE production_run_id = $1`,
      [runId]
    );
    // FIFO: credit consumed component layers back, then drop the
    // finished-goods layer this run created (the guard above ensured it's
    // untouched, so deleting it loses nothing).
    await restoreConsumptions({ dbClient: db, productionRunId: runId });
    await db.query(
      `DELETE FROM cost_layers WHERE source = 'production' AND source_ref_id = $1`,
      [runId]
    );
    await db.query(
      `DELETE FROM production_runs WHERE id = $1 AND client_id = $2`,
      [runId, clientId]
    );

    await db.query("COMMIT");
    return true;
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  } finally {
    db.release();
  }
}
