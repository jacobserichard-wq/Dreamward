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
import {
  buildClassifier,
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
