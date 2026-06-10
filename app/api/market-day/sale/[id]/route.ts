// app/api/market-day/sale/[id]/route.ts
//
// Market-day mode: undo one logged sale.
//
//   DELETE /api/market-day/sale/{lineItemId}
//   →      { undone: true, total, parentDeleted }
//
// Transaction mirrors the POST in reverse: reverse the inventory
// adjustment (stock credits back), delete the line item, shrink the
// parent's running amount. When the last sale of the day is undone
// the now-empty $0 parent row is deleted too, so an entirely-undone
// market day leaves no residue in the Processed tab.
//
// Guard: refuses line items whose parent isn't source='market_day'
// — platform-synced line items (Shopify/Wix/Square/Etsy) are not
// undoable through this endpoint.

import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getSessionClient } from "@/lib/getClient";
import { isPayingTier } from "@/lib/plans";
import { reverseSaleAdjustments } from "@/lib/inventory/adjustments";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const { id: idParam } = await params;
    const id = Number(idParam);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const db = await pool.connect();
    try {
      await db.query("BEGIN");

      const lineRes = await db.query<{
        id: number;
        quantity: string;
        unit_price: string;
        processed_item_id: number;
        source: string;
      }>(
        `SELECT li.id, li.quantity, li.unit_price,
                li.processed_item_id, p.source
           FROM processed_item_line_items li
           JOIN processed_items p ON p.id = li.processed_item_id
          WHERE li.id = $1 AND li.client_id = $2
          FOR UPDATE OF li, p`,
        [id, client.id]
      );
      if (lineRes.rowCount === 0) {
        await db.query("ROLLBACK");
        return NextResponse.json({ error: "Sale not found" }, { status: 404 });
      }
      const line = lineRes.rows[0];
      if (line.source !== "market_day") {
        await db.query("ROLLBACK");
        return NextResponse.json(
          { error: "Only market-day sales can be undone here." },
          { status: 400 }
        );
      }

      await reverseSaleAdjustments({ dbClient: db, lineItemIds: [id] });
      await db.query(
        `DELETE FROM processed_item_line_items WHERE id = $1`,
        [id]
      );

      const remainRes = await db.query<{ n: string }>(
        `SELECT COUNT(*)::int AS n
           FROM processed_item_line_items
          WHERE processed_item_id = $1`,
        [line.processed_item_id]
      );
      const remaining = Number(remainRes.rows[0].n);

      let total = 0;
      let parentDeleted = false;
      if (remaining === 0) {
        await db.query(`DELETE FROM processed_items WHERE id = $1`, [
          line.processed_item_id,
        ]);
        parentDeleted = true;
      } else {
        const saleValue =
          Number(line.quantity) * Number(line.unit_price);
        const totalRes = await db.query<{ amount: string }>(
          `UPDATE processed_items
              SET amount = GREATEST(amount - $1, 0), updated_at = NOW()
            WHERE id = $2
            RETURNING amount`,
          [saleValue, line.processed_item_id]
        );
        total = Number(totalRes.rows[0].amount);
      }

      await db.query("COMMIT");
      return NextResponse.json({ undone: true, total, parentDeleted });
    } catch (err) {
      await db.query("ROLLBACK");
      throw err;
    } finally {
      db.release();
    }
  } catch (err) {
    console.error("Market-day sale DELETE error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Couldn't undo the sale" },
      { status: 500 }
    );
  }
}
