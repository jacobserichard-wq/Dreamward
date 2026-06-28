// app/api/items/[id]/restock/route.ts
//
// POST /api/items/[id]/restock
//
// Reverses the INVENTORY side of a sale without deleting the sale:
// credits each product's quantity_on_hand back, restores its FIFO cost
// layers, and clears the stamped COGS on the line items (the sale row +
// line items stay in place). Used when a refund is logged as a RETURN —
// the customer brought the goods back, so they go back into stock. The
// money side is handled separately by the "Returns & Refunds" refund row.
//
// Tenant-scoped: only the calling client's sale + line items are touched.
// Idempotent: a second call finds no sale-reason adjustments to reverse
// and credits nothing (reverseSaleAdjustments returns 0).

import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getSessionClient } from "@/lib/getClient";
import { reverseSaleAdjustments } from "@/lib/inventory/adjustments";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const client = await getSessionClient();
    if (!client) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const { id: idParam } = await params;
    const id = Number(idParam);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      const liRes = await db.query<{ id: number }>(
        `SELECT li.id
           FROM processed_item_line_items li
           JOIN processed_items pi ON pi.id = li.processed_item_id
          WHERE pi.id = $1 AND pi.client_id = $2`,
        [id, client.id]
      );
      const lineItemIds = liRes.rows.map((r) => r.id);
      let restocked = 0;
      if (lineItemIds.length > 0) {
        restocked = await reverseSaleAdjustments({ dbClient: db, lineItemIds });
      }
      await db.query("COMMIT");
      return NextResponse.json({ restocked });
    } catch (txErr) {
      await db.query("ROLLBACK").catch(() => {});
      throw txErr;
    } finally {
      db.release();
    }
  } catch (err) {
    console.error("Restock error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Restock failed" },
      { status: 500 }
    );
  }
}
