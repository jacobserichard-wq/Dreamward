"use client";

import { useState, useMemo } from "react";
import Spinner from "./Spinner";

// API contract — matches /api/events POST response (commit 2). Exported so
// the events page imports a single source of truth for the event shape.
export interface EventResponse {
  id: number;
  clientId: number;
  name: string;
  startDate: string;
  endDate: string;
  venue: string | null;
  revenue: number | null;
  boothFee: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Props {
  // Existing events drive the booth-fee-carry-forward default. The
  // /api/events GET already returns them sorted by start_date DESC, so the
  // first venue match is the most recent prior event at that venue.
  existingEvents: EventResponse[];
  onCreated: (event: EventResponse) => void;
  onCancel: () => void;
}

// "today" in the customer's local timezone, formatted YYYY-MM-DD. The
// en-CA locale returns ISO-shaped dates without doing the UTC round-trip
// that toISOString() does (which can shift the date by a day near
// midnight UTC).
function todayLocalISO(): string {
  return new Date().toLocaleDateString("en-CA");
}

// Forgiving input — accepts "$340", "340", "340.00", or empty. Returns the
// raw input back if it's empty (let the user clear the field) or the
// normalized number string otherwise. Validation runs on submit.
function stripMoneySymbols(v: string): string {
  return v.replace(/[$,\s]/g, "");
}

function parseMoneyOrNull(v: string): number | null {
  if (v.trim() === "") return null;
  const num = Number(stripMoneySymbols(v));
  if (!Number.isFinite(num) || num < 0) return null;
  return num;
}

// Carry forward the booth_fee from the most recent prior event at the same
// venue (case-insensitive). Used onBlur of the venue input when the
// booth_fee field is still empty — never overwrites user input.
function carryForwardBoothFee(
  venue: string,
  events: EventResponse[]
): number | null {
  const normalized = venue.trim().toLowerCase();
  if (normalized === "") return null;
  const match = events.find(
    (e) => e.venue !== null && e.venue.trim().toLowerCase() === normalized
  );
  return match ? match.boothFee : null;
}

export default function EventCreateForm({
  existingEvents,
  onCreated,
  onCancel,
}: Props) {
  const today = useMemo(todayLocalISO, []);

  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState(today);
  const [multiDay, setMultiDay] = useState(false);
  const [endDate, setEndDate] = useState(today);
  const [showProgressive, setShowProgressive] = useState(false);
  const [venue, setVenue] = useState("");
  const [boothFee, setBoothFee] = useState("");
  const [revenue, setRevenue] = useState("");
  const [notes, setNotes] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Smart default: when the user picks a start_date and multi-day is off,
  // end_date stays equal to start_date. When multi-day toggles on, end_date
  // defaults to start_date so the input shows something sensible.
  const handleStartDateChange = (value: string) => {
    setStartDate(value);
    if (!multiDay) setEndDate(value);
    else if (endDate < value) setEndDate(value);
  };

  const handleMultiDayToggle = () => {
    const next = !multiDay;
    setMultiDay(next);
    if (!next) setEndDate(startDate);
  };

  const handleVenueBlur = () => {
    if (boothFee.trim() !== "") return;
    const carried = carryForwardBoothFee(venue, existingEvents);
    if (carried !== null) {
      setBoothFee(String(carried));
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);

    if (name.trim() === "") {
      setError("Name is required.");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      setError("Start date is required.");
      return;
    }
    const effectiveEnd = multiDay ? endDate : startDate;
    if (multiDay && effectiveEnd < startDate) {
      setError("End date must be on or after the start date.");
      return;
    }

    const boothFeeNum = parseMoneyOrNull(boothFee);
    if (boothFee.trim() !== "" && boothFeeNum === null) {
      setError("Booth fee must be a non-negative number.");
      return;
    }
    const revenueNum = parseMoneyOrNull(revenue);
    if (revenue.trim() !== "" && revenueNum === null) {
      setError("Revenue must be a non-negative number.");
      return;
    }

    setSubmitting(true);
    try {
      const res = await fetch("/api/events", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          startDate,
          endDate: effectiveEnd,
          venue: venue.trim() === "" ? null : venue.trim(),
          boothFee: boothFeeNum ?? 0,
          revenue: revenueNum,
          notes: notes.trim() === "" ? null : notes.trim(),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        const msg =
          (data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : null) ?? `Couldn't create event (HTTP ${res.status})`;
        setError(msg);
        return;
      }
      const data = (await res.json()) as { event: EventResponse };
      onCreated(data.event);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create event");
    } finally {
      setSubmitting(false);
    }
  };

  const labelClasses = "block text-sm font-medium text-slate-700 mb-1";
  const inputClasses =
    "w-full py-2.5 px-3.5 text-sm border border-slate-200 rounded-lg outline-none box-border focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500";

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white rounded-xl border border-slate-200 py-5 px-6 mb-5"
    >
      <h3 className="text-base font-semibold text-slate-900 mb-4 m-0">New event</h3>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 px-3.5 py-2.5 rounded-lg mb-4 text-sm">
          {error}
        </div>
      )}

      <div className="mb-4">
        <label htmlFor="event-name" className={labelClasses}>
          Name<span className="text-red-500 ml-0.5">*</span>
        </label>
        <input
          id="event-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Broad Ripple Summer Craft Fair"
          autoFocus
          required
          className={inputClasses}
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        <div>
          <label htmlFor="event-start-date" className={labelClasses}>
            {multiDay ? "Start date" : "Date"}
            <span className="text-red-500 ml-0.5">*</span>
          </label>
          <input
            id="event-start-date"
            type="date"
            value={startDate}
            onChange={(e) => handleStartDateChange(e.target.value)}
            required
            className={inputClasses}
          />
        </div>
        {multiDay && (
          <div>
            <label htmlFor="event-end-date" className={labelClasses}>
              End date<span className="text-red-500 ml-0.5">*</span>
            </label>
            <input
              id="event-end-date"
              type="date"
              value={endDate}
              min={startDate}
              onChange={(e) => setEndDate(e.target.value)}
              required
              className={inputClasses}
            />
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={handleMultiDayToggle}
        className="text-sm text-blue-600 bg-transparent border-0 p-0 cursor-pointer mb-4"
      >
        {multiDay ? "Single-day event" : "+ Multi-day event"}
      </button>

      <div className="mb-4">
        <button
          type="button"
          onClick={() => setShowProgressive((p) => !p)}
          className="text-sm text-slate-600 bg-transparent border-0 p-0 cursor-pointer"
          aria-expanded={showProgressive}
        >
          {showProgressive ? "− Hide details" : "+ Add venue, booth fee, notes"}
        </button>
      </div>

      {showProgressive && (
        <div className="mb-4 grid grid-cols-1 gap-4">
          <div>
            <label htmlFor="event-venue" className={labelClasses}>
              Venue
            </label>
            <input
              id="event-venue"
              type="text"
              value={venue}
              onChange={(e) => setVenue(e.target.value)}
              onBlur={handleVenueBlur}
              placeholder="Indianapolis Fairgrounds"
              className={inputClasses}
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label htmlFor="event-booth-fee" className={labelClasses}>
                Booth fee
              </label>
              <input
                id="event-booth-fee"
                type="text"
                inputMode="decimal"
                value={boothFee}
                onChange={(e) => setBoothFee(e.target.value)}
                placeholder="$0"
                className={inputClasses}
              />
            </div>
            <div>
              <label htmlFor="event-revenue" className={labelClasses}>
                Revenue (manual)
              </label>
              <input
                id="event-revenue"
                type="text"
                inputMode="decimal"
                value={revenue}
                onChange={(e) => setRevenue(e.target.value)}
                placeholder="$0"
                className={inputClasses}
              />
            </div>
          </div>
          <div>
            <label htmlFor="event-notes" className={labelClasses}>
              Notes
            </label>
            <textarea
              id="event-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Any details about the event..."
              className={`${inputClasses} resize-y`}
            />
          </div>
        </div>
      )}

      <div className="flex items-center gap-3 flex-wrap mt-2">
        <button
          type="submit"
          disabled={submitting}
          className="py-2.5 px-6 rounded-lg border-0 bg-blue-500 text-white cursor-pointer text-sm font-semibold inline-flex items-center gap-2 disabled:opacity-50 disabled:cursor-wait"
        >
          {submitting && <Spinner size={14} color="white" />}
          {submitting ? "Creating..." : "Create event"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={submitting}
          className="py-2.5 px-5 rounded-lg border border-slate-200 bg-white cursor-pointer text-sm text-slate-700 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
