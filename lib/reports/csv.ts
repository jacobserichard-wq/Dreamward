// lib/reports/csv.ts
//
// CSV ledger rendering — flat-ledger format with Section column per
// phase-7a-tax-reports-design.md §4.2. Consumed by:
//   - GET /api/reports/annual/csv (direct download)
//   - POST /api/reports/annual/send (base64-encoded as attachment)
//
// Cash-basis math + year-bound exclusive-end filters mirror
// aggregate.ts:annualSummary. Section totals computed inline as rows
// are built so the Summary section can lead the body.
// Unknown-classified amounts are deliberately omitted from the ledger
// (surfaced via annualSummary.summary.unknownAmount instead) — the
// CSV is a tax-handoff document where an uncategorized row invites
// misfiling.
//
// Sub-session 23 hygiene step 5 split this file out of lib/reports.ts.

import pool from "../db";
import { csvRow } from "../csv";
import type { Industry } from "../categories";
import { getInventoryValuation } from "../inventory/valuation";
import {
  buildClassifier,
  buildScheduleCMap,
  buildScheduleCSummary,
  buildIsCogsMap,
  csvBusinessSlug,
  isoYearBounds,
  type AppSettingRow,
  type SettingsRow,
} from "./aggregate";

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
  tax_amount: string | null;
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
      `SELECT id, vendor, amount, category, status, due_date, source, summary,
              tax_amount
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
  // Phase 7c: per-category Schedule C line lookup. Mirror of the
  // aggregate.ts pattern so each Expense row carries its line in the
  // ScheduleC Line column, and the ScheduleC Summary section at the
  // end of the body rolls up totals by line. Built once for the year.
  const scheduleCMap = buildScheduleCMap(industry);
  const isCogsMap = buildIsCogsMap(industry);
  // Accumulator of expense totals by category — feeds the ScheduleC
  // Summary section computed after row iteration. Keeps the CSV
  // self-contained (no need to call annualSummary just for the rollup).
  const expenseTotalsByCategory = new Map<string, { count: number; total: number }>();

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
  // Sales tax collected — netted out of income (liability, not revenue).
  let salesTaxCollected = 0;

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
      // Booth fees hardcoded to Schedule C line 20b (Rent or lease —
      // other business property). Matches the lib/categories.ts mapping
      // for "Booth & Show Fees". Hardcoded here because booth_fee lives
      // on the events table, not on a categorized processed_items row.
      expenseLines.push(
        csvRow([
          "Expense",
          e.start_date,
          "Booth fee",
          e.venue ?? e.name,
          "",
          "Booth Fees",
          "20b",
          formatMoney2(bf),
          `Event #${e.id}`,
        ])
      );
      // Roll booth fees into the by-category total for the ScheduleC
      // Summary section.
      const bk = expenseTotalsByCategory.get("Booth Fees") ?? { count: 0, total: 0 };
      bk.count += 1;
      bk.total += bf;
      expenseTotalsByCategory.set("Booth Fees", bk);
    }
    const miles = e.total_miles == null ? 0 : Number(e.total_miles);
    if (miles > 0) {
      totalMiles += miles;
      const cost = miles * irsRate;
      // Mileage hardcoded to Schedule C line 9 (Car and truck expenses).
      // IRS allows either the standard mileage rate OR actual costs;
      // Dreamward uses standard mileage rate. Either method lands on
      // line 9.
      mileageLines.push(
        csvRow([
          "Mileage",
          e.start_date,
          "Event miles",
          e.name,
          `${miles} mi × $${irsRate.toFixed(2)}`,
          "",
          "9",
          formatMoney2(cost),
          `Event #${e.id}`,
        ])
      );
    }
  }

  // processed_items → income or expense.
  for (const t of txnsResult.rows) {
    const amount = Number(t.amount);
    // Keep negative income rows (refunds — e.g. Shopify stores them as
    // negative "income") so the ledger nets out; drop only zero/NaN.
    // Negative expense rows are nonsense data and skipped below.
    if (!Number.isFinite(amount) || amount === 0) continue;
    const kind = classify(t.category);
    if (!t.due_date) continue;
    if (kind === "income") {
      // Gross receipts (Schedule C line 1) exclude sales tax collected —
      // it's a pass-through liability, tracked separately below.
      const tax = Number(t.tax_amount) || 0;
      const net = amount - tax;
      salesTaxCollected += tax;
      totalRevenue += net; // may be negative (a refund)
      // Income → Schedule C line 1 (Gross receipts or sales) by
      // convention (design §1 #7). All income types map to line 1
      // for sole-prop filings. A negative row is a refund — label it
      // so the ledger reconciles at a glance.
      incomeLines.push(
        csvRow([
          "Income",
          t.due_date,
          amount < 0 ? "Refund" : "Linked income",
          t.vendor ?? "",
          t.summary ?? "",
          t.category ?? "Uncategorized income",
          "1",
          formatMoney2(net),
          `Item #${t.id}`,
        ])
      );
    } else if (kind === "expense") {
      if (amount < 0) continue; // a negative expense is nonsense data
      totalExpenses += amount;
      const cat = t.category ?? "Uncategorized expense";
      const line = scheduleCMap.get(cat) ?? "";
      expenseLines.push(
        csvRow([
          "Expense",
          t.due_date,
          t.source === "manual" ? "Manual expense" : "Linked expense",
          t.vendor ?? "",
          t.summary ?? "",
          cat,
          line,
          formatMoney2(amount),
          `Item #${t.id}`,
        ])
      );
      // Roll into the by-category total for ScheduleC Summary.
      const bk = expenseTotalsByCategory.get(cat) ?? { count: 0, total: 0 };
      bk.count += 1;
      bk.total += amount;
      expenseTotalsByCategory.set(cat, bk);
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
        "",   // Category slot blank for AR payments
        "1",  // Income → Schedule C line 1 (Gross receipts)
        formatMoney2(amount),
        notesBits.join(" "),
      ])
    );
  }

  const mileageCost = totalMiles * irsRate;
  const netProfit = totalRevenue - boothFees - totalExpenses - mileageCost;

  // Phase 13: split COGS out of totalExpenses for the P&L
  // headline section. cogs + operatingExpenses sum back to
  // totalExpenses, so netProfit math is unchanged.
  let cogs = 0;
  for (const [category, v] of expenseTotalsByCategory) {
    if (isCogsMap.get(category) === true) cogs += v.total;
  }
  const operatingExpenses = totalExpenses - cogs;
  const grossProfit = totalRevenue - cogs;

  const header = csvRow([
    "Section",
    "Date",
    "Type",
    "Vendor/Customer",
    "Description",
    "Category",
    "Schedule C Line",
    "Amount",
    "Notes",
  ]);
  // Phase 13 Schedule-C-style P&L layout:
  //   Revenue → COGS → Gross Profit → Operating Expenses
  //          → Booth Fees → Mileage → Net Profit
  // COGS row appears only when there's a non-zero amount so single-
  // service businesses (no inventory) don't see an empty placeholder.
  const summarySection: string[] = [];
  summarySection.push(
    csvRow([
      "Summary",
      eoy,
      "Revenue total",
      "",
      "Annual revenue (cash basis)",
      "",
      "",
      formatMoney2(totalRevenue),
      "",
    ])
  );
  if (salesTaxCollected > 0) {
    summarySection.push(
      csvRow([
        "Summary",
        eoy,
        "Sales tax collected",
        "",
        "Pass-through liability — excluded from revenue; remit to your state",
        "",
        "",
        formatMoney2(salesTaxCollected),
        "",
      ])
    );
  }
  if (cogs > 0) {
    summarySection.push(
      csvRow([
        "Summary",
        eoy,
        "Cost of goods sold",
        "",
        "Materials + inventory consumed (cash basis)",
        "",
        "",
        formatMoney2(cogs),
        "",
      ])
    );
    summarySection.push(
      csvRow([
        "Summary",
        eoy,
        "Gross profit",
        "",
        "Revenue − COGS",
        "",
        "",
        formatMoney2(grossProfit),
        "",
      ])
    );
  }
  summarySection.push(
    csvRow([
      "Summary",
      eoy,
      cogs > 0 ? "Operating expenses" : "Expense total",
      "",
      cogs > 0
        ? "Annual operating expenses (excludes COGS, booth, mileage)"
        : "Annual expenses (cash basis)",
      "",
      "",
      formatMoney2(cogs > 0 ? operatingExpenses : totalExpenses),
      "",
    ])
  );
  summarySection.push(
    csvRow([
      "Summary",
      eoy,
      "Booth fees",
      "",
      "Annual booth fees",
      "",
      "",
      formatMoney2(boothFees),
      "",
    ])
  );
  summarySection.push(
    csvRow([
      "Summary",
      eoy,
      "Mileage deduction",
      "",
      `${totalMiles.toFixed(1)} mi × $${irsRate.toFixed(2)}`,
      "",
      "9",
      formatMoney2(mileageCost),
      "",
    ])
  );
  summarySection.push(
    csvRow([
      "Summary",
      eoy,
      "Net profit",
      "",
      cogs > 0
        ? "Gross Profit − Operating − Booth − Mileage"
        : "Revenue − Booth − Expenses − Mileage",
      "",
      "",
      formatMoney2(netProfit),
      "",
    ])
  );

  // Inventory valuation for Form 1125-A (beginning + ending
  // inventory). Computed from inventory_snapshots; live ending for
  // the current year.
  const inventoryValuation = await getInventoryValuation({
    clientId,
    year,
    currentYear: new Date().getUTCFullYear(),
  });
  if (inventoryValuation.beginning !== null) {
    summarySection.push(
      csvRow([
        "Summary",
        eoy,
        "Beginning inventory",
        "",
        "Form 1125-A — inventory value at start of year",
        "",
        "",
        formatMoney2(inventoryValuation.beginning),
        "",
      ])
    );
  }
  if (inventoryValuation.ending !== null) {
    summarySection.push(
      csvRow([
        "Summary",
        eoy,
        "Ending inventory",
        "",
        inventoryValuation.endingIsLive
          ? "Form 1125-A — current inventory value (live)"
          : "Form 1125-A — inventory value at year end",
        "",
        "",
        formatMoney2(inventoryValuation.ending),
        "",
      ])
    );
  }

  // Phase 7c ScheduleC Summary section. Roll up expense totals by IRS
  // Schedule C line via the shared buildScheduleCSummary helper. One
  // row per distinct line that appears in this year's expense data,
  // plus a Mileage row (line 9) since mileage is tracked separately
  // from expense categories above.
  const expenseArr = Array.from(expenseTotalsByCategory.entries()).map(
    ([category, v]) => ({
      category,
      count: v.count,
      total: v.total,
      taxDeductible: null,
      scheduleCLine: scheduleCMap.get(category) ?? null,
      isCogs: isCogsMap.get(category) === true,
    })
  );
  // Mileage (line 9) + booth fees (line 20b) live outside expense
  // categories; the shared helper injects them so this CSV matches the
  // on-screen + PDF Schedule C summary exactly.
  const scheduleCSummary = buildScheduleCSummary(expenseArr, {
    mileageCost,
    boothFees,
  });
  const scheduleCSection = scheduleCSummary.map((r) =>
    csvRow([
      "ScheduleC Summary",
      eoy,
      `Line ${r.line}`,
      "",
      r.description,
      r.categories.join("; "),
      r.line,
      formatMoney2(r.total),
      "",
    ])
  );

  const body =
    header +
    summarySection.join("") +
    incomeLines.join("") +
    expenseLines.join("") +
    mileageLines.join("") +
    scheduleCSection.join("");

  const filename = `dreamward-${csvBusinessSlug(businessName)}-${year}.csv`;
  return { body, filename };
}
