// app/api/skus/bulk-update-costs/route.ts
//
// Phase 12d commit 4 of 5. Bulk-update costs across N selected
// SKUs in one transaction. Each SKU gets a new sku_cost_history
// row with the supplied effective_date.
//
// POST /api/skus/bulk-update-costs
//   Body:
//     {
//       skuIds: number[],
//       adjustment: { type: 'percentDelta'|'dollarDelta'|'setValue', value: number },
//       effectiveDate: 'YYYY-MM-DD',
//       notes?: string,
//     }
//   Returns: { updated: number, results: BulkResult[] }
//
// Adjustment types:
//   - percentDelta: newCost = currentCost * (1 + value/100). Use
//                   negative value for decreases. Per-SKU baseline.
//   - dollarDelta:  newCost = currentCost + value. Negative value
//                   decreases. Per-SKU baseline.
//   - setValue:     newCost = value. All selected SKUs end up at
//                   the same number.
//
// Crafty Base's #1 onboarding pain: "If a supplier raises prices
// on 50 items, users must manually click into each individual
// material to update the cost." Their spreadsheet import is
// reportedly buggy. Our endpoint does it atomically in one POST.
//
// Effective-date discipline (the killer feature):
// We INSERT a NEW cost-history row rather than mutating the
// existing current row. Historical sales priced against the old
// cost keep their old cost — only sales on or after effective_date
// reprice. This is THE differentiating architectural choice vs
// Crafty Base, which (per user complaints) retroactively rewrites
// historical COGS when costs change.
//
// Idempotency / duplicate handling:
// If a SKU already has a cost-history row on the supplied
// effective_date, the UNIQUE (sku_id, effective_date) constraint
// throws 23505. We catch it per-row, record it as 'skipped', and
// continue with the rest. Reported in the response's `results`
// array so the UI can surface "3 of 47 skipped because they
// already had a cost on that date."
//
// Pro-gated. Tenant-scoped via the WHERE clause on every UPDATE.

import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getSessionClient } from "@/lib/getClient";
import { isPayingTier } from "@/lib/plans";

type AdjustmentType = "percentDelta" | "dollarDelta" | "setValue";

interface BulkBody {
  skuIds?: unknown;
  adjustment?: unknown;
  effectiveDate?: unknown;
  notes?: unknown;
}

interface BulkResult {
  skuId: number;
  /** 'updated' = new cost-history row inserted
   *  'skipped' = duplicate (existing row on same effective_date)
   *  'not_found' = sku not owned by tenant
   *  'error'   = other failure */
  status: "updated" | "skipped" | "not_found" | "error";
  oldCost: number | null;
  newCost: number | null;
  error?: string;
}

function parseAdjustment(raw: unknown): {
  type: AdjustmentType;
  value: number;
} | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { type?: unknown; value?: unknown };
  if (
    r.type !== "percentDelta" &&
    r.type !== "dollarDelta" &&
    r.type !== "setValue"
  )
    return null;
  const v = Number(r.value);
  if (!Number.isFinite(v)) return null;
  // setValue must be non-negative; percent/dollar deltas can be ±.
  if (r.type === "setValue" && v < 0) return null;
  return { type: r.type, value: v };
}

function computeNewCost(
  current: number,
  adjustment: { type: AdjustmentType; value: number }
): number {
  let next: number;
  if (adjustment.type === "percentDelta") {
    next = current * (1 + adjustment.value / 100);
  } else if (adjustment.type === "dollarDelta") {
    next = current + adjustment.value;
  } else {
    next = adjustment.value;
  }
  // Cost must be non-negative (matches NUMERIC(12,4) constraint
  // intent). Clamp at 0 — adjustments that would push below zero
  // (e.g., -200% on a $5 item) become $0.
  return Math.max(0, next);
}

