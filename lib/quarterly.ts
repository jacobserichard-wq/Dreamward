// lib/quarterly.ts
//
// Phase 7c commit 6: pure quarterly-estimate helpers for the IRS
// Form 1040-ES suggested-payment math. No I/O. Consumed by the
// annual aggregate (commit 7) so the /reports JSON response carries
// quarterly estimates for the front-end panel + PDF subsection.
//
// Math per phase-7c-design.md §4. Conservative defaults: 22% income
// + 14.13% effective self-employment = 36.13% total set-aside.
// User-overridable via client_settings.preferences.taxBracket.
//
// IMPORTANT: every consumer that surfaces these numbers must show a
// "verify with your CPA" disclaimer per design §1 #6. The math is a
// rough planning aid, not tax advice.

export interface QuarterlyInputs {
  /** YTD net profit from annualSummary.summary.netProfit. */
  ytdProfit: number;
  /** Income tax bracket assumption (percent, e.g., 22 for 22%). */
  incomePct: number;
  /** Self-employment tax assumption (percent, e.g., 14.13 effective). */
  sePct: number;
  /** Tax year (drives the projection denominator + deadline lookup). */
  year: number;
  /** Reference date (defaults to now). Injectable for testing. */
  today?: Date;
}

export interface QuarterlyEstimate {
  /** incomePct + sePct, the total effective set-aside percentage. */
  effectivePct: number;
  /** ytdProfit passed through, for the UI's "based on YTD" framing. */
  ytdProfit: number;
  /** ytdProfit × effectivePct / 100. The immediate "save now" amount. */
  ytdSetAside: number;
  /** 1-4 based on today's date within the year. 4 if year is in the past. */
  quartersElapsed: number;
  /** ytdProfit / quartersElapsed × 4. Linear projection of annual profit. */
  projectedAnnualProfit: number;
  /** projectedAnnualProfit × effectivePct / 100. */
  projectedAnnualTax: number;
  /** projectedAnnualTax / 4. The per-quarter suggested payment. */
  suggestedPerQuarter: number;
  /** ISO YYYY-MM-DD of the next 1040-ES deadline, or null for prior-year. */
  nextDeadline: string | null;
  /** All four quarterly deadlines for the year, ISO YYYY-MM-DD. */
  deadlines: { quarter: number; dueDate: string }[];
}

// IRS Form 1040-ES standard quarterly deadlines (US federal). Q4
// crosses the year boundary (covers Sep-Dec income, due Jan 15 of the
// FOLLOWING year). Non-calendar fiscal-year filers + farmers/fishermen
// have different deadlines — out of v1 scope (design §9).
function deadlinesFor(year: number): { quarter: number; dueDate: string }[] {
  return [
    { quarter: 1, dueDate: `${year}-04-15` },
    { quarter: 2, dueDate: `${year}-06-15` },
    { quarter: 3, dueDate: `${year}-09-15` },
    { quarter: 4, dueDate: `${year + 1}-01-15` },
  ];
}

// Quarters elapsed in the year as of `today`. Returns 4 for years
// already in the past (entire year is "elapsed"), 0 for future years
// (no quarters yet — caller guards against this).
function elapsedQuarters(year: number, today: Date): number {
  const currentYear = today.getUTCFullYear();
  if (year < currentYear) return 4;
  if (year > currentYear) return 0;
  // Current year — count quarters whose "covers through" date has passed.
  const m = today.getUTCMonth() + 1; // 1-12
  if (m <= 3) return 1; // Q1 in progress (Jan-Mar)
  if (m <= 5) return 2; // Q2 in progress (Apr-May; Q2 covers Apr-May
                        //   income with a Jun 15 deadline — by May
                        //   we're "in Q2")
  if (m <= 8) return 3; // Q3 in progress (Jun-Aug)
  return 4;             // Q4 in progress (Sep-Dec)
}

// Next deadline AFTER today. null if all four have passed (i.e. the
// Q4 Jan-15-of-next-year deadline is also past — extremely late
// filer).
function nextDeadlineAfter(
  year: number,
  today: Date,
  deadlines: { quarter: number; dueDate: string }[]
): string | null {
  const todayIso = `${today.getUTCFullYear()}-${String(today.getUTCMonth() + 1).padStart(2, "0")}-${String(today.getUTCDate()).padStart(2, "0")}`;
  for (const d of deadlines) {
    if (d.dueDate >= todayIso) return d.dueDate;
  }
  return null;
}

export function computeQuarterlyEstimate(opts: QuarterlyInputs): QuarterlyEstimate {
  const today = opts.today ?? new Date();
  const { ytdProfit, incomePct, sePct, year } = opts;
  const effectivePct = incomePct + sePct;

  const ytdSetAside = ytdProfit * (effectivePct / 100);
  const deadlines = deadlinesFor(year);

  let quartersElapsed = elapsedQuarters(year, today);
  // Guard: if year is future or current with 0 quarters elapsed, treat
  // as 1 to avoid divide-by-zero in the projection (UI will likely hide
  // this anyway for future years).
  if (quartersElapsed === 0) quartersElapsed = 1;

  const projectedAnnualProfit =
    year < today.getUTCFullYear()
      ? ytdProfit // prior year — YTD is the whole year
      : (ytdProfit / quartersElapsed) * 4;
  const projectedAnnualTax = projectedAnnualProfit * (effectivePct / 100);
  const suggestedPerQuarter = projectedAnnualTax / 4;

  const nextDeadline =
    year < today.getUTCFullYear() ? null : nextDeadlineAfter(year, today, deadlines);

  return {
    effectivePct,
    ytdProfit,
    ytdSetAside,
    quartersElapsed,
    projectedAnnualProfit,
    projectedAnnualTax,
    suggestedPerQuarter,
    nextDeadline,
    deadlines,
  };
}

// Default tax bracket assumption if no preferences override. 22% income
// + 14.13% self-employment effective = 36.13% total. Per design §1 #3.
// 22% is the federal bracket median for single-filer $44k-$100k taxable
// income (the FlowWork target customer band).
export const DEFAULT_TAX_BRACKET = {
  incomePct: 22,
  sePct: 14.13,
} as const;
