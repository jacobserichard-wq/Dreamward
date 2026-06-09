// app/api/skus/[id]/inventory/history/route.ts
//
// Sub-session 33 Tier 1 commit 4 of 4. GET endpoint returning the
// recent stock-adjustment history for a single SKU. Powers the
// "Stock history" table on /skus/[id].
//
// GET /api/skus/[id]/inventory/history?limit=50&offset=0
//   Returns: {
//     adjustments: AdjustmentRow[],   // newest first
//     totalCount:  number             // for "showing N of M" UI
//   }
//
// Each AdjustmentRow includes a running_balance field computed
// server-side via SUM() OVER (...). The window function runs the
// full per-SKU sum in oldest-first order then we slice the page;
// this means even a paginated view shows the correct balance at
// each point in time (matching what the cache was right after that
// adjustment ran). The denormalization is worth it — without it,
// the client would have to refetch ALL history just to draw the
// running-balance column for the visible page.
//
// Tenant-scoped via the SKU lookup; Pro-gated.

import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getSessionClient } from "@/lib/getClient";
import { isPayingTier } from "@/lib/plans";

interface AdjustmentRowDb {
  id: number;
  delta: number;
  reason: string;
  notes: string | null;
  created_at: string;
  running_balance: number;
  source_line_item_id: number | null;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export async function GET(
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
      return NextResponse.json({ error: "Invalid SKU id" }, { status: 400 });
    }

    const searchParams = req.nextUrl.searchParams;
    const limit = Math.min(
      Math.max(Number(searchParams.get("limit") ?? DEFAULT_LIMIT), 1),
      MAX_LIMIT
    );
    const offset = Math.max(Number(searchParams.get("offset") ?? 0), 0);

    // ── Tenant scope check first. Done as a separate query so we
    // can return a clean 404 before running the heavier history
    // query. Cheaper than catching it after.
    const ownership = await pool.query<{ id: number }>(
      `SELECT id FROM skus WHERE id = $1 AND client_id = $2`,
      [skuId, client.id]
    );
    if (ownership.rowCount === 0) {
      return NextResponse.json({ error: "SKU not found" }, { status: 404 });
    }

    // ── Adjustments + running balance ───────────────────────────
    //
    // Window function computes the running SUM in oldest-first
    // order — this is the cache value as it stood right after each
    // row was inserted. We then sort newest-first and slice.
    //
    // The CTE is necessary because ORDER BY in the outer query
    // would re-window if we used SUM() in the projection directly.
    const historyRes = await pool.query<AdjustmentRowDb>(
      `WITH ordered AS (
         SELECT id, delta, reason, notes, source_line_item_id, created_at,
                SUM(delta) OVER (
                  ORDER BY created_at ASC, id ASC
                  ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
                )::int AS running_balance
           FROM inventory_adjustments
          WHERE sku_id = $1
       )
       SELECT id, delta, reason, notes, source_line_item_id,
              created_at, running_balance
         FROM ordered
        ORDER BY created_at DESC, id DESC
        LIMIT $2 OFFSET $3`,
      [skuId, limit, offset]
    );

    const totalRes = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n
         FROM inventory_adjustments
        WHERE sku_id = $1`,
      [skuId]
    );

    return NextResponse.json({
      adjustments: historyRes.rows.map((r) => ({
        id: r.id,
        delta: r.delta,
        reason: r.reason,
        notes: r.notes,
        sourceLineItemId: r.source_line_item_id,
        runningBalance: r.running_balance,
        createdAt: r.created_at,
      })),
      totalCount: totalRes.rows[0]?.n ?? 0,
    });
  } catch (err) {
    console.error("SKU inventory history GET error:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to load history",
      },
      { status: 500 }
    );
  }
}
