// lib/reports/aggregate.ts
//
// Annual P&L aggregation. Reads from events, processed_items, invoices,
// invoice_payments, client_settings, and app_settings. Returns the
// AnnualSummary shape consumed by /api/reports/annual,
// /api/reports/annual/csv, and /api/reports/annual/send.
//
// Cash-basis accounting per phase-7a-tax-reports-design.md §1 #4:
//   - Income recognized when received (invoice_payments.paid_at, not
//     invoices.invoice_date). Event manual revenue counted in the year
//     of events.start_date.
//   - Expense recognized when transaction date falls in the year
//     (processed_items.due_date, which is overloaded as the transaction
//     date for expense rows per Phase 6 audit §2.1).
//
// Sub-session 23 hygiene step 5 split this file out of lib/reports.ts
// (which had grown to ~890 lines after Phases 7a + 7b). Sibling files:
//   - lib/reports/csv.ts — CSV ledger renderer
//   - lib/reports/pdf.ts — PDF dispatcher
// Public surface re-exported from lib/reports.ts (barrel).

import pool from "../db";
import { getCategoriesForIndustry, type Industry } from "../categories";
import { computeQuarterlyEstimate, DEFAULT_TAX_BRACKET } from "../quarterly";
import { getInventoryValuation } from "../inventory/valuation";

// Synthetic category names for surfaces that don't have one. These appear
// in byCategory.income alongside real category names.
const CATEGORY_EVENT_REVENUE = "Event revenue (cash-day)";
const CATEGORY_AR_COLLECTED = "AR collected (invoices paid)";

const LEGACY_INCOME = new Set(["invoice", "ar_followup"]);
const LEGACY_EXPENSE = new Set(["expense"]);

export type CategoryKind = "income" | "expense" | "unknown";

export type RateSource = "config" | "current-year-only" | "fallback";

