// Quarterly estimates panel — IRS Form 1040-ES suggested-payment
// math, displayed under the year picker on /reports.
//
// Math comes from lib/quarterly.ts (pure helper) wired through
// lib/reports/aggregate.ts as AnnualSummary.quarterlyEstimate.
// The value is null when net profit ≤ 0 (no tax owed, nothing to
// estimate) — this panel renders an explanatory message instead
// of hiding (the user still wants to know the report ran).
//
// Per Phase 7c design §1 #6: surfaces of this math MUST carry a
// "not tax advice — verify with your CPA" disclaimer. The math is
// a rough planning aid based on linear projection of YTD profit.

interface QuarterlyEstimate {
  effectivePct: number;
  ytdProfit: number;
  ytdSetAside: number;
  quartersElapsed: number;
  projectedAnnualProfit: number;
  projectedAnnualTax: number;
  suggestedPerQuarter: number;
  nextDeadline: string | null;
  deadlines: { quarter: number; dueDate: string }[];
}

interface QuarterlyEstimatesPanelProps {
  year: number;
  netProfit: number;
  estimate: QuarterlyEstimate | null;
}

function formatUsd(n: number): string {
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

// "2026-04-15" -> "April 15, 2026". Hand-built rather than
// toLocaleDateString to avoid time-zone shift (the ISO string is
// pure date, no time).
function formatDeadline(iso: string): string {
  const [y, m, d] = iso.split("-");
  const monthNames = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  return `${monthNames[Number(m) - 1]} ${Number(d)}, ${y}`;
}

export default function QuarterlyEstimatesPanel({
  year,
  netProfit,
  estimate,
}: QuarterlyEstimatesPanelProps) {
  // No estimate produced → most likely net profit ≤ 0 (a loss year).
  // Surface that explicitly so the user doesn't think the panel broke.
  if (!estimate) {
    return (
      <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6">
        <h3 className="text-base font-semibold text-slate-900 m-0 mb-2">
          Quarterly tax estimates
        </h3>
        <p className="text-sm text-slate-500 m-0">
          {netProfit <= 0
            ? `${year} shows a net loss so far — no estimated tax suggested. (Losses may carry forward; ask your CPA.)`
            : `No estimate available for ${year}.`}
        </p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6">
      <div className="mb-4">
        <h3 className="text-base font-semibold text-slate-900 m-0 mb-1">
          Quarterly tax estimates
        </h3>
        <p className="text-xs text-slate-500 m-0">
          Linear projection of your {year} YTD profit, using a{" "}
          <strong>{estimate.effectivePct.toFixed(2)}%</strong> effective
          set-aside.{" "}
          <a
            href="/settings"
            className="text-blue-600 hover:underline"
          >
            Adjust bracket →
          </a>
        </p>
      </div>

      {/* Headline stats — three cards mirroring the AR snapshot pattern. */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500 mb-1">
            YTD set-aside
          </div>
          <div className="text-lg font-semibold text-slate-900">
            {formatUsd(estimate.ytdSetAside)}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">
            on {formatUsd(estimate.ytdProfit)} profit
          </div>
        </div>
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500 mb-1">
            Projected annual tax
          </div>
          <div className="text-lg font-semibold text-slate-900">
            {formatUsd(estimate.projectedAnnualTax)}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">
            on {formatUsd(estimate.projectedAnnualProfit)} projected profit
          </div>
        </div>
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500 mb-1">
            Per quarter
          </div>
          <div className="text-lg font-semibold text-slate-900">
            {formatUsd(estimate.suggestedPerQuarter)}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">suggested payment</div>
        </div>
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-slate-500 mb-1">
            Next deadline
          </div>
          <div className="text-lg font-semibold text-slate-900">
            {estimate.nextDeadline
              ? formatDeadline(estimate.nextDeadline)
              : "All passed"}
          </div>
          <div className="text-xs text-slate-500 mt-0.5">
            Form 1040-ES (federal)
          </div>
        </div>
      </div>

      {/* All four deadlines for the year. Mark the next one. */}
      <div className="border-t border-slate-200 pt-3">
        <div className="text-xs font-medium uppercase tracking-wide text-slate-500 mb-2">
          {year} deadlines
        </div>
        <div className="flex flex-wrap gap-2">
          {estimate.deadlines.map((d) => {
            const isNext = d.dueDate === estimate.nextDeadline;
            const cls = isNext
              ? "bg-blue-50 text-blue-700 border-blue-200"
              : "bg-slate-50 text-slate-600 border-slate-200";
            return (
              <span
                key={d.quarter}
                className={`inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs border ${cls}`}
              >
                <span className="font-semibold">Q{d.quarter}</span>
                <span className="tabular-nums">{formatDeadline(d.dueDate)}</span>
                {isNext && (
                  <span className="text-[10px] font-medium uppercase">
                    next
                  </span>
                )}
              </span>
            );
          })}
        </div>
      </div>

      <p className="text-[11px] text-slate-400 mt-3 mb-0">
        <strong>Not tax advice.</strong> Estimates project linearly from
        YTD profit at the configured bracket; they don&apos;t account for
        deductions, credits, prior-year safe harbors, state tax, or
        seasonality. Verify with your CPA before making payments.
      </p>
    </div>
  );
}
