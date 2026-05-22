import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getSessionClient } from "@/lib/getClient";
import { buildClassifier } from "@/lib/reports";
import { csvRow } from "@/lib/csv";
import type { Industry } from "@/lib/categories";

// Phase 7a (Tax Reports + CSV + CPA Handoff) commit 4 of 9, per
// session-notes/phase-7a-tax-reports-design.md §5 + audit §4.2.
//
// GET /api/reports/annual/csv?year=YYYY — flat-ledger CSV download.
//
// Body shape (single CSV, four sections via the "Section" column):
//   Section, Date, Type, Vendor/Customer, Description, Category, Amount, Notes
//   Summary  rows: 4 lines (revenue/expenses/mileage/net profit totals)
//   Income   rows: events.revenue cash-day + invoice_payments + income txns
//   Expense  rows: booth_fees + expense txns
//   Mileage  rows: per-event miles × IRS rate
//
// Auth + plan gate match the JSON endpoint (strict Pro-only).
// Section totals are computed inline as rows are iterated — no
// duplicate roundtrip to lib/reports.annualSummary.
//
// Cash basis per design §1 #4. Year-bounded via exclusive-end filter.
// CRLF terminators in csvRow per the lib/csv RFC 4180 convention.

interface EventRow {
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

interface TxnRow {
  id: number;
  vendor: string | null;
  amount: string;
  category: string | null;
  status: string | null;
  due_date: string | null;
  source: string | null;
  summary: string | null;
}

interface PaymentJoinRow {
  payment_id: number;
  amount: string;
  paid_at: string;
  method: string | null;
  reference: string | null;
  invoice_number: string | null;
  customer_name: string;
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

function isPlanAllowed(plan: string | null | undefined): boolean {
  return plan === "pro";
}

function parseYear(raw: string | null, defaultYear: number): number | null {
  if (raw == null || raw === "") return defaultYear;
  const n = Number(raw);
  if (!Number.isInteger(n)) return null;
  if (n < 2020) return null;
  if (n > defaultYear) return null;
  return n;
}

// Build a slug for the download filename: lowercase, alphanumeric-dashed,
// fallback "flowwork" if empty / null. Examples:
//   "Acme Bakery" → "acme-bakery"
//   "Smith & Co., LLC" → "smith-co-llc"
function buildSlug(name: string | null | undefined): string {
  if (!name) return "flowwork";
  const s = String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return s || "flowwork";
}

function formatMoney(n: number): string {
  return n.toFixed(2);
}

export async function GET(req: NextRequest) {
  try {
    const client = await getSessionClient();
    if (!client) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    if (!isPlanAllowed(client.plan)) {
      return NextResponse.json(
        { error: "Tax reports are a Pro feature" },
        { status: 403 }
      );
    }

    const currentYear = new Date().getUTCFullYear();
    const url = new URL(req.url);
    const year = parseYear(url.searchParams.get("year"), currentYear);
    if (year === null) {
      return NextResponse.json(
        {
          error: `year must be an integer between 2020 and ${currentYear}`,
        },
        { status: 400 }
      );
    }

    const start = `${year}-01-01`;
    const end = `${year + 1}-01-01`;
    const industry = (client.industry ?? "other") as Industry;

    // Five parallel reads. The events query mirrors lib/reports.ts's
    // SQL but also fetches end_date / venue / address for the CSV
    // row descriptions. processed_items adds vendor + status +
    // summary columns for ledger rendering. invoice_payments JOINs
    // its parent invoice for customer_name + invoice_number.
    const [
      eventsResult,
      txnsResult,
      paymentsResult,
      settingsResult,
      appSettingResult,
    ] = await Promise.all([
      pool.query<EventRow>(
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
        [client.id, start, end]
      ),
      pool.query<TxnRow>(
        `SELECT id, vendor, amount, category, status, due_date, source, summary
           FROM processed_items
          WHERE client_id = $1
            AND due_date >= $2 AND due_date < $3
          ORDER BY due_date ASC, id ASC`,
        [client.id, start, end]
      ),
      pool.query<PaymentJoinRow>(
        `SELECT ip.id AS payment_id, ip.amount, ip.paid_at, ip.method, ip.reference,
                i.invoice_number, i.customer_name
           FROM invoice_payments ip
           JOIN invoices i ON i.id = ip.invoice_id
          WHERE ip.client_id = $1
            AND ip.paid_at >= $2 AND ip.paid_at < $3
          ORDER BY ip.paid_at ASC, ip.id ASC`,
        [client.id, start, end]
      ),
      pool.query<SettingsRow>(
        `SELECT custom_categories, preferences
           FROM client_settings
          WHERE client_id = $1`,
        [client.id]
      ),
      pool.query<AppSettingRow>(
        `SELECT value FROM app_settings WHERE key = 'irs_mileage_rate'`
      ),
    ]);

    // Settings + classifier setup (mirror lib/reports.ts).
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

    // Build the four section row arrays + running totals.
    const incomeLines: string[] = [];
    const expenseLines: string[] = [];
    const mileageLines: string[] = [];
    let totalRevenue = 0;
    let totalExpenses = 0;
    let boothFees = 0;
    let totalMiles = 0;

    // Events → income (cash-day revenue), expense (booth fee), mileage.
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
            formatMoney(manualRevenue),
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
            formatMoney(bf),
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
            formatMoney(cost),
            `Event #${e.id}`,
          ])
        );
      }
    }

    // processed_items → income or expense based on classifier.
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
            formatMoney(amount),
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
            formatMoney(amount),
            `Item #${t.id}`,
          ])
        );
      }
      // unknown-classified amounts are deliberately omitted from the
      // ledger — they're surfaced via the JSON aggregate's
      // unknownAmount field. The CSV is a tax-handoff document; an
      // uncategorized line in the CPA's Excel view would invite
      // misfiling.
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
          formatMoney(amount),
          notesBits.join(" "),
        ])
      );
    }

    const mileageCost = totalMiles * irsRate;
    const netProfit = totalRevenue - boothFees - totalExpenses - mileageCost;
    const eoy = `${year}-12-31`;

    // Assemble the CSV body in section order.
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
        formatMoney(totalRevenue),
        "",
      ]),
      csvRow([
        "Summary",
        eoy,
        "Booth fees",
        "",
        "Annual booth fees",
        "",
        formatMoney(boothFees),
        "",
      ]),
      csvRow([
        "Summary",
        eoy,
        "Expense total",
        "",
        "Annual expenses (cash basis)",
        "",
        formatMoney(totalExpenses),
        "",
      ]),
      csvRow([
        "Summary",
        eoy,
        "Mileage deduction",
        "",
        `${totalMiles.toFixed(1)} mi × $${irsRate.toFixed(2)}`,
        "",
        formatMoney(mileageCost),
        "",
      ]),
      csvRow([
        "Summary",
        eoy,
        "Net profit",
        "",
        "Revenue − Booth − Expenses − Mileage",
        "",
        formatMoney(netProfit),
        "",
      ]),
    ];

    const body =
      header +
      summarySection.join("") +
      incomeLines.join("") +
      expenseLines.join("") +
      mileageLines.join("");

    const slug = buildSlug(client.business_name);
    const filename = `flowwork-${slug}-${year}.csv`;

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        // Disable caching — different users + different rendered-at
        // timestamps mean an intermediate cache would serve stale CSVs.
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Annual CSV GET error:", error);
    return NextResponse.json(
      { error: "Failed to render annual CSV" },
      { status: 500 }
    );
  }
}
