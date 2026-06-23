// app/components/CogsSummaryCard.tsx
//
// Dashboard "Profit margin" widget. Puts the gross-margin pulse on
// /dashboard so makers see it without clicking through.
//
// Period filter (June 2026): a dropdown of month checkboxes with a
// year selector — tick any months (across years, non-contiguous) to
// include them; defaults to year-to-date. Because months can have gaps
// we fetch /api/cogs/summary once per selected month and aggregate
// client-side rather than teach the COGS engine about gaps — the engine
// + endpoint stay untouched, and a month the user didn't tick is never
// silently folded in.
//
// Renders: revenue / COGS / margin %, top 3 SKUs, underwater +
// unmatched warning chips, and a link to the full /cogs dashboard.
// Pro-gated (the summary endpoint 403s for non-Pro → card hides).

"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import CogsDrillModal from "./CogsDrillModal";

interface MarginTotals {
  revenue: number;
  cogs: number;
  margin: number;
  marginPercent: number | null;
  unmatchedRevenue: number;
  unmatchedLineItemCount: number;
  totalLineItemCount: number;
}

interface SkuMarginRow extends MarginTotals {
  skuId: number | null;
  skuCode: string | null;
  skuName: string | null;
  underwater: boolean;
}

interface SummaryResponse {
  period: { from: string; to: string };
  totals: MarginTotals;
  byChannel: unknown[];
  bySku: SkuMarginRow[];
  feesAndTips?: number;
}

