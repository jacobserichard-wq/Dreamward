// app/components/CogsSummaryCard.tsx
//
// Phase 12g commit 1 of 4. Dashboard widget that puts the COGS
// gross-margin pulse directly on /dashboard so merchants see it
// without clicking through. Self-fetches from
// /api/cogs/summary?from=...&to=... using a fixed 30-day window.
//
// Renders:
//   - Headline: 30-day revenue / COGS / margin %
//   - Top 3 SKUs by revenue contribution (linked to /skus/[id])
//   - Underwater warning chip when any SKUs are selling below cost
//   - Unmatched warning chip when revenue is leaking out
//   - "Open full COGS dashboard →" link
//
// Pro-gated at the parent (dashboard plans-out non-Pro users
// from this card). Card itself shows loading / empty / error
// states gracefully.

"use client";

import { useEffect, useState } from "react";
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

function isoDate(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function last30Range(): { from: string; to: string } {
  const now = new Date();
  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() - 29);
  return { from: isoDate(start), to: isoDate(now) };
}

export default function CogsSummaryCard() {
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<SummaryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const range = last30Range();
        const url = new URL("/api/cogs/summary", window.location.origin);
        url.searchParams.set("from", range.from);
        url.searchParams.set("to", range.to);
        const res = await fetch(url.toString());
        if (cancelled) return;
        if (!res.ok) {
          if (res.status === 403) return; // non-Pro — silently hide
          const body = await res.json().catch(() => ({}));
          setError(body.error || `HTTP ${res.status}`);
          return;
        }
        const payload = (await res.json()) as SummaryResponse;
        if (!cancelled) setData(payload);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Couldn't load COGS");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Non-Pro users got a silent 403 — hide the card entirely.
  if (!loading && !data && !error) return null;

  const totals = data?.totals;
  const underwaterCount = data?.bySku.filter((s) => s.underwater).length ?? 0;
  const topSkus = (data?.bySku ?? [])
    .filter((s) => s.skuId != null && s.revenue > 0)
    .slice(0, 3);

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 mb-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-700 m-0 uppercase tracking-wide">
            COGS & gross margin
          </h3>
          <p className="text-xs text-slate-500 m-0">Last 30 days</p>
        </div>
        <Link
          href="/cogs"
          className="text-xs font-medium text-blue-600 hover:text-blue-700 no-underline whitespace-nowrap"
        >
          Open dashboard →
        </Link>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500 m-0 py-4 text-center">
          Loading…
        </p>
      ) : error ? (
        <p className="text-sm text-red-700 m-0 py-2">{error}</p>
      ) : !totals || totals.totalLineItemCount === 0 ? (
        <div className="py-4 text-center">
          <p className="text-sm text-slate-700 m-0 mb-1">
            No mapped line items yet.
          </p>
          <p className="text-xs text-slate-500 m-0">
            Connect a store + map a few SKUs to start tracking gross margin
            here.{" "}
            <Link
              href="/skus"
              className="text-blue-600 hover:underline"
            >
              Go to SKUs →
            </Link>
          </p>
        </div>
      ) : (
        <>
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
