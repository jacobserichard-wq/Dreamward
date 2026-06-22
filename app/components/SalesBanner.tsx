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
}: SalesBannerProps) {
  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          {[0, 1, 2].map((i) => (
            <div key={i}>
              <div className="h-3 w-24 bg-slate-100 rounded animate-pulse mb-3" />
              <div className="h-9 w-32 bg-slate-100 rounded animate-pulse" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const netColor =
    netProfit > 0
      ? "text-emerald-700"
      : netProfit < 0
        ? "text-red-700"
        : "text-slate-900";

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-6 mb-6 shadow-sm">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 sm:divide-x sm:divide-slate-200">
        <Stat
          label="Total Sales"
          value={fmtUsd(totalSales)}
          sub={`Year-to-date ${year}`}
          accentColor="text-emerald-600"
          onClick={onDrill ? () => onDrill("income") : undefined}
        />
        <Stat
          label="Total Expenses"
          value={fmtUsd(totalExpenses)}
          sub={`Year-to-date ${year}`}
          accentColor="text-slate-700"
          isCenter
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
          accentColor={netColor}
          isLast
          onClick={onDrill ? () => onDrill("net") : undefined}
        />
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  accentColor,
  isCenter = false,
  isLast = false,
  onClick,
}: {
  label: string;
  value: string;
  sub: string;
  accentColor: string;
  isCenter?: boolean;
  isLast?: boolean;
  onClick?: () => void;
}) {
  const spacing = isCenter ? "sm:px-6" : isLast ? "sm:pl-6" : "";
  const inner = (
    <>
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
        {label}
      </div>
      <div className={`text-3xl sm:text-4xl font-extrabold tabular-nums ${accentColor}`}>
        {value}
      </div>
      <div className="text-xs text-slate-500 mt-1">
        {sub}
        {onClick && (
          <span className="text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity ml-2">
            View details →
          </span>
        )}
      </div>
    </>
  );

  if (!onClick) {
    return (
      <div className={`${spacing} text-center sm:text-left`}>{inner}</div>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      title={`${label} — see what's in this number`}
      className={`${spacing} group text-center sm:text-left w-full bg-transparent border-0 p-0 cursor-pointer rounded-lg hover:bg-slate-50 transition-colors`}
    >
      {inner}
    </button>
  );
}
