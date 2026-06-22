// app/components/reports/MarketPerformanceReport.tsx
//
// "Market performance" business report. Per-event P&L (revenue, costs
// incl. booth fee + mileage + expenses, net profit) for events in the
// selected period, ranked best → worst — "which markets are worth my
// time?". Sourced from /api/profitability (all events; filtered to the
// period client-side). Events are one channel, so no channel filter.

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import ReportExportButtons from "./ReportExportButtons";
import ReportHelp from "./ReportHelp";
import type { ReportExportSpec } from "./reportExport";

interface PerEvent {
  id: number;
  name: string;
  startDate: string;
  venue: string | null;
  revenue: { total: number };
  expenses: { total: number };
  boothFee: number;
  mileageCost: number;
  profit: number;
}
interface ProfitResp {
  perEvent: PerEvent[];
}

export interface MarketPerformanceReportProps {
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
function fmtDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const names = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${names[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

export default function MarketPerformanceReport({
  from,
  to,
  periodLabel,
}: MarketPerformanceReportProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [events, setEvents] = useState<PerEvent[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/profitability");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const d = (await res.json()) as ProfitResp;
      const inRange = (d.perEvent ?? []).filter(
        (e) => e.startDate >= from && e.startDate <= to
      );
      inRange.sort((a, b) => b.profit - a.profit);
      setEvents(inRange);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load markets");
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  const costsOf = (e: PerEvent) => e.boothFee + e.mileageCost + e.expenses.total;
  const totalRev = events.reduce((s, e) => s + e.revenue.total, 0);
  const totalCost = events.reduce((s, e) => s + costsOf(e), 0);
  const totalNet = events.reduce((s, e) => s + e.profit, 0);

  const buildSpec = (): ReportExportSpec => ({
    filename: `market-performance-${from}_${to}`,
    title: "Market performance",
    meta: [`Period: ${periodLabel}`, `${events.length} events`],
    tables: [
      {
        columns: ["Event", "Date", "Revenue", "Costs", "Net profit"],
        rows: [
          ...events.map((e) => [
            e.name,
            fmtDate(e.startDate),
            fmtUsd(e.revenue.total),
            fmtUsd(costsOf(e)),
            fmtUsd(e.profit),
          ]),
          ["Total", "", fmtUsd(totalRev), fmtUsd(totalCost), fmtUsd(totalNet)],
        ],
      },
    ],
  });

  if (loading) {
    return (
      <p className="text-center py-12 text-slate-500 text-sm">
        Loading markets…
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
              Market performance
            </h2>
            <ReportHelp reportId="markets" />
          </div>
          <p className="text-xs text-slate-500 m-0">
            {periodLabel} · per-event profit &amp; loss
          </p>
        </div>
        <ReportExportButtons buildSpec={buildSpec} disabled={events.length === 0} />
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
        {[
          {
            label: "Net profit",
            value: fmtUsd(totalNet),
            cls: totalNet < 0 ? "text-red-700" : "text-emerald-700",
          },
          { label: "Total revenue", value: fmtUsd(totalRev), cls: "text-slate-900" },
          { label: "Total costs", value: fmtUsd(totalCost), cls: "text-slate-900" },
          {
            label: "Events",
            value: String(events.length),
            cls: "text-slate-900",
          },
        ].map((t) => (
          <div
            key={t.label}
            className="bg-white border border-slate-200 rounded-xl p-4"
          >
            <p className="text-[10px] uppercase tracking-wide text-slate-500 m-0 mb-1">
              {t.label}
            </p>
            <p className={`text-2xl font-bold m-0 tabular-nums ${t.cls}`}>
              {t.value}
            </p>
          </div>
        ))}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-5 mt-4">
        {events.length === 0 ? (
          <p className="text-center py-8 text-slate-400 text-sm">
            No events in this period.
          </p>
        ) : (
          <>
            <div className="flex items-center gap-3 px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              <span className="flex-1">Event</span>
              <span className="w-24 text-right">Revenue</span>
              <span className="w-24 text-right">Costs</span>
              <span className="w-24 text-right">Net</span>
            </div>
            <ul className="m-0 p-0 list-none">
              {events.map((e) => (
                <li
                  key={e.id}
                  className="flex items-center gap-3 px-1 py-2.5 border-t border-slate-100"
                >
                  <span className="flex-1 min-w-0">
                    <Link
                      href={`/events/${e.id}`}
                      className="text-sm text-slate-800 hover:text-blue-700 no-underline truncate block"
                    >
                      {e.name}
                    </Link>
                    <span className="text-[11px] text-slate-400">
                      {fmtDate(e.startDate)}
                      {e.venue ? ` · ${e.venue}` : ""}
                    </span>
                  </span>
                  <span className="w-24 text-right text-sm tabular-nums text-slate-900">
                    {fmtUsd(e.revenue.total)}
                  </span>
                  <span className="w-24 text-right text-sm tabular-nums text-slate-500">
                    {fmtUsd(costsOf(e))}
                  </span>
                  <span
                    className={`w-24 text-right text-sm tabular-nums font-semibold ${
                      e.profit < 0 ? "text-red-700" : "text-emerald-700"
                    }`}
                  >
                    {fmtUsd(e.profit)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-slate-400 m-0 mt-3">
              Costs = booth fee + mileage (operating rate) + event expenses.
              Click an event for its full detail.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
