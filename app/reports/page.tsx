"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import PageHeader from "../components/PageHeader";
import AppHeader from "../components/AppHeader";
import ErrorBanner from "../components/ErrorBanner";
import ReportSummaryCards from "../components/ReportSummaryCards";
import ReportByCategoryTable from "../components/ReportByCategoryTable";
import ReportMonthlyChart from "../components/ReportMonthlyChart";
import ReportArSnapshot from "../components/ReportArSnapshot";
import ScheduleCSummaryPanel from "../components/ScheduleCSummaryPanel";
import QuarterlyEstimatesPanel from "../components/QuarterlyEstimatesPanel";
import ReportFilters, {
  resolvePeriod,
  type ResolvedPeriod,
} from "../components/reports/ReportFilters";
import PnlReport from "../components/reports/PnlReport";
import ChannelMixReport from "../components/reports/ChannelMixReport";
import ProductProfitabilityReport from "../components/reports/ProductProfitabilityReport";
import SalesTrendReport from "../components/reports/SalesTrendReport";
import SectionTip from "../components/SectionTip";
import { isPayingTier } from "@/lib/plans";

// Phase 7a (Tax Reports + CSV + CPA Handoff) commit 6 of 9, per
// session-notes/phase-7a-tax-reports-design.md §7.
//
// /reports page. Pro-only (matches /api/reports/annual route guard).
// Year picker → fetches /api/reports/annual?year=X → renders summary
// cards + monthly chart + by-category lists + AR snapshot.
//
// Send-to-CPA button is intentionally NOT in this commit — commit 8
// (POST /api/reports/annual/send) ships it alongside the email send
// route. Download CSV button does ship here since the CSV endpoint
// already exists (commit 4).

// Mirror of AnnualSummary from lib/reports.ts. Re-declared here so the
// page doesn't pull a server module into the client bundle. NUMERIC
// values are already cast to JS numbers by the JSON serialization.
interface AnnualSummaryResponse {
  year: number;
  generatedAt: string;
  basis: "cash";
  summary: {
    totalRevenue: number;
    totalExpenses: number;
    boothFees: number;
    mileageCost: number;
    totalMiles: number;
    netProfit: number;
    unknownAmount: number;
    // Phase 13: split COGS out from total expenses + surface
    // gross profit as the headline mid-line on the P&L.
    cogs: number;
    grossProfit: number;
    operatingExpenses: number;
  };
  byCategory: {
    income: Array<{ category: string; count: number; total: number }>;
    expense: Array<{
      category: string;
      count: number;
      total: number;
      taxDeductible: boolean | null;
      // Phase 7c commit 9: Schedule C line surfaces in the category
      // table (badge) and the dedicated summary panel below.
      scheduleCLine: string | null;
      // Phase 13: true when this category is tagged isCogs.
      isCogs: boolean;
    }>;
  };
  // Phase 7c commit 9: Schedule C rollup — built by
  // lib/reports/aggregate.ts.buildScheduleCSummary from the byCategory
  // expense rows. Empty array when nothing maps.
  scheduleCSummary: Array<{
    line: string;
    description: string;
    total: number;
    categories: string[];
  }>;
  // Phase 7c commit 9: quarterly estimate. Null when net profit ≤ 0
  // (loss year — no tax owed). Math from lib/quarterly.ts.
  quarterlyEstimate: {
    effectivePct: number;
    ytdProfit: number;
    ytdSetAside: number;
    quartersElapsed: number;
    projectedAnnualProfit: number;
    projectedAnnualTax: number;
    suggestedPerQuarter: number;
    nextDeadline: string | null;
    deadlines: { quarter: number; dueDate: string }[];
  } | null;
  byMonth: Array<{
    month: string;
    revenue: number;
    expenses: number;
    netProfit: number;
  }>;
  mileage: {
    totalMiles: number;
    rate: number;
    rateSource: "config" | "current-year-only" | "fallback";
    deduction: number;
    perEvent: Array<{
      eventId: number;
      name: string;
      startDate: string;
      miles: number;
      cost: number;
    }>;
  };
  ar: {
    invoicesIssued: number;
    invoicesPaid: number;
    amountCollected: number;
    outstandingAsOfYearEnd: number;
  };
  inventoryValuation: {
    beginning: number | null;
    ending: number | null;
    endingIsLive: boolean;
  };
}