export async function POST(req: NextRequest) {
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

    const body = (await req.json().catch(() => null)) as BulkBody | null;
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    // ── Validate skuIds[] ───────────────────────────────────────
    if (!Array.isArray(body.skuIds) || body.skuIds.length === 0) {
      return NextResponse.json(
        { error: "skuIds must be a non-empty array" },
        { status: 400 }
      );
    }
    if (body.skuIds.length > 500) {
      return NextResponse.json(
        { error: "Maximum 500 SKUs per request" },
        { status: 400 }
      );
    }
    const skuIds: number[] = [];
    for (const v of body.skuIds) {
      const n = Number(v);
      if (!Number.isInteger(n) || n <= 0) {
        return NextResponse.json(
          { error: "Every skuId must be a positive integer" },
          { status: 400 }
        );
      }
      skuIds.push(n);
    }

    // ── Validate adjustment ─────────────────────────────────────
    const adjustment = parseAdjustment(body.adjustment);
    if (!adjustment) {
      return NextResponse.json(
        {
          error:
            "adjustment must be { type: 'percentDelta'|'dollarDelta'|'setValue', value: number } and setValue must be non-negative",
        },
        { status: 400 }
      );
    }

    // ── Validate effectiveDate ──────────────────────────────────
    if (
      typeof body.effectiveDate !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(body.effectiveDate)
    ) {
      return NextResponse.json(
        { error: "effectiveDate must be YYYY-MM-DD" },
        { status: 400 }
      );
    }
    const effectiveDate = body.effectiveDate;
    const notes =
      typeof body.notes === "string" && body.notes.trim().length > 0
        ? body.notes.trim()
        : null;

    // ── Per-SKU loop inside one transaction ─────────────────────
    //
    // Each SKU's cost lookup + INSERT is independent (one bad sku
    // shouldn't kill the others), but we wrap them in a single
    // transaction for atomicity — either every successful row
    // commits or nothing does. SAVEPOINTs let us catch per-row
    // SQLSTATE 23505 (duplicate effective_date) without aborting
    // the whole transaction.
    const dbClient = await pool.connect();
    const results: BulkResult[] = [];
    let updatedCount = 0;
    try {
      await dbClient.query("BEGIN");

      for (const skuId of skuIds) {
        // Look up current cost (tenant-scoped via JOIN to skus).
        const currentRes = await dbClient.query<{ cost: string | null }>(
          `SELECT (
             SELECT cost::text FROM sku_cost_history
              WHERE sku_id = $1
                AND effective_date <= CURRENT_DATE
              ORDER BY effective_date DESC LIMIT 1
           ) AS cost
             FROM skus
            WHERE id = $1 AND client_id = $2`,
          [skuId, client.id]
        );

        if (currentRes.rowCount === 0) {
          results.push({
            skuId,
            status: "not_found",
            oldCost: null,
            newCost: null,
          });
          continue;
        }

        const currentCost = currentRes.rows[0]?.cost
          ? Number(currentRes.rows[0].cost)
          : 0;
        const newCost = computeNewCost(currentCost, adjustment);

        // SAVEPOINT so a per-row 23505 (duplicate effective_date)
        // doesn't abort the outer transaction.
        await dbClient.query("SAVEPOINT row_insert");
        try {
          await dbClient.query(
            `INSERT INTO sku_cost_history
               (sku_id, cost, currency, effective_date, notes)
             VALUES ($1, $2, 'USD', $3, $4)`,
            [skuId, newCost, effectiveDate, notes]
          );
          await dbClient.query("RELEASE SAVEPOINT row_insert");
          results.push({
            skuId,
            status: "updated",
            oldCost: currentCost,
            newCost,
          });
          updatedCount++;
        } catch (rowErr) {
          await dbClient.query("ROLLBACK TO SAVEPOINT row_insert");
          const e = rowErr as { code?: string; message?: string };
          if (e?.code === "23505") {
            results.push({
              skuId,
              status: "skipped",
              oldCost: currentCost,
              newCost,
              error:
                "A cost row already exists for this SKU on the selected effective date.",
            });
          } else {
            results.push({
              skuId,
              status: "error",
              oldCost: currentCost,
              newCost,
              error: e?.message ?? "unknown",
            });
          }
        }
      }

      await dbClient.query("COMMIT");
    } catch (txErr) {
      await dbClient.query("ROLLBACK").catch(() => {});
      throw txErr;
    } finally {
      dbClient.release();
    }

    return NextResponse.json({ updated: updatedCount, results });
  } catch (err) {
    console.error("Bulk-update-costs POST error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to bulk update" },
      { status: 500 }
    );
  }
}
