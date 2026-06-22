// app/components/reports/ProductProfitabilityReport.tsx
//
// "Product profitability" business report. Per-SKU revenue, COGS,
// margin, and margin % for the selected period — top sellers and
// underwater products (selling below cost). Filterable by channel.
//
//   All channels  -> /api/cogs/summary (bySku is already aggregated)
//   One channel   -> /api/cogs/drill?scope=channel (aggregate by SKU)

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import ReportExportButtons from "./ReportExportButtons";
import ReportHelp from "./ReportHelp";
import type { ReportExportSpec } from "./reportExport";

interface ProductRow {
  key: string;
  code: string | null;
  name: string;
  revenue: number;
  cogs: number;
}

interface SummaryBySku {
  totals: { unmatchedRevenue: number; unmatchedLineItemCount: number };
  bySku: {
    skuId: number | null;
    skuCode: string | null;
    skuName: string | null;
    revenue: number;
    cogs: number;
  }[];
}
interface DrillResp {
  lineItems: {
    matchedSkuId: number | null;
    matchedSkuCode: string | null;
    matchedSkuName: string | null;
    name: string;
    revenue: number;
    cogs: number;
  }[];
}

export interface ProductProfitabilityReportProps {
  from: string;
  to: string;
  periodLabel: string;
  channel: string;
  channelLabel: string;
}

function fmtUsd(n: number): string {
  const abs = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return n < 0 ? `-$${abs}` : `$${abs}`;
}
function marginPct(rev: number, cogs: number): string {
  if (rev <= 0) return "—";
  return `${(((rev - cogs) / rev) * 100).toFixed(1)}%`;
}

