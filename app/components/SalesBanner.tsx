// app/components/SalesBanner.tsx
//
// Phase 9.2 commit 1 of 6. The new 3-stat dashboard hero per
// Jacob's "command center" redesign: Total Sales / Total Expenses /
// Net Profit displayed prominently at the top of the dashboard.
//
// Replaces the 4-card stat row (Total Items / Total Amount /
// Avg Confidence / Business Miles) which mixed operational metrics
// with financial ones + had vanity stats. The new banner is purely
// financial — the gut-check trio every business owner cares about.
//
// Data source: the channel-profitability API call the dashboard
// already makes (totalRevenue + totalDirectExpenses + overhead +
// netProfit). Single source of truth with the ChannelStack below.
//
// Pure-presentational. Parent owns the data fetch + the year/mode
// selection (passed via props).

"use client";

import Link from "next/link";

interface SalesBannerProps {
  totalSales: number;
  totalExpenses: number;
  netProfit: number;
  /** Year shown in the sub-text under each stat. Defaults to YTD
   *  framing; future enhancement: pass period label
   *  ("Last 30 days" / "Q2 2026" / etc.) as Phase 9.2 evolves. */
  year: number;
  /** Render skeleton state when data hasn't loaded yet (avoids
   *  layout shift on first paint). */
  loading?: boolean;
  /** When provided, each stat becomes clickable and calls this with
   *  the drill kind (Total Sales → income, Expenses → expense, Net →
   *  net). The dashboard opens the TotalsDrillModal. */
  onDrill?: (kind: "income" | "expense" | "net") => void;
  /** When set, an "Open dashboard →" link is shown top-right inside the
   *  card (mirrors the Profit margin card). */
  dashboardHref?: string;
  /** Card title shown top-left, styled like the Profit margin card's
   *  header so the two cards match. */
  title?: string;
}

function fmtUsd(n: number): string {
  const abs = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return n < 0 ? `-$${abs}` : `$${abs}`;
}

export default function SalesBanner({
  totalSales,
  totalExpenses,
  netProfit,
  year,
  loading = false,
  onDrill,
  dashboardHref,
  title,
}: SalesBannerProps) {
  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-5 mb-4">
        <div className="grid grid-cols-3 gap-3">
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="rounded-lg p-2.5 bg-slate-50 border border-slate-100"
            >
              <div className="h-2.5 w-16 bg-slate-100 rounded animate-pulse mb-1.5" />
              <div className="h-5 w-20 bg-slate-100 rounded animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 mb-4">
      {(title || dashboardHref) && (
        <div className="flex items-start justify-between gap-3 mb-3">
          <h3 className="text-sm font-semibold text-slate-700 m-0 uppercase tracking-wide">
            {title}
          </h3>
          {dashboardHref && (
            <Link
              href={dashboardHref}
              className="text-xs font-medium text-blue-600 hover:text-blue-700 no-underline whitespace-nowrap"
            >
              Open dashboard →
            </Link>
          )}
        </div>
      )}
      <div className="grid grid-cols-3 gap-3">
        <Stat
          label="Total Sales"
          value={fmtUsd(totalSales)}
          sub={`Year-to-date ${year}`}
          onClick={onDrill ? () => onDrill("income") : undefined}
        />
        <Stat
          label="Total Expenses"
          value={fmtUsd(totalExpenses)}
          sub={`Year-to-date ${year}`}
          onClick={onDrill ? () => onDrill("expense") : undefined}
        />
        <Stat
          label="Net Profit"
          value={fmtUsd(netProfit)}
          sub={
            netProfit > 0
              ? "Profitable so far"
              : netProfit < 0
                ? "Operating at a loss"
                : "Breaking even"
          }
          highlight
          tone={netProfit < 0 ? "negative" : "positive"}
          onClick={onDrill ? () => onDrill("net") : undefined}
        />
      </div>
    </div>
  );
}

// Boxed stat — same treatment as the Profit margin card's Stat. The
// highlighted (Net Profit) box is green when >= 0 and red when negative.
function Stat({
  label,
  value,
  sub,
  highlight = false,
  tone = "positive",
  onClick,
}: {
  label: string;
  value: string;
  sub: string;
  highlight?: boolean;
  tone?: "positive" | "negative";
  onClick?: () => void;
}) {
  const boxClass = highlight
    ? tone === "negative"
      ? "bg-red-50 border border-red-200"
      : "bg-emerald-50 border border-emerald-200"
    : "bg-slate-50 border border-slate-100";
  const valueClass = highlight
    ? tone === "negative"
      ? "text-red-800"
      : "text-emerald-800"
    : "text-slate-900";
  const subClass = highlight
    ? tone === "negative"
      ? "text-red-700"
      : "text-emerald-700"
    : "text-slate-500";
  const base = `rounded-lg p-2.5 text-left w-full ${boxClass}`;

  const inner = (
    <>
      <p className="text-[10px] uppercase tracking-wide text-slate-500 m-0 mb-0.5">
        {label}
      </p>
      <p className={`text-base font-bold m-0 tabular-nums ${valueClass}`}>
        {value}
      </p>
      <p className={`text-[10px] m-0 mt-0.5 ${subClass}`}>{sub}</p>
    </>
  );

  if (!onClick) {
    return <div className={base}>{inner}</div>;
  }
  return (
    <button
      type="button"
      onClick={onClick}
      title={`${label} — see details`}
      className={`${base} cursor-pointer hover:ring-2 hover:ring-blue-500/20 hover:border-blue-300 transition-all`}
    >
      {inner}
    </button>
  );
}
