// app/api/skus/[id]/inventory/[adjustment_id]/route.ts
//
// Reverse a MANUAL stock adjustment (receive / manual / recount /
// correction) — the escape hatch for a fat-fingered receive. Undoes
// the adjustment's stock effect and deletes the ledger row.
//
// DELETE /api/skus/[id]/inventory/[adjustment_id]
//   Returns: { reversed: boolean }
//
// Deliberately refuses to delete 'sale' / 'production_in' /
// 'production_out' rows — those are tied to line items + production
// runs and have their own reversal paths (alias unmap / run
// reverse). Deleting one in isolation would desync those.
//
// Tenant-scoped (the SKU must belong to the client). Transactional.
// Paying-tier gated.

import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getSessionClient } from "@/lib/getClient";
import { isPayingTier } from "@/lib/plans";

const REVERSIBLE = new Set(["receive", "manual", "recount", "correction"]);

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; adjustment_id: string }> }
) {
  try {
    const client = await getSessionClient();
    if (!client) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    if (!isPayingTier(client.plan)) {
      return NextResponse.json(
        { error: "This feature requires an active subscription." },
        { status: 403 }
      );
    }

    const { id: idParam, adjustment_id: adjParam } = await params;
    const skuId = Number(idParam);
    const adjId = Number(adjParam);
    if (
      !Number.isInteger(skuId) ||
      skuId <= 0 ||
      !Number.isInteger(adjId) ||
      adjId <= 0
    ) {
      return NextResponse.json({ error: "Invalid ids" }, { status: 400 });
    }

    const db = await pool.connect();
    try {
      await db.query("BEGIN");

      // Load the adjustment, tenant-scoped via the SKU's client_id.
      // delta returns as a string (NUMERIC).
      const adjRes = await db.query<{ delta: string; reason: string }>(
        `SELECT ia.delta, ia.reason
           FROM inventory_adjustments ia
           JOIN skus s ON s.id = ia.sku_id
          WHERE ia.id = $1
            AND ia.sku_id = $2
            AND s.client_id = $3`,
        [adjId, skuId, client.id]
      );
      if (adjRes.rowCount === 0) {
        await db.query("ROLLBACK");
        return NextResponse.json(
          { error: "Adjustment not found" },
          { status: 404 }
        );
      }

      const { delta, reason } = adjRes.rows[0];
      if (!REVERSIBLE.has(reason)) {
        await db.query("ROLLBACK");
        return NextResponse.json(
          {
            error:
              "Sales + production adjustments can't be reversed here — undo the originating sale or production run instead.",
          },
          { status: 400 }
        );
      }

      // Undo the stock effect (subtract the delta), then delete the
      // ledger row.
      await db.query(
        `UPDATE skus SET quantity_on_hand = quantity_on_hand - $1 WHERE id = $2`,
        [parseFloat(delta), skuId]
      );
      await db.query(`DELETE FROM inventory_adjustments WHERE id = $1`, [adjId]);

      await db.query("COMMIT");
      return NextResponse.json({ reversed: true });
    } catch (txErr) {
      await db.query("ROLLBACK").catch(() => {});
      throw txErr;
    } finally {
      db.release();
    }
  } catch (err) {
    console.error("Inventory adjustment DELETE error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to reverse" },
      { status: 500 }
    );
  }
}