export default function ProductProfitabilityReport({
  from,
  to,
  periodLabel,
  channel,
  channelLabel,
}: ProductProfitabilityReportProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<ProductRow[]>([]);
  // Line items not yet mapped to a SKU: revenue with $0 COGS. Surfaced as
  // an "Unmatched" row so the report total ties to the Profit Margin card.
  const [unmatched, setUnmatched] = useState<{ revenue: number; count: number }>(
    { revenue: 0, count: 0 }
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let result: ProductRow[];
      let unm = { revenue: 0, count: 0 };
      if (channel === "all") {
        const res = await fetch(`/api/cogs/summary?from=${from}&to=${to}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const d = (await res.json()) as SummaryBySku;
        result = d.bySku
          .filter((s) => s.skuId != null)
          .map((s) => ({
            key: String(s.skuId),
            code: s.skuCode,
            name: s.skuName ?? "—",
            revenue: s.revenue,
            cogs: s.cogs,
          }));
        unm = {
          revenue: d.totals?.unmatchedRevenue ?? 0,
          count: d.totals?.unmatchedLineItemCount ?? 0,
        };
      } else {
        const url = new URL("/api/cogs/drill", window.location.origin);
        url.searchParams.set("scope", "channel");
        url.searchParams.set("id", channel);
        url.searchParams.set("from", from);
        url.searchParams.set("to", to);
        const res = await fetch(url.toString());
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const d = (await res.json()) as DrillResp;
        const map = new Map<string, ProductRow>();
        for (const li of d.lineItems) {
          if (li.matchedSkuId == null) {
            unm.revenue += li.revenue;
            unm.count += 1;
            continue;
          }
          const k = String(li.matchedSkuId);
          const ex = map.get(k);
          if (ex) {
            ex.revenue += li.revenue;
            ex.cogs += li.cogs;
          } else {
            map.set(k, {
              key: k,
              code: li.matchedSkuCode,
              name: li.matchedSkuName ?? li.name,
              revenue: li.revenue,
              cogs: li.cogs,
            });
          }
        }
        result = Array.from(map.values());
      }
      setRows(result.sort((a, b) => b.revenue - a.revenue));
      setUnmatched(unm);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load products");
    } finally {
      setLoading(false);
    }
  }, [from, to, channel]);

  useEffect(() => {
    void load();
  }, [load]);

  const isAll = channel === "all";
  const underwater = rows.filter((r) => r.revenue > 0 && r.cogs > r.revenue);
  const matchedRevenue = rows.reduce((s, r) => s + r.revenue, 0);
  const totalCogs = rows.reduce((s, r) => s + r.cogs, 0);
  const totalRevenue = matchedRevenue + unmatched.revenue;
  const totalMargin = totalRevenue - totalCogs;

  const buildSpec = (): ReportExportSpec => {
    const specRows: (string | number)[][] = rows.map((r) => [
      `${r.code ? r.code + " " : ""}${r.name}`,
      fmtUsd(r.revenue),
      fmtUsd(r.cogs),
      fmtUsd(r.revenue - r.cogs),
      marginPct(r.revenue, r.cogs),
    ]);
    if (unmatched.revenue > 0) {
      specRows.push([
        `Unmatched (${unmatched.count} line item${unmatched.count === 1 ? "" : "s"})`,
        fmtUsd(unmatched.revenue),
        fmtUsd(0),
        fmtUsd(unmatched.revenue),
        marginPct(unmatched.revenue, 0),
      ]);
    }
    specRows.push([
      "Total",
      fmtUsd(totalRevenue),
      fmtUsd(totalCogs),
      fmtUsd(totalMargin),
      marginPct(totalRevenue, totalCogs),
    ]);
    return {
      filename: `product-profitability-${channel}-${from}_${to}`,
      title: "Product profitability",
      meta: [
        `Period: ${periodLabel}`,
        `Channel: ${isAll ? "All channels" : channelLabel}`,
      ],
      tables: [
        {
          columns: ["Product", "Revenue", "COGS", "Margin", "Margin %"],
          rows: specRows,
        },
      ],
    };
  };

  if (loading) {
    return (
      <p className="text-center py-12 text-slate-500 text-sm">
        Loading products…
      </p>
    );
  }
  if (error) return <p className="text-sm text-red-700 py-4">{error}</p>;

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-1 flex-wrap">
        <div>
          <div className="flex items-center gap-1.5">
            <h2 className="text-xl font-bold text-slate-900 m-0">
              Product profitability
            </h2>
            <ReportHelp reportId="products" />
          </div>
          <p className="text-xs text-slate-500 m-0">
            {periodLabel} · {isAll ? "All channels" : channelLabel}
          </p>
        </div>
        <ReportExportButtons buildSpec={buildSpec} disabled={rows.length === 0} />
      </div>

      {underwater.length > 0 && (
        <div className="mt-3 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-50 text-red-700 border border-red-200 text-xs font-semibold">
          {"\u{26A0}"} {underwater.length} product
          {underwater.length === 1 ? "" : "s"} selling below cost
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl p-5 mt-4">
        {rows.length === 0 ? (
          <p className="text-center py-8 text-slate-400 text-sm">
            No mapped product sales in this period
            {isAll ? "" : " for this channel"}.
          </p>
        ) : (
          <>
            <div className="flex items-center gap-3 px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              <span className="flex-1">Product</span>
              <span className="w-24 text-right">Revenue</span>
              <span className="w-24 text-right">COGS</span>
              <span className="w-24 text-right">Margin</span>
              <span className="w-16 text-right">Margin %</span>
            </div>
            <ul className="m-0 p-0 list-none">
              {rows.map((r) => {
                const margin = r.revenue - r.cogs;
                const under = r.revenue > 0 && r.cogs > r.revenue;
                return (
                  <li
                    key={r.key}
                    className="flex items-center gap-3 px-1 py-2.5 border-t border-slate-100"
                  >
                    <span className="flex-1 min-w-0 text-sm text-slate-800 truncate">
                      {r.code && (
                        <span className="font-mono text-slate-500 mr-1.5">
                          {r.code}
                        </span>
                      )}
                      {r.name}
                    </span>
                    <span className="w-24 text-right text-sm tabular-nums text-slate-900">
                      {fmtUsd(r.revenue)}
                    </span>
                    <span className="w-24 text-right text-sm tabular-nums text-slate-500">
                      {fmtUsd(r.cogs)}
                    </span>
                    <span
                      className={`w-24 text-right text-sm tabular-nums font-semibold ${
                        under ? "text-red-700" : "text-slate-900"
                      }`}
                    >
                      {fmtUsd(margin)}
                    </span>
                    <span
                      className={`w-16 text-right text-sm tabular-nums ${
                        under ? "text-red-700" : "text-slate-500"
                      }`}
                    >
                      {marginPct(r.revenue, r.cogs)}
                    </span>
                  </li>
                );
              })}
              {unmatched.revenue > 0 && (
                <li className="flex items-center gap-3 px-1 py-2.5 border-t border-slate-100 bg-amber-50/40 -mx-1 px-2 rounded">
                  <span className="flex-1 min-w-0 text-sm text-amber-800">
                    Unmatched{" "}
                    <span className="text-[11px] text-amber-600">
                      ({unmatched.count} line item
                      {unmatched.count === 1 ? "" : "s"})
                    </span>{" "}
                    <Link
                      href="/skus/unmatched"
                      className="text-[11px] text-blue-600 hover:underline"
                    >
                      map these →
                    </Link>
                  </span>
                  <span className="w-24 text-right text-sm tabular-nums text-slate-900">
                    {fmtUsd(unmatched.revenue)}
                  </span>
                  <span className="w-24 text-right text-sm tabular-nums text-slate-400">
                    {fmtUsd(0)}
                  </span>
                  <span className="w-24 text-right text-sm tabular-nums font-semibold text-slate-900">
                    {fmtUsd(unmatched.revenue)}
                  </span>
                  <span className="w-16 text-right text-sm tabular-nums text-slate-400">
                    {marginPct(unmatched.revenue, 0)}
                  </span>
                </li>
              )}
              <li className="flex items-center gap-3 px-1 py-2.5 border-t-2 border-slate-200 font-bold text-slate-900">
                <span className="flex-1 text-sm">Total</span>
                <span className="w-24 text-right text-sm tabular-nums">
                  {fmtUsd(totalRevenue)}
                </span>
                <span className="w-24 text-right text-sm tabular-nums text-slate-500">
                  {fmtUsd(totalCogs)}
                </span>
                <span className="w-24 text-right text-sm tabular-nums">
                  {fmtUsd(totalMargin)}
                </span>
                <span className="w-16 text-right text-sm tabular-nums text-slate-500">
                  {marginPct(totalRevenue, totalCogs)}
                </span>
              </li>
            </ul>
            <p className="text-[11px] text-slate-400 m-0 mt-3">
              Margin = revenue − COGS (product cost only, before channel
              expenses + overhead). The <strong>Unmatched</strong> row is
              itemized sales not yet mapped to a SKU (revenue, no cost) — map
              them to give them a cost. The <strong>Total</strong> ties to the
              Profit margin card.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
