"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import PageHeader from "../components/PageHeader";
import AppHeader from "../components/AppHeader";
import ErrorBanner from "../components/ErrorBanner";
import ChannelTable, {
  type ChannelRow,
} from "../components/ChannelTable";
import { isPayingTier } from "@/lib/plans";

// Phase 5 commit 7: portfolio profitability dashboard. Reads
// /api/profitability for portfolio aggregates, monthly trends, and
// best/worst-market rankings. Per-event drill-down lives on the
// existing event detail page (commit 6).
//
// rateSource: "fallback" surfaces a visible amber notice — the user
// feedback rule from sub-session 19 is "never let a fabricated rate
// pass as a real one without a flag." Same notice as the event detail
// card, hoisted to the top of this page since every dollar figure on
// the dashboard depends on the IRS rate.

interface PerEvent {
  id: number;
  name: string;
  startDate: string;
  endDate: string;
  venue: string | null;
  revenue: { total: number; manual: number; linked: number };
  expenses: { total: number; linked: number; manual: number };
  boothFee: number;
  totalMiles: number | null;
  mileageCost: number;
  profit: number;
  unknownAmount: number;
}

interface Portfolio {
  totalRevenue: number;
  totalExpenses: number;
  totalBoothFees: number;
  totalMiles: number;
  totalMileageCost: number;
  netProfit: number;
  eventCount: number;
  unknownAmount: number;
}

interface MonthlyTrendRow {
  month: string;
  revenue: number;
  expenses: number;
  net: number;
}

interface ProfitabilityResponse {
  perEvent: PerEvent[];
  portfolio: Portfolio;
  monthlyTrend: MonthlyTrendRow[];
  bestMarkets: PerEvent[];
  worstMarkets: PerEvent[];
  irsMileageRate: number;
  rateSource: "config" | "fallback";
}

