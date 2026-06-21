// app/components/CogsSummaryCard.tsx
//
// Dashboard "Profit margin" widget. Puts the gross-margin pulse on
// /dashboard so makers see it without clicking through.
//
// Period filter (June 2026): defaults to year-to-date and lets the
// maker pick exactly which months to include (a checklist + Apply).
// Months can be non-contiguous, so rather than teach the COGS engine
// about gaps we fetch /api/cogs/summary once per selected month and
// aggregate client-side — the engine + endpoint stay untouched, and we
// never silently fold in a month the user didn't pick.
//
// Renders: revenue / COGS / margin %, top 3 SKUs, underwater +
// unmatched warning chips, and a link to the full /cogs dashboard.
// Pro-gated (the summary endpoint 403s for non-Pro → card hides).

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

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
}

interface Aggregated {
  totals: MarginTotals;
  bySku: SkuMarginRow[];
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

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

  for (const p of parts) {
    totals.revenue += p.totals.revenue;
    totals.cogs += p.totals.cogs;
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

  return { totals, bySku };
}

export default function CogsSummaryCard() {
  const now = new Date();
  const year = now.getUTCFullYear();
  const maxMonth = now.getUTCMonth(); // 0-based; latest selectable month
  const allMonths = Array.from({ length: maxMonth + 1 }, (_, i) => i);

  // Committed selection (drives the fetch) + the in-progress checklist.
  const [selected, setSelected] = useState<number[]>(allMonths);
  const [draft, setDraft] = useState<Set<number>>(new Set(allMonths));
  const [filterOpen, setFilterOpen] = useState(false);

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<Aggregated | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(
    async (months: number[]) => {
      if (months.length === 0) {
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
        });
        setLoading(false);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const today = new Date();
        const parts = await Promise.all(
          months.map(async (mi) => {
            const { from, to } = monthBounds(year, mi, today);
            const url = new URL("/api/cogs/summary", window.location.origin);
            url.searchParams.set("from", from);
            url.searchParams.set("to", to);
            const res = await fetch(url.toString());
            if (res.status === 403) {
              throw new Error("__forbidden__");
            }
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
          setForbidden(true); // non-Pro → hide
        } else {
          setError(err instanceof Error ? err.message : "Couldn't load margin");
        }
      } finally {
        setLoading(false);
      }
    },
    [year]
  );

  useEffect(() => {
    fetchData(selected);
  }, [selected, fetchData]);

  // Non-Pro users got a 403 — hide the card entirely.
  if (forbidden) return null;

  const isYtd = selected.length === allMonths.length;
  const periodLabel = (() => {
    if (selected.length === 0) return "No months selected";
    if (isYtd) return `Year to date · ${year}`;
    const names = selected
      .slice()
      .sort((a, b) => a - b)
      .map((m) => MONTHS[m]);
    if (names.length <= 3) return `${names.join(", ")} · ${year}`;
    return `${names.length} months · ${year}`;
  })();

  const totals = data?.totals;
  const underwaterCount = data?.bySku.filter((s) => s.underwater).length ?? 0;
  const topSkus = (data?.bySku ?? [])
    .filter((s) => s.skuId != null && s.revenue > 0)
    .slice(0, 3);

  const openFilter = () => {
    setDraft(new Set(selected));
    setFilterOpen(true);
  };
  const toggleDraft = (m: number) => {
    setDraft((prev) => {
      const next = new Set(prev);
      if (next.has(m)) next.delete(m);
      else next.add(m);
      return next;
    });
  };
  const applyFilter = () => {
    setSelected(Array.from(draft).sort((a, b) => a - b));
    setFilterOpen(false);
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 mb-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
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
        </div>
        <Link
          href="/cogs"
          className="text-xs font-medium text-blue-600 hover:text-blue-700 no-underline whitespace-nowrap"
        >
          Open dashboard →
        </Link>
      </div>

      {/* Month filter panel */}
      {filterOpen && (
        <div className="border border-slate-200 rounded-lg p-3 mb-4 bg-slate-50">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-slate-600">
              Include months ({year})
            </span>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => setDraft(new Set(allMonths))}
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
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-1.5 mb-3">
            {allMonths.map((m) => {
              const on = draft.has(m);
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => toggleDraft(m)}
                  className={`py-1.5 px-2 rounded-md text-xs font-medium cursor-pointer border transition-colors ${
                    on
                      ? "bg-blue-500 text-white border-blue-500"
                      : "bg-white text-slate-600 border-slate-200 hover:border-slate-300"
                  }`}
                >
                  {MONTHS[m]}
                </button>
              );
            })}
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setFilterOpen(false)}
              className="py-1.5 px-3 text-xs font-medium text-slate-700 border border-slate-300 rounded-lg cursor-pointer hover:bg-white"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={applyFilter}
              className="py-1.5 px-3 text-xs font-semibold text-white bg-blue-500 hover:bg-blue-600 rounded-lg border-0 cursor-pointer"
            >
              Apply
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-500 m-0 py-4 text-center">Loading…</p>
      ) : error ? (
        <p className="text-sm text-red-700 m-0 py-2">{error}</p>
      ) : selected.length === 0 ? (
        <p className="text-sm text-slate-500 m-0 py-4 text-center">
          Pick at least one month above to see your margin.
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
            Revenue, cost &amp; profit margin for {periodLabel.replace(/ · .*/, "")}
            .
          </p>
          {/* Headline strip */}
          <div className="grid grid-cols-3 gap-3 mb-3">
            <Stat label="Revenue" value={fmtUsd(totals.revenue)} />
            <Stat label="COGS" value={fmtUsd(totals.cogs)} />
            <Stat
              label="Margin"
              value={fmtUsd(totals.margin)}
              sub={fmtPct(totals.marginPercent)}
              highlight
            />
          </div>

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
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  highlight,
}: {
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-lg p-2.5 ${highlight ? "bg-emerald-50 border border-emerald-200" : "bg-slate-50 border border-slate-100"}`}
    >
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
    </div>
  );
}
