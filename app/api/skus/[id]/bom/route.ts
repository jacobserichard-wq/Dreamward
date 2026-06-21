// app/api/skus/[id]/bom/route.ts
//
// Tier 2 commit 3. The recipe (bill of materials) for a finished
// SKU — what it's made of. GET lists the components with each
// component's current stock (for the "can I make N?" math); POST
// upserts a component row.
//
// GET /api/skus/[id]/bom
//   Returns: {
//     components: Array<{
//       id, componentSkuId, componentCode, componentName,
//       componentUnit, componentStock, quantityPerUnit, notes
//     }>,
//     canMake: number | null   // min floor(stock / qtyPerUnit);
//                              // null when the recipe is empty
//   }
//
// POST /api/skus/[id]/bom
//   Body: { componentSkuId, quantityPerUnit, notes? }
//   Upserts (one row per parent+component). Returns the saved row.
//
// Guards: component != parent; component belongs to the client;
// quantityPerUnit > 0. Paying-tier gated.

import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getSessionClient } from "@/lib/getClient";
import { isPayingTier } from "@/lib/plans";
import {
  computeBomUnitCost,
  recomputeSkuAndParents,
} from "@/lib/inventory/costRollup";

interface BomRowDb {
  id: number;
  component_sku_id: number;
  component_code: string;
  component_name: string;
  component_unit: string;
  component_stock: string; // NUMERIC → string
  quantity_per_unit: string;
  notes: string | null;
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
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

    const { id: idParam } = await params;
    const parentId = Number(idParam);
    if (!Number.isInteger(parentId) || parentId <= 0) {
      return NextResponse.json({ error: "Invalid SKU id" }, { status: 400 });
    }

    // Ownership check on the parent.
    const owns = await pool.query(
      `SELECT id FROM skus WHERE id = $1 AND client_id = $2`,
      [parentId, client.id]
    );
    if (owns.rowCount === 0) {
      return NextResponse.json({ error: "SKU not found" }, { status: 404 });
    }

    const res = await pool.query<BomRowDb>(
      `SELECT b.id,
              b.component_sku_id,
              s.code            AS component_code,
              s.name            AS component_name,
              s.unit            AS component_unit,
              s.quantity_on_hand AS component_stock,
              b.quantity_per_unit,
              b.notes
         FROM bom_components b
         JOIN skus s ON s.id = b.component_sku_id
        WHERE b.parent_sku_id = $1
          AND b.client_id = $2
        ORDER BY s.name ASC`,
      [parentId, client.id]
    );

    const components = res.rows.map((r) => ({
      id: r.id,
      componentSkuId: r.component_sku_id,
      componentCode: r.component_code,
      componentName: r.component_name,
      componentUnit: r.component_unit,
      componentStock: Number(r.component_stock),
      quantityPerUnit: Number(r.quantity_per_unit),
      notes: r.notes,
    }));

    // "Can make N" = the limiting component. floor(stock / per-unit),
    // min across components. Null when the recipe is empty. A
    // component with non-positive stock floors the answer to 0.
    let canMake: number | null = null;
    if (components.length > 0) {
      canMake = Math.min(
        ...components.map((c) =>
          c.quantityPerUnit > 0
            ? Math.floor(c.componentStock / c.quantityPerUnit)
            : 0
        )
      );
      if (!Number.isFinite(canMake)) canMake = 0;
    }

    // Cost rollup for the recipe — per-component unit/line cost + the
    // rolled-up total. Reuses the engine so the math matches exactly
    // what materializeBomCost would write.
    const roll = await computeBomUnitCost(parentId, client.id);
    const costByComponent = new Map(
      roll.lines.map((l) => [l.componentSkuId, l])
    );
    const componentsWithCost = components.map((c) => {
      const line = costByComponent.get(c.componentSkuId);
      return {
        ...c,
        unitCost: line?.unitCost ?? null,
        lineCost: line?.lineCost ?? 0,
      };
    });

    return NextResponse.json({
      components: componentsWithCost,
      canMake,
      rolledUpCost: roll.unitCost,
      missingCostCount: roll.missingCostCount,
    });
  } catch (err) {
    console.error("BOM GET error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load recipe" },
      { status: 500 }
    );
  }
}

interface PostBody {
  componentSkuId?: unknown;
  quantityPerUnit?: unknown;
  notes?: unknown;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
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

    const { id: idParam } = await params;
    const parentId = Number(idParam);
    if (!Number.isInteger(parentId) || parentId <= 0) {
      return NextResponse.json({ error: "Invalid SKU id" }, { status: 400 });
    }

    const body = (await req.json().catch(() => null)) as PostBody | null;
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const componentSkuId = Number(body.componentSkuId);
    if (!Number.isInteger(componentSkuId) || componentSkuId <= 0) {
      return NextResponse.json(
        { error: "componentSkuId must be a valid SKU id" },
        { status: 400 }
      );
    }
    // A SKU can't be its own ingredient.
    if (componentSkuId === parentId) {
      return NextResponse.json(
        { error: "A product can't be a component of itself" },
        { status: 400 }
      );
    }
    if (
      typeof body.quantityPerUnit !== "number" ||
      !Number.isFinite(body.quantityPerUnit) ||
      body.quantityPerUnit <= 0
    ) {
      return NextResponse.json(
        { error: "quantityPerUnit must be a positive number" },
        { status: 400 }
      );
    }
    const notes =
      typeof body.notes === "string" && body.notes.trim().length > 0
        ? body.notes.trim()
        : null;

    // Both SKUs must belong to the caller. One query confirms both.
    const ownCheck = await pool.query<{ id: number }>(
      `SELECT id FROM skus WHERE id = ANY($1) AND client_id = $2`,
      [[parentId, componentSkuId], client.id]
    );
    if (ownCheck.rowCount !== 2) {
      return NextResponse.json(
        { error: "Both products must belong to your catalog" },
        { status: 404 }
      );
    }

    // Upsert — one row per (parent, component). Editing the qty
    // updates in place.
    const saved = await pool.query<{ id: number }>(
      `INSERT INTO bom_components
         (client_id, parent_sku_id, component_sku_id, quantity_per_unit, notes)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (parent_sku_id, component_sku_id)
       DO UPDATE SET quantity_per_unit = EXCLUDED.quantity_per_unit,
                     notes = EXCLUDED.notes,
                     updated_at = NOW()
       RETURNING id`,
      [client.id, parentId, componentSkuId, body.quantityPerUnit, notes]
    );

    // Recipe changed → re-roll this product's cost (if component-costed)
    // and cascade up. Best-effort; never fail the recipe edit over it.
    try {
      await recomputeSkuAndParents(parentId, client.id);
    } catch (rollupErr) {
      console.error("Cost rollup after recipe add failed:", rollupErr);
    }

    return NextResponse.json({ id: saved.rows[0].id });
  } catch (err) {
    console.error("BOM POST error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to save component" },
      { status: 500 }
    );
  }
}
