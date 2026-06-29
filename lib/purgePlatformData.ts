// lib/purgePlatformData.ts
//
// Polish-queue fix (June 2026): shared inventory-aware purge used by
// the /api/{square,wix,etsy}/purge-data routes.
//
// The original purge routes were three copies of a bare
//   DELETE FROM processed_items WHERE client_id=$1 AND source=$2
// which left a data-quality hole: line items cascade with the
// parents (0018 ON DELETE CASCADE), but their inventory
// sale-adjustments survive with source_line_item_id nulled (0020 ON
// DELETE SET NULL) — so stock stayed decremented by sales that no
// longer existed in reports.
//
// This helper does it right, in one transaction:
//   1. Collect the line-item ids under the doomed parents
//   2. reverseSaleAdjustments — ledger rows deleted, stock credited
//   3. DELETE the parents (line items cascade)
// A crash between steps rolls everything back; the reconciliation
// invariant (SUM(delta) per sku == quantity_on_hand) holds
// throughout.
//
// Extracted to ONE module instead of pasting the transaction into
// three routes — triplication is exactly how the original gap
// drifted into place.

import pool from "@/lib/db";
import { reverseSaleAdjustments } from "@/lib/inventory/adjustments";
import { deleteAttachmentsForProcessedItems } from "@/lib/blob";

export type PurgeableSource = "shopify" | "wix" | "square" | "etsy";

export async function purgePlatformData(opts: {
  clientId: number;
  source: PurgeableSource;
}): Promise<{ deleted: number; adjustmentsReversed: number }> {
  const db = await pool.connect();
  try {
    await db.query("BEGIN");

    const lineItemsRes = await db.query<{ id: number }>(
      `SELECT li.id
         FROM processed_item_line_items li
         JOIN processed_items p ON p.id = li.processed_item_id
        WHERE p.client_id = $1 AND p.source = $2`,
      [opts.clientId, opts.source]
    );
    const lineItemIds = lineItemsRes.rows.map((r) => r.id);

    const adjustmentsReversed =
      lineItemIds.length > 0
        ? await reverseSaleAdjustments({ dbClient: db, lineItemIds })
        : 0;

    // Delete attachment blobs before the rows cascade them away.
    const parentIdsRes = await db.query<{ id: number }>(
      `SELECT id FROM processed_items WHERE client_id = $1 AND source = $2`,
      [opts.clientId, opts.source]
    );
    await deleteAttachmentsForProcessedItems(
      db,
      opts.clientId,
      parentIdsRes.rows.map((r) => r.id)
    );

    const del = await db.query(
      `DELETE FROM processed_items
        WHERE client_id = $1 AND source = $2`,
      [opts.clientId, opts.source]
    );

    await db.query("COMMIT");
    return { deleted: del.rowCount ?? 0, adjustmentsReversed };
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  } finally {
    db.release();
  }
}
