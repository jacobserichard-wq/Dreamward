// app/components/ChannelTable.tsx
//
// Phase 9.1 commit 3 of 7. Pure-presentational table showing the
// canonical 9-channel revenue/expense/net breakdown with horizontal
// bars + per-channel collapse + empty-state CTAs.
//
// Designed for the dashboard (commit 4) but reusable on the
// /profitability "By Channel" tab (commit 5) — the variant prop
// switches between dashboard-density and full-density rendering.
//
// State ownership: pure props. Parent owns the data fetch + the
// collapse-state persistence (via preferences.ux.dashboard).

"use client";

import Link from "next/link";

export interface ChannelRow {
  id: string;
  label: string;
  icon: string;
  comingSoon: boolean;
  hasData: boolean;
  revenue: number;
  directExpenses: number;
  netAttributable: number;
  netAllocated: number;
  allocatedOverhead: number;
  emptyAddHref: string | null;
  emptyAddLabel: string | null;
  proGated: boolean;
  /** Where clicking a populated channel card drills to.
   *  null = no click target (typically coming-soon channels). */
  drillHref?: string | null;
  /** Phase 13: short plain-language sub-line shown under the
   *  channel label in the "Add another channel" disclosure.
   *  Sourced from CANONICAL_CHANNELS[].description. */
  description?: string;
}

export interface ChannelTableProps {
  channels: ChannelRow[];
  overhead: number;
  totalRevenue: number;
  netProfit: number;
  /** "attributable" = net excludes overhead allocation.
   *  "allocated" = net subtracts pro-rata overhead share. */
  mode: "attributable" | "allocated";
  onToggleMode: () => void;
  /** Channel IDs the user has collapsed (won't render full row;
   *  shown in the "Show collapsed (N)" expander instead). */
  collapsedChannels: string[];
  onToggleCollapse: (channelId: string) => void;
  /** Pro/plan check — drives whether Pro-gated channel CTAs route
   *  to /integrations (Pro user) or /billing (non-Pro). */
  isPro: boolean;
  /** "dashboard" = compact rows + table-grid layout for embedded use;
   *  "full" = larger rows + extra columns for the dedicated page. */
  variant?: "dashboard" | "full";
}

function fmtUsd(n: number, signed = false): string {
  const abs = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (signed && n < 0) return `-$${abs}`;
  return n < 0 ? `($${abs})` : `$${abs}`;
}

