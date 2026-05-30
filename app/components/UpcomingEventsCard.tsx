// app/components/UpcomingEventsCard.tsx
//
// Phase 9.2 commit 4 of 6. Right-column section on the redesigned
// dashboard. Two sub-sections:
//
//   1. Upcoming Events — pulls from the existing events table.
//      Sorted by start_date ASC. Limit ~5 visible; "View all →"
//      link to /events when more exist.
//
//   2. Promotions — placeholder section with a "Coming soon" pill.
//      Hints at the future feature without committing to scope or
//      data model.
//
// Per Jacob's call: "on the right side I want an upcoming Events
// and Promotion schedule". Promotions per Phase 9.2 design call =
// reuse existing events table for v1; the actual Promotions feature
// is deferred to a later sub-phase if/when scope is locked.
//
// Pure-presentational. Parent fetches the events list.

"use client";

import Link from "next/link";

export interface UpcomingEvent {
  id: number;
  name: string;
  startDate: string;   // YYYY-MM-DD
  endDate?: string;
  venue?: string | null;
}

export interface UpcomingEventsCardProps {
  /** All events with start_date >= today, pre-sorted ASC by parent.
   *  Parent caps the list size; this component just renders. */
  events: UpcomingEvent[];
  /** When true, parent is still loading — render skeleton. */
  loading?: boolean;
  /** Max events shown in the card (default 5). Anything past this
   *  is hidden behind "View all" link. */
  visibleLimit?: number;
}

// Human-friendly date: "Jun 14" or "Jun 14-16" for date ranges
function fmtDateRange(startDate: string, endDate?: string): string {
  const fmt = (iso: string) => {
    const [, m, d] = iso.split("-");
    const monthNames = [
      "Jan", "Feb", "Mar", "Apr", "May", "Jun",
      "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    return `${monthNames[Number(m) - 1]} ${Number(d)}`;
  };
  if (!endDate || endDate === startDate) return fmt(startDate);
  // Same month → "Jun 14-16", different months → "Jun 28-Jul 2"
  const [sy, sm] = startDate.split("-");
  const [ey, em] = endDate.split("-");
  if (sy === ey && sm === em) {
    return `${fmt(startDate)}-${endDate.split("-")[2].replace(/^0/, "")}`;
  }
  return `${fmt(startDate)}-${fmt(endDate)}`;
}

// Days-until label: "Today" / "Tomorrow" / "in 5 days" / "in 3 weeks"
function daysUntilLabel(startDate: string): string {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const [y, m, d] = startDate.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1, d));
  const diffDays = Math.round(
    (target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
  );
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  if (diffDays < 0) return ""; // shouldn't happen (parent filters); defensive
  if (diffDays < 7) return `in ${diffDays} days`;
  if (diffDays < 30) {
    const weeks = Math.round(diffDays / 7);
    return weeks === 1 ? "in 1 week" : `in ${weeks} weeks`;
  }
  const months = Math.round(diffDays / 30);
  return months === 1 ? "in 1 month" : `in ${months} months`;
}

export default function UpcomingEventsCard({
  events,
  loading = false,
  visibleLimit = 5,
}: UpcomingEventsCardProps) {
  const visible = events.slice(0, visibleLimit);
  const hasMore = events.length > visibleLimit;

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      {/* ── Upcoming Events ─────────────────────────────────── */}
      <div className="mb-5">
        <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
          <h3 className="text-lg font-bold text-slate-900 m-0">
            Upcoming Events
          </h3>
          <Link
            href="/events"
            className="text-xs text-blue-600 hover:underline"
          >
            View all {"\u{2192}"}
          </Link>
        </div>

        {loading ? (
          <ul className="space-y-2 m-0 p-0 list-none">
            {[0, 1, 2].map((i) => (
              <li
                key={i}
                className="h-12 bg-slate-50 rounded animate-pulse"
              />
            ))}
          </ul>
        ) : visible.length === 0 ? (
          <div className="border border-dashed border-slate-200 rounded-lg p-4 text-center">
            <p className="text-sm text-slate-500 m-0 mb-2">
              No upcoming events
            </p>
            {/* /events/new isn't a route — events use an inline-
                create pattern on /events. Land on the list page
                where the "+ New event" toggle button lives. */}
            <Link
              href="/events"
              className="text-xs text-blue-600 hover:underline font-medium"
            >
              Add your first event {"\u{2192}"}
            </Link>
          </div>
        ) : (
          <ul className="space-y-2 m-0 p-0 list-none">
            {visible.map((ev) => (
              <li key={ev.id}>
                <Link
                  href={`/events/${ev.id}`}
                  className="block border border-slate-200 hover:border-slate-300 rounded-lg p-2.5 no-underline transition-colors"
                >
                  <div className="flex items-baseline justify-between gap-2 mb-0.5">
                    <span className="text-sm font-semibold text-slate-900 truncate">
                      {ev.name}
                    </span>
                    <span className="text-[11px] text-slate-500 whitespace-nowrap">
                      {daysUntilLabel(ev.startDate)}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500">
                    {"\u{1F4C5}"} {fmtDateRange(ev.startDate, ev.endDate)}
                    {ev.venue ? ` · ${ev.venue}` : ""}
                  </div>
                </Link>
              </li>
            ))}
            {hasMore && (
              <li className="text-center pt-1">
                <Link
                  href="/events"
                  className="text-xs text-slate-500 hover:underline"
                >
                  +{events.length - visibleLimit} more {"\u{2192}"}
                </Link>
              </li>
            )}
          </ul>
        )}
      </div>

      {/* ── Promotions placeholder ─────────────────────────── */}
      <div className="pt-4 border-t border-slate-100">
        <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
          <h3 className="text-lg font-bold text-slate-900 m-0">Promotions</h3>
          <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 text-slate-500 border border-slate-200 uppercase tracking-wide">
            Coming soon
          </span>
        </div>
        <div className="border border-dashed border-slate-200 rounded-lg p-4 text-center">
          <p className="text-xs text-slate-500 m-0 leading-relaxed">
            Plan sales, discount campaigns, and product launches with
            tracked revenue impact.
          </p>
        </div>
      </div>
    </div>
  );
}
