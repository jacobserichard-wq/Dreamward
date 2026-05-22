// lib/reports.ts
//
// Phase 7a (Tax Reports + CSV + CPA Handoff). Designed in
// session-notes/phase-7a-tax-reports-design.md §3.
//
// Pure server-side annual aggregation. Reads from events, processed_items,
// invoices, invoice_payments, client_settings, and app_settings. Returns
// the AnnualSummary shape consumed by /api/reports/annual,
// /api/reports/annual/csv, and /api/reports/annual/send.
//
// Cash-basis accounting (design §1 #4):
//   - Income recognized when received (invoice_payments.paid_at, not
//     invoices.invoice_date). Event manual revenue counted in the year
//     of events.start_date.
//   - Expense recognized when transaction date falls in the year
//     (processed_items.due_date, which is overloaded as the transaction
//     date for expense rows per Phase 6 audit §2.1).
//
// The classifier is duplicated from app/api/profitability/route.ts. Same
// priority order: seeded > customs > legacy. Worth factoring out to
// lib/classifier.ts in a future cleanup; left local here so commit 1 is
// self-contained.

import pool from "./db";
import { getCategoriesForIndustry, type Industry } from "./categories";
import { csvRow } from "./csv";

// Synthetic category names for surfaces that don't have one. These appear
// in byCategory.income alongside real category names.
const CATEGORY_EVENT_REVENUE = "Event revenue (cash-day)";
const CATEGORY_AR_COLLECTED = "AR collected (invoices paid)";

const LEGACY_INCOME = new Set(["invoice", "ar_followup"]);
const LEGACY_EXPENSE = new Set(["expense"]);

type CategoryKind = "income" | "expense" | "unknown";

export type RateSource = "config" | "current-year-only" | "fallback";

export interface AnnualSummary {
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

interface SettingsRow {
  custom_categories: string[] | null;
  preferences: {
    custom_income_categories?: string[];
  } | null;
}

interface AppSettingRow {
  value: string;
}

// Lookup-based classifier matching app/api/profitability/route.ts.
// Priority: seeded > customs > legacy. Returns 'unknown' for
// categories we can't place; unknown amounts surface in the summary
// but are NOT folded into income/expense math (guessing the sign
// would be worse than silently omitting).
//
// Exported so the CSV route (commit 4) can reuse the same classifier
// when rendering row-level detail. Keeps the income/expense routing
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

// Map of category name → taxDeductible flag for the requested industry.
// Used to annotate byCategory.expense rows. taxDeductible is omitted from
// many categories in lib/categories.ts (timing/Section-179 caveats) —
// those map to null rather than false so the UI can render an explicit
// "unspecified" indicator.
function buildTaxDeductibleMap(industry: Industry): Map<string, boolean | null> {
  const m = new Map<string, boolean | null>();
  for (const c of getCategoriesForIndustry(industry)) {
    if (c.type !== "expense") continue;
    m.set(c.name, c.taxDeductible ?? null);
  }
  return m;
}

function isoYearBounds(year: number): { start: string; end: string; eoy: string } {
  // Exclusive-end pattern dodges leap-day edge cases.
  return {
    start: `${year}-01-01`,
    end: `${year + 1}-01-01`,
    eoy: `${year}-12-31`,
  };
}

function monthKey(date: string): string {
  // Input: YYYY-MM-DD (per the pg DATE-parser override from sub-session 19).
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

export async function annualSummary(opts: {
  clientId: number;
  year: number;
  industry: Industry;
}): Promise<AnnualSummary> {
  const { clientId, year, industry } = opts;
  const { start, end, eoy } = isoYearBounds(year);
  const currentYear = new Date().getUTCFullYear();

  // Six parallel reads. Five are client-scoped, app_settings is global.
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
    // SQL-side aggregation per design §1 #8.
    //
    // No >= start-of-year bound — outstanding at EOY includes invoices
    // from ANY prior year that are still unpaid by EOY. Only two
    // parameters here ($1 = client_id, $2 = eoy); passing an unused
    // `start` would crash node-postgres' parameter-type inference
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
    // AR counts: invoices issued in the year, and (distinct) invoices
    // paid (in full or partially) during the year.
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

  // IRS rate + rateSource per design §1 #5.
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
    if (!monthBucket) continue; // out of bounds, shouldn't happen given SQL filter
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
  for (const v of byCategoryExpense.values()) totalExpenses += v.total;
  const mileageCost = totalMiles * irsMileageRate;
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
      // Note: monthly netProfit doesn't subtract per-month booth fees or
      // mileage (both are event-driven and harder to attribute cleanly
      // by month). Annual summary still shows the full deduction in
      // summary.mileageCost / summary.boothFees. This is acceptable for
      // the charting use case in commit 6.
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
    }))
    .sort((a, b) => b.total - a.total);

  const outstandingAsOfYearEnd = Number(
    outstandingResult.rows[0]?.outstanding ?? 0
  );
  const arCounts = arCountsResult.rows[0];
  const invoicesIssued = Number(arCounts?.invoices_issued ?? 0);
  const invoicesPaid = Number(arCounts?.invoices_paid ?? 0);

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
    },
    byCategory: {
      income: incomeArr,
      expense: expenseArr,
    },
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
  };
}

