// app/api/skus/[id]/costs/route.ts
//
// Phase 12b commit 4 of 4. POST endpoint for adding a new cost
// row to sku_cost_history.
//
// POST /api/skus/[id]/costs
//   Body: { cost: number, effectiveDate: YYYY-MM-DD, notes?: string }
//   Returns: { cost: CostHistoryRow }
//
// This is the primary "the merchant changed their wholesale price"
// path. Existing rows in sku_cost_history are NOT mutated — the
// new row supersedes the old one for sales on or after its
// effective_date, while historical sales continue to look up their
// own date and resolve to the older row. That's the whole point of
// the partial unique index (sku_id, effective_date).
//
// Duplicate effective_date handling: skus(sku_id, effective_date)
// is UNIQUE. Postgres throws SQLSTATE 23505 if the merchant tries
// to add two cost rows on the same date — we map that to a 409
// with a friendly error pointing them at the existing row.
//
// Tenant safety: every UPDATE/INSERT verifies the parent SKU
// belongs to this client via a sub-select, so a forged URL with
// someone else's SKU id returns 404.
//
// Pro-gated like every other /api/skus endpoint.

import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getSessionClient } from "@/lib/getClient";
import { isPayingTier } from "@/lib/plans";
import { recomputeParentsUsing } from "@/lib/inventory/costRollup";

interface CreateCostBody {
  cost?: unknown;
  effectiveDate?: unknown;
  notes?: unknown;
}

function parseCost(v: unknown): number | null {
  if (v == null || v === "") return null;
  const s = typeof v === "number" ? String(v) : String(v).replace(/[$,\s]/g, "");
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

export async function POST(
  req: NextRequest,
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
    const skuId = Number(idParam);
    if (!Number.isInteger(skuId) || skuId <= 0) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const body = (await req.json().catch(() => null)) as CreateCostBody | null;
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const costNum = parseCost(body.cost);
    if (costNum == null) {
      return NextResponse.json(
        { error: "Cost must be a non-negative number" },
        { status: 400 }
      );
    }
    if (
      !isNonEmptyString(body.effectiveDate) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(body.effectiveDate)
    ) {
      return NextResponse.json(
        { error: "Effective date must be YYYY-MM-DD" },
        { status: 400 }
      );
    }
    const notes =
      typeof body.notes === "string" && body.notes.trim().length > 0
        ? body.notes.trim()
        : null;

    // Tenant ownership check + INSERT in one round trip using a
    // SELECT-into-INSERT pattern. If the SKU doesn't belong to
    // this client, the sub-select returns zero rows and the
    // INSERT does nothing — we then return 404.
    try {
      const result = await pool.query<{
        id: number;
        cost: string;
        currency: string;
        effective_date: string;
        notes: string | null;
        created_at: string;
      }>(
        `INSERT INTO sku_cost_history (sku_id, cost, currency, effective_date, notes)
         SELECT $1, $2, 'USD', $3, $4
           FROM skus
          WHERE id = $1 AND client_id = $5
         RETURNING id, cost, currency, effective_date, notes, created_at`,
        [skuId, costNum, body.effectiveDate, notes, client.id]
      );

      if (result.rowCount === 0) {
        return NextResponse.json(
          { error: "SKU not found" },
          { status: 404 }
        );
      }

      // If this SKU is used as a component in any component-costed
      // recipe, its new cost ripples up. Best-effort — never fail the
      // user's cost entry over a derived-cost refresh.
      try {
        await recomputeParentsUsing(skuId, client.id);
      } catch (rollupErr) {
        console.error("Cost rollup after cost add failed:", rollupErr);
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
    } catch (dbErr) {
      const pgErr = dbErr as { code?: string };
      if (pgErr?.code === "23505") {
        return NextResponse.json(
          {
            error:
              "A cost already exists for this SKU on that date. Click the existing row's cost value to edit it in place, or pick a different effective date.",
          },
          { status: 409 }
        );
      }
      throw dbErr;
    }
  } catch (err) {
    console.error("Cost POST error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to add cost" },
      { status: 500 }
    );
  }
}
