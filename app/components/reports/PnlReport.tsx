// app/components/reports/PnlReport.tsx
//
// "P&L by channel" business report. Revenue → COGS → Gross profit →
// Operating expenses → Net, for All channels or one channel, over the
// selected period. Reconciles to the dashboard at the all-channels
// level: Revenue + Operating expenses come from the channel rollup
// (/api/profitability/channels), COGS from the line-item engine
// (/api/cogs/summary) — the same split the tax report uses.

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
  netProfit: number;
}
interface CogsResp {
  totals: { cogs: number };
  byChannel: { channel: string | null; cogs: number }[];
}

export interface PnlReportProps {
  from: string;
  to: string;
  periodLabel: string;
  /** "all" or a channel id. */
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
function fmtPct(rev: number, val: number): string {
  if (rev <= 0) return "—";
  return `${((val / rev) * 100).toFixed(1)}%`;
}

export default function PnlReport({
  from,
  to,
  periodLabel,
  channel,
  channelLabel,
}: PnlReportProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<{
    revenue: number;
    cogs: number;
    opex: number;
    perChannel: { label: string; revenue: number; directExpenses: number }[];
    overhead: number;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const chUrl = `/api/profitability/channels?from=${from}&to=${to}&mode=attributable`;
      const cogsUrl = `/api/cogs/summary?from=${from}&to=${to}`;
      const [chRes, cogsRes] = await Promise.all([fetch(chUrl), fetch(cogsUrl)]);
      if (!chRes.ok) throw new Error(`Channels HTTP ${chRes.status}`);
      if (!cogsRes.ok) throw new Error(`COGS HTTP ${cogsRes.status}`);
      const ch = (await chRes.json()) as ChannelsResp;
      const cogs = (await cogsRes.json()) as CogsResp;

      if (channel === "all") {
        const opex =
          ch.channels.reduce((s, c) => s + c.directExpenses, 0) + ch.overhead;
        setData({
          revenue: ch.totalRevenue,
          cogs: cogs.totals.cogs,
          opex,
          overhead: ch.overhead,
          perChannel: ch.channels
            .filter((c) => c.revenue !== 0 || c.directExpenses !== 0)
            .map((c) => ({
              label: c.label,
              revenue: c.revenue,
              directExpenses: c.directExpenses,
            }))
            .sort((a, b) => b.revenue - a.revenue),
        });
      } else {
        const c = ch.channels.find((x) => x.id === channel);
        const chCogs =
          cogs.byChannel.find((x) => x.channel === channel)?.cogs ?? 0;
        setData({
          revenue: c?.revenue ?? 0,
          cogs: chCogs,
          opex: c?.directExpenses ?? 0,
          overhead: 0,
          perChannel: [],
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load P&L");
    } finally {
      setLoading(false);
    }
  }, [from, to, channel]);

  useEffect(() => {
    void load();
  }, [load]);

  const isAll = channel === "all";

  const buildSpec = (): ReportExportSpec => {
    const d = data!;
    const gross = d.revenue - d.cogs;
    const net = gross - d.opex;
    const pnl: (string | number)[][] = [
      ["Revenue", fmtUsd(d.revenue)],
      ["Cost of goods sold", fmtUsd(-d.cogs)],
      ["Gross profit", fmtUsd(gross)],
      [isAll ? "Operating expenses" : "Direct expenses", fmtUsd(-d.opex)],
      [isAll ? "Net profit" : "Channel contribution", fmtUsd(net)],
    ];
    const tables: ReportExportSpec["tables"] = [
      { heading: "Profit & Loss", columns: ["Line", "Amount"], rows: pnl },
    ];
    if (isAll && d.perChannel.length) {
      tables.push({
        heading: "By channel",
        columns: ["Channel", "Revenue", "Direct expenses", "Contribution"],
        rows: d.perChannel.map((c) => [
          c.label,
          fmtUsd(c.revenue),
          fmtUsd(-c.directExpenses),
          fmtUsd(c.revenue - c.directExpenses),
        ]),
      });
    }
    return {
      filename: `pnl-${channel}-${from}_${to}`,
      title: "Profit & Loss",
      meta: [`Period: ${periodLabel}`, `Channel: ${isAll ? "All channels" : channelLabel}`],
      tables,
    };
  };

  if (loading) {
    return <p className="text-center py-12 text-slate-500 text-sm">Loading P&L…</p>;
  }
  if (error) {
    return <p className="text-sm text-red-700 py-4">{error}</p>;
  }
  if (!data) return null;

  const gross = data.revenue - data.cogs;
  const net = gross - data.opex;

  const Row = ({
    label,
    value,
    bold,
    sub,
  }: {
    label: string;
    value: number;
    bold?: boolean;
    sub?: string;
  }) => (
    <div
      className={`flex items-center justify-between py-2.5 px-1 border-b border-slate-100 ${
        bold ? "font-bold text-slate-900" : "text-slate-700"
      }`}
    >
      <span className="text-sm">{label}</span>
      <span className="flex items-baseline gap-2">
        {sub && <span className="text-xs text-slate-400">{sub}</span>}
        <span
          className={`text-sm tabular-nums ${
            value < 0 ? "text-slate-500" : bold ? "" : "text-slate-900"
          }`}
        >
          {value < 0 ? `(${fmtUsd(-value)})` : fmtUsd(value)}
        </span>
      </span>
    </div>
  );

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-1 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-slate-900 m-0">
            Profit &amp; Loss
          </h2>
          <p className="text-xs text-slate-500 m-0">
            {periodLabel} · {isAll ? "All channels" : channelLabel}
          </p>
        </div>
        <ReportExportButtons buildSpec={buildSpec} />
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-5 mt-4 max-w-2xl">
        <Row label="Revenue" value={data.revenue} />
        <Row label="Cost of goods sold (COGS)" value={-data.cogs} />
        <Row label="Gross profit" value={gross} bold sub={fmtPct(data.revenue, gross)} />
        <Row
          label={isAll ? "Operating expenses" : "Direct expenses"}
          value={-data.opex}
        />
        <div className="flex items-center justify-between py-3 px-1 mt-1 border-t-2 border-slate-200">
          <span className="text-base font-bold text-slate-900">
            {isAll ? "Net profit" : "Channel contribution"}
          </span>
          <span
            className={`text-lg font-bold tabular-nums ${
              net < 0 ? "text-red-700" : "text-emerald-700"
            }`}
          >
            {net < 0 ? `(${fmtUsd(-net)})` : fmtUsd(net)}
          </span>
        </div>
        {!isAll && (
          <p className="text-[11px] text-slate-400 m-0 mt-3">
            Per-channel COGS reflects sales tagged to this channel; some
            event/market sales may appear only under All channels. Overhead
            isn&rsquo;t allocated to individual channels.
          </p>
        )}
      </div>

      {isAll && data.perChannel.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-xl p-5 mt-4">
          <h3 className="text-sm font-semibold text-slate-700 m-0 mb-3 uppercase tracking-wide">
            By channel
          </h3>
          <div className="flex items-center gap-3 px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            <span className="flex-1">Channel</span>
            <span className="w-24 text-right">Revenue</span>
            <span className="w-24 text-right">Direct exp.</span>
            <span className="w-24 text-right">Contribution</span>
          </div>
          <ul className="m-0 p-0 list-none">
            {data.perChannel.map((c) => (
              <li
                key={c.label}
                className="flex items-center gap-3 px-1 py-2 border-t border-slate-100"
              >
                <span className="flex-1 text-sm text-slate-800 truncate">
                  {c.label}
                </span>
                <span className="w-24 text-right text-sm tabular-nums text-slate-900">
                  {fmtUsd(c.revenue)}
                </span>
                <span className="w-24 text-right text-sm tabular-nums text-slate-500">
                  ({fmtUsd(c.directExpenses)})
                </span>
                <span className="w-24 text-right text-sm tabular-nums font-semibold text-slate-900">
                  {fmtUsd(c.revenue - c.directExpenses)}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-slate-400 m-0 mt-3">
            Contribution = channel revenue − its direct expenses (before COGS
            and shared overhead).
          </p>
        </div>
      )}
    </div>
  );
}
