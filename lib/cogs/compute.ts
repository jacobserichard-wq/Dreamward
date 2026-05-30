// lib/cogs/compute.ts
//
// Phase 12f computation engine. One module that powers the
// /cogs dashboard + the eventual dashboard widget + email digest.
//
// Core function: computeMargin({ clientId, periodStart, periodEnd })
// returns the period's revenue, COGS, and gross margin overall +
// optionally broken down by channel or by SKU.
//
// Architecture notes — what makes this different from Crafty Base:
//
//   1. Effective-date discipline. The cost we use for each line
//      item is the newest sku_cost_history row whose effective_date
//      is <= the line item's sold_at. NOT the SKU's current cost.
//      This means changing a SKU's cost today doesn't retroactively
//      rewrite historical COGS — directly opposite to Crafty Base's
//      "Historical Data Nightmare" complaint.
//
//   2. Unmatched items contribute zero COGS (and are flagged in
//      the unmatchedRevenue field separately) instead of being
//      silently dropped. The dashboard surfaces the unmatched
//      bucket prominently so the merchant knows their margin
//      numbers are partial until they sweep /skus/unmatched.
//
//   3. Status filter: only sales with processed_items.status='paid'
//      count. Cancelled/refunded sales are excluded from both
//      revenue and COGS — the typical accrual treatment.
//
//   4. EVERY number returned can be drilled into (audit trail in
//      Phase 12f commit 3) to see the exact line items + their
//      effective cost on that sale's date.

import pool from "@/lib/db";

export interface MarginTotals {
  revenue: number;
  cogs: number;
  margin: number;             // revenue - cogs
  marginPercent: number | null; // null when revenue=0
  /** Line items with no matched_sku_id contribute to revenue but
   *  zero to COGS. Surfaced so the dashboard can show "of this
   *  total, $X is from unmatched items — your margin reading is
   *  incomplete until you map them." */
  unmatchedRevenue: number;
  unmatchedLineItemCount: number;
  totalLineItemCount: number;
}

export interface ChannelMarginRow extends MarginTotals {
  /** Comes from processed_items.channel. Null = no channel tag
   *  (legacy uncategorized sale). */
  channel: string | null;
}

export interface SkuMarginRow extends MarginTotals {
  /** matched_sku_id. Null = an "Unmatched bucket" row that groups
   *  every unmapped item across the period. */
  skuId: number | null;
  skuCode: string | null;
  skuName: string | null;
  /** True when revenue is positive but COGS exceeds it. The
   *  dashboard pulls these into an "Underwater SKUs" warning
   *  panel. */
  underwater: boolean;
}

interface RawMarginRow {
  group_key: string | null;
  revenue: string;
  cogs: string;
  unmatched_revenue: string;
  unmatched_line_item_count: number;
  total_line_item_count: number;
}

/**
 * Build a MarginTotals object from a raw query row.
 * Centralizes the string→number coercion + the
 * marginPercent edge case (null when revenue=0).
 */
function toMarginTotals(r: RawMarginRow): MarginTotals {
  const revenue = Number(r.revenue) || 0;
  const cogs = Number(r.cogs) || 0;
  const margin = revenue - cogs;
  return {
    revenue,
    cogs,
    margin,
    marginPercent: revenue > 0 ? (margin / revenue) * 100 : null,
    unmatchedRevenue: Number(r.unmatched_revenue) || 0,
    unmatchedLineItemCount: r.unmatched_line_item_count ?? 0,
    totalLineItemCount: r.total_line_item_count ?? 0,
  };
}

/**
 * Reusable SQL fragment for the cost-on-sale-date lookup. Implemented
 * as a correlated subquery so each line item resolves to the right
 * cost-history row independently. The (sku_id, effective_date DESC)
 * partial index from migration 0017 makes the LIMIT 1 lookup cheap.
 *
 * The COALESCE wraps the entire subquery so unmatched line items
 * (matched_sku_id IS NULL) contribute 0 to COGS — they're surfaced
 * separately via unmatched_revenue.
 */
const COST_LOOKUP_SQL = `
  COALESCE(
    (SELECT ch.cost FROM sku_cost_history ch
      WHERE ch.sku_id = pili.matched_sku_id
        AND ch.effective_date <= pili.sold_at
      ORDER BY ch.effective_date DESC
      LIMIT 1),
    0
  )
`.trim();

/**
 * Build the period base CTE — the SUM clauses shared by every
 * grouping flavor. Caller supplies the GROUP BY column (or no group)
 * + the column to surface as group_key.
 */
