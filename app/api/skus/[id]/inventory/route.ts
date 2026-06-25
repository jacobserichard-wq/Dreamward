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
import {
  addCostLayer,
  consumeFifo,
  lastKnownUnitCost,
} from "@/lib/inventory/costLayers";
import pool from "@/lib/db";
import { isPayingTier } from "@/lib/plans";

interface PostBody {
  delta?: unknown;
  reason?: unknown;
  notes?: unknown;
  /** Optional per-unit cost for a positive receive — sets the FIFO
   *  layer's cost. Omitted → falls back to the SKU's last-known cost. */
  unitCost?: unknown;
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
    // Tier 2: fractional deltas allowed (delta is NUMERIC). No
    // truncation — a 0.5-oz receive is valid.
    const delta = body.delta;
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

    // ── Validate optional unit cost (positive receive only) ──────
    let unitCost: number | undefined;
    if (body.unitCost != null && body.unitCost !== "") {
      const uc = Number(body.unitCost);
      if (!Number.isFinite(uc) || uc < 0) {
        return NextResponse.json(
          { error: "unitCost must be a non-negative number" },
          { status: 400 }
        );
      }
      unitCost = uc;
    }

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

    // Quantity and FIFO cost move together in one transaction so the two
    // ledgers (inventory_adjustments quantity, cost_layers cost) can't
    // drift: adding stock creates a cost layer; removing stock drains
    // layers oldest-first.
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      const quantityOnHand = await recordManualAdjustment({
        dbClient: db,
        skuId,
        delta,
        reason,
        notes,
      });

      if (delta > 0) {
        const layerCost = unitCost ?? (await lastKnownUnitCost(db, skuId));
        await addCostLayer({
          dbClient: db,
          clientId: client.id,
          skuId,
          source: reason === "receive" ? "receive" : "manual",
          acquiredAt: new Date().toISOString().slice(0, 10),
          quantity: delta,
          unitCost: layerCost,
          notes:
            unitCost == null
              ? `${notes ? notes + " — " : ""}cost estimated from last known`
              : notes,
        });
      } else {
        await consumeFifo({
          dbClient: db,
          clientId: client.id,
          skuId,
          quantity: -delta,
          reason: reason === "manual" ? "manual_out" : "correction",
        });
      }

      await db.query("COMMIT");
      return NextResponse.json({ quantityOnHand });
    } catch (txErr) {
      await db.query("ROLLBACK").catch(() => {});
      throw txErr;
    } finally {
      db.release();
    }
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