// ---------------------------------------------------------------------
// CSV rendering — Phase 7a commit 8 refactor (was inlined in
// app/api/reports/annual/csv/route.ts as of commit 4).
//
// Returns the full CSV body as a string + a download filename.
// Consumed by both:
//   - GET /api/reports/annual/csv — direct download
//   - POST /api/reports/annual/send — base64-encoded as attachment
//
// Cash-basis math + year-bound exclusive-end filters mirror
// annualSummary above. Section totals are computed inline as rows are
// built so the Summary section can lead the body. Unknown-classified
// amounts are deliberately omitted from the ledger (surfaced via
// annualSummary.summary.unknownAmount instead) — the CSV is a tax-
// handoff document where an uncategorized row invites misfiling.
// ---------------------------------------------------------------------

interface CsvEventRow {
  id: number;
  name: string;
  start_date: string;
  end_date: string;
  venue: string | null;
  address: string | null;
  revenue: string | null;
  booth_fee: string;
  total_miles: string | null;
}

interface CsvTxnRow {
  id: number;
  vendor: string | null;
  amount: string;
  category: string | null;
  status: string | null;
  due_date: string | null;
  source: string | null;
  summary: string | null;
}

interface CsvPaymentJoinRow {
  payment_id: number;
  amount: string;
  paid_at: string;
  method: string | null;
  reference: string | null;
  invoice_number: string | null;
  customer_name: string;
}

function formatMoney2(n: number): string {
  return n.toFixed(2);
}

/**
 * Slug a business name for the CSV download filename.
 * "Acme Bakery" → "acme-bakery"; null/empty → "flowwork".
 */
export function csvBusinessSlug(name: string | null | undefined): string {
  if (!name) return "flowwork";
  const s = String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return s || "flowwork";
}

