// app/api/skus/[id]/route.ts
//
// Phase 12b commit 3 of 4. PATCH + DELETE endpoints for an
// individual SKU. Sister of /api/skus (list + create).
//
// PATCH /api/skus/[id]
//   Body: { name?, description?, active? } — any subset
//   Returns: { sku: SkuRow }
//
// DELETE /api/skus/[id]
//   Soft delete — sets skus.active = false. Existing
//   processed_item_line_items.matched_sku_id rows keep their
//   reference so historical reports stay intact. The merchant
//   can later restore by PATCHing active=true (no UI surface
//   needed; the same edit modal handles both paths).
//   Returns: { sku: SkuRow } — the archived row, so the client
//   can flip its chip without re-fetching.
//
// Code is intentionally NOT mutable. Once a SKU has a code, its
// identity is locked — alias mappings, cost history rows, and
// any external integrations refer to it by code. Allowing rename
// would require a cascading update + audit log. Defer to a
// future "merge SKUs" workflow if a real use case emerges.
//
// All queries tenant-scoped on client_id. Pro-gated.

import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getSessionClient } from "@/lib/getClient";

interface SkuRowDb {
  id: number;
  code: string;
  name: string;
  description: string | null;
  active: boolean;
  current_cost: string | null;
  cost_currency: string | null;
  cost_effective_date: string | null;
  sales_count: number;
  last_sale_date: string | null;
  created_at: string;
  updated_at: string;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

// Reusable enrich-and-serialize. Same shape as GET /api/skus so
// the page can drop the result straight into its local state.
async function loadEnrichedSku(
  clientId: number,
  skuId: number
): Promise<SkuRowDb | null> {
  const res = await pool.query<SkuRowDb>(
    `SELECT s.id, s.code, s.name, s.description, s.active,
            ch.cost           AS current_cost,
            ch.currency       AS cost_currency,
            ch.effective_date AS cost_effective_date,
            COALESCE(sales.sales_count, 0)::int AS sales_count,
            sales.last_sale_date,
            s.created_at, s.updated_at
       FROM skus s
       LEFT JOIN LATERAL (
         SELECT cost, currency, effective_date
           FROM sku_cost_history
          WHERE sku_id = s.id
            AND effective_date <= CURRENT_DATE
          ORDER BY effective_date DESC
          LIMIT 1
       ) ch ON true
       LEFT JOIN LATERAL (
         SELECT COUNT(*)::int AS sales_count, MAX(sold_at) AS last_sale_date
           FROM processed_item_line_items
          WHERE matched_sku_id = s.id
       ) sales ON true
      WHERE s.id = $1 AND s.client_id = $2`,
    [skuId, clientId]
  );
  return res.rows[0] ?? null;
}

function serializeSku(row: SkuRowDb) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description,
    active: row.active,
    currentCost: row.current_cost != null ? Number(row.current_cost) : null,
    costCurrency: row.cost_currency,
    costEffectiveDate: row.cost_effective_date,
    salesCount: row.sales_count,
    lastSaleDate: row.last_sale_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------
// PATCH — update an existing SKU
// ---------------------------------------------------------------------

interface PatchSkuBody {
  name?: unknown;
  description?: unknown;
  active?: unknown;
}

export async function PATCH(
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
        { error: "SKU catalog is a Pro feature." },
        { status: 403 }
      );
    }

    const { id: idParam } = await params;
    const id = Number(idParam);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const body = (await req.json().catch(() => null)) as PatchSkuBody | null;
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    // ── Build dynamic SET clause from the fields provided ──────
    const updates: string[] = [];
    const values: unknown[] = [];
    let p = 1;

    if (body.name !== undefined) {
      if (!isNonEmptyString(body.name)) {
        return NextResponse.json(
          { error: "Name cannot be empty" },
          { status: 400 }
        );
      }
      updates.push(`name = $${p++}`);
      values.push(body.name.trim());
    }

    if (body.description !== undefined) {
      const desc =
        typeof body.description === "string" && body.description.trim().length > 0
          ? body.description.trim()
          : null;
      if (desc === null) {
        updates.push(`description = NULL`);
      } else {
        updates.push(`description = $${p++}`);
        values.push(desc);
      }
    }

    if (body.active !== undefined) {
      if (typeof body.active !== "boolean") {
        return NextResponse.json(
          { error: "active must be a boolean" },
          { status: 400 }
        );
      }
      updates.push(`active = $${p++}`);
      values.push(body.active);
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { error: "No fields to update" },
        { status: 400 }
      );
    }

    updates.push(`updated_at = NOW()`);

    // ── Tenant-scoped UPDATE ──────────────────────────────────
    const result = await pool.query<{ id: number }>(
      `UPDATE skus
          SET ${updates.join(", ")}
        WHERE id = $${p++} AND client_id = $${p++}
        RETURNING id`,
      [...values, id, client.id]
    );

    if (result.rowCount === 0) {
      return NextResponse.json(
        { error: "SKU not found" },
        { status: 404 }
      );
    }

    // Re-load with the enrichment subqueries so we return the same
    // shape as GET /api/skus.
    const enriched = await loadEnrichedSku(client.id, id);
    if (!enriched) {
      // Should be impossible — we just UPDATEd it — but defend
      // against a race condition.
      return NextResponse.json(
        { error: "SKU disappeared after update" },
        { status: 500 }
      );
    }
    return NextResponse.json({ sku: serializeSku(enriched) });
  } catch (err) {
    console.error("SKU PATCH error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to update SKU" },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------
// DELETE — soft-delete (set active=false)
// ---------------------------------------------------------------------

export async function DELETE(
  _req: NextRequest,
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
        { error: "SKU catalog is a Pro feature." },
        { status: 403 }
      );
    }

    const { id: idParam } = await params;
    const id = Number(idParam);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const result = await pool.query<{ id: number }>(
      `UPDATE skus
          SET active = false, updated_at = NOW()
        WHERE id = $1 AND client_id = $2
        RETURNING id`,
      [id, client.id]
    );

    if (result.rowCount === 0) {
      return NextResponse.json(
        { error: "SKU not found" },
        { status: 404 }
      );
    }

    const enriched = await loadEnrichedSku(client.id, id);
    if (!enriched) {
      return NextResponse.json(
        { error: "SKU disappeared after archive" },
        { status: 500 }
      );
    }
    return NextResponse.json({ sku: serializeSku(enriched) });
  } catch (err) {
    console.error("SKU DELETE error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to archive SKU" },
      { status: 500 }
    );
  }
}
