// app/cogs/page.tsx
//
// Phase 12f commit 2 of 3. The COGS / gross margin dashboard.
// The visible business value of Phase 12 — the answer to
// "how much money is my business actually making per channel,
// per product?"
//
// Sections:
//   1. Period selector (presets + custom)
//   2. Headline totals strip (revenue / COGS / gross margin)
//   3. Unmatched warning banner (when unmatched revenue > 0)
//   4. Underwater SKUs warning panel (when any present)
//   5. By-channel breakdown table
//   6. Top SKUs by revenue contribution
//
// Audit trail drill-in modal ships in commit 3.
//
// Anti-Crafty differentiation surfaced in-app:
//   - "Cost calculations are transparent" tooltip on the COGS
//     number (links to commit 3's drill-in)
//   - Effective-date tooltip on per-SKU rows reminding the
//     merchant that historical sales locked in their historical
//     cost — directly counters Crafty Base's "Historical Data
//     Nightmare" complaint.

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import PageHeader from "../components/PageHeader";
import AppHeader from "../components/AppHeader";
import ErrorBanner from "../components/ErrorBanner";
import SectionTip from "../components/SectionTip";
import CogsAuditTrailModal, {
  type CogsDrillScopeOpts,
} from "../components/CogsAuditTrailModal";
import { CANONICAL_CHANNELS } from "@/lib/profitability/channels";

interface MarginTotals {
  revenue: number;
  cogs: number;
  margin: number;
  marginPercent: number | null;
  unmatchedRevenue: number;
  unmatchedLineItemCount: number;
  totalLineItemCount: number;
}

interface ChannelMarginRow extends MarginTotals {
  channel: string | null;
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
  byChannel: ChannelMarginRow[];
  bySku: SkuMarginRow[];
}

type PresetId =
  | "last7"
  | "last30"
  | "thisMonth"
  | "lastMonth"
  | "thisQuarter"
  | "ytd"
  | "lastYear"
  | "custom";

