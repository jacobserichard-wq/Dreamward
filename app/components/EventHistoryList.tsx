"use client";

import Link from "next/link";

export interface EventSummary {
  id: number;
  name: string;
  startDate: string;
  endDate: string;
  venue: string | null;
  // Phase 3 sub-session 17 commit 10: per-event aggregate from
  // /api/events GET. Optional so the type still works for callers that
  // haven't been migrated to the new aggregate response shape.
  linkedCount?: number;
  linkedTotal?: number;
}

interface Props {
  events: EventSummary[];
}

// "May 18, 2026" for single-day; "May 18 – May 20, 2026" when month + year
// match; "May 18, 2026 – June 2, 2026" when they don't. Browser-local-
// timezone display is correct for date-only values once we read them as UTC.
function formatDateRange(startDate: string, endDate: string): string {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  const fullStart = start.toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  if (startDate === endDate) return fullStart;

  const sameYear = start.getUTCFullYear() === end.getUTCFullYear();
  const sameMonth = sameYear && start.getUTCMonth() === end.getUTCMonth();
  if (sameMonth) {
    const startShort = start.toLocaleDateString("en-US", {
      timeZone: "UTC",
      month: "long",
      day: "numeric",
    });
    const endShort = end.toLocaleDateString("en-US", {
      timeZone: "UTC",
      day: "numeric",
      year: "numeric",
    });
    return `${startShort} – ${endShort}`;
  }
  const fullEnd = end.toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  return `${fullStart} – ${fullEnd}`;
}

export default function EventHistoryList({ events }: Props) {
  if (events.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 py-10 px-6 text-center">
        <p className="text-sm text-slate-500 m-0">
          No events yet. Click <strong>+ New event</strong> above to add your first market day.
        </p>
      </div>
    );
  }

  return (
    <ul className="grid grid-cols-1 gap-3 list-none p-0 m-0">
      {events.map((event) => {
        const count = event.linkedCount ?? 0;
        const total = event.linkedTotal ?? 0;
        return (
          <li key={event.id}>
            <Link
              href={`/events/${event.id}`}
              className="block bg-white rounded-xl border border-slate-200 py-4 px-5 no-underline text-slate-900"
            >
              <div className="flex justify-between items-start gap-3 flex-wrap">
                <div className="min-w-0 flex-1">
                  <p className="text-base font-semibold text-slate-900 m-0 mb-1 break-words">
                    {event.name}
                  </p>
                  <p className="text-sm text-slate-500 m-0">
                    {formatDateRange(event.startDate, event.endDate)}
                    {event.venue ? ` · ${event.venue}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  {count > 0 && (
                    <div className="text-right">
                      <p className="text-sm font-semibold text-slate-700 m-0">
                        ${total.toLocaleString("en-US", {
                          minimumFractionDigits: 2,
                          maximumFractionDigits: 2,
                        })}
                      </p>
                      <p className="text-xs text-slate-400 m-0">
                        {count} {count === 1 ? "transaction" : "transactions"}
                      </p>
                    </div>
                  )}
                  <span
                    aria-hidden="true"
                    className="text-slate-400 text-lg leading-none pt-0.5"
                  >
                    {"→"}
                  </span>
                </div>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
