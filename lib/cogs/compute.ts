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
//   1. FIFO cost layers. COGS is stamped onto each line item at sale
//      time by draining the SKU's oldest cost layers first
//      (lib/inventory/costLayers.ts), and recorded in
//      processed_item_line_items.cogs_amount. This engine just SUMs
//      that column — it never recomputes cost from a date lookup, so
//      changing a SKU's cost today can't retroactively rewrite a
//      historical sale's COGS. cogs_is_estimated marks any sale whose
//      cost fell back (stock went negative / no layer), surfaced so the
//      merchant knows that figure is approximate.
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
  /** Count of sold line items whose COGS is a fallback estimate (stock
   *  went negative, or the product had no cost layer). > 0 means the
   *  COGS/margin figure is approximate — the dashboard can flag it. */
  cogsEstimatedLineItemCount: number;
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
  cogs_estimated_line_item_count: number;
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
    cogsEstimatedLineItemCount: r.cogs_estimated_line_item_count ?? 0,
    totalLineItemCount: r.total_line_item_count ?? 0,
  };
}

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
      COALESCE(SUM(pili.cogs_amount), 0)::text AS cogs,
      COALESCE(
        SUM(CASE WHEN pili.matched_sku_id IS NULL
                 THEN pili.quantity * pili.unit_price
                 ELSE 0 END),
        0
      )::text AS unmatched_revenue,
      COUNT(*) FILTER (WHERE pili.matched_sku_id IS NULL)::int AS unmatched_line_item_count,
      COUNT(*) FILTER (WHERE pili.cogs_is_estimated)::int AS cogs_estimated_line_item_count,
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
      cogs_estimated_line_item_count: 0,
      total_line_item_count: 0,
    }
  );
}

/**
 * Period total of fees + tips collected on paid sales — service charges
 * + tips, the income that lives on the payment but NOT in the product
 * line items. Summed over PARENT processed_items (not the line-item
 * join) so a multi-line order isn't counted once per line. Drives the
 * "Total Sales vs Product sales" explanation: when this is 0 the two are
 * equal, so the card hides the note.
 */
export async function computeFeesAndTips(opts: {
  clientId: number;
  periodStart: string;
  periodEnd: string;
}): Promise<number> {
  const res = await pool.query<{ total: string }>(
    `SELECT COALESCE(SUM(COALESCE(service_charge_amount, 0)
                       + COALESCE(tip_amount, 0)), 0)::text AS total
       FROM processed_items
      WHERE client_id = $1
        AND status = 'paid'
        AND due_date >= $2
        AND due_date <= $3`,
    [opts.clientId, opts.periodStart, opts.periodEnd]
  );
  return Number(res.rows[0]?.total) || 0;
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
