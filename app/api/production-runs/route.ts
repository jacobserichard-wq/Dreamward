// app/api/production-runs/route.ts
//
// Tier 2 commit 4. Record + list production runs.
//
// POST /api/production-runs
//   Body: { finishedSkuId, quantityProduced, runDate, notes? }
//   Runs the engine (lib/inventory/production.recordProductionRun).
//   Returns the ProductionRunResult (incl. hadRecipe + what got
//   consumed) so the UI can show the deduction + the no-recipe
//   nudge.
//
// GET /api/production-runs?sku=<finishedSkuId>&limit=
//   Lists runs for a finished SKU, newest first.
//
// Paying-tier gated, tenant-scoped.

import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getSessionClient } from "@/lib/getClient";
import { isPayingTier } from "@/lib/plans";
import { recordProductionRun } from "@/lib/inventory/production";

interface PostBody {
  finishedSkuId?: unknown;
  quantityProduced?: unknown;
  runDate?: unknown;
  notes?: unknown;
}

export async function POST(req: NextRequest) {
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

    const body = (await req.json().catch(() => null)) as PostBody | null;
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const finishedSkuId = Number(body.finishedSkuId);
    if (!Number.isInteger(finishedSkuId) || finishedSkuId <= 0) {
      return NextResponse.json(
        { error: "finishedSkuId must be a valid SKU id" },
        { status: 400 }
      );
    }
    if (
      typeof body.quantityProduced !== "number" ||
      !Number.isFinite(body.quantityProduced) ||
      body.quantityProduced <= 0
    ) {
      return NextResponse.json(
        { error: "quantityProduced must be a positive number" },
        { status: 400 }
      );
    }
    const runDate =
      typeof body.runDate === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(body.runDate)
        ? body.runDate
        : null;
    if (!runDate) {
      return NextResponse.json(
        { error: "runDate must be YYYY-MM-DD" },
        { status: 400 }
      );
    }
    const notes =
      typeof body.notes === "string" && body.notes.trim().length > 0
        ? body.notes.trim()
        : null;

    const result = await recordProductionRun({
      clientId: client.id,
      finishedSkuId,
      quantityProduced: body.quantityProduced,
      runDate,
      notes,
    });

    return NextResponse.json(result);
  } catch (err) {
    console.error("Production run POST error:", err);
    const msg = err instanceof Error ? err.message : "Failed to record run";
    // "Finished SKU not found" → 404; everything else 500.
    const status = msg.includes("not found") ? 404 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}

interface RunRowDb {
  id: number;
  quantity_produced: string;
  run_date: string;
  notes: string | null;
  created_at: string;
}

export async function GET(req: NextRequest) {
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

    const skuParam = req.nextUrl.searchParams.get("sku");
    const finishedSkuId = Number(skuParam);
    if (!Number.isInteger(finishedSkuId) || finishedSkuId <= 0) {
      return NextResponse.json(
        { error: "sku query param required" },
        { status: 400 }
      );
    }
    const limit = Math.min(
      Math.max(Number(req.nextUrl.searchParams.get("limit") ?? 50), 1),
      200
    );

    const res = await pool.query<RunRowDb>(
      `SELECT id, quantity_produced, run_date, notes, created_at
         FROM production_runs
        WHERE finished_sku_id = $1
          AND client_id = $2
        ORDER BY run_date DESC, id DESC
        LIMIT $3`,
      [finishedSkuId, client.id, limit]
    );

    return NextResponse.json({
      runs: res.rows.map((r) => ({
        id: r.id,
        quantityProduced: Number(r.quantity_produced),
        runDate: r.run_date,
        notes: r.notes,
        createdAt: r.created_at,
      })),
    });
  } catch (err) {
    console.error("Production runs GET error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load runs" },
      { status: 500 }
    );
  }
}
