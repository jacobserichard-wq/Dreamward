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

    // ── Guardrail: refuse to delete the row currently in effect
    // unless a replacement also-in-effect row exists.
    //
    // The original guard only counted total rows, so deleting an
    // "effective today" row was allowed when a future-dated
    // ("scheduled") row also existed. That left the SKU with
    // current_cost = NULL until the scheduled row's effective_date
    // arrived — confusing UX even though COGS reports handled the
    // NULL gracefully.
    //
    // New rule: a delete is refused when has_current_before is
    // true AND has_current_after would be false (i.e., the row
    // being deleted was the only one whose effective_date <=
    // CURRENT_DATE). All other deletes — future-dated rows, old
    // back-dated rows that aren't the current pick, deletions on
    // SKUs that already have no current cost — are allowed.
    //
    // Single CTE keeps the ownership check + status snapshot +
    // conditional DELETE atomic. Skus that don't belong to this
    // client return owns_sku=false → 404.
    const result = await pool.query<{
      owns_sku: boolean;
      row_exists: boolean;
      has_current_before: boolean;
      has_current_after: boolean;
      deleted: number;
    }>(
      `WITH status AS (
         SELECT
           EXISTS (
             SELECT 1 FROM skus s
              WHERE s.id = $1 AND s.client_id = $2
           ) AS owns_sku,
           EXISTS (
             SELECT 1 FROM sku_cost_history ch
              WHERE ch.sku_id = $1 AND ch.id = $3
           ) AS row_exists,
           EXISTS (
             SELECT 1 FROM sku_cost_history ch
              WHERE ch.sku_id = $1 AND ch.effective_date <= CURRENT_DATE
           ) AS has_current_before,
           EXISTS (
             SELECT 1 FROM sku_cost_history ch
              WHERE ch.sku_id = $1
                AND ch.id <> $3
                AND ch.effective_date <= CURRENT_DATE
           ) AS has_current_after
       ),
       del AS (
         DELETE FROM sku_cost_history
          WHERE id = $3
            AND sku_id = $1
            AND (SELECT owns_sku FROM status)
            AND NOT (
              (SELECT has_current_before FROM status)
              AND NOT (SELECT has_current_after FROM status)
            )
          RETURNING id
       )
       SELECT
         (SELECT owns_sku FROM status) AS owns_sku,
         (SELECT row_exists FROM status) AS row_exists,
         (SELECT has_current_before FROM status) AS has_current_before,
         (SELECT has_current_after FROM status) AS has_current_after,
         COALESCE((SELECT COUNT(*)::int FROM del), 0) AS deleted`,
      [skuId, client.id, costId]
    );

    const row = result.rows[0];
    if (!row || !row.owns_sku) {
      return NextResponse.json({ error: "SKU not found" }, { status: 404 });
    }
    if (!row.row_exists) {
      return NextResponse.json(
        { error: "Cost row not found" },
        { status: 404 }
      );
    }
    // Guard tripped — would have orphaned the currently-in-effect
    // cost (i.e., row being deleted was the only one with
    // effective_date <= today, and SKU currently has a current cost).
    if (row.has_current_before && !row.has_current_after) {
      return NextResponse.json(
        {
          error:
            "Can't delete the cost row that's currently in effect. Add a back-dated replacement cost first, or delete the future-dated rows so this SKU has no scheduled costs to fall back on.",
        },
        { status: 409 }
      );
    }
    // Defensive — should be impossible after the checks above.
    if (row.deleted === 0) {
      return NextResponse.json(
        { error: "Cost row could not be deleted" },
        { status: 500 }
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
