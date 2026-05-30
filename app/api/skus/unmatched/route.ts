// app/api/skus/unmatched/route.ts
//
// Phase 12d commit 2 of 5. Feed for the /skus/unmatched page.
//
// GET /api/skus/unmatched
//   Query params:
//     ?platform=shopify|wix|square   — optional filter
//     ?limit=<num>                   — default 200, max 500
//     ?offset=<num>                  — default 0
//   Returns:
//     {
//       items: UnmatchedItem[],
//       summary: { totalGroups, totalLineItems, totalRevenue, byPlatform: {...} }
//     }
//
// We GROUP BY (platform, external_item_id, name) so the same un-
// mapped item appearing in 50 orders shows as one row with count
// + total revenue. That's the bulk-match shape: select N groups,
// "Create new SKU from these" creates one SKU and one alias that
// resolves all of them, OR "Map to existing SKU" pops a typeahead
// for the same effect.
//
// Special case — Square POS "Custom Amount" line items have
// external_item_id IS NULL. They can't be mapped via the normal
// alias path (alias requires an external_id), so we surface them
// in a distinct group keyed by name only. The /skus/unmatched
// page calls them out with explicit copy because they're Crafty
// Base's #1 complaint and we handle them as first-class data.
//
// Pro-gated. Tenant-scoped on every query.

import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getSessionClient } from "@/lib/getClient";

interface UnmatchedRowDb {
  platform: string;
  external_item_id: string | null;
  external_sku: string | null;
  name: string;
  line_item_count: number;
  total_revenue: string; // pg NUMERIC
  last_sold_at: string;
}

interface PlatformCountRow {
  platform: string;
  group_count: number;
  line_item_count: number;
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
    const platform = params.get("platform");
    if (platform && !["shopify", "wix", "square"].includes(platform)) {
      return NextResponse.json(
        { error: "Invalid platform filter" },
        { status: 400 }
      );
    }
    const limit = Math.min(
      Math.max(Number(params.get("limit") ?? 200), 1),
      500
    );
    const offset = Math.max(Number(params.get("offset") ?? 0), 0);

    // ── Main grouped query ──────────────────────────────────────
    //
    // GROUP BY (platform, external_item_id, name) — last column
    // breaks ties when the same external_item_id is somehow
    // associated with two different display names (rare but
    // possible if a merchant renames an item mid-history). For
    // Square Custom Amount items (external_item_id IS NULL) the
    // group key collapses to just name, which is what we want.
    //
    // The platform filter param is ALWAYS referenced in the WHERE
    // ($2 = '' selects everything, else the explicit value) per
    // pg parameter discipline.
    const platformFilter = platform ?? "";
    const result = await pool.query<UnmatchedRowDb>(
      `SELECT platform,
              external_item_id,
              MAX(external_sku)                 AS external_sku,
              name,
              COUNT(*)::int                      AS line_item_count,
              SUM(quantity * unit_price)         AS total_revenue,
              MAX(sold_at)::text                 AS last_sold_at
         FROM processed_item_line_items
        WHERE client_id = $1
          AND matched_sku_id IS NULL
          AND ($2 = '' OR platform = $2)
        GROUP BY platform, external_item_id, name
        ORDER BY MAX(sold_at) DESC, COUNT(*) DESC
        LIMIT $3 OFFSET $4`,
      [client.id, platformFilter, limit, offset]
    );

    // ── Summary (counts + revenue across the WHOLE unmatched set,
    // not just the current page) ────────────────────────────────
    const summaryRes = await pool.query<{
      total_groups: number;
      total_line_items: number;
      total_revenue: string;
    }>(
      `WITH groups AS (
         SELECT platform, external_item_id, name,
                COUNT(*)::int                AS lic,
                SUM(quantity * unit_price)   AS rev
           FROM processed_item_line_items
          WHERE client_id = $1
            AND matched_sku_id IS NULL
            AND ($2 = '' OR platform = $2)
          GROUP BY platform, external_item_id, name
       )
       SELECT COUNT(*)::int          AS total_groups,
              COALESCE(SUM(lic), 0)::int AS total_line_items,
              COALESCE(SUM(rev), 0)::text AS total_revenue
         FROM groups`,
      [client.id, platformFilter]
    );

    // ── Per-platform breakdown (always returns all 3 platforms
    // even when filtered to one, so chip counts stay accurate) ──
    const platformRes = await pool.query<PlatformCountRow>(
      `SELECT platform,
              COUNT(DISTINCT (external_item_id, name))::int AS group_count,
              COUNT(*)::int                                  AS line_item_count
         FROM processed_item_line_items
        WHERE client_id = $1
          AND matched_sku_id IS NULL
        GROUP BY platform`,
      [client.id]
    );

    const byPlatform: Record<
      string,
      { groupCount: number; lineItemCount: number }
    > = { shopify: { groupCount: 0, lineItemCount: 0 },
          wix:     { groupCount: 0, lineItemCount: 0 },
          square:  { groupCount: 0, lineItemCount: 0 } };
    for (const r of platformRes.rows) {
      if (byPlatform[r.platform]) {
        byPlatform[r.platform] = {
          groupCount: r.group_count,
          lineItemCount: r.line_item_count,
        };
      }
    }

    const summary = summaryRes.rows[0] ?? {
      total_groups: 0,
      total_line_items: 0,
      total_revenue: "0",
    };

    return NextResponse.json({
      items: result.rows.map((r) => ({
        platform: r.platform,
        externalItemId: r.external_item_id,
        externalSku: r.external_sku,
        name: r.name,
        lineItemCount: r.line_item_count,
        totalRevenue: Number(r.total_revenue) || 0,
        lastSoldAt: r.last_sold_at,
        /** Stable client-side key for React. */
        groupKey: `${r.platform}:${r.external_item_id ?? "__null__"}:${r.name}`,
      })),
      summary: {
        totalGroups: summary.total_groups,
        totalLineItems: summary.total_line_items,
        totalRevenue: Number(summary.total_revenue) || 0,
        byPlatform,
      },
    });
  } catch (err) {
    console.error("Unmatched GET error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load unmatched" },
      { status: 500 }
    );
  }
}
