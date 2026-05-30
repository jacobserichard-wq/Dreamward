// app/components/ChannelStack.tsx
//
// Phase 9.2 commit 3 of 6. Vertical channel cards for the dashboard.
// Companion to the existing ChannelTable (horizontal layout, lives
// on the /profitability "By Channel" tab).
//
// Per Jacob's call: "I want the Channels to be Vertical and I only
// want to see Shopify, Market places, with the options to add new
// verticals". Default collapsed set is wider than before — only
// Shopify + Markets visible by default; user can restore others
// from the "Show N collapsed" expander.
//
// Each card: icon + label + revenue + net (color-coded) +
// horizontal mini-bar + collapse-X + empty-state CTA when no data.
// Stacks vertically; better for the new dashboard's split-column
// layout where Channels is the left half.

"use client";

import Link from "next/link";
import type { ChannelRow } from "./ChannelTable";

export interface ChannelStackProps {
  channels: ChannelRow[];
  /** Max revenue across all channels — used to normalize bar widths.
   *  Pre-computed by parent (which already iterates the rows). */
  maxRevenue: number;
  collapsedChannels: string[];
  onToggleCollapse: (channelId: string) => void;
  /** Pro/plan check — drives whether Pro-gated channel CTAs route
   *  to /integrations (Pro user) or /billing (non-Pro). */
  isPro: boolean;
  /** Optional "Add another channel" footer link. Default true. */
  showAddButton?: boolean;
}

function fmtUsd(n: number, signed = false): string {
  const abs = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (signed && n < 0) return `-$${abs}`;
  return `$${abs}`;
}