const CURRENT_YEAR = new Date().getUTCFullYear();
// Year picker range: current + prior 3 (per design §3 default;
// older years still queryable via direct URL).
const YEAR_OPTIONS = [
  CURRENT_YEAR,
  CURRENT_YEAR - 1,
  CURRENT_YEAR - 2,
  CURRENT_YEAR - 3,
];

// Reports hub registry. "Tax pack" is the existing calendar-year report;
// the Business reports are built one per commit (ready flips to true as
// each lands). Drives the left-sidebar picker.
type ReportId =
  | "tax"
  | "pnl"
  | "channel-mix"
  | "products"
  | "trend"
  | "markets"
  | "ar"
  | "refunds"
  | "inventory";

const REPORT_GROUPS: {
  group: string;
  items: { id: ReportId; label: string; ready: boolean }[];
}[] = [
  { group: "Tax", items: [{ id: "tax", label: "Tax pack", ready: true }] },
  {
    group: "Business",
    items: [
      { id: "pnl", label: "P&L by channel", ready: true },
      { id: "channel-mix", label: "Channel mix", ready: true },
      { id: "products", label: "Product profitability", ready: true },
      { id: "trend", label: "Sales trend & growth", ready: true },
      { id: "markets", label: "Market performance", ready: false },
      { id: "ar", label: "Receivables aging", ready: false },
      { id: "refunds", label: "Refunds & returns", ready: false },
      { id: "inventory", label: "Inventory & COGS", ready: false },
    ],
  },
];

