// lib/inventory/valuation.ts
//
// Inventory valuation — total stock value + point-in-time snapshots
// for Schedule-C / Form 1125-A beginning + ending inventory.
//
// computeInventoryValue is "as of now": the FIFO value of stock still on
// hand = SUM(remaining_qty × unit_cost) across the client's open cost
// layers. This is the true ending-inventory cost basis (Form 1125-A) —
// the un-sold tail of every purchase at the price actually paid. It can't
// reconstruct historical stock, so beginning/ending inventory for a
// report year comes from inventory_snapshots — point-in-time records the
// cron lays down monthly. Going forward those build the history; for the
// current year's ending we fall back to the live value.

import type { PoolClient } from "pg";
import pool from "@/lib/db";

/** Current total inventory value for a client = the FIFO cost of stock
 *  still on hand (Σ remaining cost layers). Stock with no cost layer
 *  contributes 0. */
export async function computeInventoryValue(
  clientId: number,
  dbClient?: PoolClient
): Promise<number> {
  const db = dbClient ?? pool;
  const res = await db.query<{ total: string }>(
    `SELECT COALESCE(SUM(cl.remaining_qty * cl.unit_cost), 0) AS total
       FROM cost_layers cl
       JOIN skus s ON s.id = cl.sku_id
      WHERE cl.client_id = $1
        AND cl.remaining_qty > 0
        AND s.active`,
    [clientId]
  );
  return Number(res.rows[0]?.total ?? 0);
}

/** Record (or refresh) today's inventory-value snapshot for a
 *  client. Idempotent via the UNIQUE(client_id, snapshot_date)
 *  constraint — re-running on the same date overwrites. Returns the
 *  value recorded. */
export async function recordInventorySnapshot(
  clientId: number,
  snapshotDate: string, // YYYY-MM-DD
  dbClient?: PoolClient
): Promise<number> {
  const db = dbClient ?? pool;
  const value = await computeInventoryValue(clientId, dbClient);
  await db.query(
    `INSERT INTO inventory_snapshots (client_id, snapshot_date, total_value)
     VALUES ($1, $2, $3)
     ON CONFLICT (client_id, snapshot_date)
     DO UPDATE SET total_value = EXCLUDED.total_value`,
    [clientId, snapshotDate, value]
  );
  return value;
}

export interface InventoryValuation {
  /** Inventory value at the start of the report year (= the latest
   *  snapshot on/before Dec 31 of the prior year). Null when no
   *  snapshot exists yet (first year of use). */
  beginning: number | null;
  /** Inventory value at the end of the report year. For the current
   *  year this is the live computed value; for past years it's the
   *  latest snapshot on/before Dec 31 of that year. Null when
   *  neither is available. */
  ending: number | null;
  /** True when `ending` is the live value rather than a snapshot
   *  (i.e., the report year is the current year). */
  endingIsLive: boolean;
}

/** Resolve beginning + ending inventory for a report year from the
 *  snapshot history (with a live fallback for the current year's
 *  ending). */
export async function getInventoryValuation(opts: {
  clientId: number;
  year: number;
  currentYear: number;
}): Promise<InventoryValuation> {
  const { clientId, year, currentYear } = opts;

  // Beginning = latest snapshot on/before Dec 31 of the prior year.
  const beginningRes = await pool.query<{ total_value: string }>(
    `SELECT total_value FROM inventory_snapshots
      WHERE client_id = $1
        AND snapshot_date <= $2
      ORDER BY snapshot_date DESC
      LIMIT 1`,
    [clientId, `${year - 1}-12-31`]
  );
  const beginning =
    beginningRes.rowCount! > 0
      ? Number(beginningRes.rows[0].total_value)
      : null;

  // Ending.
  let ending: number | null;
  let endingIsLive = false;
  if (year >= currentYear) {
    // Current (or future) year — use the live value.
    ending = await computeInventoryValue(clientId);
    endingIsLive = true;
  } else {
    const endingRes = await pool.query<{ total_value: string }>(
      `SELECT total_value FROM inventory_snapshots
        WHERE client_id = $1
          AND snapshot_date <= $2
        ORDER BY snapshot_date DESC
        LIMIT 1`,
      [clientId, `${year}-12-31`]
    );
    ending =
      endingRes.rowCount! > 0 ? Number(endingRes.rows[0].total_value) : null;
  }

  return { beginning, ending, endingIsLive };
}
