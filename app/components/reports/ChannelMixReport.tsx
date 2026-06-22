// app/components/reports/ChannelMixReport.tsx
//
// "Channel mix" business report. Revenue, share-of-sales, direct
// expenses, and net per channel for the selected period — answers
// "where is my money coming from?". Inherently cross-channel, so the
// channel filter doesn't apply (hub hides it). Sourced from the channel
// rollup (/api/profitability/channels).

"use client";

import { useCallback, useEffect, useState } from "react";
import ReportExportButtons from "./ReportExportButtons";
import type { ReportExportSpec } from "./reportExport";

interface ChannelRow {
  id: string;
  label: string;
  revenue: number;
  directExpenses: number;
}
interface ChannelsResp {
  channels: ChannelRow[];
  overhead: number;
  totalRevenue: number;
}

export interface ChannelMixReportProps {
  from: string;
  to: string;
  periodLabel: string;
}

function fmtUsd(n: number): string {
  const abs = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return n < 0 ? `-$${abs}` : `$${abs}`;
}

export default function ChannelMixReport({
  from,
  to,
  periodLabel,
}: ChannelMixReportProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<ChannelRow[]>([]);
  const [totalRevenue, setTotalRevenue] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/profitability/channels?from=${from}&to=${to}&mode=attributable`
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = (await res.json()) as ChannelsResp;
      setRows(
        d.channels
          .filter((c) => c.revenue !== 0 || c.directExpenses !== 0)
          .sort((a, b) => b.revenue - a.revenue)
      );
      setTotalRevenue(d.totalRevenue);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load channel mix");
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const pct = (rev: number) =>
    totalRevenue > 0 ? (rev / totalRevenue) * 100 : 0;

  const buildSpec = (): ReportExportSpec => ({
    filename: `channel-mix-${from}_${to}`,
    title: "Channel mix",
    meta: [`Period: ${periodLabel}`],
    tables: [
      {
        columns: ["Channel", "Revenue", "% of sales", "Direct expenses", "Net"],
        rows: [
          ...rows.map((c) => [
            c.label,
            fmtUsd(c.revenue),
            `${pct(c.revenue).toFixed(1)}%`,
            fmtUsd(-c.directExpenses),
            fmtUsd(c.revenue - c.directExpenses),
          ]),
          [
            "Total",
            fmtUsd(totalRevenue),
            "100%",
            fmtUsd(-rows.reduce((s, c) => s + c.directExpenses, 0)),
            fmtUsd(
              rows.reduce((s, c) => s + (c.revenue - c.directExpenses), 0)
            ),
          ],
        ],
      },
    ],
  });

  if (loading) {
    return (
      <p className="text-center py-12 text-slate-500 text-sm">
        Loading channel mix…
      </p>
    );
  }
  if (error) return <p className="text-sm text-red-700 py-4">{error}</p>;

  const totalDirect = rows.reduce((s, c) => s + c.directExpenses, 0);
  const totalNet = rows.reduce((s, c) => s + (c.revenue - c.directExpenses), 0);

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-1 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-slate-900 m-0">Channel mix</h2>
          <p className="text-xs text-slate-500 m-0">
            {periodLabel} · where your sales come from
          </p>
        </div>
        <ReportExportButtons buildSpec={buildSpec} disabled={rows.length === 0} />
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-5 mt-4">
        {rows.length === 0 ? (
          <p className="text-center py-8 text-slate-400 text-sm">
            No channel revenue in this period.
          </p>
        ) : (
          <>
            <div className="flex items-center gap-3 px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              <span className="flex-1">Channel</span>
              <span className="w-28 text-right">Revenue</span>
              <span className="w-32">Share</span>
              <span className="w-24 text-right">Direct exp.</span>
              <span className="w-24 text-right">Net</span>
            </div>
            <ul className="m-0 p-0 list-none">
              {rows.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center gap-3 px-1 py-2.5 border-t border-slate-100"
                >
                  <span className="flex-1 text-sm text-slate-800 truncate">
                    {c.label}
                  </span>
                  <span className="w-28 text-right text-sm tabular-nums text-slate-900 font-semibold">
                    {fmtUsd(c.revenue)}
                  </span>
                  <span className="w-32 flex items-center gap-1.5">
                    <span className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
                      <span
                        className="block h-full bg-emerald-400 rounded-full"
                        style={{ width: `${Math.max(pct(c.revenue), 1)}%` }}
                      />
                    </span>
                    <span className="text-[11px] text-slate-500 tabular-nums w-10 text-right">
                      {pct(c.revenue).toFixed(0)}%
                    </span>
                  </span>
                  <span className="w-24 text-right text-sm tabular-nums text-slate-500">
                    ({fmtUsd(c.directExpenses)})
                  </span>
                  <span
                    className={`w-24 text-right text-sm tabular-nums font-semibold ${
                      c.revenue - c.directExpenses < 0
                        ? "text-red-700"
                        : "text-slate-900"
                    }`}
                  >
                    {fmtUsd(c.revenue - c.directExpenses)}
                  </span>
                </li>
              ))}
              <li className="flex items-center gap-3 px-1 py-2.5 border-t-2 border-slate-200 font-bold text-slate-900">
                <span className="flex-1 text-sm">Total</span>
                <span className="w-28 text-right text-sm tabular-nums">
                  {fmtUsd(totalRevenue)}
                </span>
                <span className="w-32 text-[11px] text-slate-400">100%</span>
                <span className="w-24 text-right text-sm tabular-nums text-slate-500">
                  ({fmtUsd(totalDirect)})
                </span>
                <span className="w-24 text-right text-sm tabular-nums">
                  {fmtUsd(totalNet)}
                </span>
              </li>
            </ul>
            <p className="text-[11px] text-slate-400 m-0 mt-3">
              Net = channel revenue − its direct expenses (before COGS and
              shared overhead). Share = % of total revenue.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