function fmtUsd(n: number): string {
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function fmtPct(n: number | null): string {
  if (n == null) return "—";
  return `${n >= 0 ? "" : ""}${n.toFixed(1)}%`;
}

function isoDate(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function presetToRange(preset: PresetId): { from: string; to: string } | null {
  if (preset === "custom") return null;
  const now = new Date();
  const today = isoDate(now);
  switch (preset) {
    case "last7": {
      const d = new Date(now);
      d.setUTCDate(d.getUTCDate() - 6);
      return { from: isoDate(d), to: today };
    }
    case "last30": {
      const d = new Date(now);
      d.setUTCDate(d.getUTCDate() - 29);
      return { from: isoDate(d), to: today };
    }
    case "thisMonth": {
      const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
      return { from: isoDate(d), to: today };
    }
    case "lastMonth": {
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
      const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
      return { from: isoDate(start), to: isoDate(end) };
    }
    case "thisQuarter": {
      const qStartMonth = Math.floor(now.getUTCMonth() / 3) * 3;
      const start = new Date(Date.UTC(now.getUTCFullYear(), qStartMonth, 1));
      return { from: isoDate(start), to: today };
    }
    case "ytd": {
      const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
      return { from: isoDate(start), to: today };
    }
    case "lastYear": {
      const start = new Date(Date.UTC(now.getUTCFullYear() - 1, 0, 1));
      const end = new Date(Date.UTC(now.getUTCFullYear() - 1, 11, 31));
      return { from: isoDate(start), to: isoDate(end) };
    }
  }
}

function channelLabel(id: string | null): { label: string; icon: string } {
  if (!id) return { label: "Uncategorized", icon: "\u{1F4CB}" };
  const meta = CANONICAL_CHANNELS.find((c) => c.id === id);
  if (!meta) return { label: id, icon: "" };
  return { label: meta.label, icon: meta.icon };
}

export default function CogsPage() {
  const router = useRouter();

  const [preset, setPreset] = useState<PresetId>("last30");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<SummaryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  // Audit trail modal state
  const [auditScope, setAuditScope] = useState<CogsDrillScopeOpts | null>(null);

  const range = useMemo(() => {
    if (preset === "custom") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(customFrom)) return null;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(customTo)) return null;
      return { from: customFrom, to: customTo };
    }
    return presetToRange(preset);
  }, [preset, customFrom, customTo]);

  const load = useCallback(async () => {
    if (!range) return;
    try {
      const url = new URL("/api/cogs/summary", window.location.origin);
      url.searchParams.set("from", range.from);
      url.searchParams.set("to", range.to);
      const res = await fetch(url.toString());
      if (!res.ok) {
        if (res.status === 401) {
          router.replace("/signin?callbackUrl=/cogs");
          return;
        }
        if (res.status === 403) {
          setForbidden(true);
          return;
        }
        const body = await res.json().catch(() => ({}));
        setError(body.error || `HTTP ${res.status}`);
        return;
      }
      const payload = (await res.json()) as SummaryResponse;
      setData(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load COGS data");
    }
  }, [range, router]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await load();
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (loading) return;
    load();
  }, [load, loading]);

  if (forbidden) {
    return (
      <div className="min-h-screen bg-slate-50 font-sans">
        <div className="max-w-[1100px] mx-auto py-8 px-4 sm:px-6">
          <PageHeader
            backHref="/dashboard"
            backLabel="FlowWork"
            title="COGS"
            subtitle="Pro feature"
          />
          <div className="bg-white rounded-xl border border-slate-200 py-12 px-6 text-center">
            <p className="text-base font-medium text-slate-700 m-0 mb-4">
              Gross margin reporting is part of FlowWork Pro.
            </p>
            <Link
              href="/upgrade"
              className="inline-block py-2 px-4 rounded-lg bg-blue-500 text-white text-sm font-semibold no-underline hover:bg-blue-600"
            >
              See Pro plans
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const totals = data?.totals;
  const underwaterSkus = data?.bySku.filter((s) => s.underwater) ?? [];
  const unmatchedPct =
    totals && totals.revenue > 0
      ? (totals.unmatchedRevenue / totals.revenue) * 100
      : 0;

  return (
    <div className="min-h-screen bg-slate-50 font-sans">
      <AppHeader />
      <div className="max-w-[1100px] mx-auto py-8 px-4 sm:px-6">
        <PageHeader
          backHref="/dashboard"
          backLabel="FlowWork"
          title="COGS & gross margin"
          subtitle="Per-period revenue, cost of goods sold, and margin — broken down by channel and by SKU. Click any number for the audit trail."
        />

        <SectionTip id="cogs" title="How gross margin gets calculated">
          Margin = revenue minus the cost of goods sold. For each sale,
          FlowWork looks up the SKU&apos;s cost on the date it sold (its
          effective-dated cost row) — so a price change today never
          rewrites last month&apos;s margin. If a SKU shows $0 COGS, it
          has no cost row covering the sale date; add one on the{" "}
          <strong>SKUs</strong> page. Click any number here to see the
          exact line items and cost rows behind it.
        </SectionTip>

        {error && (
          <ErrorBanner message={error} onDismiss={() => setError(null)} />
        )}

        {/* Period selector */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 mb-4">
          <div className="flex items-center gap-2 flex-wrap mb-2">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500 mr-1">
              Period:
            </span>
            {(
              [
                ["last7", "Last 7 days"],
                ["last30", "Last 30 days"],
                ["thisMonth", "This month"],
                ["lastMonth", "Last month"],
                ["thisQuarter", "This quarter"],
                ["ytd", "Year to date"],
                ["lastYear", "Last year"],
                ["custom", "Custom"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setPreset(id)}
                className={`px-3 py-1 rounded-full text-xs font-medium border cursor-pointer ${
                  preset === id
                    ? "bg-slate-800 text-white border-slate-800"
                    : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
          {preset === "custom" && (
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
                className="py-1 px-2 text-xs border border-slate-200 rounded outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
              <span className="text-xs text-slate-500">to</span>
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
                className="py-1 px-2 text-xs border border-slate-200 rounded outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
              />
            </div>
          )}
          {range && (
            <p className="text-[10px] text-slate-400 m-0 mt-2 font-mono">
              {range.from} → {range.to}
            </p>
          )}
        </div>

        {/* Totals strip */}
        {loading ? (
          <p className="text-center p-[60px] text-slate-500">
            Loading COGS data…
          </p>
        ) : !totals ? null : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
              <StatCard label="Revenue" value={fmtUsd(totals.revenue)} />
              <StatCard
                label="Cost of goods"
                value={fmtUsd(totals.cogs)}
                sub="See the math →"
                onClick={() =>
                  setAuditScope({
                    scope: "totals",
                    label: "All line items in this period",
                  })
                }
              />
              <StatCard
                label="Gross margin"
                value={fmtUsd(totals.margin)}
                sub={`${fmtPct(totals.marginPercent)} of revenue`}
                highlight
              />
            </div>

            {/* Unmatched warning */}
            {totals.unmatchedRevenue > 0 && (
              <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-xl px-4 py-3 mb-4">
                <p className="text-sm font-semibold m-0 mb-1">
                  {fmtUsd(totals.unmatchedRevenue)} of revenue (
                  {unmatchedPct.toFixed(1)}%) is from unmatched line items.
                </p>
                <p className="text-xs m-0 text-amber-800">
                  These contribute to revenue but not COGS — your margin
                  reading is incomplete until they&apos;re mapped to FlowWork
                  SKUs.{" "}
                  <Link
                    href="/skus/unmatched"
                    className="text-amber-900 underline font-medium"
                  >
                    Map them now →
                  </Link>
                </p>
              </div>
            )}

            {/* Underwater SKUs warning */}
            {underwaterSkus.length > 0 && (
              <div className="bg-red-50 border border-red-200 text-red-900 rounded-xl px-4 py-3 mb-4">
                <p className="text-sm font-semibold m-0 mb-1">
                  {"\u{26A0}"} {underwaterSkus.length} SKU
                  {underwaterSkus.length === 1 ? "" : "s"} selling below cost
                </p>
                <ul className="m-0 mt-2 list-none p-0 space-y-1">
                  {underwaterSkus.slice(0, 5).map((s) => (
                    <li
                      key={s.skuId ?? "u"}
                      className="text-xs flex justify-between gap-2"
                    >
                      <span>
                        <span className="font-mono font-semibold mr-1">
                          {s.skuCode}
                        </span>
                        {s.skuName}
                      </span>
                      <span className="tabular-nums">
                        Revenue {fmtUsd(s.revenue)} vs COGS {fmtUsd(s.cogs)} ({" "}
                        <span className="font-semibold">
                          {fmtPct(s.marginPercent)}
                        </span>{" "}
                        )
                      </span>
                    </li>
                  ))}
                  {underwaterSkus.length > 5 && (
                    <li className="text-xs italic">
                      …and {underwaterSkus.length - 5} more
                    </li>
                  )}
                </ul>
              </div>
            )}

            {/* By-channel breakdown */}
            <h2 className="text-sm font-semibold text-slate-700 m-0 mb-2 uppercase tracking-wide">
              By channel
            </h2>
            <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto mb-6">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
                    <th className="text-left py-2.5 px-4 font-medium">Channel</th>
                    <th className="text-right py-2.5 px-4 font-medium">
                      Revenue
                    </th>
                    <th className="text-right py-2.5 px-4 font-medium">COGS</th>
                    <th className="text-right py-2.5 px-4 font-medium">Margin</th>
                    <th className="text-right py-2.5 px-4 font-medium">
                      Margin %
                    </th>
                    <th className="w-24 text-right py-2.5 px-4 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {data!.byChannel.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-6 text-center text-slate-500 text-sm">
                        No sales in this period.
                      </td>
                    </tr>
                  ) : (
                    data!.byChannel.map((row) => {
                      const meta = channelLabel(row.channel);
                      return (
                        <tr
                          key={row.channel ?? "__null__"}
                          className="border-b border-slate-100 last:border-b-0"
                        >
                          <td className="py-3 px-4">
                            <span className="inline-flex items-center gap-1.5">
                              <span>{meta.icon}</span>
                              <span className="font-medium text-slate-900">
                                {meta.label}
                              </span>
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right text-slate-900 tabular-nums whitespace-nowrap">
                            {fmtUsd(row.revenue)}
                          </td>
                          <td className="py-3 px-4 text-right text-slate-600 tabular-nums whitespace-nowrap">
                            {fmtUsd(row.cogs)}
                          </td>
                          <td className="py-3 px-4 text-right text-slate-900 font-semibold tabular-nums whitespace-nowrap">
                            {fmtUsd(row.margin)}
                          </td>
                          <td className="py-3 px-4 text-right text-slate-700 tabular-nums whitespace-nowrap">
                            {fmtPct(row.marginPercent)}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <button
                              type="button"
                              onClick={() =>
                                setAuditScope({
                                  scope: "channel",
                                  id: row.channel ?? "null",
                                  label: `Channel: ${meta.label}`,
                                })
                              }
                              className="text-xs font-medium text-blue-600 hover:text-blue-700 bg-transparent border-0 cursor-pointer whitespace-nowrap"
                            >
                              Audit →
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Top SKUs */}
            <h2 className="text-sm font-semibold text-slate-700 m-0 mb-2 uppercase tracking-wide">
              Top SKUs by revenue
            </h2>
            <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto mb-6">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
                    <th className="text-left py-2.5 px-4 font-medium">SKU</th>
                    <th className="text-right py-2.5 px-4 font-medium">Units</th>
                    <th className="text-right py-2.5 px-4 font-medium">
                      Revenue
                    </th>
                    <th className="text-right py-2.5 px-4 font-medium">COGS</th>
                    <th className="text-right py-2.5 px-4 font-medium">Margin</th>
                    <th className="text-right py-2.5 px-4 font-medium">
                      Margin %
                    </th>
                    <th className="w-24 text-right py-2.5 px-4 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {data!.bySku.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="py-6 text-center text-slate-500 text-sm">
                        No mapped line items in this period.
                      </td>
                    </tr>
                  ) : (
                    data!.bySku.slice(0, 20).map((s) => (
                      <tr
                        key={s.skuId ?? "__unmatched__"}
                        className={`border-b border-slate-100 last:border-b-0 ${s.underwater ? "bg-red-50/30" : ""}`}
                      >
                        <td className="py-3 px-4">
                          {s.skuId == null ? (
                            <span className="italic text-amber-700">
                              Unmatched bucket ({s.unmatchedLineItemCount} items)
                            </span>
                          ) : (
                            <Link
                              href={`/skus/${s.skuId}`}
                              className="text-blue-600 hover:underline"
                            >
                              <span className="font-mono font-semibold mr-1">
                                {s.skuCode}
                              </span>
                              {s.skuName}
                            </Link>
                          )}
                          {s.underwater && (
                            <span className="ml-2 text-[10px] uppercase font-semibold text-red-700">
                              Underwater
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right text-slate-700 tabular-nums">
                          {s.totalLineItemCount}
                        </td>
                        <td className="py-3 px-4 text-right text-slate-900 tabular-nums whitespace-nowrap">
                          {fmtUsd(s.revenue)}
                        </td>
                        <td className="py-3 px-4 text-right text-slate-600 tabular-nums whitespace-nowrap">
                          {fmtUsd(s.cogs)}
                        </td>
                        <td className="py-3 px-4 text-right text-slate-900 font-semibold tabular-nums whitespace-nowrap">
                          {fmtUsd(s.margin)}
                        </td>
                        <td className="py-3 px-4 text-right text-slate-700 tabular-nums whitespace-nowrap">
                          {fmtPct(s.marginPercent)}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <button
                            type="button"
                            onClick={() =>
                              setAuditScope(
                                s.skuId == null
                                  ? {
                                      scope: "unmatched",
                                      label: "Unmatched bucket",
                                    }
                                  : {
                                      scope: "sku",
                                      id: String(s.skuId),
                                      label: `SKU: ${s.skuCode ?? s.skuId}`,
                                    }
                              )
                            }
                            className="text-xs font-medium text-blue-600 hover:text-blue-700 bg-transparent border-0 cursor-pointer whitespace-nowrap"
                          >
                            Audit →
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <p className="text-xs text-slate-400 text-center mt-6">
              <strong>Effective-date discipline:</strong> Each line item&apos;s
              COGS uses the cost-history row that was active on the sale&apos;s
              date — never today&apos;s cost. Changing a SKU&apos;s price now
              never rewrites your historical margin.
            </p>
          </>
        )}
      </div>

      {range && (
        <CogsAuditTrailModal
          open={auditScope !== null}
          scope={auditScope}
          from={range.from}
          to={range.to}
          onClose={() => setAuditScope(null)}
        />
      )}
    </div>
  );
}

function StatCard({
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
  const baseClass = `rounded-xl border p-4 ${
    highlight
      ? "bg-emerald-50 border-emerald-200"
      : "bg-white border-slate-200"
  }`;
  const interactiveClass = onClick
    ? "cursor-pointer hover:border-blue-400 hover:shadow-sm transition-all text-left w-full"
    : "";
  const content = (
    <>
      <p className="text-xs uppercase tracking-wide text-slate-500 m-0 mb-1">
        {label}
      </p>
      <p
        className={`text-2xl font-bold m-0 tabular-nums ${highlight ? "text-emerald-800" : "text-slate-900"}`}
      >
        {value}
      </p>
      {sub && (
        <p className={`text-xs m-0 mt-0.5 ${onClick ? "text-blue-600 font-medium" : "text-slate-500"}`}>
          {sub}
        </p>
      )}
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`${baseClass} ${interactiveClass}`}
      >
        {content}
      </button>
    );
  }
  return <div className={baseClass}>{content}</div>;
}
