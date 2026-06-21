// app/components/ActionItemsStrip.tsx
//
// Phase 9.2 commit 2 of 6. Compact pill row that surfaces "things
// you should act on" — replaces the Status Breakdown + AR card
// sections that get removed from the new dashboard layout.
//
// Per Jacob's call: "lets move that information under the invoices
// at the top by settings". Renders as a thin strip BELOW the top
// nav header, before the main content area. High contrast pills
// for each pending action; each clickable to the appropriate
// filtered view.
//
// Pills currently surfaced:
//   - Needs Review count → /dashboard?view=transactions&filter=needs_review
//     (opens the Transactions view with the status filter applied)
//   - Overdue $ → /invoices?status=overdue
//   - (future) Pending payments / Other action prompts
//
// Auto-hides when there are no pending actions (zero needs-review +
// zero overdue) — empty action strip = visual noise.
//
// Pure-presentational. Parent supplies the counts from existing
// data (processedItems classification + arSummary fetch).

"use client";

import Link from "next/link";

export interface ActionItemsStripProps {
  needsReviewCount: number;
  overdueAmount: number;
  /** When true (no real data yet), render nothing rather than a
   *  flash of empty pills. Distinct from auto-hide which is for
   *  legitimate zero state. */
  loading?: boolean;
}

function fmtUsdShort(n: number): string {
  // Short format for the strip — $1,234 (no decimals when whole)
  if (n === 0) return "$0";
  if (n >= 1000 && n < 10000) {
    return `$${n.toLocaleString("en-US", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    })}`;
  }
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default function ActionItemsStrip({
  needsReviewCount,
  overdueAmount,
  loading = false,
}: ActionItemsStripProps) {
  // Don't render at all during initial load — prevents a brief
  // flash of "nothing to do" before counts arrive.
  if (loading) return null;

  const hasAnything = needsReviewCount > 0 || overdueAmount > 0;
  if (!hasAnything) return null;

  return (
    <div className="border-b border-slate-200 bg-white">
      <div className="max-w-[1200px] mx-auto px-4 sm:px-8 py-2.5 flex items-center gap-2 flex-wrap">
        <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 mr-1">
          Needs your attention:
        </span>

        {needsReviewCount > 0 && (
          <Link
            href="/dashboard?view=transactions&filter=needs_review"
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-800 text-xs font-medium no-underline hover:bg-indigo-100 transition-colors"
          >
            <span>{"\u{1F440}"}</span>
            <span className="tabular-nums">{needsReviewCount}</span>
            <span>
              item{needsReviewCount === 1 ? "" : "s"} need
              {needsReviewCount === 1 ? "s" : ""} review
            </span>
          </Link>
        )}

        {overdueAmount > 0 && (
          <Link
            href="/invoices?status=overdue"
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-50 border border-red-200 text-red-800 text-xs font-medium no-underline hover:bg-red-100 transition-colors"
          >
            <span>{"\u{1F6A8}"}</span>
            <span className="tabular-nums">{fmtUsdShort(overdueAmount)}</span>
            <span>overdue</span>
          </Link>
        )}
      </div>
    </div>
  );
}
