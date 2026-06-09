// app/api/inventory/route.ts
//
// Inventory page aggregate. One endpoint that powers the whole
// /inventory dashboard: every SKU's stock + value + status, the
// portfolio totals, and the "can't make" alerts for finished goods
// blocked by an out-of-stock material.
//
// GET /api/inventory
//   → {
//       items: InventoryItem[],
//       totals: { totalValue, lowCount, outCount, negativeCount,
//                 skuCount },
//       cantMake: [{ finishedSkuId, code, name, limitingComponent }]
//     }
//
// Paying-tier gated, tenant-scoped.

import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getSessionClient } from "@/lib/getClient";
import { isPayingTier } from "@/lib/plans";

interface SkuRowDb {
  id: number;
  code: string;
  name: string;
  unit: string;
  quantity_on_hand: string;
  reorder_point: string;
  current_cost: string | null;
  is_finished: boolean;
  is_raw_material: boolean;
}

interface BomRowDb {
  parent_sku_id: number;
  parent_code: string;
  parent_name: string;
  component_name: string;
  quantity_per_unit: string;
  component_stock: string;
}

type Status = "negative" | "out" | "low" | "ok";

function statusFor(stock: number, reorderPoint: number): Status {
  if (stock < 0) return "negative";
  if (stock === 0) return "out";
  // Explicit reorder point wins; otherwise the <=10 heuristic.
  if (reorderPoint > 0) {
    return stock <= reorderPoint ? "low" : "ok";
  }
  return stock <= 10 ? "low" : "ok";
}

export async function GET() {
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

    // ── 1. SKUs with stock, current cost, reorder point, flags ──
    const skuRes = await pool.query<SkuRowDb>(
      `SELECT s.id, s.code, s.name, s.unit,
              s.quantity_on_hand,
              s.reorder_point,
              ch.cost AS current_cost,
              EXISTS (SELECT 1 FROM bom_components b
                       WHERE b.parent_sku_id = s.id) AS is_finished,
              EXISTS (SELECT 1 FROM bom_components b
                       WHERE b.component_sku_id = s.id) AS is_raw_material
         FROM skus s
         LEFT JOIN LATERAL (
           SELECT cost FROM sku_cost_history
            WHERE sku_id = s.id
              AND effective_date <= CURRENT_DATE
            ORDER BY effective_date DESC
            LIMIT 1
         ) ch ON true
        WHERE s.client_id = $1
          AND s.active
        ORDER BY s.code ASC`,
      [client.id]
    );

    let totalValue = 0;
    let lowCount = 0;
    let outCount = 0;
    let negativeCount = 0;

    const items = skuRes.rows.map((r) => {
      const stock = Number(r.quantity_on_hand);
      const reorderPoint = Number(r.reorder_point);
      const cost = r.current_cost != null ? Number(r.current_cost) : 0;
      const stockValue = stock * cost;
      const status = statusFor(stock, reorderPoint);

      // Negative stock contributes a negative value; that's honest —
      // it signals a data-quality issue, not a real asset.
      totalValue += stockValue;
      if (status === "negative") negativeCount++;
      else if (status === "out") outCount++;
      else if (status === "low") lowCount++;

      return {
        id: r.id,
        code: r.code,
        name: r.name,
        unit: r.unit,
        quantityOnHand: stock,
        reorderPoint,
        currentCost: r.current_cost != null ? cost : null,
        stockValue,
        status,
        isFinished: r.is_finished,
        isRawMaterial: r.is_raw_material,
      };
    });

    // ── 2. "Can't make" — finished goods blocked by a component ──
    // Pull every recipe row joined to the component's current stock,
    // group by finished good, compute can-make = min floor(stock /
    // per-unit). When 0, name the limiting component.
    const bomRes = await pool.query<BomRowDb>(
      `SELECT b.parent_sku_id,
              p.code AS parent_code,
              p.name AS parent_name,
              cs.name AS component_name,
              b.quantity_per_unit,
              cs.quantity_on_hand AS component_stock
         FROM bom_components b
         JOIN skus p  ON p.id = b.parent_sku_id
         JOIN skus cs ON cs.id = b.component_sku_id
        WHERE b.client_id = $1`,
      [client.id]
    );

    // group rows by finished good
    const byParent = new Map<
      number,
      {
        code: string;
        name: string;
        rows: Array<{ componentName: string; perUnit: number; stock: number }>;
      }
    >();
    for (const r of bomRes.rows) {
      const entry = byParent.get(r.parent_sku_id) ?? {
        code: r.parent_code,
        name: r.parent_name,
        rows: [],
      };
      entry.rows.push({
        componentName: r.component_name,
        perUnit: Number(r.quantity_per_unit),
        stock: Number(r.component_stock),
      });
      byParent.set(r.parent_sku_id, entry);
    }

    const cantMake: Array<{
      finishedSkuId: number;
      code: string;
      name: string;
      limitingComponent: string;
    }> = [];
    for (const [finishedSkuId, entry] of byParent) {
      let canMake = Infinity;
      let limiting = "";
      for (const row of entry.rows) {
        const possible =
          row.perUnit > 0 ? Math.floor(row.stock / row.perUnit) : 0;
        if (possible < canMake) {
          canMake = possible;
          limiting = row.componentName;
        }
      }
      if (canMake <= 0) {
        cantMake.push({
          finishedSkuId,
          code: entry.code,
          name: entry.name,
          limitingComponent: limiting,
        });
      }
    }

    return NextResponse.json({
      items,
      totals: {
        totalValue,
        lowCount,
        outCount,
        negativeCount,
        skuCount: items.length,
      },
      cantMake,
    });
  } catch (err) {
    console.error("Inventory GET error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load inventory" },
      { status: 500 }
    );
  }
}
