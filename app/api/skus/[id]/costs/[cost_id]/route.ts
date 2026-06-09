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
import { isPayingTier } from "@/lib/plans";

// ---------------------------------------------------------------------
// PATCH — edit the cost amount or notes in place
// ---------------------------------------------------------------------
//
// Smoke-test follow-up (sub-session 30). The original Phase 12b
// design kept cost rows immutable except for delete, on the
// theory that mutating an existing row silently rewrites the
// COGS of any sales priced against it (Crafty Base's exact
// historical-data anti-pattern).
//
// In practice, "fix today's typo" + "no sales priced against it
// yet" is the common case, and the workaround
// (delete + re-add) is annoying because the new delete guard
// requires another in-effect row first.
//
// We allow PATCH but only to two fields:
//   - cost (NUMERIC, >= 0)
//   - notes (TEXT, nullable)
//
// effective_date is intentionally NOT mutable — it's the join
// key historical line items resolve through, so changing it would
// silently re-bucket COGS for past sales. To "move" a cost row
// to a different date, the merchant must add+delete.
//
// Audit-trail caveat: the audit-trail modal (Phase 12f.3)
// surfaces "cost_history #N · effective Mon DD" per line item.
// After a PATCH, future drill-ins still show the same row id +
// date but with the NEW cost. We accept that — the merchant
// explicitly took action to update it. Crafty Base's issue was
// that recipe-cost changes propagated WITHOUT a deliberate
// action on the cost-history row itself.

interface PatchCostBody {
  cost?: unknown;
  notes?: unknown;
  /** Required when the change would retroactively rewrite the
   *  recorded COGS on existing line items. The /skus/[id] UI shows
   *  a confirm modal in that case + passes true here on consent. */
  acknowledgeHistoricalChange?: unknown;
}

/**
 * Count how many processed_item_line_items rows currently resolve
 * their COGS through this specific cost-history row. Used by both
 * PATCH (when cost changes) and DELETE to decide whether the
 * operation would silently rewrite historical COGS.
 *
 * Implementation mirrors the "reign window" computation in
 * lib/cogs/compute: a line item resolves through cost row CH if
 * sold_at >= CH.effective_date AND no later cost row's
 * effective_date falls in (CH.effective_date, sold_at].
 */
async function countAffectedLineItems(
  costId: number,
  skuId: number
): Promise<number> {
  const res = await pool.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n
       FROM processed_item_line_items pili
      WHERE pili.matched_sku_id = $2
        AND pili.sold_at >= (
          SELECT effective_date FROM sku_cost_history WHERE id = $1
        )
        AND NOT EXISTS (
          SELECT 1 FROM sku_cost_history ch2
           WHERE ch2.sku_id = $2
             AND ch2.effective_date > (
               SELECT effective_date FROM sku_cost_history WHERE id = $1
             )
             AND ch2.effective_date <= pili.sold_at
        )`,
    [costId, skuId]
  );
  return res.rows[0]?.n ?? 0;
}

function parseCost(v: unknown): number | null {
  if (v == null || v === "") return null;
  const s = typeof v === "number" ? String(v) : String(v).replace(/[$,\s]/g, "");
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

export async function PATCH(
  req: NextRequest,
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
    if (!isPayingTier(client.plan)) {
      return NextResponse.json(
        { error: "This feature requires an active subscription." },
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

    const body = (await req.json().catch(() => null)) as PatchCostBody | null;
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const updates: string[] = [];
    const values: unknown[] = [];
    let p = 1;
    let costIsChanging = false;

    if (body.cost !== undefined) {
      const costNum = parseCost(body.cost);
      if (costNum === null) {
        return NextResponse.json(
          { error: "cost must be a non-negative number" },
          { status: 400 }
        );
      }
      updates.push(`cost = $${p++}`);
      values.push(costNum);
      costIsChanging = true;
    }

    if (body.notes !== undefined) {
      const notes =
        typeof body.notes === "string" && body.notes.trim().length > 0
          ? body.notes.trim()
          : null;
      if (notes === null) {
        updates.push(`notes = NULL`);
      } else {
        updates.push(`notes = $${p++}`);
        values.push(notes);
      }
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { error: "No fields to update" },
        { status: 400 }
      );
    }

    // ── Historical-impact guard ───────────────────────────────
    //
    // If the cost value is changing AND existing line items resolve
    // their COGS through this row, this PATCH would silently rewrite
    // recorded COGS on those past sales. That's the Crafty Base
    // "Historical Data Nightmare" anti-pattern. Require explicit
    // acknowledgeHistoricalChange:true from the client (UI shows a
    // confirm modal naming the count) before proceeding.
    //
    // Notes-only edits skip this — they don't affect COGS.
    if (costIsChanging && body.acknowledgeHistoricalChange !== true) {
      const affected = await countAffectedLineItems(costId, skuId);
      if (affected > 0) {
        return NextResponse.json(
          {
            error:
              `This change would retroactively rewrite COGS on ${affected} historical sale${affected === 1 ? "" : "s"}. Pass acknowledgeHistoricalChange:true to confirm.`,
            requiresAcknowledgement: true,
            affectedLineItemCount: affected,
          },
          { status: 409 }
        );
      }
    }

    // Tenant-scoped UPDATE — the WHERE EXISTS clause ensures the
    // cost row's parent SKU belongs to this client. Forged ids
    // get rowCount=0 → 404.
    const result = await pool.query<{
      id: number;
      cost: string;
      currency: string;
      effective_date: string;
      notes: string | null;
      created_at: string;
    }>(
      `UPDATE sku_cost_history
          SET ${updates.join(", ")}
        WHERE id = $${p++}
          AND sku_id = $${p++}
          AND EXISTS (
            SELECT 1 FROM skus s
             WHERE s.id = $${p - 1} AND s.client_id = $${p++}
          )
        RETURNING id, cost::text AS cost, currency, effective_date::text AS effective_date,
                  notes, created_at::text AS created_at`,
      [...values, costId, skuId, client.id]
    );

    if (result.rowCount === 0) {
      return NextResponse.json(
        { error: "Cost row not found" },
        { status: 404 }
      );
    }

    const r = result.rows[0];
    return NextResponse.json({
      cost: {
        id: r.id,
        cost: Number(r.cost),
        currency: r.currency,
        effectiveDate: r.effective_date,
        notes: r.notes,
        createdAt: r.created_at,
      },
    });
  } catch (err) {
    console.error("Cost PATCH error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to update cost" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  req: NextRequest,
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
    if (!isPayingTier(client.plan)) {
      return NextResponse.json(
        { error: "This feature requires an active subscription." },
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

    // ── Historical-impact guard ───────────────────────────────
    //
    // Same Crafty Base anti-pattern protection as the PATCH path.
    // Deleting a cost row that had line items resolved through it
    // re-buckets those sales to the NEXT-earliest cost (or $0).
    // Requires explicit ack via ?acknowledgeHistoricalChange=true.
    const url = new URL(req.url);
    const ackParam =
      url.searchParams.get("acknowledgeHistoricalChange") === "true";
    if (!ackParam) {
      const affected = await countAffectedLineItems(costId, skuId);
      if (affected > 0) {
        return NextResponse.json(
          {
            error:
              `Deleting this cost row would rewrite COGS on ${affected} historical sale${affected === 1 ? "" : "s"} (they'd re-bucket to the next-earliest cost or $0). Pass ?acknowledgeHistoricalChange=true to confirm.`,
            requiresAcknowledgement: true,
            affectedLineItemCount: affected,
          },
          { status: 409 }
        );
      }
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
