// app/api/skus/route.ts
//
// Phase 12b commit 1 of 4. GET endpoint for the new /skus surface
// — the FlowWork SKU catalog management page.
//
// GET /api/skus
//   Query params:
//     ?include_inactive=1  — include soft-deleted (active=false) SKUs.
//                            Defaults to 0 (active-only).
//     ?limit=<num>         — default 200, max 500
//     ?offset=<num>        — default 0
//   Returns:
//     {
//       skus: SkuRow[],
//       summary: { totalActive: number; totalArchived: number }
//     }
//
// Each SkuRow includes the "current cost" (newest sku_cost_history
// row whose effective_date <= today) and aggregate sales stats
// (count + last sale date) pulled from processed_item_line_items.
// In Phase 12b before line-item ingestion ships, the sales stats
// will be zero everywhere — that's expected and rendered as "—" by
// the page UI. Once Phase 12c ingestion ships the same query lights
// up without code changes.
//
// Plan gating: Pro-only. SKU catalog pairs with the Pro
// integrations (Shopify/Wix/Square); a Starter user can't auto-fan
// sales into matched_sku_id anyway, so the catalog is useless to
// them. Decision recorded in session-notes/phase-12-cogs-design.md
// + locked during the Phase 12b kickoff conversation.

import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getSessionClient } from "@/lib/getClient";

interface SkuRowDb {
  id: number;
  code: string;
  name: string;
  description: string | null;
  active: boolean;
  current_cost: string | null;       // pg NUMERIC → string
  cost_currency: string | null;
  cost_effective_date: string | null;
  sales_count: number;
  last_sale_date: string | null;
  created_at: string;
  updated_at: string;
}