function formatMoney(n: number): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatMoneyShort(n: number): string {
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

// "2025-03" → "Mar '25". Compact X-axis labels keep three charts readable
// in a narrow grid cell without a tooltip.
function formatMonthShort(month: string): string {
  if (!/^\d{4}-\d{2}$/.test(month)) return month;
  const [year, mm] = month.split("-");
  const d = new Date(Number(year), Number(mm) - 1, 1);
  return d.toLocaleString("en-US", { month: "short", year: "2-digit" });
}

export default function ProfitabilityPage() {
  const router = useRouter();
  const [data, setData] = useState<ProfitabilityResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [plan, setPlan] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Phase 9.1: tab state + channel data + year picker. Default tab
  // is "events" (existing behavior). "channels" loads the new
  // /api/profitability/channels endpoint and renders the
  // ChannelTable in full-detail variant.
  const currentYear = new Date().getUTCFullYear();
  const [activeTab, setActiveTab] = useState<"events" | "channels">("events");
  const [channelYear, setChannelYear] = useState<number>(currentYear);
  const [channelMode, setChannelMode] = useState<"attributable" | "allocated">(
    "attributable"
  );
  const [channelData, setChannelData] = useState<{
    channels: ChannelRow[];
    overhead: number;
    totalRevenue: number;
    netProfit: number;
  } | null>(null);
  const [channelLoading, setChannelLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/profitability");
      if (res.status === 401) {
        router.replace("/signin?callbackUrl=/profitability");
        return;
      }
      if (res.status === 403) {
        // 403 = non-paying (canceled) user. Sentinel "canceled"
        // drives the upgrade-prompt branch below. Under the
        // feature-flat model every paying tier reaches the content.
        setPlan("canceled");
        return;
      }
      if (!res.ok) {
        setError(`Couldn't load profitability: HTTP ${res.status}`);
        return;
      }
      const json = (await res.json()) as ProfitabilityResponse;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load page");
    } finally {
      setLoading(false);
    }
  }, [router]);

  // Phase 9.1: load channel data when the channels tab is active OR
  // the year/mode changes. Skip when on the events tab (no point
  // fetching data we won't display).
  useEffect(() => {
    if (activeTab !== "channels") return;
    let cancelled = false;
    async function loadChannels() {
      setChannelLoading(true);
      try {
        const res = await fetch(
          `/api/profitability/channels?year=${channelYear}&mode=${channelMode}`
        );
        if (!res.ok) return;
        const json = (await res.json()) as {
          channels: ChannelRow[];
          overhead: number;
          totalRevenue: number;
          netProfit: number;
        };
        if (cancelled) return;
        setChannelData(json);
      } catch {
        // Soft-fail — tab shows the existing channelData (stale OK)
      } finally {
        if (!cancelled) setChannelLoading(false);
      }
    }
    loadChannels();
    return () => {
      cancelled = true;
    };
  }, [activeTab, channelYear, channelMode]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 font-sans">
        <div className="max-w-[900px] mx-auto py-8 px-4 sm:px-6">
          <p className="text-center p-[60px] text-slate-500">Loading profitability...</p>
        </div>
      </div>
    );
  }

  if (plan !== null && !isPayingTier(plan)) {
    return (
      <div className="min-h-screen bg-slate-50 font-sans">
        <div className="max-w-[900px] mx-auto py-8 px-4 sm:px-6">
          <PageHeader
            backHref="/dashboard"
            backLabel="FlowWork"
            title="Profitability"
            subtitle="Per-event profit & loss, monthly trends, and best/worst markets"
          />
          <div className="bg-amber-50 border border-amber-200 rounded-xl py-8 px-6 text-center">
            <p className="text-base font-medium text-amber-900 m-0 mb-2">
              {"\u{1F512}"} Active subscription required
            </p>
            <p className="text-sm text-amber-800 m-0 mb-5 leading-relaxed">
              Start your subscription — from $10/mo — to see per-event P&L,
              monthly profit trends, and your best- and worst-performing
              markets. Included on every tier.
            </p>
            <Link
              href="/billing"
              className="inline-block py-2.5 px-6 rounded-lg bg-amber-600 text-white text-sm font-semibold no-underline cursor-pointer"
            >
              View plans
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="min-h-screen bg-slate-50 font-sans">
        <div className="max-w-[900px] mx-auto py-8 px-4 sm:px-6">
          <PageHeader
            backHref="/dashboard"
            backLabel="FlowWork"
            title="Profitability"
            subtitle="Per-event profit & loss, monthly trends, and best/worst markets"
          />
          {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
        </div>
      </div>
    );
  }

  const { portfolio, monthlyTrend, bestMarkets, worstMarkets, irsMileageRate, rateSource } = data;
  const profitColor =
    portfolio.netProfit >= 0 ? "text-slate-900" : "text-red-700";

  return (
    <div className="min-h-screen bg-slate-50 font-sans">
      <AppHeader />
      <div className="max-w-[1100px] mx-auto py-8 px-4 sm:px-6">
        <PageHeader
          backHref="/dashboard"
          backLabel="FlowWork"
          title="Profitability"
          subtitle="Per-event profit & loss, monthly trends, and best/worst markets"
        />

        {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

        {/* Sub-session 19 user feedback: visible notice when the IRS rate
            is the hardcoded fallback, not a configured value. Hoisted to
            the top so the user sees it before reading any dollar figure
            that depends on the rate. */}
        {rateSource === "fallback" && (
          <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded-lg px-4 py-3 mb-5 text-sm">
            <strong>Using default IRS mileage rate</strong> (${irsMileageRate.toFixed(2)}/mi).
            The configured rate isn&apos;t available — mileage costs below use the
            default. Configure it in{" "}
            <Link href="/settings" className="underline">
              Settings
            </Link>
            .
          </div>
        )}

        {/* Phase 9.1: tab bar — Events (existing) | Channels (new).
            "events" stays as the default to preserve existing user
            expectations + the existing URL stays meaningful. */}
        <div className="flex gap-1 mb-5 border-b border-slate-200">
          {(["events", "channels"] as const).map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={`py-2.5 px-4 text-sm font-medium border-b-2 cursor-pointer transition-colors ${
                activeTab === tab
                  ? "text-slate-900 border-blue-500"
                  : "text-slate-500 border-transparent hover:text-slate-700"
              } bg-transparent`}
            >
              {tab === "events" ? "By Event" : "By Channel"}
            </button>
          ))}
        </div>

        {/* ── BY CHANNEL TAB ─────────────────────────────────── */}
        {activeTab === "channels" && (
          <>
            {/* Year picker — matches /reports pattern. Current + 3
                prior years; older accessible via direct URL */}
            <div className="flex items-center gap-2 mb-4 flex-wrap">
              <label
                htmlFor="channels-year"
                className="text-sm font-medium text-slate-700"
              >
                Year
              </label>
              <select
                id="channels-year"
                value={channelYear}
                onChange={(e) => setChannelYear(Number(e.target.value))}
                disabled={channelLoading}
                className="py-1.5 px-2.5 text-sm border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-500/20 focus:outline-none focus:border-blue-500 disabled:bg-slate-100"
              >
                {[
                  currentYear,
                  currentYear - 1,
                  currentYear - 2,
                  currentYear - 3,
                ].map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
              {channelLoading && (
                <span className="text-xs text-slate-500">Loading…</span>
              )}
            </div>

            {channelData ? (
              <ChannelTable
                channels={channelData.channels}
                overhead={channelData.overhead}
                totalRevenue={channelData.totalRevenue}
                netProfit={channelData.netProfit}
                mode={channelMode}
                onToggleMode={() =>
                  setChannelMode((m) =>
                    m === "attributable" ? "allocated" : "attributable"
                  )
                }
                // No collapse on this page — show every channel
                // in the dedicated view. The dashboard is where
                // per-user curation matters.
                collapsedChannels={[]}
                onToggleCollapse={() => {
                  /* no-op on this page */
                }}
                isPro={isPayingTier(plan)}
                variant="full"
              />
            ) : (
              <p className="text-center py-12 text-slate-500 text-sm">
                {channelLoading
                  ? "Loading channel breakdown…"
                  : "No channel data for this year yet."}
              </p>
            )}
          </>
        )}

        {/* ── BY EVENT TAB (existing content) ────────────────── */}
        {activeTab === "events" && (
        portfolio.eventCount === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 py-8 px-6 text-center">
            <p className="text-base text-slate-700 m-0 mb-2">
              No events yet
            </p>
            <p className="text-sm text-slate-500 m-0 mb-4">
              Add events on the <Link href="/events" className="text-blue-600 no-underline">Events</Link> page
              to start tracking per-market profit & loss.
            </p>
          </div>
        ) : (
          <>
            {/* Portfolio summary — KPI tiles */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
              <KpiTile
                label="Net profit"
                value={`${portfolio.netProfit < 0 ? "−" : ""}$${formatMoney(Math.abs(portfolio.netProfit))}`}
                valueClass={`text-2xl font-bold ${profitColor}`}
                subtitle={`across ${portfolio.eventCount} ${portfolio.eventCount === 1 ? "event" : "events"}`}
              />
              <KpiTile
                label="Total revenue"
                value={`$${formatMoney(portfolio.totalRevenue)}`}
              />
              <KpiTile
                label="Total expenses"
                value={`$${formatMoney(
                  portfolio.totalExpenses + portfolio.totalBoothFees + portfolio.totalMileageCost
                )}`}
                subtitle={`incl. $${formatMoneyShort(portfolio.totalBoothFees)} booth + $${formatMoneyShort(portfolio.totalMileageCost)} mileage`}
              />
              {/* Per Jacob: replaced Total Miles tile with Profit
                  Margin %. Mileage is a tax-prep input, not a
                  decision-support metric, and was already counted
                  in Total Expenses above. Profit Margin answers a
                  question every business owner intuitively asks
                  ("how efficient am I?") in the same shape as the
                  other tiles ($ → %). Mileage cost still surfaces
                  in the Total Expenses subtitle + per-event tables
                  below + the /reports annual summary. */}
              <KpiTile
                label="Profit margin"
                value={
                  portfolio.totalRevenue > 0
                    ? `${(
                        (portfolio.netProfit / portfolio.totalRevenue) *
                        100
                      ).toFixed(1)}%`
                    : "—"
                }
                valueClass={`text-2xl font-bold ${profitColor}`}
                subtitle={
                  portfolio.totalRevenue > 0
                    ? portfolio.netProfit >= 0
                      ? "of every revenue dollar kept"
                      : "of every revenue dollar lost"
                    : "no revenue yet"
                }
              />
            </div>

            {portfolio.unknownAmount !== 0 && (
              <p className="text-xs text-slate-500 mb-5">
                ${formatMoney(Math.abs(portfolio.unknownAmount))} in uncategorized event
                transactions are excluded from these totals.
              </p>
            )}

            {/* Three monthly trend charts. Identical shape so they pair
                visually; small fixed height so they fit on one screen.
                Per Jacob: hide entire row when there's only 0-1 data
                points — a single dot per chart looks broken + adds no
                signal. Reappears as soon as the user has events
                spanning 2+ months. */}
            {monthlyTrend.length >= 2 && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
              <MonthlyTrendCard
                title="Revenue"
                color="#16a34a"
                data={monthlyTrend.map((m) => ({ month: m.month, value: m.revenue }))}
              />
              <MonthlyTrendCard
                title="Expenses"
                color="#dc2626"
                data={monthlyTrend.map((m) => ({ month: m.month, value: m.expenses }))}
              />
              <MonthlyTrendCard
                title="Net profit"
                color="#2563eb"
                data={monthlyTrend.map((m) => ({ month: m.month, value: m.net }))}
              />
            </div>
            )}

            {/* Best/worst markets — ranked tables. worstMarkets is empty
                when eventCount <= 5 (API suppresses the overlap with
                bestMarkets); just hide the section in that case. */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <MarketsTable title="Best markets" rows={bestMarkets} />
              {worstMarkets.length > 0 && (
                <MarketsTable title="Worst markets" rows={worstMarkets} />
              )}
            </div>
          </>
        )
        )}
      </div>
    </div>
  );
}

