// app/api/profitability/drill/route.ts
//
// Drill-down feed for the dashboard's big totals (Total Sales /
// Total Expenses). Returns the itemized contributors that sum to the
// SalesBanner number, mirroring lib/profitability/channels exactly so
// the list reconciles to the headline:
//
//   income  → every income processed_item + each event's revenue
//   expense → every expense processed_item (channel-attributed AND
//             overhead) + each event's booth fee + mileage cost
//
// 'unknown'-kind rows are excluded (same as computeChannels — they
// don't count toward revenue or expenses).
//
// GET /api/profitability/drill?year=YYYY&kind=income|expense
//   Returns: { kind, year, total, rows: DrillRow[] }  (rows: amount desc)
//
// Pro-gated + tenant-scoped, same as /api/profitability/channels.

import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getSessionClient } from "@/lib/getClient";
import type { Industry } from "@/lib/categories";
import {
  buildKindClassifier,
  CANONICAL_CHANNELS,
  type ChannelId,
} from "@/lib/profitability/channels";
import { loadOperatingRateFromPrefs } from "@/lib/mileageRates";
import { isPayingTier } from "@/lib/plans";

interface EventRow {
  id: number;
  name: string | null;
  revenue: string | null;
  booth_fee: string;
  total_miles: string | null;
  start_date: string | null;
}

interface TxnRow {
  amount: string;
  category: string | null;
  vendor: string | null;
  source: string | null;
  event_id: number | null;
  channel: string | null;
  due_date: string | null;
}

interface SettingsRow {
  custom_categories: string[] | null;
  preferences: { custom_income_categories?: string[] } | null;
}

interface DrillRow {
  label: string;
  sublabel: string | null;
  amount: number;
  date: string | null;
  kind: "txn" | "event";
}

// channel id → display label (for the row sublabel).
const CHANNEL_LABEL = new Map<ChannelId, string>(
  CANONICAL_CHANNELS.map((c) => [c.id, c.label])
);

const VALID_CHANNEL_IDS = new Set<string>(CANONICAL_CHANNELS.map((c) => c.id));

// Mirror of classifyIncomeRow / classifyExpenseRow channel resolution,
// but only for producing a human sublabel (not the rollup itself).
function incomeChannelLabel(r: TxnRow): string {
  if (r.channel && VALID_CHANNEL_IDS.has(r.channel)) {
    return CHANNEL_LABEL.get(r.channel as ChannelId) ?? r.channel;
  }
  if (r.source === "shopify") return "Shopify";
  if (r.source === "wix") return "Wix";
  if (r.source === "square") return "Square";
  if (r.source === "etsy") return "Etsy";
  if (r.event_id !== null) return "Markets";
  return r.category || "Uncategorized";
}

function expenseChannelLabel(r: TxnRow): string {
  if (r.channel && VALID_CHANNEL_IDS.has(r.channel)) {
    return CHANNEL_LABEL.get(r.channel as ChannelId) ?? r.channel;
  }
  if (r.event_id !== null) return "Markets";
  if (r.source === "shopify") return "Shopify";
  if (r.source === "wix") return "Wix";
  if (r.source === "square") return "Square";
  if (r.source === "etsy") return "Etsy";
  return "Overhead";
}

