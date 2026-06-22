// app/components/MonthFilterPill.tsx
//
// Shared month-checklist period filter used by both the Profit margin
// card and the Totals card so the two controls are identical. A pill
// shows the current selection ("Year to date · 2026", "Jan, Mar · 2026",
// "5 months · 2025–2026", …) and opens a dropdown with a year stepper +
// month checkboxes. Selection is keyed "YYYY-MM" so months from
// different years can be combined (non-contiguous OK). Defaults to the
// current year-to-date.
//
// Stateless w.r.t. the committed selection — the parent owns `selected`
// and refetches when onApply fires. The dropdown's draft state is
// internal.

"use client";

import { useEffect, useRef, useState } from "react";

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// How many years back the year stepper can go.
const YEARS_BACK = 5;

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function keyFor(year: number, monthIdx: number): string {
  return `${year}-${pad2(monthIdx + 1)}`;
}

export function parseKey(k: string): { year: number; monthIdx: number } {
  const [y, m] = k.split("-").map(Number);
  return { year: y, monthIdx: m - 1 };
}

function isoDate(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

/** from/to bounds for one month, capped at today (sold_at/due_date are
 *  DATEs — never query into the future). */
export function monthBounds(
  year: number,
  monthIdx: number,
  today: Date
): { from: string; to: string } {
  const from = `${year}-${pad2(monthIdx + 1)}-01`;
  const lastDay = new Date(Date.UTC(year, monthIdx + 1, 0)).getUTCDate();
  let to = `${year}-${pad2(monthIdx + 1)}-${pad2(lastDay)}`;
  const todayStr = isoDate(today);
  if (to > todayStr) to = todayStr;
  return { from, to };
}

/** Year-to-date keys for the current year (Jan .. current month). */
export function currentYtdKeys(): string[] {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  return Array.from({ length: m + 1 }, (_, i) => keyFor(y, i));
}

/** Human label for a selection. */
export function monthSelectionLabel(selected: string[]): string {
  if (selected.length === 0) return "No months selected";
  const now = new Date();
  const cy = now.getUTCFullYear();
  const cm = now.getUTCMonth();
  const ytd = Array.from({ length: cm + 1 }, (_, i) => keyFor(cy, i));
  if (selected.length === ytd.length && ytd.every((k) => selected.includes(k))) {
    return `Year to date · ${cy}`;
  }
  const byYear = new Map<number, number[]>();
  for (const k of selected) {
    const { year, monthIdx } = parseKey(k);
    if (!byYear.has(year)) byYear.set(year, []);
    byYear.get(year)!.push(monthIdx);
  }
  const years = Array.from(byYear.keys()).sort((a, b) => a - b);
  if (years.length === 1) {
    const yy = years[0];
    const months = byYear.get(yy)!.sort((a, b) => a - b);
    if (months.length === 12) return `${yy}`;
    if (months.length <= 3) return `${months.map((m) => MONTHS[m]).join(", ")} · ${yy}`;
    return `${months.length} months · ${yy}`;
  }
  return `${selected.length} months · ${years[0]}–${years[years.length - 1]}`;
}

export interface MonthFilterPillProps {
  /** Committed selection, "YYYY-MM" keys. */
  selected: string[];
  /** Called with the new selection when the user hits Apply. */
  onApply: (months: string[]) => void;
}

export default function MonthFilterPill({
  selected,
  onApply,
}: MonthFilterPillProps) {
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth();
  const minYear = currentYear - YEARS_BACK;

  const [draft, setDraft] = useState<Set<string>>(new Set(selected));
  const [viewYear, setViewYear] = useState(currentYear);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [open]);

  const monthsForViewYear =
    viewYear === currentYear
      ? Array.from({ length: currentMonth + 1 }, (_, i) => i)
      : Array.from({ length: 12 }, (_, i) => i);

  const openPanel = () => {
    setDraft(new Set(selected));
    setViewYear(currentYear);
    setOpen(true);
  };
  const toggle = (key: string) =>
    setDraft((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const apply = () => {
    onApply(Array.from(draft).sort((a, b) => a.localeCompare(b)));
    setOpen(false);
  };

  return (
    <div className="relative inline-block" ref={wrapRef}>
      <button
        type="button"
        onClick={() => (open ? setOpen(false) : openPanel())}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[11px] font-semibold cursor-pointer border-0 hover:bg-slate-200"
        title="Choose which months to include"
      >
        {"\u{1F4C5}"} {monthSelectionLabel(selected)}
        <span aria-hidden="true" className="text-slate-400">
          {open ? "▴" : "▾"}
        </span>
      </button>

      {open && (
        <div className="absolute z-20 top-full left-0 mt-1 w-72 bg-white border border-slate-200 rounded-lg shadow-xl p-3">
          {/* Year stepper */}
          <div className="flex items-center justify-between mb-2">
            <button
              type="button"
              onClick={() => setViewYear((y) => Math.max(minYear, y - 1))}
              disabled={viewYear <= minYear}
              className="w-6 h-6 inline-flex items-center justify-center rounded border border-slate-200 text-slate-600 cursor-pointer disabled:opacity-30 hover:bg-slate-50 bg-white"
              aria-label="Previous year"
            >
              ‹
            </button>
            <span className="text-sm font-semibold text-slate-800">
              {viewYear}
            </span>
            <button
              type="button"
              onClick={() => setViewYear((y) => Math.min(currentYear, y + 1))}
              disabled={viewYear >= currentYear}
              className="w-6 h-6 inline-flex items-center justify-center rounded border border-slate-200 text-slate-600 cursor-pointer disabled:opacity-30 hover:bg-slate-50 bg-white"
              aria-label="Next year"
            >
              ›
            </button>
          </div>

          {/* Month checkboxes */}
          <div className="grid grid-cols-3 gap-x-2 gap-y-1 mb-3">
            {monthsForViewYear.map((m) => {
              const key = keyFor(viewYear, m);
              return (
                <label
                  key={m}
                  className="flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer py-1 px-1 rounded hover:bg-slate-50 select-none"
                >
                  <input
                    type="checkbox"
                    checked={draft.has(key)}
                    onChange={() => toggle(key)}
                    className="cursor-pointer accent-blue-500"
                  />
                  {MONTHS[m]}
                </label>
              );
            })}
          </div>

          <div className="flex items-center justify-between border-t border-slate-100 pt-2">
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setDraft(new Set(currentYtdKeys()))}
                className="text-[11px] font-medium text-blue-600 hover:underline cursor-pointer bg-transparent border-0 p-0"
              >
                Year to date
              </button>
              <button
                type="button"
                onClick={() => setDraft(new Set())}
                className="text-[11px] font-medium text-slate-500 hover:underline cursor-pointer bg-transparent border-0 p-0"
              >
                Clear
              </button>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="py-1 px-2.5 text-[11px] font-medium text-slate-700 border border-slate-300 rounded-lg cursor-pointer hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={apply}
                className="py-1 px-2.5 text-[11px] font-semibold text-white bg-blue-500 hover:bg-blue-600 rounded-lg border-0 cursor-pointer"
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