export interface AnnualSummary {
  year: number;
  generatedAt: string;
  basis: "cash";
  summary: {
    totalRevenue: number;
    /** Sum of ALL expense-category rows in byCategory.expense
     *  (INCLUDES COGS-tagged categories for back-compat with
     *  pre-Phase-13 consumers). Use `operatingExpenses` for the
     *  Schedule-C-style P&L denominator. */
    totalExpenses: number;
    boothFees: number;
    mileageCost: number;
    totalMiles: number;
    netProfit: number;
    unknownAmount: number;
    /** Phase 13: total of expense categories with isCogs=true.
     *  Subset of totalExpenses (not in addition to it). */
    cogs: number;
    /** Phase 13: totalRevenue minus cogs. The headline number on
     *  a Schedule-C-style P&L (above operating expenses). */
    grossProfit: number;
    /** Phase 13: totalExpenses minus cogs. The "operating
     *  expenses" line on a P&L (booth fees + mileage are still
     *  tracked separately on top of this). */
    operatingExpenses: number;
  };
  byCategory: {
    income: Array<{ category: string; count: number; total: number }>;
    expense: Array<{
      category: string;
      count: number;
      total: number;
      taxDeductible: boolean | null;
      // Phase 7c: IRS Schedule C Part II line number this category
      // maps to. null when the category has no scheduleC field set
      // (rare — categories with truly novel content; would land on
      // "27a" Other expenses on the actual return).
      scheduleCLine: string | null;
      // Phase 13: true when the category is tagged isCogs in
      // lib/categories.ts. Drives the P&L's separate Gross Profit
      // line on screen + in PDF/CSV exports.
      isCogs: boolean;
    }>;
  };
  // Phase 7c: roll up expense totals by Schedule C line. Sorted by total
  // descending. One row per distinct line that appears in expense data
  // for the year. Used by /reports' Schedule C summary panel + by the
  // PDF's Schedule C summary section.
  scheduleCSummary: Array<{
    line: string;
    description: string;
    total: number;
    categories: string[];
  }>;
  byMonth: Array<{
    month: string; // YYYY-MM
    revenue: number;
    expenses: number;
    netProfit: number;
  }>;
  mileage: {
    totalMiles: number;
    rate: number;
    rateSource: RateSource;
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
  // Phase 7c: quarterly estimated-tax helper output. null when math
  // doesn't apply (zero or negative YTD profit — nothing to set aside).
  // UI/PDF render the panel only when this is non-null.
  quarterlyEstimate: import("../quarterly").QuarterlyEstimate | null;
  // Inventory page feature: beginning + ending inventory value for
  // Form 1125-A (Cost of Goods Sold). From inventory_snapshots, with
  // a live fallback for the current year's ending.
  inventoryValuation: import("../inventory/valuation").InventoryValuation;
}

// pg row shapes exported for the sibling renderers (csv.ts uses
// SettingsRow + AppSettingRow with the same shape).
export interface SettingsRow {
  custom_categories: string[] | null;
  preferences: {
    custom_income_categories?: string[];
    // Phase 7c: optional tax bracket override for quarterly estimate
    // math. Falls back to DEFAULT_TAX_BRACKET (22% income + 14.13%
    // SE) when missing. Editable in /settings (commit 8).
    taxBracket?: {
      incomePct?: number;
      sePct?: number;
    };
  } | null;
}

export interface AppSettingRow {
  value: string;
}

interface EventRow {
  id: number;
  name: string;
  start_date: string;
  revenue: string | null;
  booth_fee: string;
  total_miles: string | null;
}

interface TxnRow {
  amount: string;
  category: string | null;
  source: string | null;
  due_date: string | null;
}

interface PaymentRow {
  amount: string;
  paid_at: string;
}

interface OutstandingRow {
  outstanding: string;
}

interface ArCountsRow {
  invoices_issued: string;
  invoices_paid: string;
}

// Lookup-based classifier matching app/api/profitability/route.ts.
// Priority: seeded > customs > legacy. Returns 'unknown' for categories
// we can't place; unknown amounts surface in the summary but are NOT
// folded into income/expense math (guessing the sign would be worse
// than silently omitting).
//
// Exported so the CSV renderer can reuse the same classifier when
// rendering row-level detail. Keeps the income/expense routing
// consistent between the JSON aggregate and the CSV ledger.
export function buildClassifier(
  industry: Industry,
  customIncome: string[],
  customExpense: string[]
): (category: string | null) => CategoryKind {
  const seeded = new Map<string, "income" | "expense">();
  for (const c of getCategoriesForIndustry(industry)) {
    seeded.set(c.name, c.type);
  }
  const incomeSet = new Set(
    customIncome.map((s) => s.trim()).filter((s) => s.length > 0)
  );
  const expenseSet = new Set(
    customExpense.map((s) => s.trim()).filter((s) => s.length > 0)
  );
  return (category): CategoryKind => {
    if (!category) return "unknown";
    const seededType = seeded.get(category);
    if (seededType) return seededType;
    if (incomeSet.has(category)) return "income";
    if (expenseSet.has(category)) return "expense";
    if (LEGACY_INCOME.has(category)) return "income";
    if (LEGACY_EXPENSE.has(category)) return "expense";
    return "unknown";
  };
}

// Phase 7c: IRS Schedule C Part II line descriptions, used to humanize
// the scheduleCSummary rollup. Lines per the 2025 Schedule C form;
// extended in the future if IRS renumbers (rare). Line 30 included
// separately since the home-office category targets it directly even
// though it's outside Part II.
export const SCHEDULE_C_DESCRIPTIONS: Record<string, string> = {
  "8": "Advertising",
  "9": "Car and truck expenses",
  "10": "Commissions and fees",
  "11": "Contract labor",
  "12": "Depletion",
  "13": "Depreciation and section 179 expense",
  "14": "Employee benefit programs",
  "15": "Insurance (other than health)",
  "16a": "Mortgage interest",
  "16b": "Interest (other)",
  "17": "Legal and professional services",
  "18": "Office expense",
  "19": "Pension and profit-sharing plans",
  "20a": "Rent or lease — vehicles, machinery, equipment",
  "20b": "Rent or lease — other business property",
  "21": "Repairs and maintenance",
  "22": "Supplies",
  "23": "Taxes and licenses",
  "24a": "Travel",
  "24b": "Deductible meals",
  "25": "Utilities",
  "26": "Wages",
  "27a": "Other expenses",
  "30": "Expenses for business use of home",
};

// Phase 7c: Map of category name → scheduleC line for the requested
// industry. Mirror of buildTaxDeductibleMap. Null when the category
// doesn't carry a scheduleC field — surfaced as null in the response
// rather than silently bucketed to "27a" so the UI/PDF can render an
// "unspecified" indicator.
export function buildScheduleCMap(industry: Industry): Map<string, string | null> {
  const m = new Map<string, string | null>();
  for (const c of getCategoriesForIndustry(industry)) {
    if (c.type !== "expense") continue;
    m.set(c.name, c.scheduleC ?? null);
  }
  return m;
}

// Phase 7c: roll up an array of expense category totals by Schedule C
// line. Each input row contributes its total to the line's running sum
// and appends its category name to the line's `categories` list.
// Output sorted by total descending. Unmapped categories (scheduleCLine
// === null) are deliberately omitted from the summary — they show on
// the on-screen expense list with an "unspecified" badge but don't
// contribute to a Schedule C line that can't be filed against.
export function buildScheduleCSummary(
  expense: Array<{
    category: string;
    count: number;
    total: number;
    taxDeductible: boolean | null;
    scheduleCLine: string | null;
  }>
): AnnualSummary["scheduleCSummary"] {
  const buckets = new Map<string, { total: number; categories: string[] }>();
  for (const row of expense) {
    if (!row.scheduleCLine) continue;
    const b = buckets.get(row.scheduleCLine) ?? { total: 0, categories: [] };
    b.total += row.total;
    b.categories.push(row.category);
    buckets.set(row.scheduleCLine, b);
  }
  return Array.from(buckets.entries())
    .map(([line, b]) => ({
      line,
      description: SCHEDULE_C_DESCRIPTIONS[line] ?? `Line ${line}`,
      total: b.total,
      categories: b.categories,
    }))
    .sort((a, b) => b.total - a.total);
}

// Phase 13: Map of category name → isCogs flag for the requested
// industry. Mirror of buildTaxDeductibleMap / buildScheduleCMap.
// Defaults to false when the underlying category doesn't set the
// field. Custom categories (added via /settings) are not in this
// map and naturally default to false in the report consumer when
// .get() returns undefined.
export function buildIsCogsMap(industry: Industry): Map<string, boolean> {
  const m = new Map<string, boolean>();
  for (const c of getCategoriesForIndustry(industry)) {
    if (c.type !== "expense") continue;
    m.set(c.name, c.isCogs === true);
  }
  return m;
}

// Map of category name → taxDeductible flag for the requested industry.
// Used to annotate byCategory.expense rows. taxDeductible is omitted
// from many categories in lib/categories.ts (timing/Section-179
// caveats) — those map to null rather than false so the UI can render
// an explicit "unspecified" indicator.
function buildTaxDeductibleMap(industry: Industry): Map<string, boolean | null> {
  const m = new Map<string, boolean | null>();
  for (const c of getCategoriesForIndustry(industry)) {
    if (c.type !== "expense") continue;
    m.set(c.name, c.taxDeductible ?? null);
  }
  return m;
}

export function isoYearBounds(year: number): {
  start: string;
  end: string;
  eoy: string;
} {
  // Exclusive-end pattern dodges leap-day edge cases.
  return {
    start: `${year}-01-01`,
    end: `${year + 1}-01-01`,
    eoy: `${year}-12-31`,
  };
}

function monthKey(date: string): string {
  // Input: YYYY-MM-DD (per the pg DATE-parser override from
  // sub-session 19).
  return date.slice(0, 7);
}

function emptyMonthlyBuckets(year: number) {
  const buckets: Map<string, { revenue: number; expenses: number }> = new Map();
  for (let m = 1; m <= 12; m++) {
    buckets.set(`${year}-${String(m).padStart(2, "0")}`, {
      revenue: 0,
      expenses: 0,
    });
  }
  return buckets;
}

/**
 * Slug a business name for download filenames.
 *   "Acme Bakery" → "acme-bakery"
 *   null/empty → "flowwork"
 *
 * Shared between csv.ts (CSV filename) and pdf.ts (PDF filename).
 * Kept in aggregate.ts to avoid a csv ↔ pdf import edge.
 *
 * (Name retained from its origin in the CSV path for compat with
 * existing imports via the barrel.)
 */
export function csvBusinessSlug(name: string | null | undefined): string {
  if (!name) return "flowwork";
  const s = String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return s || "flowwork";
}

export async function annualSummary(opts: {
  clientId: number;
  year: number;
  industry: Industry;
}): Promise<AnnualSummary> {
  const { clientId, year, industry } = opts;
  const { start, end, eoy } = isoYearBounds(year);
  const currentYear = new Date().getUTCFullYear();

  // Seven parallel reads. Six are client-scoped, app_settings is global.
  const [
    eventsResult,
    txnsResult,
    paymentsResult,
    outstandingResult,
    arCountsResult,
    settingsResult,
    appSettingResult,
  ] = await Promise.all([
    pool.query<EventRow>(
      `SELECT id, name, start_date, revenue, booth_fee,
              CASE
                WHEN round_trip_miles IS NULL THEN NULL
                WHEN returns_home_nightly THEN
                  round_trip_miles * ((end_date - start_date) + 1)
                ELSE round_trip_miles
              END AS total_miles
         FROM events
        WHERE client_id = $1
          AND start_date >= $2 AND start_date < $3
        ORDER BY start_date ASC, id ASC`,
      [clientId, start, end]
    ),
    pool.query<TxnRow>(
      `SELECT amount, category, source, due_date
         FROM processed_items
        WHERE client_id = $1
          AND due_date >= $2 AND due_date < $3`,
      [clientId, start, end]
    ),
    pool.query<PaymentRow>(
      `SELECT amount, paid_at
         FROM invoice_payments
        WHERE client_id = $1
          AND paid_at >= $2 AND paid_at < $3`,
      [clientId, start, end]
    ),
    // Outstanding-at-year-end: invoices issued on or before YYYY-12-31,
    // not written off, with amount_total minus payments received by EOY.
    // No >= start-of-year bound — outstanding at EOY includes invoices
    // from ANY prior year that are still unpaid by EOY. Only two
    // parameters ($1 = client_id, $2 = eoy); an unused `start` would
    // crash node-postgres' parameter-type inference
    // (`pg_analyze_and_rewrite_varparams` — surfaced during the
    // sub-session 21 smoke test).
    pool.query<OutstandingRow>(
      `SELECT COALESCE(SUM(
                i.amount_total
                - COALESCE(
                    (SELECT SUM(ip.amount)
                       FROM invoice_payments ip
                      WHERE ip.invoice_id = i.id
                        AND ip.paid_at <= $2),
                    0
                  )
              ), 0) AS outstanding
         FROM invoices i
        WHERE i.client_id = $1
          AND i.invoice_date <= $2
          AND i.status <> 'written_off'
          AND (
            i.amount_total
            - COALESCE(
                (SELECT SUM(ip.amount)
                   FROM invoice_payments ip
                  WHERE ip.invoice_id = i.id
                    AND ip.paid_at <= $2),
                0
              )
          ) > 0`,
      [clientId, eoy]
    ),
    pool.query<ArCountsRow>(
      `SELECT
         (SELECT COUNT(*)::text
            FROM invoices
           WHERE client_id = $1
             AND invoice_date >= $2 AND invoice_date < $3
         ) AS invoices_issued,
         (SELECT COUNT(DISTINCT invoice_id)::text
            FROM invoice_payments
           WHERE client_id = $1
             AND paid_at >= $2 AND paid_at < $3
         ) AS invoices_paid`,
      [clientId, start, end]
    ),
    pool.query<SettingsRow>(
      `SELECT custom_categories, preferences
         FROM client_settings
        WHERE client_id = $1`,
      [clientId]
    ),
    pool.query<AppSettingRow>(
      `SELECT value FROM app_settings WHERE key = 'irs_mileage_rate'`
    ),
  ]);

  // Settings + classifier setup.
  const settings = settingsResult.rows[0] ?? null;
  const customExpense: string[] = Array.isArray(settings?.custom_categories)
    ? (settings!.custom_categories as string[])
    : [];
  const prefIncome = settings?.preferences?.custom_income_categories;
  const customIncome: string[] = Array.isArray(prefIncome) ? prefIncome : [];
  const classify = buildClassifier(industry, customIncome, customExpense);
  const deductibleMap = buildTaxDeductibleMap(industry);
  const scheduleCMap = buildScheduleCMap(industry);
  const isCogsMap = buildIsCogsMap(industry);

  // IRS rate + rateSource per phase-7a-tax-reports-design.md §1 #5.
  const irsRaw = appSettingResult.rows[0]?.value;
  const parsedRate = irsRaw == null ? NaN : Number(irsRaw);
  const hasConfiguredRate = Number.isFinite(parsedRate) && parsedRate > 0;
  const irsMileageRate = hasConfiguredRate ? parsedRate : 0.7;
  const rateSource: RateSource = !hasConfiguredRate
    ? "fallback"
    : year === currentYear
      ? "config"
      : "current-year-only";

  // Accumulators.
  let boothFees = 0;
  let totalMiles = 0;
  let unknownAmount = 0;
  const monthly = emptyMonthlyBuckets(year);
  const byCategoryIncome = new Map<string, { count: number; total: number }>();
  const byCategoryExpense = new Map<string, { count: number; total: number }>();
  const perEventMileage: AnnualSummary["mileage"]["perEvent"] = [];

  // Events: booth fees, manual cash-day revenue, mileage.
  for (const e of eventsResult.rows) {
    boothFees += Number(e.booth_fee);
    const manualRevenue = e.revenue == null ? 0 : Number(e.revenue);
    if (manualRevenue > 0) {
      const inc = byCategoryIncome.get(CATEGORY_EVENT_REVENUE) ?? {
        count: 0,
        total: 0,
      };
      inc.count += 1;
      inc.total += manualRevenue;
      byCategoryIncome.set(CATEGORY_EVENT_REVENUE, inc);
      monthly.get(monthKey(e.start_date))!.revenue += manualRevenue;
    }
    const eventMiles = e.total_miles == null ? 0 : Number(e.total_miles);
    if (eventMiles > 0) {
      totalMiles += eventMiles;
      perEventMileage.push({
        eventId: e.id,
        name: e.name,
        startDate: e.start_date,
        miles: eventMiles,
        cost: eventMiles * irsMileageRate,
      });
    }
  }

  // processed_items: linked income, linked + manual expenses.
  for (const t of txnsResult.rows) {
    const amount = Number(t.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const kind = classify(t.category);
    if (!t.due_date) continue;
    const mKey = monthKey(t.due_date);
    const monthBucket = monthly.get(mKey);
    if (!monthBucket) continue;
    if (kind === "income") {
      const cat = t.category ?? "Uncategorized income";
      const bucket = byCategoryIncome.get(cat) ?? { count: 0, total: 0 };
      bucket.count += 1;
      bucket.total += amount;
      byCategoryIncome.set(cat, bucket);
      monthBucket.revenue += amount;
    } else if (kind === "expense") {
      const cat = t.category ?? "Uncategorized expense";
      const bucket = byCategoryExpense.get(cat) ?? { count: 0, total: 0 };
      bucket.count += 1;
      bucket.total += amount;
      byCategoryExpense.set(cat, bucket);
      monthBucket.expenses += amount;
    } else {
      unknownAmount += amount;
    }
  }

  // invoice_payments: AR collected counts as income in the month paid.
  let arCollected = 0;
  for (const p of paymentsResult.rows) {
    const amount = Number(p.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    arCollected += amount;
    const monthBucket = monthly.get(monthKey(p.paid_at));
    if (monthBucket) monthBucket.revenue += amount;
    const bucket = byCategoryIncome.get(CATEGORY_AR_COLLECTED) ?? {
      count: 0,
      total: 0,
    };
    bucket.count += 1;
    bucket.total += amount;
    byCategoryIncome.set(CATEGORY_AR_COLLECTED, bucket);
  }

  // Summary roll-ups.
  let totalRevenue = 0;
  for (const v of byCategoryIncome.values()) totalRevenue += v.total;
  let totalExpenses = 0;
  let cogs = 0;
  for (const [categoryName, v] of byCategoryExpense) {
    totalExpenses += v.total;
    if (isCogsMap.get(categoryName) === true) {
      cogs += v.total;
    }
  }
  const operatingExpenses = totalExpenses - cogs;
  const grossProfit = totalRevenue - cogs;
  const mileageCost = totalMiles * irsMileageRate;
  // Net profit math is unchanged — booth fees + mileage are still
  // tracked separately on top of operating expenses, and totalExpenses
  // still bundles COGS in for back-compat with downstream consumers
  // that read it directly.
  const netProfit = totalRevenue - boothFees - totalExpenses - mileageCost;

  // byMonth in chronological order with computed netProfit.
  const byMonth: AnnualSummary["byMonth"] = [];
  for (let m = 1; m <= 12; m++) {
    const k = `${year}-${String(m).padStart(2, "0")}`;
    const b = monthly.get(k)!;
    byMonth.push({
      month: k,
      revenue: b.revenue,
      expenses: b.expenses,
      netProfit: b.revenue - b.expenses,
    });
  }

  // byCategory arrays, sorted by total descending.
  const incomeArr = Array.from(byCategoryIncome.entries())
    .map(([category, v]) => ({ category, count: v.count, total: v.total }))
    .sort((a, b) => b.total - a.total);
  const expenseArr = Array.from(byCategoryExpense.entries())
    .map(([category, v]) => ({
      category,
      count: v.count,
      total: v.total,
      taxDeductible: deductibleMap.get(category) ?? null,
      scheduleCLine: scheduleCMap.get(category) ?? null,
      isCogs: isCogsMap.get(category) === true,
    }))
    .sort((a, b) => b.total - a.total);
  const scheduleCSummary = buildScheduleCSummary(expenseArr);

  const outstandingAsOfYearEnd = Number(
    outstandingResult.rows[0]?.outstanding ?? 0
  );
  const arCounts = arCountsResult.rows[0];
  const invoicesIssued = Number(arCounts?.invoices_issued ?? 0);
  const invoicesPaid = Number(arCounts?.invoices_paid ?? 0);

  // Inventory valuation for Form 1125-A (beginning + ending
  // inventory). Reads inventory_snapshots; live fallback for the
  // current year's ending.
  const inventoryValuation = await getInventoryValuation({
    clientId,
    year,
    currentYear,
  });

  return {
    year,
    generatedAt: new Date().toISOString(),
    basis: "cash",
    summary: {
      totalRevenue,
      totalExpenses,
      boothFees,
      mileageCost,
      totalMiles,
      netProfit,
      unknownAmount,
      cogs,
      grossProfit,
      operatingExpenses,
    },
    byCategory: {
      income: incomeArr,
      expense: expenseArr,
    },
    scheduleCSummary,
    // Phase 7c: quarterly estimate. Skip math entirely when YTD profit
    // is zero or negative — no set-aside obligation; UI renders nothing.
    quarterlyEstimate:
      netProfit > 0
        ? computeQuarterlyEstimate({
            ytdProfit: netProfit,
            incomePct:
              settings?.preferences?.taxBracket?.incomePct ??
              DEFAULT_TAX_BRACKET.incomePct,
            sePct:
              settings?.preferences?.taxBracket?.sePct ??
              DEFAULT_TAX_BRACKET.sePct,
            year,
          })
        : null,
    byMonth,
    mileage: {
      totalMiles,
      rate: irsMileageRate,
      rateSource,
      deduction: mileageCost,
      perEvent: perEventMileage,
    },
    ar: {
      invoicesIssued,
      invoicesPaid,
      amountCollected: arCollected,
      outstandingAsOfYearEnd,
    },
    inventoryValuation,
  };
}