export async function GET(req: NextRequest) {
  try {
    const client = await getSessionClient();
    if (!client) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    if (!isPayingTier(client.plan)) {
      return NextResponse.json(
        { error: "This feature requires an active subscription." },
        { status: 403 }
      );
    }

    const url = req.nextUrl.searchParams;
    const now = new Date();
    const year = url.get("year") ? Number(url.get("year")) : now.getUTCFullYear();
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      return NextResponse.json({ error: "Invalid year param" }, { status: 400 });
    }
    const kind = url.get("kind");
    if (kind !== "income" && kind !== "expense") {
      return NextResponse.json(
        { error: "kind must be income or expense" },
        { status: 400 }
      );
    }

    const yearStart = `${year}-01-01`;
    const yearEnd = `${year}-12-31`;

    // Optional explicit date range (from/to) overrides the year bounds so
    // a month-filtered Totals card can drill into exactly its months.
    const ymd = /^\d{4}-\d{2}-\d{2}$/;
    const fromParam = url.get("from");
    const toParam = url.get("to");
    const rangeStart = fromParam && ymd.test(fromParam) ? fromParam : yearStart;
    const rangeEnd = toParam && ymd.test(toParam) ? toParam : yearEnd;

    const [eventsResult, txnsResult, settingsResult] = await Promise.all([
      pool.query<EventRow>(
        `SELECT id, name, revenue, booth_fee,
                CASE
                  WHEN round_trip_miles IS NULL THEN NULL
                  WHEN returns_home_nightly THEN
                    round_trip_miles * ((end_date - start_date) + 1)
                  ELSE round_trip_miles
                END AS total_miles,
                start_date
           FROM events
          WHERE client_id = $1
            AND start_date >= $2
            AND start_date <= $3`,
        [client.id, rangeStart, rangeEnd]
      ),
      pool.query<TxnRow>(
        `SELECT amount, category, vendor, source, event_id, channel, due_date
           FROM processed_items
          WHERE client_id = $1
            AND due_date IS NOT NULL
            AND due_date >= $2
            AND due_date <= $3`,
        [client.id, rangeStart, rangeEnd]
      ),
      pool.query<SettingsRow>(
        `SELECT custom_categories, preferences
           FROM client_settings
          WHERE client_id = $1`,
        [client.id]
      ),
    ]);

    const industry = (client.industry ?? "other") as Industry;
    const settings = settingsResult.rows[0] ?? null;
    const customExpense: string[] = Array.isArray(settings?.custom_categories)
      ? (settings!.custom_categories as string[])
      : [];
    const prefIncome = settings?.preferences?.custom_income_categories;
    const customIncome: string[] = Array.isArray(prefIncome) ? prefIncome : [];
    const classify = buildKindClassifier(industry, customIncome, customExpense);

    const operating = loadOperatingRateFromPrefs(settings?.preferences);
    const operatingMileageRate = operating.rate;

    const rows: DrillRow[] = [];

    // ── processed_items ────────────────────────────────────────────
    for (const r of txnsResult.rows) {
      const amount = Number(r.amount);
      if (!Number.isFinite(amount)) continue;
      const k = classify(r.category);
      if (k !== kind) continue; // 'unknown' + the other kind are excluded
      rows.push({
        label: r.vendor || r.category || (kind === "income" ? "Sale" : "Expense"),
        sublabel:
          kind === "income" ? incomeChannelLabel(r) : expenseChannelLabel(r),
        amount,
        date: r.due_date,
        kind: "txn",
      });
    }

    // ── events ─────────────────────────────────────────────────────
    for (const e of eventsResult.rows) {
      const name = e.name || `Event #${e.id}`;
      if (kind === "income") {
        const rev = e.revenue == null ? 0 : Number(e.revenue);
        if (rev > 0) {
          rows.push({
            label: `Market revenue — ${name}`,
            sublabel: "Markets",
            amount: rev,
            date: e.start_date,
            kind: "event",
          });
        }
      } else {
        const boothFee = Number(e.booth_fee);
        if (boothFee > 0) {
          rows.push({
            label: `Booth fee — ${name}`,
            sublabel: "Markets",
            amount: boothFee,
            date: e.start_date,
            kind: "event",
          });
        }
        const miles = e.total_miles == null ? 0 : Number(e.total_miles);
        const mileageCost = miles * operatingMileageRate;
        if (mileageCost > 0) {
          rows.push({
            label: `Mileage — ${name}`,
            sublabel: "Markets",
            amount: mileageCost,
            date: e.start_date,
            kind: "event",
          });
        }
      }
    }

    rows.sort((a, b) => b.amount - a.amount);
    const total = rows.reduce((sum, r) => sum + r.amount, 0);

    return NextResponse.json({ kind, year, total, rows });
  } catch (err) {
    console.error("Profitability drill GET error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load drill" },
      { status: 500 }
    );
  }
}
