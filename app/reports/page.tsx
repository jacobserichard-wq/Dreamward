"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import PageHeader from "../components/PageHeader";
import ErrorBanner from "../components/ErrorBanner";
import ReportSummaryCards from "../components/ReportSummaryCards";
import ReportByCategoryTable from "../components/ReportByCategoryTable";
import ReportMonthlyChart from "../components/ReportMonthlyChart";
import ReportArSnapshot from "../components/ReportArSnapshot";

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
  };
  byCategory: {
    income: Array<{ category: string; count: number; total: number }>;
    expense: Array<{
      category: string;
      count: number;
      total: number;
      taxDeductible: boolean | null;
    }>;
  };
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
  const [year, setYear] = useState<number>(CURRENT_YEAR);
  const [summary, setSummary] = useState<AnnualSummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [reportLoading, setReportLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
        if (clientData.plan === "pro") {
          await loadReport(CURRENT_YEAR);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't load page");
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [router, loadReport]);

  const handleYearChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newYear = Number(e.target.value);
    setYear(newYear);
    loadReport(newYear);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 font-sans">
        <div className="max-w-[1100px] mx-auto py-8 px-4 sm:px-6">
          <p className="text-center p-[60px] text-slate-500">
            Loading reports...
          </p>
        </div>
      </div>
    );
  }

  if (plan !== "pro") {
    return (
      <div className="min-h-screen bg-slate-50 font-sans">
        <div className="max-w-[1100px] mx-auto py-8 px-4 sm:px-6">
          <PageHeader
            backHref="/"
            backLabel="FlowWork"
            title="Tax Reports"
            subtitle="Calendar-year summaries for your CPA"
          />
          <div className="bg-amber-50 border border-amber-200 rounded-xl py-8 px-6 text-center">
            <p className="text-base font-medium text-amber-900 m-0 mb-2">
              {"\u{1F512}"} Tax Reports are a Pro feature
            </p>
            <p className="text-sm text-amber-800 m-0 mb-5 leading-relaxed">
              Upgrade to Pro ($89/mo) to generate annual summaries, export
              CSVs for your CPA, and send polished handoff emails — all in
              one click.
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
      <div className="max-w-[1100px] mx-auto py-8 px-4 sm:px-6">
        <PageHeader
          backHref="/"
          backLabel="FlowWork"
          title="Tax Reports"
          subtitle="Calendar-year summaries for your CPA"
        />

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

          <div className="flex items-center gap-2">
            <a
              href={`/api/reports/annual/csv?year=${year}`}
              className="py-2 px-4 rounded-lg border border-slate-300 bg-white text-slate-700 text-sm font-medium no-underline cursor-pointer hover:bg-slate-50"
              // Browser will treat as download due to Content-Disposition.
            >
              {"\u{1F4E5}"} Download CSV
            </a>
            {/* Send-to-CPA button arrives in commit 8 alongside the
                /api/reports/annual/send route. */}
          </div>
        </div>

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

            <ReportArSnapshot
              year={summary.year}
              invoicesIssued={summary.ar.invoicesIssued}
              invoicesPaid={summary.ar.invoicesPaid}
              amountCollected={summary.ar.amountCollected}
              outstandingAsOfYearEnd={summary.ar.outstandingAsOfYearEnd}
            />

            <div className="text-xs text-slate-500 mt-8 pb-4 border-t border-slate-200 pt-3">
              <p className="m-0 mb-1">
                <strong>Cash-basis report.</strong> Income counted when
                received; expenses counted when paid. Generated{" "}
                {formatGeneratedAt(summary.generatedAt)} from your FlowWork
                records.
              </p>
              <p className="m-0 text-slate-400">
                Auto-generated from your records. Verify against source
                documents before filing.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
