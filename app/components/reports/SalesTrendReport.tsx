// app/components/reports/SalesTrendReport.tsx
//
// "Sales trend & growth" business report. Revenue + net per month over
// the selected period, plus a year-over-year comparison against the same
// calendar months a year earlier. Uses the annual byMonth data
// (/api/reports/annual) — all-channels, so the channel filter is hidden.

"use client";

import { useCallback, useEffect, useState } from "react";
import ReportExportButtons from "./ReportExportButtons";
import type { ReportExportSpec } from "./reportExport";

interface MonthRow {
  month: string; // YYYY-MM
  revenue: number;
  expenses: number;
  netProfit: number;
}
interface AnnualResp {
  byMonth: MonthRow[];
}

export interface SalesTrendReportProps {
  from: string;
  to: string;
  periodLabel: string;
}

const MONTH_NAMES = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function fmtUsd(n: number): string {
  const abs = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return n < 0 ? `-$${abs}` : `$${abs}`;
}

// "YYYY-MM" keys from the start month of `from` to the start month of `to`.
function monthsInRange(from: string, to: string): string[] {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  const out: string[] = [];
  let y = fy;
  let m = fm;
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
    if (out.length > 60) break; // safety
  }
  return out;
}

export default function SalesTrendReport({
  from,
  to,
  periodLabel,
}: SalesTrendReportProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [months, setMonths] = useState<
    { key: string; label: string; revenue: number; net: number }[]
  >([]);
  const [prior, setPrior] = useState<{ revenue: number; net: number }>({
    revenue: 0,
    net: 0,
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const inRange = monthsInRange(from, to);
      const years = new Set<number>();
      for (const k of inRange) {
        const y = Number(k.slice(0, 4));
        years.add(y);
        years.add(y - 1); // for YoY
      }
      const yearList = Array.from(years);
      const resList = await Promise.all(
        yearList.map((y) => fetch(`/api/reports/annual?year=${y}`))
      );
      const byYear = new Map<number, Map<string, MonthRow>>();
      for (let i = 0; i < yearList.length; i++) {
        const res = resList[i];
        if (!res.ok) continue;
        const d = (await res.json()) as AnnualResp;
        const map = new Map<string, MonthRow>();
        for (const mr of d.byMonth ?? []) map.set(mr.month, mr);
        byYear.set(yearList[i], map);
      }

      const rows = inRange.map((k) => {
        const [y, m] = k.split("-").map(Number);
        const mr = byYear.get(y)?.get(k);
        return {
          key: k,
          label: `${MONTH_NAMES[m - 1]} ${y}`,
          revenue: mr?.revenue ?? 0,
          net: mr?.netProfit ?? 0,
        };
      });
      setMonths(rows);

      // YoY: same calendar months, prior year.
      let pRev = 0;
      let pNet = 0;
      for (const k of inRange) {
        const [y, m] = k.split("-").map(Number);
        const pk = `${y - 1}-${String(m).padStart(2, "0")}`;
        const mr = byYear.get(y - 1)?.get(pk);
        pRev += mr?.revenue ?? 0;
        pNet += mr?.netProfit ?? 0;
      }
      setPrior({ revenue: pRev, net: pNet });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load trend");
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalRev = months.reduce((s, m) => s + m.revenue, 0);
  const totalNet = months.reduce((s, m) => s + m.net, 0);
  const maxRev = Math.max(...months.map((m) => Math.abs(m.revenue)), 1);

  const growth = (cur: number, prev: number): string => {
    if (prev === 0) return cur === 0 ? "—" : "new";
    const pct = ((cur - prev) / Math.abs(prev)) * 100;
    return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
  };

  const buildSpec = (): ReportExportSpec => ({
    filename: `sales-trend-${from}_${to}`,
    title: "Sales trend & growth",
    meta: [`Period: ${periodLabel}`, "All channels"],
    tables: [
      {
        heading: "By month",
        columns: ["Month", "Revenue", "Net"],
        rows: [
          ...months.map((m) => [m.label, fmtUsd(m.revenue), fmtUsd(m.net)]),
          ["Total", fmtUsd(totalRev), fmtUsd(totalNet)],
        ],
      },
      {
        heading: "Year over year (same months)",
        columns: ["Metric", "This period", "Prior year", "Change"],
        rows: [
          ["Revenue", fmtUsd(totalRev), fmtUsd(prior.revenue), growth(totalRev, prior.revenue)],
          ["Net", fmtUsd(totalNet), fmtUsd(prior.net), growth(totalNet, prior.net)],
        ],
      },
    ],
  });

  if (loading) {
    return (
      <p className="text-center py-12 text-slate-500 text-sm">Loading trend…</p>
    );
  }
  if (error) return <p className="text-sm text-red-700 py-4">{error}</p>;

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-1 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-slate-900 m-0">
            Sales trend &amp; growth
          </h2>
          <p className="text-xs text-slate-500 m-0">{periodLabel} · all channels</p>
        </div>
        <ReportExportButtons buildSpec={buildSpec} disabled={months.length === 0} />
      </div>

      {/* YoY cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
        {[
          { label: "Revenue", cur: totalRev, prev: prior.revenue },
          { label: "Net profit", cur: totalNet, prev: prior.net },
        ].map((s) => {
          const g = growth(s.cur, s.prev);
          const up = g.startsWith("+") || g === "new";
          return (
            <div
              key={s.label}
              className="bg-white border border-slate-200 rounded-xl p-4"
            >
              <p className="text-[10px] uppercase tracking-wide text-slate-500 m-0 mb-1">
                {s.label}
              </p>
              <p className="text-2xl font-bold text-slate-900 m-0 tabular-nums">
                {fmtUsd(s.cur)}
              </p>
              <p className="text-xs text-slate-500 m-0 mt-1">
                vs {fmtUsd(s.prev)} last year ·{" "}
                <span
                  className={
                    g === "—"
                      ? "text-slate-400"
                      : up
                        ? "text-emerald-600 font-semibold"
                        : "text-red-600 font-semibold"
                  }
                >
                  {g}
                </span>
              </p>
            </div>
          );
        })}
      </div>

      {/* Monthly bars */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 mt-4">
        <h3 className="text-sm font-semibold text-slate-700 m-0 mb-3 uppercase tracking-wide">
          By month
        </h3>
        {months.length === 0 ? (
          <p className="text-center py-6 text-slate-400 text-sm">
            No months in this period.
          </p>
        ) : (
          <ul className="m-0 p-0 list-none space-y-2">
            {months.map((m) => (
              <li key={m.key} className="flex items-center gap-3">
                <span className="w-20 text-xs text-slate-500 flex-shrink-0">
                  {m.label}
                </span>
                <span className="flex-1 h-3 bg-slate-100 rounded-full overflow-hidden">
                  <span
                    className="block h-full bg-emerald-400 rounded-full"
                    style={{
                      width: `${Math.max((Math.abs(m.revenue) / maxRev) * 100, 0)}%`,
                    }}
                  />
                </span>
                <span className="w-24 text-right text-sm tabular-nums text-slate-900">
                  {fmtUsd(m.revenue)}
                </span>
                <span
                  className={`w-24 text-right text-xs tabular-nums ${
                    m.net < 0 ? "text-red-600" : "text-slate-500"
                  }`}
                >
                  net {fmtUsd(m.net)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-[11px] text-slate-400 m-0 mt-3">
          Bars show monthly revenue; net = revenue − expenses. Year-over-year
          compares the same calendar months a year earlier.
        </p>
      </div>
    </div>
  );
}
