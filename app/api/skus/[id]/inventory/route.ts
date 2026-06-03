// app/api/skus/[id]/inventory/route.ts
//
// Sub-session 33 Tier 1 commit 3 of 4. Manual stock-adjustment
// endpoint for the Receive Stock UI on /skus/[id]. Sales-side
// inventory updates go through lib/cogs/lineItems.ts +
// lib/cogs/aliases.ts hooks automatically; this is the only path
// for non-sale changes (received a shipment, counted today,
// fixing a bad earlier entry).
//
// POST /api/skus/[id]/inventory
//   Body: {
//     delta:  number              // signed integer, non-zero
//     reason: "receive" | "manual" | "recount" | "correction"
//     notes?: string | null
//   }
//   Returns: {
//     quantityOnHand: number      // post-adjustment stock cache
//   }
//
// reason="sale" is intentionally rejected — sale adjustments must
// flow through the line-item hooks so the partial UNIQUE
// idempotency on source_line_item_id applies. A merchant manually
// inserting a "sale" reason row would silently bypass that
// dedup and risk double-decrementing.
//
// Tenant-scoped via the SKU lookup in recordManualAdjustment
// (UPDATE rowCount=0 → 404).
//
// Pro-gated (matches the rest of the SKU surface).

import { NextRequest, NextResponse } from "next/server";
import { getSessionClient } from "@/lib/getClient";
import { recordManualAdjustment } from "@/lib/inventory/adjustments";
import pool from "@/lib/db";

interface PostBody {
  delta?: unknown;
  reason?: unknown;
  notes?: unknown;
}

const ALLOWED_REASONS = new Set([
  "receive",
  "manual",
  "recount",
  "correction",
]);

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
    if (client.plan !== "pro") {
      return NextResponse.json(
        { error: "Inventory adjustments are a Pro feature." },
        { status: 403 }
      );
    }

    const { id: idParam } = await params;
    const skuId = Number(idParam);
    if (!Number.isInteger(skuId) || skuId <= 0) {
      return NextResponse.json({ error: "Invalid SKU id" }, { status: 400 });
    }

    const body = (await req.json().catch(() => null)) as PostBody | null;
    if (!body) {
      return NextResponse.json(
        { error: "Invalid JSON body" },
        { status: 400 }
      );
    }

    // ── Validate delta ───────────────────────────────────────────
    if (typeof body.delta !== "number" || !Number.isFinite(body.delta)) {
      return NextResponse.json(
        { error: "delta must be a number" },
        { status: 400 }
      );
    }
    const delta = Math.trunc(body.delta);
    if (delta === 0) {
      return NextResponse.json(
        { error: "delta must be non-zero" },
        { status: 400 }
      );
    }

    // ── Validate reason ──────────────────────────────────────────
    if (typeof body.reason !== "string" || !ALLOWED_REASONS.has(body.reason)) {
      return NextResponse.json(
        {
          error:
            "reason must be one of: receive, manual, recount, correction",
        },
        { status: 400 }
      );
    }
    const reason = body.reason as "receive" | "manual" | "recount" | "correction";

    const notes =
      typeof body.notes === "string" && body.notes.trim().length > 0
        ? body.notes.trim()
        : null;

    // ── Tenant scope: confirm the SKU belongs to this client
    // BEFORE the adjustment runs, so a forged id can't credit
    // someone else's stock. recordManualAdjustment doesn't
    // know about client_id — keep the check explicit here.
    const ownership = await pool.query<{ id: number }>(
      `SELECT id FROM skus WHERE id = $1 AND client_id = $2`,
      [skuId, client.id]
    );
    if (ownership.rowCount === 0) {
      return NextResponse.json({ error: "SKU not found" }, { status: 404 });
    }

    const quantityOnHand = await recordManualAdjustment({
      skuId,
      delta,
      reason,
      notes,
    });

    return NextResponse.json({ quantityOnHand });
  } catch (err) {
    console.error("SKU inventory POST error:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to adjust inventory",
      },
      { status: 500 }
    );
  }
}