export default function ChannelTable({
  channels,
  overhead,
  totalRevenue,
  netProfit,
  mode,
  onToggleMode,
  collapsedChannels,
  onToggleCollapse,
  isPro,
  variant = "dashboard",
}: ChannelTableProps) {
  const collapsed = new Set(collapsedChannels);
  const visibleChannels = channels.filter((c) => !collapsed.has(c.id));
  const hiddenChannels = channels.filter((c) => collapsed.has(c.id));

  // Bar widths normalized to the largest revenue value (so the
  // biggest channel fills the bar). Math.max with 1 guards against
  // div-by-zero when no channels have data yet.
  const maxRevenue = Math.max(...channels.map((c) => c.revenue), 1);

  const showShowMore = hiddenChannels.length > 0;

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 mb-8">
      {/* Header — title + mode toggle */}
      <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
        <div>
          <h3 className="text-lg font-bold text-slate-900 m-0 mb-1">
            Channel Profitability
          </h3>
          <p className="text-xs text-slate-500 m-0">
            Where your business made + spent money this year.{" "}
            {mode === "attributable"
              ? "Overhead is shown separately."
              : "Overhead is split across channels by revenue share."}
          </p>
        </div>
        <button
          type="button"
          onClick={onToggleMode}
          className="text-xs font-medium text-blue-600 hover:underline cursor-pointer bg-transparent border-0 whitespace-nowrap"
          title={
            mode === "attributable"
              ? "Switch to allocated view (overhead split across channels)"
              : "Switch back to attributable view (overhead shown separately)"
          }
        >
          {mode === "attributable"
            ? "Show fully-allocated →"
            : "← Show attributable only"}
        </button>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
              <th className="text-left py-2 pr-3 font-medium">Channel</th>
              <th className="text-right py-2 px-3 font-medium">Revenue</th>
              <th className="text-right py-2 px-3 font-medium">Expenses</th>
              {mode === "allocated" && (
                <th className="text-right py-2 px-3 font-medium">Overhead</th>
              )}
              <th className="text-right py-2 pl-3 font-medium">Net</th>
              <th className="w-8" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {visibleChannels.map((ch) => (
              <ChannelRowRender
                key={ch.id}
                channel={ch}
                mode={mode}
                maxRevenue={maxRevenue}
                isPro={isPro}
                onCollapse={() => onToggleCollapse(ch.id)}
                variant={variant}
              />
            ))}

            {/* Overhead row — only shows in attributable mode (in
                allocated mode, overhead is folded into each channel) */}
            {mode === "attributable" && overhead > 0 && (
              <tr className="border-b border-slate-100 bg-slate-50">
                <td className="py-3 pr-3">
                  <div className="flex items-center gap-2.5">
                    <span className="text-xl">{"\u{1F4CB}"}</span>
                    <div>
                      <div className="font-semibold text-slate-700 text-sm">
                        Overhead
                      </div>
                      <div className="text-xs text-slate-500">
                        Not attributed to any channel
                      </div>
                    </div>
                  </div>
                </td>
                <td className="py-3 px-3 text-right text-slate-400 tabular-nums">
                  —
                </td>
                <td className="py-3 px-3 text-right tabular-nums text-slate-700">
                  {fmtUsd(overhead)}
                </td>
                <td className="py-3 pl-3 text-right tabular-nums text-red-700 font-semibold">
                  {fmtUsd(-overhead, true)}
                </td>
                <td />
              </tr>
            )}

            {/* Total row */}
            <tr className="border-t-2 border-slate-300 font-bold">
              <td className="py-3 pr-3 text-slate-900">Net profit</td>
              <td className="py-3 px-3 text-right tabular-nums text-slate-900">
                {fmtUsd(totalRevenue)}
              </td>
              <td className="py-3 px-3 text-right tabular-nums text-slate-900">
                {fmtUsd(
                  channels.reduce((a, c) => a + c.directExpenses, 0) +
                    overhead
                )}
              </td>
              {mode === "allocated" && (
                <td className="py-3 px-3 text-right tabular-nums text-slate-400">
                  —
                </td>
              )}
              <td
                className={`py-3 pl-3 text-right tabular-nums ${
                  netProfit >= 0 ? "text-emerald-700" : "text-red-700"
                }`}
              >
                {fmtUsd(netProfit, true)}
              </td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>

      {/* Show-collapsed expander */}
      {showShowMore && (
        <div className="mt-4 pt-3 border-t border-slate-100">
          <details className="group">
            <summary className="cursor-pointer text-xs font-medium text-slate-600 hover:text-slate-900 list-none flex items-center gap-2">
              <span className="text-slate-400 group-open:rotate-90 transition-transform inline-block">
                {"\u{25B6}"}
              </span>
              Show {hiddenChannels.length} collapsed channel
              {hiddenChannels.length === 1 ? "" : "s"}
            </summary>
            <ul className="mt-2 space-y-1 pl-5 m-0 list-none">
              {hiddenChannels.map((ch) => (
                <li
                  key={ch.id}
                  className="flex items-center justify-between gap-3 text-xs py-1"
                >
                  <span className="text-slate-500">
                    {ch.icon} {ch.label}
                    {ch.hasData && (
                      <span className="text-slate-400 ml-2">
                        {fmtUsd(ch.revenue)} revenue · {fmtUsd(ch.netAttributable, true)} net
                      </span>
                    )}
                  </span>
                  <button
                    type="button"
                    onClick={() => onToggleCollapse(ch.id)}
                    className="text-blue-600 hover:underline cursor-pointer text-xs bg-transparent border-0"
                  >
                    Restore
                  </button>
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------
// One row
// ---------------------------------------------------------------------

function ChannelRowRender({
  channel,
  mode,
  maxRevenue,
  isPro,
  onCollapse,
  variant,
}: {
  channel: ChannelRow;
  mode: "attributable" | "allocated";
  maxRevenue: number;
  isPro: boolean;
  onCollapse: () => void;
  variant: "dashboard" | "full";
}) {
  // Pro-gated channel CTA destination: /billing for non-Pro,
  // the channel's actual add destination for Pro.
  const ctaHref =
    channel.proGated && !isPro ? "/billing" : channel.emptyAddHref;
  const ctaLabel =
    channel.proGated && !isPro
      ? `Upgrade to Pro to add ${channel.label}`
      : channel.emptyAddLabel;

  const barWidth =
    channel.hasData && maxRevenue > 0
      ? `${Math.max(2, (channel.revenue / maxRevenue) * 100)}%`
      : "0%";

  const netValue =
    mode === "attributable" ? channel.netAttributable : channel.netAllocated;

  return (
    <tr
      className={`border-b border-slate-100 last:border-b-0 ${
        channel.comingSoon ? "opacity-50" : ""
      }`}
    >
      <td className={`pr-3 ${variant === "full" ? "py-4" : "py-3"}`}>
        <div className="flex items-start gap-2.5">
          <span className="text-xl flex-shrink-0">{channel.icon}</span>
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-slate-900 text-sm flex items-center gap-2 flex-wrap">
              {channel.label}
              {channel.comingSoon && (
                <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-500 border border-slate-200">
                  Coming soon
                </span>
              )}
              {channel.proGated && !isPro && !channel.comingSoon && (
                <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-200">
                  Pro
                </span>
              )}
            </div>
            {/* Revenue bar — visual ranking */}
            {channel.hasData && (
              <div
                className="mt-1.5 h-1 bg-slate-100 rounded-full overflow-hidden max-w-[260px]"
                aria-hidden
              >
                <div
                  className="h-full bg-emerald-500 transition-[width] duration-300"
                  style={{ width: barWidth }}
                />
              </div>
            )}
            {/* Empty-state CTA when no data + the channel has an
                add-action defined */}
            {!channel.hasData && !channel.comingSoon && ctaHref && ctaLabel && (
              <Link
                href={ctaHref}
                className="text-xs text-blue-600 hover:underline mt-1 inline-block"
              >
                {ctaLabel} {"\u{2192}"}
              </Link>
            )}
          </div>
        </div>
      </td>

      {/* Revenue */}
      <td
        className={`px-3 text-right tabular-nums ${
          variant === "full" ? "py-4" : "py-3"
        } ${channel.hasData ? "text-slate-900" : "text-slate-300"}`}
      >
        {channel.hasData ? fmtUsd(channel.revenue) : "—"}
      </td>

      {/* Expenses */}
      <td
        className={`px-3 text-right tabular-nums ${
          variant === "full" ? "py-4" : "py-3"
        } ${channel.directExpenses > 0 ? "text-slate-700" : "text-slate-300"}`}
      >
        {channel.directExpenses > 0 ? fmtUsd(channel.directExpenses) : "—"}
      </td>

      {/* Overhead column (allocated mode only) */}
      {mode === "allocated" && (
        <td
          className={`px-3 text-right tabular-nums ${
            variant === "full" ? "py-4" : "py-3"
          } ${channel.allocatedOverhead > 0 ? "text-slate-500" : "text-slate-300"}`}
        >
          {channel.allocatedOverhead > 0
            ? fmtUsd(channel.allocatedOverhead)
            : "—"}
        </td>
      )}

      {/* Net */}
      <td
        className={`pl-3 text-right tabular-nums font-semibold ${
          variant === "full" ? "py-4" : "py-3"
        } ${
          !channel.hasData
            ? "text-slate-300"
            : netValue >= 0
              ? "text-emerald-700"
              : "text-red-700"
        }`}
      >
        {channel.hasData ? fmtUsd(netValue, true) : "—"}
      </td>

      {/* Per-row collapse button. Coming-soon channels collapse too
          (lets users hide the roadmap teaser). */}
      <td className={`pl-2 ${variant === "full" ? "py-4" : "py-3"}`}>
        <button
          type="button"
          onClick={onCollapse}
          title={`Collapse ${channel.label}`}
          aria-label={`Collapse ${channel.label}`}
          className="text-slate-400 hover:text-slate-700 cursor-pointer bg-transparent border-0 text-sm leading-none"
        >
          {"\u{00D7}"}
        </button>
      </td>
    </tr>
  );
}