function formatGeneratedAt(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function ReportsPage() {
  const router = useRouter();
  const [plan, setPlan] = useState<string | null>(null);
  const [selectedReport, setSelectedReport] = useState<ReportId>("tax");
  // Shared business-report filters (period + channel) + the channel list
  // for the dropdown.
  const [period, setPeriod] = useState<ResolvedPeriod>(() =>
    resolvePeriod("ytd")
  );
  const [reportChannel, setReportChannel] = useState<string>("all");
  const [reportChannels, setReportChannels] = useState<
    { id: string; label: string }[]
  >([]);
  const [year, setYear] = useState<number>(CURRENT_YEAR);
  const [summary, setSummary] = useState<AnnualSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [reportLoading, setReportLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Phase 7a commit 8: cpaEmailSet drives the Send-to-CPA button's
  // enabled state. Fetched from /api/settings.preferences.cpa.email
  // alongside the initial client load.
  const [cpaEmailSet, setCpaEmailSet] = useState<boolean>(false);
  const [sending, setSending] = useState(false);
  const [sentMsg, setSentMsg] = useState<string | null>(null);

  const loadReport = useCallback(
    async (y: number) => {
      setReportLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/reports/annual?year=${y}`);
        if (res.status === 401) {
          router.replace("/signin?callbackUrl=/reports");
          return;
        }
        if (res.status === 403) {
          // Plan-gate — handled separately by the page-level upgrade prompt
          // shown after loadClient finishes. Just clear the summary.
          setSummary(null);
          return;
        }
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError(body.error || `HTTP ${res.status}`);
          return;
        }
        const data = (await res.json()) as AnnualSummaryResponse;
        setSummary(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't load report");
      } finally {
        setReportLoading(false);
      }
    },
    [router]
  );

  // Initial load: identify plan, then fetch the current-year report
  // (only if Pro — non-Pro renders the upgrade prompt instead).
  useEffect(() => {
    async function init() {
      try {
        const clientRes = await fetch("/api/client");
        if (clientRes.status === 401) {
          router.replace("/signin?callbackUrl=/reports");
          return;
        }
        if (!clientRes.ok) {
          setError(`Couldn't load account: HTTP ${clientRes.status}`);
          return;
        }
        const clientData = await clientRes.json();
        setPlan(clientData.plan);
        if (isPayingTier(clientData.plan)) {
          // Fire the settings fetch + the initial-year report in
          // parallel. Settings determines the Send-to-CPA button
          // enabled state; the report fills the page body.
          const [, settingsRes] = await Promise.all([
            loadReport(CURRENT_YEAR),
            fetch("/api/settings"),
          ]);
          if (settingsRes.ok) {
            const settingsData = await settingsRes.json().catch(() => null);
            const prefs =
              settingsData?.settings?.preferences &&
              typeof settingsData.settings.preferences === "object"
                ? (settingsData.settings.preferences as Record<string, unknown>)
                : {};
            const rawCpa = prefs.cpa;
            const cpaEmail =
              rawCpa &&
              typeof rawCpa === "object" &&
              typeof (rawCpa as Record<string, unknown>).email === "string"
                ? ((rawCpa as Record<string, unknown>).email as string).trim()
                : "";
            setCpaEmailSet(cpaEmail.length > 0);
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't load page");
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [router, loadReport]);

  // Channel list for the business-report filter dropdown (channels with
  // any data this year).
  useEffect(() => {
    if (!isPayingTier(plan)) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/profitability/channels?year=${CURRENT_YEAR}`
        );
        if (!res.ok) return;
        const d = (await res.json()) as {
          channels?: {
            id: string;
            label: string;
            revenue: number;
            directExpenses: number;
          }[];
        };
        if (cancelled) return;
        setReportChannels(
          (d.channels ?? [])
            .filter((c) => c.revenue !== 0 || c.directExpenses !== 0)
            .map((c) => ({ id: c.id, label: c.label }))
        );
      } catch {
        /* non-fatal — dropdown just stays "All channels" */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [plan]);

  const handleYearChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newYear = Number(e.target.value);
    setYear(newYear);
    loadReport(newYear);
  };

  const handleSendToCpa = async () => {
    setSending(true);
    setError(null);
    setSentMsg(null);
    try {
      const res = await fetch(`/api/reports/annual/send?year=${year}`, {
        method: "POST",
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        sentTo?: string;
        year?: number;
      };
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setSentMsg(`Sent ${data.year} summary to ${data.sentTo}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send report");
    } finally {
      setSending(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 font-sans">
        <div className="max-w-[1280px] mx-auto py-8 px-4 sm:px-6">
          <p className="text-center p-[60px] text-slate-500">
            Loading reports...
          </p>
        </div>
      </div>
    );
  }

  if (!isPayingTier(plan)) {
    return (
      <div className="min-h-screen bg-slate-50 font-sans">
        <div className="max-w-[1280px] mx-auto py-8 px-4 sm:px-6">
          <PageHeader
            title="Tax Reports"
            subtitle="Calendar-year summaries for your CPA"
          />
          <div className="bg-amber-50 border border-amber-200 rounded-xl py-8 px-6 text-center">
            <p className="text-base font-medium text-amber-900 m-0 mb-2">
              {"\u{1F512}"} Active subscription required
            </p>
            <p className="text-sm text-amber-800 m-0 mb-5 leading-relaxed">
              Start your subscription to generate annual summaries, export
              CSVs for your CPA, and send polished handoff emails — all in
              one click. Every paid tier includes tax reports.
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

  return (
    <div className="min-h-screen bg-slate-50 font-sans">
      <AppHeader />
      <div className="max-w-[1280px] mx-auto py-8 px-4 sm:px-6">
        <PageHeader title="Reports" subtitle="Tax + business reports" />

        <div className="flex flex-col lg:flex-row gap-6 mt-2">
          {/* Sidebar — report picker. Business reports flip to active as
              each one ships. */}
          <aside className="lg:w-56 flex-shrink-0">
            {REPORT_GROUPS.map((grp) => (
              <div key={grp.group} className="mb-4">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 m-0 mb-1.5 px-2">
                  {grp.group}
                </p>
                <div className="flex flex-col gap-0.5">
                  {grp.items.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      disabled={!r.ready}
                      onClick={() => r.ready && setSelectedReport(r.id)}
                      className={`text-left text-sm py-1.5 px-2.5 rounded-lg border-0 transition-colors ${
                        selectedReport === r.id
                          ? "bg-slate-900 text-white font-semibold cursor-pointer"
                          : r.ready
                            ? "bg-transparent text-slate-700 hover:bg-slate-100 cursor-pointer"
                            : "bg-transparent text-slate-300 cursor-not-allowed"
                      }`}
                    >
                      {r.label}
                      {!r.ready && (
                        <span className="text-[10px] text-slate-300 ml-1">
                          soon
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </aside>

          {/* Selected report */}
          <div className="flex-1 min-w-0">
            {selectedReport === "tax" && (
              <>
        <SectionTip id="reports" title="One-click handoff to your CPA">
          Pick a year and Dreamward builds a Schedule-C-formatted P&amp;L —
          Revenue → COGS → Gross Profit → Operating Expenses → Net. Use{" "}
          <strong>Download PDF/CSV</strong> or email it straight to your
          accountant (save their address in Settings). Numbers come only
          from data Dreamward can see, so enter any out-of-band expenses
          before tax season. Set your tax bracket in Settings to get
          quarterly estimate suggestions too.
        </SectionTip>

        {error && (
          <ErrorBanner message={error} onDismiss={() => setError(null)} />
        )}

        {/* Year picker + action bar */}
        <div className="flex flex-wrap justify-between items-center gap-3 mb-6">
          <div className="flex items-center gap-2">
            <label
              htmlFor="reports-year"
              className="text-sm font-medium text-slate-700"
            >
              Year
            </label>
            <select
              id="reports-year"
              value={year}
              onChange={handleYearChange}
              disabled={reportLoading}
              className="py-2 px-3 text-sm border border-slate-300 rounded-lg bg-white focus:ring-2 focus:ring-blue-500/20 focus:outline-none focus:border-blue-500 disabled:bg-slate-100"
            >
              {YEAR_OPTIONS.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <a
              href={`/api/reports/annual/csv?year=${year}`}
              className="py-2 px-4 rounded-lg border border-slate-300 bg-white text-slate-700 text-sm font-medium no-underline cursor-pointer hover:bg-slate-50"
              // Browser will treat as download due to Content-Disposition.
            >
              {"\u{1F4E5}"} Download CSV
            </a>
            <a
              href={`/api/reports/annual/pdf?year=${year}`}
              className="py-2 px-4 rounded-lg border border-slate-300 bg-white text-slate-700 text-sm font-medium no-underline cursor-pointer hover:bg-slate-50"
              // Same Content-Disposition: attachment pattern; browser saves
              // instead of inline-renders. PDF route shipped in Phase 7b
              // commit 4.
            >
              {"\u{1F4C4}"} Download PDF
            </a>
            <button
              type="button"
              onClick={handleSendToCpa}
              disabled={!cpaEmailSet || sending || reportLoading || !summary}
              title={
                !cpaEmailSet
                  ? "Set your CPA email in Settings first"
                  : `Email the ${year} CSV to your CPA`
              }
              className={`py-2 px-4 rounded-lg border-0 text-white text-sm font-semibold ${
                cpaEmailSet && !sending && !reportLoading && summary
                  ? "bg-blue-500 cursor-pointer"
                  : "bg-slate-300 cursor-not-allowed"
              }`}
            >
              {sending ? "Sending..." : `${"\u{1F4E7}"} Send to CPA`}
            </button>
            {!cpaEmailSet && (
              <Link
                href="/settings"
                className="text-xs text-blue-600 hover:underline"
              >
                Set CPA email →
              </Link>
            )}
          </div>
        </div>

        {sentMsg && (
          <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 text-sm rounded-lg px-4 py-2 mb-4 flex justify-between items-center">
            <span>{sentMsg}</span>
            <button
              type="button"
              onClick={() => setSentMsg(null)}
              className="text-emerald-600 hover:underline cursor-pointer"
            >
              Dismiss
            </button>
          </div>
        )}

        {reportLoading && !summary && (
          <p className="text-center p-[40px] text-slate-500">
            Loading {year} report...
          </p>
        )}

        {summary && (
          <>
            <ReportSummaryCards
              revenue={summary.summary.totalRevenue}
              expenses={summary.summary.totalExpenses}
              boothFees={summary.summary.boothFees}
              mileageCost={summary.summary.mileageCost}
              totalMiles={summary.summary.totalMiles}
              netProfit={summary.summary.netProfit}
              cogs={summary.summary.cogs}
              grossProfit={summary.summary.grossProfit}
              operatingExpenses={summary.summary.operatingExpenses}
            />

            {/* Phase 7c commit 9: quarterly estimates panel. Renders an
                explanatory message when estimate is null (loss year). */}
            <QuarterlyEstimatesPanel
              year={summary.year}
              netProfit={summary.summary.netProfit}
              estimate={summary.quarterlyEstimate}
            />

            {/* Mileage rate honesty notice — design §1 #5. Only renders
                when the rate isn't certain to be year-correct. */}
            {summary.mileage.rateSource === "current-year-only" && (
              <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded-lg p-3 mb-6 text-sm">
                <strong>Note:</strong> This report uses the current IRS
                mileage rate (${summary.mileage.rate.toFixed(2)}/mi). For
                prior-year filings, verify against the historical rate
                published by the IRS for {summary.year}.
              </div>
            )}
            {summary.mileage.rateSource === "fallback" && (
              <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-3 mb-6 text-sm">
                <strong>Configuration warning:</strong> The IRS mileage rate
                isn't set in app_settings. Falling back to $0.70/mi.
                Configure it in Settings before using this for filing.
              </div>
            )}

            {summary.summary.unknownAmount > 0 && (
              <div className="bg-slate-50 border border-slate-200 text-slate-700 rounded-lg p-3 mb-6 text-sm">
                <strong>Heads up:</strong> $
                {summary.summary.unknownAmount.toLocaleString("en-US", {
                  minimumFractionDigits: 2,
                })}{" "}
                in transactions had categories the classifier couldn't
                place — they're excluded from the totals. Review the
                affected items in the Dashboard.
              </div>
            )}

            <ReportMonthlyChart data={summary.byMonth} />

            <ReportByCategoryTable
              income={summary.byCategory.income}
              expense={summary.byCategory.expense}
            />

            {/* Phase 7c commit 9: Schedule C rollup. Renders nothing
                when scheduleCSummary is empty (no categories mapped). */}
            <ScheduleCSummaryPanel
              year={summary.year}
              rows={summary.scheduleCSummary}
            />

            <ReportArSnapshot
              year={summary.year}
              invoicesIssued={summary.ar.invoicesIssued}
              invoicesPaid={summary.ar.invoicesPaid}
              amountCollected={summary.ar.amountCollected}
              outstandingAsOfYearEnd={summary.ar.outstandingAsOfYearEnd}
            />

            {/* Inventory valuation — Form 1125-A beginning + ending
                inventory. Only shown when we have at least an ending
                value (a snapshot or live). */}
            {summary.inventoryValuation.ending !== null && (
              <div className="bg-white border border-slate-200 rounded-xl p-5 mt-6">
                <h3 className="text-base font-bold text-slate-900 m-0 mb-1">
                  Inventory (Form 1125-A)
                </h3>
                <p className="text-xs text-slate-500 m-0 mb-4">
                  Stock value for your Cost of Goods Sold. Beginning + ending
                  inventory help your CPA reconcile COGS on Schedule C.
                </p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-500 m-0 mb-1">
                      Beginning inventory
                    </p>
                    <p className="text-xl font-bold text-slate-900 m-0 tabular-nums">
                      {summary.inventoryValuation.beginning !== null
                        ? `$${summary.inventoryValuation.beginning.toLocaleString(
                            "en-US",
                            { minimumFractionDigits: 2, maximumFractionDigits: 2 }
                          )}`
                        : "—"}
                    </p>
                    {summary.inventoryValuation.beginning === null && (
                      <p className="text-[11px] text-slate-400 m-0 mt-0.5">
                        No prior-year snapshot yet
                      </p>
                    )}
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-wide text-slate-500 m-0 mb-1">
                      Ending inventory
                    </p>
                    <p className="text-xl font-bold text-slate-900 m-0 tabular-nums">
                      {`$${summary.inventoryValuation.ending.toLocaleString(
                        "en-US",
                        { minimumFractionDigits: 2, maximumFractionDigits: 2 }
                      )}`}
                    </p>
                    {summary.inventoryValuation.endingIsLive && (
                      <p className="text-[11px] text-slate-400 m-0 mt-0.5">
                        Current value (live)
                      </p>
                    )}
                  </div>
                </div>
                <p className="text-[11px] text-slate-400 m-0 mt-3">
                  Not tax advice — verify with your CPA. Inventory accounting
                  rules vary by business.
                </p>
              </div>
            )}

            <div className="text-xs text-slate-500 mt-8 pb-4 border-t border-slate-200 pt-3">
              <p className="m-0 mb-1">
                <strong>Cash-basis report.</strong> Income counted when
                received; expenses counted when paid. Generated{" "}
                {formatGeneratedAt(summary.generatedAt)} from your Dreamward
                records.
              </p>
              <p className="m-0 text-slate-400">
                Auto-generated from your records. Verify against source
                documents before filing.
              </p>
            </div>
          </>
        )}
              </>
            )}

            {selectedReport === "pnl" && (
              <>
                <ReportFilters
                  period={period}
                  onPeriodChange={setPeriod}
                  channel={reportChannel}
                  onChannelChange={setReportChannel}
                  channels={reportChannels}
                  showChannel
                />
                <PnlReport
                  from={period.from}
                  to={period.to}
                  periodLabel={period.label}
                  channel={reportChannel}
                  channelLabel={
                    reportChannels.find((c) => c.id === reportChannel)?.label ??
                    reportChannel
                  }
                />
              </>
            )}

            {selectedReport === "channel-mix" && (
              <>
                <ReportFilters
                  period={period}
                  onPeriodChange={setPeriod}
                  channel={reportChannel}
                  onChannelChange={setReportChannel}
                  channels={reportChannels}
                  showChannel={false}
                />
                <ChannelMixReport
                  from={period.from}
                  to={period.to}
                  periodLabel={period.label}
                />
              </>
            )}

            {selectedReport === "products" && (
              <>
                <ReportFilters
                  period={period}
                  onPeriodChange={setPeriod}
                  channel={reportChannel}
                  onChannelChange={setReportChannel}
                  channels={reportChannels}
                  showChannel
                />
                <ProductProfitabilityReport
                  from={period.from}
                  to={period.to}
                  periodLabel={period.label}
                  channel={reportChannel}
                  channelLabel={
                    reportChannels.find((c) => c.id === reportChannel)?.label ??
                    reportChannel
                  }
                />
              </>
            )}

            {selectedReport === "trend" && (
              <>
                <ReportFilters
                  period={period}
                  onPeriodChange={setPeriod}
                  channel={reportChannel}
                  onChannelChange={setReportChannel}
                  channels={reportChannels}
                  showChannel={false}
                />
                <SalesTrendReport
                  from={period.from}
                  to={period.to}
                  periodLabel={period.label}
                />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