function buildAggregateSql(opts: {
  groupExpr: string | null; // SQL expression to group by; null = whole period
  groupKeyExpr: string;     // expression to expose as group_key in the SELECT
}): string {
  const groupBy = opts.groupExpr ? `GROUP BY ${opts.groupExpr}` : "";
  return `
    SELECT
      ${opts.groupKeyExpr} AS group_key,
      COALESCE(SUM(pili.quantity * pili.unit_price), 0)::text AS revenue,
      COALESCE(SUM(pili.quantity * ${COST_LOOKUP_SQL}), 0)::text AS cogs,
      COALESCE(
        SUM(CASE WHEN pili.matched_sku_id IS NULL
                 THEN pili.quantity * pili.unit_price
                 ELSE 0 END),
        0
      )::text AS unmatched_revenue,
      COUNT(*) FILTER (WHERE pili.matched_sku_id IS NULL)::int AS unmatched_line_item_count,
      COUNT(*)::int AS total_line_item_count
    FROM processed_item_line_items pili
    JOIN processed_items pi ON pi.id = pili.processed_item_id
    WHERE pili.client_id = $1
      AND pili.sold_at >= $2
      AND pili.sold_at <= $3
      AND pi.status = 'paid'
    ${groupBy}
  `.trim();
}

/**
 * The overall totals for a period (no grouping).
 */
export async function computeMargin(opts: {
  clientId: number;
  periodStart: string; // YYYY-MM-DD
  periodEnd: string;
}): Promise<MarginTotals> {
  const sql = buildAggregateSql({
    groupExpr: null,
    groupKeyExpr: "NULL",
  });
  const res = await pool.query<RawMarginRow>(sql, [
    opts.clientId,
    opts.periodStart,
    opts.periodEnd,
  ]);
  return toMarginTotals(
    res.rows[0] ?? {
      group_key: null,
      revenue: "0",
      cogs: "0",
      unmatched_revenue: "0",
      unmatched_line_item_count: 0,
      total_line_item_count: 0,
    }
  );
}

/**
 * Per-channel breakdown. Groups by processed_items.channel.
 * Includes a null-channel row when there are uncategorized sales.
 */
export async function computeMarginByChannel(opts: {
  clientId: number;
  periodStart: string;
  periodEnd: string;
}): Promise<ChannelMarginRow[]> {
  const sql = buildAggregateSql({
    groupExpr: "pi.channel",
    groupKeyExpr: "pi.channel",
  });
  const res = await pool.query<RawMarginRow>(sql, [
    opts.clientId,
    opts.periodStart,
    opts.periodEnd,
  ]);
  return res.rows
    .map((r) => ({
      channel: r.group_key,
      ...toMarginTotals(r),
    }))
    .sort((a, b) => b.revenue - a.revenue);
}

/**
 * Per-SKU breakdown. Groups by matched_sku_id with the SKU's code
 * and name joined in via a separate query (cheaper than a JOIN in
 * the aggregate since we limit + only enrich the top N + an
 * unmatched bucket).
 *
 * A "synthetic" row with skuId=null represents the unmatched bucket
 * (everything with matched_sku_id IS NULL) so the dashboard can
 * surface it as a single line.
 */
export async function computeMarginBySku(opts: {
  clientId: number;
  periodStart: string;
  periodEnd: string;
  limit?: number; // top N by revenue; default 100
}): Promise<SkuMarginRow[]> {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);

  const sql = buildAggregateSql({
    groupExpr: "pili.matched_sku_id",
    groupKeyExpr: "pili.matched_sku_id::text",
  });
  const res = await pool.query<RawMarginRow>(sql, [
    opts.clientId,
    opts.periodStart,
    opts.periodEnd,
  ]);

  // Enrich with code + name via one extra query (only for
  // non-null SKU rows).
  const skuIds = res.rows
    .map((r) => (r.group_key ? Number(r.group_key) : null))
    .filter((id): id is number => id !== null);
  let skuMap = new Map<number, { code: string; name: string }>();
  if (skuIds.length > 0) {
    const skuInfoRes = await pool.query<{
      id: number;
      code: string;
      name: string;
    }>(
      `SELECT id, code, name FROM skus
        WHERE id = ANY($1::int[]) AND client_id = $2`,
      [skuIds, opts.clientId]
    );
    skuMap = new Map(
      skuInfoRes.rows.map((r) => [r.id, { code: r.code, name: r.name }])
    );
  }

  const enriched: SkuMarginRow[] = res.rows.map((r) => {
    const totals = toMarginTotals(r);
    const skuId = r.group_key ? Number(r.group_key) : null;
    const info = skuId != null ? skuMap.get(skuId) : null;
    return {
      skuId,
      skuCode: info?.code ?? null,
      skuName: info?.name ?? null,
      ...totals,
      underwater: totals.revenue > 0 && totals.cogs > totals.revenue,
    };
  });

  return enriched.sort((a, b) => b.revenue - a.revenue).slice(0, limit);
}
