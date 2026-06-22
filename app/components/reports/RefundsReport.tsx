// app/components/reports/RefundsReport.tsx
//
// "Refunds & returns" business report. Total refunds + refund rate
// (refunds ÷ gross sales) for the period, broken down by channel, plus
// the individual refunds. Sourced from /api/reports/refunds (negative
// income rows). The by-channel table is the channel view, so the channel
// filter dropdown is hidden.

"use client";

import { useCallback, useEffect, useState } from "react";
import ReportExportButtons from "./ReportExportButtons";
import type { ReportExportSpec } from "./reportExport";

interface ChannelRefund {
  channelLabel: string;
  gross: number;
  refunds: number;
  rate: number | null;
}
interface RefundRow {
  label: string;
  channelLabel: string;
  amount: number;
  date: string | null;
}
interface RefundsResp {
  grossSales: number;
  totalRefunds: number;
  refundRate: number | null;
  byChannel: ChannelRefund[];
  refunds: RefundRow[];
}

export interface RefundsReportProps {
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
function fmtRate(r: number | null): string {
  return r == null ? "—" : `${(r * 100).toFixed(1)}%`;
}
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const names = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${names[Number(m[2]) - 1]} ${Number(m[3])}`;
}

export default function RefundsReport({
  from,
  to,
  periodLabel,
}: RefundsReportProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<RefundsResp | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/reports/refunds?from=${from}&to=${to}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData((await res.json()) as RefundsResp);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load refunds");
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <p className="text-center py-12 text-slate-500 text-sm">
        Loading refunds…
      </p>
    );
  }
  if (error) return <p className="text-sm text-red-700 py-4">{error}</p>;
  if (!data) return null;

  const buildSpec = (): ReportExportSpec => ({
    filename: `refunds-${from}_${to}`,
    title: "Refunds & returns",
    meta: [
      `Period: ${periodLabel}`,
      `Total refunds: ${fmtUsd(data.totalRefunds)}`,
      `Refund rate: ${fmtRate(data.refundRate)}`,
    ],
    tables: [
      {
        heading: "By channel",
        columns: ["Channel", "Gross sales", "Refunds", "Refund rate"],
        rows: data.byChannel.map((c) => [
          c.channelLabel,
          fmtUsd(c.gross),
          fmtUsd(c.refunds),
          fmtRate(c.rate),
        ]),
      },
      {
        heading: "Refunds",
        columns: ["Item", "Channel", "Date", "Amount"],
        rows: data.refunds.map((r) => [
          r.label,
          r.channelLabel,
          fmtDate(r.date),
          fmtUsd(r.amount),
        ]),
      },
    ],
  });

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-1 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-slate-900 m-0">
            Refunds &amp; returns
          </h2>
          <p className="text-xs text-slate-500 m-0">{periodLabel}</p>
        </div>
        <ReportExportButtons
          buildSpec={buildSpec}
          disabled={data.totalRefunds === 0 && data.grossSales === 0}
        />
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 mt-4">
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-[10px] uppercase tracking-wide text-slate-500 m-0 mb-1">
            Total refunds
          </p>
          <p className="text-2xl font-bold text-slate-900 m-0 tabular-nums">
            {fmtUsd(data.totalRefunds)}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-[10px] uppercase tracking-wide text-slate-500 m-0 mb-1">
            Refund rate
          </p>
          <p
            className={`text-2xl font-bold m-0 tabular-nums ${
              (data.refundRate ?? 0) > 0.05 ? "text-amber-700" : "text-slate-900"
            }`}
          >
            {fmtRate(data.refundRate)}
          </p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-[10px] uppercase tracking-wide text-slate-500 m-0 mb-1">
            Gross sales
          </p>
          <p className="text-2xl font-bold text-slate-900 m-0 tabular-nums">
            {fmtUsd(data.grossSales)}
          </p>
        </div>
      </div>

      {data.totalRefunds === 0 ? (
        <div className="bg-white border border-slate-200 rounded-xl p-8 mt-4 text-center text-sm text-slate-400">
          No refunds in this period. 🎉
        </div>
      ) : (
        <>
          {/* By channel */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 mt-4">
            <h3 className="text-sm font-semibold text-slate-700 m-0 mb-3 uppercase tracking-wide">
              By channel
            </h3>
            <div className="flex items-center gap-3 px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              <span className="flex-1">Channel</span>
              <span className="w-28 text-right">Gross</span>
              <span className="w-24 text-right">Refunds</span>
              <span className="w-16 text-right">Rate</span>
            </div>
            <ul className="m-0 p-0 list-none">
              {data.byChannel.map((c) => (
                <li
                  key={c.channelLabel}
                  className="flex items-center gap-3 px-1 py-2 border-t border-slate-100"
                >
                  <span className="flex-1 text-sm text-slate-800 truncate">
                    {c.channelLabel}
                  </span>
                  <span className="w-28 text-right text-sm tabular-nums text-slate-500">
                    {fmtUsd(c.gross)}
                  </span>
                  <span className="w-24 text-right text-sm tabular-nums font-semibold text-slate-900">
                    {fmtUsd(c.refunds)}
                  </span>
                  <span
                    className={`w-16 text-right text-sm tabular-nums ${
                      (c.rate ?? 0) > 0.05 ? "text-amber-700" : "text-slate-500"
                    }`}
                  >
                    {fmtRate(c.rate)}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          {/* Individual refunds */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 mt-4">
            <h3 className="text-sm font-semibold text-slate-700 m-0 mb-3 uppercase tracking-wide">
              Refunds ({data.refunds.length})
            </h3>
            <ul className="m-0 p-0 list-none">
              {data.refunds.map((r, i) => (
                <li
                  key={i}
                  className="flex items-center gap-3 px-1 py-2 border-t border-slate-100"
                >
                  <span className="flex-1 min-w-0 text-sm text-slate-800 truncate">
                    {r.label}
                  </span>
                  <span className="text-[11px] text-slate-400 whitespace-nowrap">
                    {r.channelLabel} · {fmtDate(r.date)}
                  </span>
                  <span className="w-24 text-right text-sm tabular-nums font-semibold text-slate-900">
                    {fmtUsd(r.amount)}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-slate-400 m-0 mt-3">
              Refund rate = refunds ÷ gross sales. A channel above ~5% is worth
              a look.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
