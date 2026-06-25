// lib/inventory/receiveFromExpense.ts
//
// Shared logic for "receive a purchase into a component's stock", used by
// both the standalone /api/inventory/receive-from-expense route (the card
// action) and the /api/expenses POST (inline in the Add-an-expense form).
//
// Inventory/margin-side only: the expense row itself is untouched, so it
// still counts as the cash-basis cost in Net Profit. Receiving adds stock
// + sets the component's per-unit cost (for the margin view + ending-
// inventory value). Caller MUST run this inside a transaction (pass the
// PoolClient) so stock + cost + relink can't half-apply.

import type { PoolClient } from "pg";
import { recordManualAdjustment } from "./adjustments";
import { recomputeParentsUsing } from "./costRollup";
import { addCostLayer } from "./costLayers";

export async function receiveExpenseIntoInventory(opts: {
  dbClient: PoolClient;
  clientId: number;
  processedItemId: number;
  skuId: number;
  quantity: number;
  amount: number;
  vendor: string;
  /** YYYY-MM-DD — the purchase date; the new cost row is effective here. */
  effectiveDate: string;
}): Promise<{ quantityOnHand: number; unitCost: number }> {
  const {
    dbClient: db,
    clientId,
    processedItemId,
    skuId,
    quantity,
    amount,
    vendor,
    effectiveDate,
  } = opts;

  const unitCost = amount / quantity;

  // 1. Add the quantity to the component's stock.
  const quantityOnHand = await recordManualAdjustment({
    dbClient: db,
    skuId,
    delta: quantity, // positive = receive
    reason: "receive",
    notes: `Received from ${vendor}`,
  });

  // 2. Set the component's per-unit cost from this purchase (the "current
  //    cost" display row). UNIQUE(sku_id, effective_date) means a second
  //    same-day receipt would collide — upsert to the latest price rather
  //    than crash. The distinct FIFO layers below are what get consumed.
  await db.query(
    `INSERT INTO sku_cost_history (sku_id, cost, currency, effective_date, notes)
     VALUES ($1, $2, 'USD', $3, $4)
     ON CONFLICT (sku_id, effective_date)
       DO UPDATE SET cost = EXCLUDED.cost, notes = EXCLUDED.notes`,
    [
      skuId,
      unitCost,
      effectiveDate,
      `From ${vendor} ($${amount.toFixed(2)} ÷ ${quantity})`,
    ]
  );

  // 2b. FIFO: record this receipt as a cost layer so COGS drains it
  //     oldest-first. The sku_cost_history row above stays for the
  //     "current cost" display; this layer is what actually gets consumed.
  await addCostLayer({
    dbClient: db,
    clientId,
    skuId,
    source: "receive",
    sourceRefId: processedItemId,
    acquiredAt: effectiveDate,
    quantity,
    unitCost,
    notes: `From ${vendor}`,
  });

  // 3. Refresh rolled-up cost of any products using this component
  //    (best-effort — reconciles on the next recipe touch if it hiccups).
  try {
    await recomputeParentsUsing(skuId, clientId, db);
  } catch (rollupErr) {
    console.error("Cost rollup after receive failed:", rollupErr);
  }

  // 4. Link the expense so it can't be received twice.
  await db.query(
    `UPDATE processed_items
        SET received_sku_id = $1, received_quantity = $2, updated_at = NOW()
      WHERE id = $3 AND client_id = $4`,
    [skuId, quantity, processedItemId, clientId]
  );

  return { quantityOnHand, unitCost };
}