interface Aggregated {
  totals: MarginTotals;
  bySku: SkuMarginRow[];
  /** Service charges + tips in the period — when >0, Total Sales exceeds
   *  Product sales and the card explains why. */
  feesAndTips: number;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// How many years back the year selector can go.
const YEARS_BACK = 5;

function fmtUsd(n: number): string {
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function fmtPct(n: number | null): string {
  if (n == null) return "—";
  return `${n.toFixed(1)}%`;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function isoDate(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}

// Selection key: "YYYY-MM" (1-based month).
function keyFor(year: number, monthIdx: number): string {
  return `${year}-${pad2(monthIdx + 1)}`;
}
function parseKey(k: string): { year: number; monthIdx: number } {
  const [y, m] = k.split("-").map(Number);
  return { year: y, monthIdx: m - 1 };
}

// from/to bounds for one month, capped at today so we never query into
// the future (sold_at is a DATE).
function monthBounds(
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

// Sum per-month summaries into one. bySku rows are merged by skuId and
// their margin/underwater recomputed from the summed revenue/cogs.
function aggregate(parts: SummaryResponse[]): Aggregated {
  const totals: MarginTotals = {
    revenue: 0,
    cogs: 0,
    margin: 0,
    marginPercent: null,
    unmatchedRevenue: 0,
    unmatchedLineItemCount: 0,
    totalLineItemCount: 0,
  };
  const skuMap = new Map<number, SkuMarginRow>();
  let feesAndTips = 0;

  for (const p of parts) {
    totals.revenue += p.totals.revenue;
    totals.cogs += p.totals.cogs;
    feesAndTips += p.feesAndTips ?? 0;
    totals.unmatchedRevenue += p.totals.unmatchedRevenue;
    totals.unmatchedLineItemCount += p.totals.unmatchedLineItemCount;
    totals.totalLineItemCount += p.totals.totalLineItemCount;
    for (const s of p.bySku) {
      if (s.skuId == null) continue; // skip the unmatched bucket here
      const ex = skuMap.get(s.skuId);
      if (ex) {
        ex.revenue += s.revenue;
        ex.cogs += s.cogs;
      } else {
        skuMap.set(s.skuId, { ...s });
      }
    }
  }
  totals.margin = totals.revenue - totals.cogs;
  totals.marginPercent =
    totals.revenue > 0 ? (totals.margin / totals.revenue) * 100 : null;

  const bySku = Array.from(skuMap.values())
    .map((s) => {
      const margin = s.revenue - s.cogs;
      return {
        ...s,
        margin,
        marginPercent: s.revenue > 0 ? (margin / s.revenue) * 100 : null,
        underwater: s.revenue > 0 && s.cogs > s.revenue,
      };
    })
    .sort((a, b) => b.revenue - a.revenue);

  return { totals, bySku, feesAndTips };
}

export default function CogsSummaryCard() {
  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth(); // 0-based
  const minYear = currentYear - YEARS_BACK;

  // Year-to-date keys for the current year (Jan..current month).
  const ytdKeys = useCallback(
    () =>
      Array.from({ length: currentMonth + 1 }, (_, i) => keyFor(currentYear, i)),
    [currentYear, currentMonth]
  );

  // Committed selection (drives the fetch) + the in-progress draft.
  const [selected, setSelected] = useState<string[]>(() => ytdKeys());
  const [draft, setDraft] = useState<Set<string>>(() => new Set(ytdKeys()));
  const [viewYear, setViewYear] = useState(currentYear);
  const [filterOpen, setFilterOpen] = useState(false);

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<Aggregated | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Drill-down: which figure (revenue/cogs/margin) was clicked.
  const [drillFocus, setDrillFocus] = useState<
    "revenue" | "cogs" | "margin" | null
  >(null);

  const wrapRef = useRef<HTMLDivElement>(null);

  const fetchData = useCallback(async (keys: string[]) => {
    if (keys.length === 0) {
      setData({
        totals: {
          revenue: 0,
          cogs: 0,
          margin: 0,
          marginPercent: null,
          unmatchedRevenue: 0,
          unmatchedLineItemCount: 0,
          totalLineItemCount: 0,
        },
        bySku: [],
        feesAndTips: 0,
      });
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const today = new Date();
      const parts = await Promise.all(
        keys.map(async (k) => {
          const { year, monthIdx } = parseKey(k);
          const { from, to } = monthBounds(year, monthIdx, today);
          const url = new URL("/api/cogs/summary", window.location.origin);
          url.searchParams.set("from", from);
          url.searchParams.set("to", to);
          const res = await fetch(url.toString());
          if (res.status === 403) throw new Error("__forbidden__");
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.error || `HTTP ${res.status}`);
          }
          return (await res.json()) as SummaryResponse;
        })
      );
      setData(aggregate(parts));
    } catch (err) {
      if (err instanceof Error && err.message === "__forbidden__") {
        setForbidden(true);
      } else {
        setError(err instanceof Error ? err.message : "Couldn't load margin");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(selected);
  }, [selected, fetchData]);

  // Close the dropdown on an outside click.
  useEffect(() => {
    if (!filterOpen) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setFilterOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [filterOpen]);

  if (forbidden) return null;

  const ytd = ytdKeys();
  const isYtd =
    selected.length === ytd.length && ytd.every((k) => selected.includes(k));

  const periodLabel = (() => {
    if (selected.length === 0) return "No months selected";
    if (isYtd) return `Year to date · ${currentYear}`;
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
      if (months.length <= 3)
        return `${months.map((m) => MONTHS[m]).join(", ")} · ${yy}`;
      return `${months.length} months · ${yy}`;
    }
    return `${selected.length} months · ${years[0]}–${years[years.length - 1]}`;
  })();

  const totals = data?.totals;
  const underwaterCount = data?.bySku.filter((s) => s.underwater).length ?? 0;
  const topSkus = (data?.bySku ?? [])
    .filter((s) => s.skuId != null && s.revenue > 0)
    .slice(0, 3);

  // Months selectable for the year currently shown in the dropdown
  // (cap the current year at the current month; past years get all 12).
  const monthsForViewYear =
    viewYear === currentYear
      ? Array.from({ length: currentMonth + 1 }, (_, i) => i)
      : Array.from({ length: 12 }, (_, i) => i);

  const openFilter = () => {
    setDraft(new Set(selected));
    setViewYear(currentYear);
    setFilterOpen(true);
  };
  const toggleDraft = (key: string) => {
    setDraft((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const applyFilter = () => {
    setSelected(
      Array.from(draft).sort((a, b) => a.localeCompare(b))
    );
    setFilterOpen(false);
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 mb-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="relative" ref={wrapRef}>
          <h3 className="text-sm font-semibold text-slate-700 m-0 uppercase tracking-wide">
            Profit margin
          </h3>
          <button
            type="button"
            onClick={() => (filterOpen ? setFilterOpen(false) : openFilter())}
            className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 text-[11px] font-semibold cursor-pointer border-0 hover:bg-slate-200"
            title="Choose which months to include"
          >
            {"\u{1F4C5}"} {periodLabel}
            <span aria-hidden="true" className="text-slate-400">
              {filterOpen ? "▴" : "▾"}
            </span>
          </button>

          {/* Month dropdown */}
          {filterOpen && (
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
                  onClick={() =>
                    setViewYear((y) => Math.min(currentYear, y + 1))
                  }
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
                        onChange={() => toggleDraft(key)}
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
                    onClick={() => setDraft(new Set(ytdKeys()))}
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
                    onClick={() => setFilterOpen(false)}
                    className="py-1 px-2.5 text-[11px] font-medium text-slate-700 border border-slate-300 rounded-lg cursor-pointer hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={applyFilter}
                    className="py-1 px-2.5 text-[11px] font-semibold text-white bg-blue-500 hover:bg-blue-600 rounded-lg border-0 cursor-pointer"
                  >
                    Apply
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
        <Link
          href="/cogs"
          className="text-xs font-medium text-blue-600 hover:text-blue-700 no-underline whitespace-nowrap"
        >
          Open dashboard →
        </Link>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500 m-0 py-4 text-center">Loading…</p>
      ) : error ? (
        <p className="text-sm text-red-700 m-0 py-2">{error}</p>
      ) : selected.length === 0 ? (
        <p className="text-sm text-slate-500 m-0 py-4 text-center">
          Pick at least one month to see your margin.
        </p>
      ) : !totals || totals.totalLineItemCount === 0 ? (
        <div className="py-4 text-center">
          <p className="text-sm text-slate-700 m-0 mb-1">
            No mapped line items in {isYtd ? "this year so far" : "the selected months"}.
          </p>
          <p className="text-xs text-slate-500 m-0">
            Connect a store + map a few SKUs to start tracking gross margin
            here.{" "}
            <Link href="/skus" className="text-blue-600 hover:underline">
              Go to SKUs →
            </Link>
          </p>
        </div>
      ) : (
        <>
          <p className="text-xs text-slate-500 m-0 mb-2">
            Product sales, cost &amp; profit margin for{" "}
            {periodLabel.replace(/ · .*/, "")}.
          </p>
          {/* Headline strip */}
          <div className="grid grid-cols-3 gap-3 mb-2">
            <Stat
              label="Product sales"
              value={fmtUsd(totals.revenue)}
              onClick={() => setDrillFocus("revenue")}
            />
            <Stat
              label="COGS"
              value={fmtUsd(totals.cogs)}
              onClick={() => setDrillFocus("cogs")}
            />
            <Stat
              label="Margin"
              value={fmtUsd(totals.margin)}
              sub={fmtPct(totals.marginPercent)}
              highlight
              onClick={() => setDrillFocus("margin")}
            />
          </div>
          {/* Why this differs from Total Sales — shown only when there
              actually IS a gap (service charges / tips in the period), so
              makers who just sell products don't see needless noise. */}
          {(data?.feesAndTips ?? 0) > 0 && (
            <p className="text-[11px] text-slate-400 m-0 mb-3">
              Just your{" "}
              <strong className="font-semibold text-slate-500">products</strong>,
              measured against what they cost you. Your{" "}
              <strong className="font-semibold text-slate-500">Total Sales</strong>{" "}
              (above) is higher because it also includes the shipping &amp;
              service fees you charge.
            </p>
          )}

          {/* Warning chips */}
          {(underwaterCount > 0 || totals.unmatchedLineItemCount > 0) && (
            <div className="flex gap-2 flex-wrap mb-3">
              {underwaterCount > 0 && (
                <Link
                  href="/cogs"
                  className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-semibold bg-red-50 text-red-700 border border-red-200 no-underline hover:bg-red-100"
                >
                  {"\u{26A0}"} {underwaterCount} underwater SKU
                  {underwaterCount === 1 ? "" : "s"}
                </Link>
              )}
              {totals.unmatchedLineItemCount > 0 && (
                <Link
                  href="/skus/unmatched"
                  className="inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 no-underline hover:bg-amber-100"
                >
                  {totals.unmatchedLineItemCount} unmatched line item
                  {totals.unmatchedLineItemCount === 1 ? "" : "s"}
                </Link>
              )}
            </div>
          )}

          {/* Top SKUs */}
          {topSkus.length > 0 && (
            <div>
              <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500 m-0 mb-1">
                Top SKUs (revenue)
              </p>
              <ul className="m-0 p-0 list-none space-y-1">
                {topSkus.map((s) => (
                  <li
                    key={s.skuId!}
                    className="flex justify-between gap-2 text-xs"
                  >
                    <Link
                      href={`/skus/${s.skuId}`}
                      className="text-slate-700 hover:text-blue-700 truncate no-underline flex-1"
                    >
                      <span className="font-mono font-semibold mr-1.5">
                        {s.skuCode}
                      </span>
                      <span className="text-slate-500">{s.skuName}</span>
                    </Link>
                    <span className="tabular-nums whitespace-nowrap text-slate-900 font-semibold">
                      {fmtUsd(s.revenue)}{" "}
                      <span
                        className={`text-[10px] ml-0.5 ${s.underwater ? "text-red-700" : "text-slate-500"}`}
                      >
                        ({fmtPct(s.marginPercent)})
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {drillFocus && (
        <CogsDrillModal
          open={drillFocus !== null}
          months={selected}
          focus={drillFocus}
          periodLabel={periodLabel}
          onClose={() => setDrillFocus(null)}
        />
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  highlight,
  onClick,
}: {
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
  onClick?: () => void;
}) {
  const base = `rounded-lg p-2.5 text-left w-full ${highlight ? "bg-emerald-50 border border-emerald-200" : "bg-slate-50 border border-slate-100"}`;
  const inner = (
    <>
      <p className="text-[10px] uppercase tracking-wide text-slate-500 m-0 mb-0.5">
        {label}
      </p>
      <p
        className={`text-base font-bold m-0 tabular-nums ${highlight ? "text-emerald-800" : "text-slate-900"}`}
      >
        {value}
      </p>
      {sub && (
        <p
          className={`text-[10px] m-0 mt-0.5 ${highlight ? "text-emerald-700" : "text-slate-500"}`}
        >
          {sub}
        </p>
      )}
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
