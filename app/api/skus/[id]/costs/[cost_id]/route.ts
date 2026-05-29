// app/api/skus/[id]/costs/[cost_id]/route.ts
//
// Phase 12b commit 4 of 4. DELETE endpoint for a single cost row.
//
// DELETE /api/skus/[id]/costs/[cost_id]
//   Returns: { deleted: true }
//
// The primary "cost changed" path is POST /api/skus/[id]/costs
// (adds a new cost row, leaves history intact). Deleting a cost
// row is the typo-correction escape hatch — the merchant entered
// the wrong number, realized it before any sales were recorded
// against this cost level, and wants it gone.
//
// Guardrail: refuse to delete the only remaining cost row. A SKU
// with zero cost rows breaks GET /api/skus' current-cost lookup
// (returns NULL forever) and complicates COGS computation. If the
// merchant really wants no cost on this SKU, they can soft-delete
// the SKU itself via DELETE /api/skus/[id].
//
// Tenant scope via a JOIN-style check: the WHERE clause requires
// the cost row's parent SKU to belong to this client. Forged URLs
// targeting another tenant's cost row return 404.
//
// Pro-gated like every other /api/skus endpoint.

import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getSessionClient } from "@/lib/getClient";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; cost_id: string }> }
) {
  try {
    const client = await getSessionClient();
    if (!client) {
      return NextResponse.json(
        { error: "Not authenticated" },
        { status: 401 }
      );
    }
    if (client.plan !== "pro") {
      return NextResponse.json(
        { error: "SKU catalog is a Pro feature." },
        { status: 403 }
      );
    }

    const { id: idParam, cost_id: costIdParam } = await params;
    const skuId = Number(idParam);
    const costId = Number(costIdParam);
    if (!Number.isInteger(skuId) || skuId <= 0) {
      return NextResponse.json({ error: "Invalid sku id" }, { status: 400 });
    }
    if (!Number.isInteger(costId) || costId <= 0) {
      return NextResponse.json({ error: "Invalid cost id" }, { status: 400 });
    }

    // ── Guardrail: refuse to delete the only cost row ─────────
    // Count first, then delete. Single round trip via CTE keeps
    // the check atomic.
    const result = await pool.query<{
      remaining: number;
      deleted: number;
    }>(
      `WITH guard AS (
         SELECT COUNT(*)::int AS n
           FROM sku_cost_history ch
           JOIN skus s ON s.id = ch.sku_id
          WHERE ch.sku_id = $1
            AND s.client_id = $2
       ),
       del AS (
         DELETE FROM sku_cost_history
          WHERE id = $3
            AND sku_id = $1
            AND (SELECT n FROM guard) > 1
            AND EXISTS (
              SELECT 1 FROM skus
               WHERE id = $1 AND client_id = $2
            )
          RETURNING id
       )
       SELECT
         (SELECT n FROM guard) AS remaining,
         COALESCE((SELECT COUNT(*)::int FROM del), 0) AS deleted`,
      [skuId, client.id, costId]
    );

    const row = result.rows[0];
    // No rows returned at all means the SKU isn't visible to this
    // client (or doesn't exist).
    if (!row || row.remaining === 0) {
      return NextResponse.json({ error: "SKU not found" }, { status: 404 });
    }
    // Guard tripped — there was only one cost row, refuse.
    if (row.remaining === 1) {
      return NextResponse.json(
        {
          error:
            "Can't delete the only cost row. Add a replacement first, or archive the SKU instead.",
        },
        { status: 409 }
      );
    }
    // Delete actually ran but matched zero rows → cost_id was
    // wrong (or already deleted).
    if (row.deleted === 0) {
      return NextResponse.json(
        { error: "Cost row not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ deleted: true });
  } catch (err) {
    console.error("Cost DELETE error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to delete cost" },
      { status: 500 }
    );
  }
}