export default function ChannelStack({
  channels,
  maxRevenue,
  collapsedChannels,
  onToggleCollapse,
  isPro,
  showAddButton = true,
}: ChannelStackProps) {
  const collapsed = new Set(collapsedChannels);
  const visible = channels.filter((c) => !collapsed.has(c.id));
  const hidden = channels.filter((c) => collapsed.has(c.id));

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className="mb-4">
        <h3 className="text-lg font-bold text-slate-900 m-0 mb-1">Channels</h3>
        <p className="text-xs text-slate-500 m-0">
          Where your business made money this year.
        </p>
      </div>

      {/* Stack of channel cards */}
      <div className="space-y-2">
        {visible.length === 0 && (
          <p className="text-sm text-slate-500 italic py-3 text-center">
            No channels visible. Restore one from the collapsed list below.
          </p>
        )}
        {visible.map((ch) => (
          <ChannelCard
            key={ch.id}
            channel={ch}
            maxRevenue={maxRevenue}
            isPro={isPro}
            onCollapse={() => onToggleCollapse(ch.id)}
          />
        ))}
      </div>

      {/* Show-collapsed expander */}
      {hidden.length > 0 && (
        <div className="mt-4 pt-3 border-t border-slate-100">
          <details className="group">
            <summary className="cursor-pointer text-xs font-medium text-slate-600 hover:text-slate-900 list-none flex items-center gap-2">
              <span className="text-slate-400 group-open:rotate-90 transition-transform inline-block">
                {"\u{25B6}"}
              </span>
              Add another channel ({hidden.length} available)
            </summary>
            <ul className="mt-2 space-y-2 m-0 p-0 list-none">
              {hidden.map((ch) => (
                <li
                  key={ch.id}
                  className="flex items-start justify-between gap-3 text-xs py-1.5 pl-5"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-slate-700 flex items-center gap-2">
                      <span className="text-base">{ch.icon}</span>
                      <span className="font-medium">{ch.label}</span>
                      {ch.comingSoon && (
                        <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-500 border border-slate-200">
                          Coming soon
                        </span>
                      )}
                    </div>
                    {ch.description && (
                      <p className="text-[11px] text-slate-500 m-0 mt-0.5 ml-7 leading-snug">
                        {ch.description}
                      </p>
                    )}
                  </div>
                  {!ch.comingSoon && (
                    <button
                      type="button"
                      onClick={() => onToggleCollapse(ch.id)}
                      className="text-blue-600 hover:underline cursor-pointer text-xs bg-transparent border-0 whitespace-nowrap pt-0.5"
                    >
                      + Add
                    </button>
                  )}
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
// One channel card (vertical layout)
// ---------------------------------------------------------------------

function ChannelCard({
  channel,
  maxRevenue,
  isPro,
  onCollapse,
}: {
  channel: ChannelRow;
  maxRevenue: number;
  isPro: boolean;
  onCollapse: () => void;
}) {
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

  const netColor =
    !channel.hasData
      ? "text-slate-300"
      : channel.netAttributable >= 0
        ? "text-emerald-700"
        : "text-red-700";

  // Drill-down: when the channel has data AND has a drillHref, the
  // whole card becomes a clickable link to the relevant source-of-
  // truth surface (Markets → /events, Wholesale → /invoices, etc.).
  // Coming-soon channels never get a drill target. The empty-state
  // CTA path already has its own link, so this only matters when
  // hasData=true.
  const drillTarget =
    channel.hasData && channel.drillHref && !channel.comingSoon
      ? channel.drillHref
      : null;

  const cardClasses = `border border-slate-200 rounded-lg p-3 group block ${
    channel.comingSoon
      ? "opacity-50"
      : drillTarget
        ? "hover:border-blue-400 hover:shadow-sm cursor-pointer transition-all"
        : "hover:border-slate-300"
  }`;

  const cardContent = (
    <>
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-center gap-2.5 flex-1 min-w-0">
          <span className="text-xl flex-shrink-0">{channel.icon}</span>
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-slate-900 text-sm flex items-center gap-1.5 flex-wrap">
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
          </div>
        </div>
        <button
          type="button"
          onClick={(e) => {
            // stopPropagation so clicking collapse-X doesn't also
            // trigger the card's drill-down navigation when the
            // whole card is wrapped in a Link.
            e.stopPropagation();
            e.preventDefault();
            onCollapse();
          }}
          title={`Hide ${channel.label}`}
          aria-label={`Hide ${channel.label}`}
          className="opacity-0 group-hover:opacity-100 transition-opacity text-slate-400 hover:text-slate-700 cursor-pointer bg-transparent border-0 text-sm leading-none flex-shrink-0"
        >
          {"\u{00D7}"}
        </button>
      </div>

      {channel.hasData ? (
        <>
          {/* Revenue bar */}
          <div
            className="h-1.5 bg-slate-100 rounded-full overflow-hidden mb-2"
            aria-hidden
          >
            <div
              className="h-full bg-emerald-500 transition-[width] duration-300"
              style={{ width: barWidth }}
            />
          </div>
          {/* Numbers row — 3 metrics with equal visual weight per
              Jacob's tweak. Revenue + Expenses styled the same;
              Net stays on the right + color-coded for the at-a-
              glance positive/negative read. */}
          <div className="flex items-baseline justify-between gap-2 text-xs flex-wrap">
            <div className="flex items-baseline gap-2">
              <span className="text-slate-500">Revenue</span>
              <span className="font-semibold text-slate-900 tabular-nums">
                {fmtUsd(channel.revenue)}
              </span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-slate-500">Expenses</span>
              <span className="font-semibold text-slate-900 tabular-nums">
                {fmtUsd(channel.directExpenses)}
              </span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-slate-500">Net</span>
              <span className={`font-bold tabular-nums ${netColor}`}>
                {fmtUsd(channel.netAttributable, true)}
              </span>
            </div>
          </div>
        </>
      ) : (
        <>
          {/* Empty-state CTA */}
          {!channel.comingSoon && ctaHref && ctaLabel ? (
            <Link
              href={ctaHref}
              className="inline-flex items-center gap-1.5 text-xs text-blue-600 hover:underline font-medium"
            >
              {ctaLabel} {"\u{2192}"}
            </Link>
          ) : (
            <span className="text-xs text-slate-400">No revenue yet</span>
          )}
        </>
      )}
    </>
  );

  // Conditionally wrap in Link OR div. Coming-soon channels +
  // channels with no data never get the link (nothing to drill to).
  return drillTarget ? (
    <Link href={drillTarget} className={cardClasses}>
      {cardContent}
    </Link>
  ) : (
    <div className={cardClasses}>{cardContent}</div>
  );
}