export async function renderAnnualCsvBody(opts: {
  clientId: number;
  year: number;
  industry: Industry;
  businessName: string | null;
}): Promise<{ body: string; filename: string }> {
  const { clientId, year, industry, businessName } = opts;
  const { start, end, eoy } = isoYearBounds(year);

  const [
    eventsResult,
    txnsResult,
    paymentsResult,
    settingsResult,
    appSettingResult,
  ] = await Promise.all([
    pool.query<CsvEventRow>(
      `SELECT id, name, start_date, end_date, venue, address,
              revenue, booth_fee,
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
    pool.query<CsvTxnRow>(
      `SELECT id, vendor, amount, category, status, due_date, source, summary
         FROM processed_items
        WHERE client_id = $1
          AND due_date >= $2 AND due_date < $3
        ORDER BY due_date ASC, id ASC`,
      [clientId, start, end]
    ),
    pool.query<CsvPaymentJoinRow>(
      `SELECT ip.id AS payment_id, ip.amount, ip.paid_at, ip.method, ip.reference,
              i.invoice_number, i.customer_name
         FROM invoice_payments ip
         JOIN invoices i ON i.id = ip.invoice_id
        WHERE ip.client_id = $1
          AND ip.paid_at >= $2 AND ip.paid_at < $3
        ORDER BY ip.paid_at ASC, ip.id ASC`,
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

  const settings = settingsResult.rows[0] ?? null;
  const customExpense: string[] = Array.isArray(settings?.custom_categories)
    ? (settings!.custom_categories as string[])
    : [];
  const prefIncome = settings?.preferences?.custom_income_categories;
  const customIncome: string[] = Array.isArray(prefIncome) ? prefIncome : [];
  const classify = buildClassifier(industry, customIncome, customExpense);

  const irsRaw = appSettingResult.rows[0]?.value;
  const parsedRate = irsRaw == null ? NaN : Number(irsRaw);
  const irsRate =
    Number.isFinite(parsedRate) && parsedRate > 0 ? parsedRate : 0.7;

  const incomeLines: string[] = [];
  const expenseLines: string[] = [];
  const mileageLines: string[] = [];
  let totalRevenue = 0;
  let totalExpenses = 0;
  let boothFees = 0;
  let totalMiles = 0;

  // Events → cash-day revenue, booth fee, mileage.
  for (const e of eventsResult.rows) {
    const manualRevenue = e.revenue == null ? 0 : Number(e.revenue);
    if (manualRevenue > 0) {
      totalRevenue += manualRevenue;
      incomeLines.push(
        csvRow([
          "Income",
          e.start_date,
          "Event revenue (cash-day)",
          e.name,
          `Day-of receipts at ${e.venue ?? "event"}`,
          "",
          formatMoney2(manualRevenue),
          `Event #${e.id}`,
        ])
      );
    }
    const bf = Number(e.booth_fee);
    if (bf > 0) {
      boothFees += bf;
      expenseLines.push(
        csvRow([
          "Expense",
          e.start_date,
          "Booth fee",
          e.venue ?? e.name,
          "",
          "Booth Fees",
          formatMoney2(bf),
          `Event #${e.id}`,
        ])
      );
    }
    const miles = e.total_miles == null ? 0 : Number(e.total_miles);
    if (miles > 0) {
      totalMiles += miles;
      const cost = miles * irsRate;
      mileageLines.push(
        csvRow([
          "Mileage",
          e.start_date,
          "Event miles",
          e.name,
          `${miles} mi × $${irsRate.toFixed(2)}`,
          "",
          formatMoney2(cost),
          `Event #${e.id}`,
        ])
      );
    }
  }

  // processed_items → income or expense.
  for (const t of txnsResult.rows) {
    const amount = Number(t.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    const kind = classify(t.category);
    if (!t.due_date) continue;
    if (kind === "income") {
      totalRevenue += amount;
      incomeLines.push(
        csvRow([
          "Income",
          t.due_date,
          "Linked income",
          t.vendor ?? "",
          t.summary ?? "",
          t.category ?? "Uncategorized income",
          formatMoney2(amount),
          `Item #${t.id}`,
        ])
      );
    } else if (kind === "expense") {
      totalExpenses += amount;
      expenseLines.push(
        csvRow([
          "Expense",
          t.due_date,
          t.source === "manual" ? "Manual expense" : "Linked expense",
          t.vendor ?? "",
          t.summary ?? "",
          t.category ?? "Uncategorized expense",
          formatMoney2(amount),
          `Item #${t.id}`,
        ])
      );
    }
    // unknown-kind amounts deliberately omitted (see header comment).
  }

  // invoice_payments → income.
  for (const p of paymentsResult.rows) {
    const amount = Number(p.amount);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    totalRevenue += amount;
    const notesBits: string[] = [];
    if (p.method) notesBits.push(p.method);
    if (p.reference) notesBits.push(`#${p.reference}`);
    const desc = p.invoice_number
      ? `Invoice #${p.invoice_number}`
      : "Invoice payment";
    incomeLines.push(
      csvRow([
        "Income",
        p.paid_at,
        "AR payment received",
        p.customer_name,
        desc,
        "",
        formatMoney2(amount),
        notesBits.join(" "),
      ])
    );
  }

  const mileageCost = totalMiles * irsRate;
  const netProfit = totalRevenue - boothFees - totalExpenses - mileageCost;

  const header = csvRow([
    "Section",
    "Date",
    "Type",
    "Vendor/Customer",
    "Description",
    "Category",
    "Amount",
    "Notes",
  ]);
  const summarySection = [
    csvRow([
      "Summary",
      eoy,
      "Revenue total",
      "",
      "Annual revenue (cash basis)",
      "",
      formatMoney2(totalRevenue),
      "",
    ]),
    csvRow([
      "Summary",
      eoy,
      "Booth fees",
      "",
      "Annual booth fees",
      "",
      formatMoney2(boothFees),
      "",
    ]),
    csvRow([
      "Summary",
      eoy,
      "Expense total",
      "",
      "Annual expenses (cash basis)",
      "",
      formatMoney2(totalExpenses),
      "",
    ]),
    csvRow([
      "Summary",
      eoy,
      "Mileage deduction",
      "",
      `${totalMiles.toFixed(1)} mi × $${irsRate.toFixed(2)}`,
      "",
      formatMoney2(mileageCost),
      "",
    ]),
    csvRow([
      "Summary",
      eoy,
      "Net profit",
      "",
      "Revenue − Booth − Expenses − Mileage",
      "",
      formatMoney2(netProfit),
      "",
    ]),
  ];

  const body =
    header +
    summarySection.join("") +
    incomeLines.join("") +
    expenseLines.join("") +
    mileageLines.join("");

  const filename = `flowwork-${csvBusinessSlug(businessName)}-${year}.csv`;
  return { body, filename };
}