export async function GET(req: NextRequest) {
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

    const params = req.nextUrl.searchParams;
    const includeInactive = params.get("include_inactive") === "1";
    const limit = Math.min(
      Math.max(Number(params.get("limit") ?? 200), 1),
      500
    );
    const offset = Math.max(Number(params.get("offset") ?? 0), 0);

    // ── Main query ──────────────────────────────────────────────
    //
    // Two LEFT JOIN LATERAL subqueries enrich each SKU row:
    //
    //   1. current cost   — newest sku_cost_history row with
    //                       effective_date <= today. Uses the
    //                       (sku_id, effective_date DESC) index to
    //                       cap the LIMIT-1 lookup at O(log n).
    //                       A SKU with no cost rows yet (impossible
    //                       in the happy path — POST creates one
    //                       atomically — but defended against)
    //                       returns NULLs.
    //
    //   2. sales rollup   — COUNT + MAX over the per-SKU line items.
    //                       Today this returns zeros for everyone
    //                       because Phase 12c (line-item ingestion)
    //                       hasn't shipped. The query is forward-
    //                       compatible: when 12c populates
    //                       processed_item_line_items.matched_sku_id,
    //                       this lights up without re-deploy.
    //
    // The (s.active OR $2) filter referenced $2 either way — the
    // include_inactive boolean — so node-postgres' type inference
    // doesn't choke on an unused parameter (see MEMORY: pg parameter
    // discipline).
    const result = await pool.query<SkuRowDb>(
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
        WHERE s.client_id = $1
          AND (s.active OR $2)
        ORDER BY s.code ASC
        LIMIT $3 OFFSET $4`,
      [client.id, includeInactive, limit, offset]
    );

    // ── Summary counts (cheap; one extra round trip) ────────────
    const summaryRes = await pool.query<{
      total_active: number;
      total_archived: number;
    }>(
      `SELECT
         COUNT(*) FILTER (WHERE active)::int      AS total_active,
         COUNT(*) FILTER (WHERE NOT active)::int  AS total_archived
       FROM skus
       WHERE client_id = $1`,
      [client.id]
    );
    const summary = summaryRes.rows[0] ?? {
      total_active: 0,
      total_archived: 0,
    };

    return NextResponse.json({
      skus: result.rows.map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        description: r.description,
        active: r.active,
        currentCost: r.current_cost != null ? Number(r.current_cost) : null,
        costCurrency: r.cost_currency,
        costEffectiveDate: r.cost_effective_date,
        salesCount: r.sales_count,
        lastSaleDate: r.last_sale_date,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
      summary: {
        totalActive: summary.total_active,
        totalArchived: summary.total_archived,
      },
    });
  } catch (err) {
    console.error("SKUs GET error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load SKUs" },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------
// POST — create a new SKU + its initial cost row
// ---------------------------------------------------------------------
//
// Transactional: skus + sku_cost_history are written together so a
// SKU can never exist without at least one cost row. If either INSERT
// fails the whole thing rolls back. Mirrors the pool.connect() →
// BEGIN/COMMIT/ROLLBACK pattern in app/api/events/[id]/route.ts.
//
// Duplicate-code handling: skus(client_id, code) is UNIQUE. Postgres
// throws SQLSTATE 23505 on collision; we map that to a 409 with a
// human-readable message instead of a generic 500.

interface CreateSkuBody {
  code?: unknown;
  name?: unknown;
  description?: unknown;
  cost?: unknown;
  effectiveDate?: unknown;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function parseCost(v: unknown): number | null {
  if (v == null || v === "") return null;
  const s = typeof v === "number" ? String(v) : String(v).replace(/[$,\s]/g, "");
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
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
    if (client.plan !== "pro") {
      return NextResponse.json(
        { error: "SKU catalog is a Pro feature." },
        { status: 403 }
      );
    }

    const body = (await req.json().catch(() => null)) as CreateSkuBody | null;
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    // ── Validate required fields ────────────────────────────────
    if (!isNonEmptyString(body.code)) {
      return NextResponse.json(
        { error: "SKU code is required" },
        { status: 400 }
      );
    }
    if (body.code.trim().length > 64) {
      return NextResponse.json(
        { error: "SKU code is too long (max 64 characters)" },
        { status: 400 }
      );
    }
    if (!isNonEmptyString(body.name)) {
      return NextResponse.json(
        { error: "Name is required" },
        { status: 400 }
      );
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

    const code = body.code.trim();
    const name = body.name.trim();
    const description =
      typeof body.description === "string" && body.description.trim().length > 0
        ? body.description.trim()
        : null;
    const effectiveDate = body.effectiveDate;

    // ── Transactional create ────────────────────────────────────
    const dbClient = await pool.connect();
    try {
      await dbClient.query("BEGIN");

      const skuInsert = await dbClient.query<{ id: number }>(
        `INSERT INTO skus (client_id, code, name, description)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [client.id, code, name, description]
      );
      const skuId = skuInsert.rows[0].id;

      await dbClient.query(
        `INSERT INTO sku_cost_history (sku_id, cost, currency, effective_date)
         VALUES ($1, $2, 'USD', $3)`,
        [skuId, costNum, effectiveDate]
      );

      await dbClient.query("COMMIT");

      // Return a full SkuRow shape matching GET so the client can
      // append without a re-fetch. sales_count + last_sale_date are
      // necessarily zero/null for a brand-new SKU.
      return NextResponse.json({
        sku: {
          id: skuId,
          code,
          name,
          description,
          active: true,
          currentCost: costNum,
          costCurrency: "USD",
          costEffectiveDate: effectiveDate,
          salesCount: 0,
          lastSaleDate: null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      });
    } catch (txErr) {
      await dbClient.query("ROLLBACK").catch(() => {});
      // Duplicate code → friendly 409 instead of a generic 500.
      const pgErr = txErr as { code?: string };
      if (pgErr?.code === "23505") {
        return NextResponse.json(
          { error: `SKU code "${code}" already exists in your catalog.` },
          { status: 409 }
        );
      }
      throw txErr;
    } finally {
      dbClient.release();
    }
  } catch (err) {
    console.error("SKUs POST error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create SKU" },
      { status: 500 }
    );
  }
}