function KpiTile({
  label,
  value,
  valueClass = "text-2xl font-bold text-slate-900",
  subtitle,
}: {
  label: string;
  value: string;
  valueClass?: string;
  subtitle?: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 py-4 px-5">
      <p className="text-xs text-slate-500 uppercase tracking-wider m-0 mb-1">{label}</p>
      <p className={`${valueClass} m-0 leading-tight`}>{value}</p>
      {subtitle && <p className="text-xs text-slate-500 m-0 mt-1">{subtitle}</p>}
    </div>
  );
}

function MonthlyTrendCard({
  title,
  color,
  data,
}: {
  title: string;
  color: string;
  data: { month: string; value: number }[];
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 py-4 px-4">
      <p className="text-xs text-slate-500 uppercase tracking-wider m-0 mb-3">{title}</p>
      {data.length === 0 ? (
        <p className="text-sm text-slate-400 m-0 text-center py-8">No data yet</p>
      ) : (
        <ResponsiveContainer width="100%" height={140}>
          <LineChart
            data={data}
            margin={{ top: 5, right: 10, left: 0, bottom: 5 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
            <XAxis
              dataKey="month"
              tickFormatter={formatMonthShort}
              tick={{ fontSize: 11, fill: "#64748b" }}
              tickLine={false}
              axisLine={{ stroke: "#cbd5e1" }}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "#64748b" }}
              tickFormatter={(v: number) => `$${formatMoneyShort(v)}`}
              tickLine={false}
              axisLine={{ stroke: "#cbd5e1" }}
              width={50}
            />
            <Tooltip
              formatter={(v) => [`$${formatMoney(Number(v))}`, title]}
              labelFormatter={(label) => formatMonthShort(String(label))}
              contentStyle={{
                fontSize: 12,
                borderRadius: 6,
                border: "1px solid #e2e8f0",
              }}
            />
            <Line
              type="monotone"
              dataKey="value"
              stroke={color}
              strokeWidth={2}
              dot={{ r: 3, fill: color }}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function MarketsTable({ title, rows }: { title: string; rows: PerEvent[] }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 py-4 px-5">
      <h2 className="text-base font-bold text-slate-900 m-0 mb-3">{title}</h2>
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr>
            <th className="text-left text-xs text-slate-500 font-medium pb-2 border-b border-slate-100">
              Event
            </th>
            <th className="text-right text-xs text-slate-500 font-medium pb-2 border-b border-slate-100 w-28">
              Profit
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="py-2 border-b border-slate-50">
                <Link
                  href={`/events/${r.id}`}
                  className="text-blue-600 no-underline font-medium"
                >
                  {r.name}
                </Link>
                <p className="text-xs text-slate-500 m-0">
                  {r.startDate}
                  {r.venue ? ` · ${r.venue}` : ""}
                </p>
              </td>
              <td
                className={`py-2 text-right border-b border-slate-50 font-semibold whitespace-nowrap ${
                  r.profit >= 0 ? "text-slate-900" : "text-red-700"
                }`}
              >
                {r.profit < 0 ? "−" : ""}${formatMoney(Math.abs(r.profit))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
