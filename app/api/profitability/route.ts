import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getSessionClient } from "@/lib/getClient";
import { getCategoriesForIndustry, type Industry } from "@/lib/categories";

// Phase 5 commit 5: /api/profitability. Server-side P&L computation per
// the design spec §1 model:
//   revenue       = events.revenue (cash/other) + linked income txns
//   expenses      = linked expense txns + manual event expenses
//   mileage_cost  = total_miles × IRS rate (from app_settings)
//   profit        = revenue − booth_fee − expenses − mileage_cost
//
// Why server-side: the client doesn't know the IRS rate, doesn't have the
// industry-aware category taxonomy in scope, and shouldn't be trusted to
// classify income vs expense for the dashboard. One endpoint returns
// per-event breakdowns + portfolio aggregates + monthly trend + best/
// worst rankings — sub-session 19 commits 6/7 consume this.
//
// Custom-category typing (sub-session 19 design call, Option 1): the
// legacy `client_settings.custom_categories` list is expense-typed by
// convention. The new `client_settings.preferences.custom_income_categories`
// list (added in commit 8's Settings UI work) lets users declare income
// categories that don't appear in the seeded taxonomy. Without this fix,
// a customer creating a custom "Wholesale Orders" income category would
// have it subtracted from revenue as if it were an expense.

function isPlanAllowed(plan: string | null | undefined): boolean {
  return plan === "growth" || plan === "pro" || plan === "trial";
}

// Phase 1 umbrella values predating the type-tagged taxonomy. The
// reclassify cron rewrites these on newly-uploaded rows, but historical
// rows persist and have to be interpreted at read time.
const LEGACY_INCOME = new Set(["invoice", "ar_followup"]);
const LEGACY_EXPENSE = new Set(["expense"]);

type CategoryKind = "income" | "expense" | "unknown";

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
  event_id: number;
  amount: string;
  category: string | null;
  source: string | null;
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

// Lookup-based classifier: pre-builds the maps once, then per-txn dispatch
// is O(1). Priority order is intentional — seeded names always beat user
// customs (a user can't override "Marketing & Advertising" to be income),
// and customs beat legacy values.
function buildClassifier(
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

export async function GET() {
  try {
    const client = await getSessionClient();
    if (!client) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    if (!isPlanAllowed(client.plan)) {
      return NextResponse.json(
        { error: "Profitability is a Growth or Pro feature" },
        { status: 403 }
      );
    }

    // Four independent reads — parallelize. Tenant-scoped on client_id
    // for every query that hits client data; app_settings is global.
    // total_miles uses the same §8.2 conditional that /api/events GET
    // does: returns_home_nightly multiplies by day_count, else single
    // trip. Null round_trip_miles propagates to null total_miles.
    const [eventsResult, txnsResult, settingsResult, appSettingResult] =
      await Promise.all([
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
            ORDER BY start_date ASC, id ASC`,
          [client.id]
        ),
        pool.query<TxnRow>(
          `SELECT event_id, amount, category, source
             FROM processed_items
            WHERE client_id = $1 AND event_id IS NOT NULL`,
          [client.id]
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

    const industry = (client.industry ?? "other") as Industry;
    const settings = settingsResult.rows[0] ?? null;
    const customExpense: string[] = Array.isArray(settings?.custom_categories)
      ? (settings!.custom_categories as string[])
      : [];
    const prefIncome = settings?.preferences?.custom_income_categories;
    const customIncome: string[] = Array.isArray(prefIncome) ? prefIncome : [];

    const classify = buildClassifier(industry, customIncome, customExpense);

    // IRS rate fallback: 0.70 matches the migration 0006 seed (2025 rate).
    // If the migration hasn't been applied yet the query returns no rows
    // and we degrade to the constant rather than NaN-ing every mileage
    // cost downstream. Once 0006 lands this path is dead.
    const irsRateRaw = appSettingResult.rows[0]?.value;
    const parsedRate = irsRateRaw == null ? NaN : Number(irsRateRaw);
    const irsMileageRate =
      Number.isFinite(parsedRate) && parsedRate > 0 ? parsedRate : 0.7;

    interface PerEventAccumulator {
      manualRevenue: number;
      linkedIncome: number;
      manualExpense: number;
      linkedExpense: number;
      unknownAmount: number;
    }
    const accumulators = new Map<number, PerEventAccumulator>();
    for (const e of eventsResult.rows) {
      accumulators.set(e.id, {
        manualRevenue: e.revenue == null ? 0 : Number(e.revenue),
        linkedIncome: 0,
        manualExpense: 0,
        linkedExpense: 0,
        unknownAmount: 0,
      });
    }

    for (const t of txnsResult.rows) {
      const acc = accumulators.get(t.event_id);
      if (!acc) continue;
      const amount = Number(t.amount);
      if (!Number.isFinite(amount)) continue;
      const kind = classify(t.category);
      if (kind === "income") {
        acc.linkedIncome += amount;
      } else if (kind === "expense") {
        if (t.source === "manual") acc.manualExpense += amount;
        else acc.linkedExpense += amount;
      } else {
        // Unknown-category amounts are surfaced but never folded into the
        // profit math — guessing the sign would be worse than silently
        // omitting. Commit 6/7 can render an "uncategorized" badge from
        // this field if non-zero.
        acc.unknownAmount += amount;
      }
    }

    const perEvent = eventsResult.rows.map((e) => {
      const acc = accumulators.get(e.id)!;
      const totalMiles = e.total_miles == null ? null : Number(e.total_miles);
      const mileageCost =
        totalMiles == null ? 0 : totalMiles * irsMileageRate;
      const revenue = acc.manualRevenue + acc.linkedIncome;
      const expenses = acc.linkedExpense + acc.manualExpense;
      const boothFee = Number(e.booth_fee);
      const profit = revenue - boothFee - expenses - mileageCost;
      return {
        id: e.id,
        name: e.name,
        startDate: e.start_date,
        endDate: e.end_date,
        venue: e.venue,
        address: e.address,
        revenue: {
          total: revenue,
          manual: acc.manualRevenue,
          linked: acc.linkedIncome,
        },
        expenses: {
          total: expenses,
          linked: acc.linkedExpense,
          manual: acc.manualExpense,
        },
        boothFee,
        totalMiles,
        mileageCost,
        profit,
        unknownAmount: acc.unknownAmount,
      };
    });

    const portfolio = perEvent.reduce(
      (agg, e) => ({
        totalRevenue: agg.totalRevenue + e.revenue.total,
        totalExpenses: agg.totalExpenses + e.expenses.total,
        totalBoothFees: agg.totalBoothFees + e.boothFee,
        totalMiles: agg.totalMiles + (e.totalMiles ?? 0),
        totalMileageCost: agg.totalMileageCost + e.mileageCost,
        netProfit: agg.netProfit + e.profit,
        eventCount: agg.eventCount + 1,
        unknownAmount: agg.unknownAmount + e.unknownAmount,
      }),
      {
        totalRevenue: 0,
        totalExpenses: 0,
        totalBoothFees: 0,
        totalMiles: 0,
        totalMileageCost: 0,
        netProfit: 0,
        eventCount: 0,
        unknownAmount: 0,
      }
    );

    // Monthly trend keys off start_date so a multi-day event spanning
    // months is attributed to its start month. expenses in the trend
    // include booth fees + mileage cost (the dashboard charts the full
    // outflow per month, not just the processed_items slice).
    const monthBuckets = new Map<
      string,
      { revenue: number; expenses: number; net: number }
    >();
    for (const e of perEvent) {
      const month = e.startDate.slice(0, 7);
      const bucket = monthBuckets.get(month) ?? {
        revenue: 0,
        expenses: 0,
        net: 0,
      };
      bucket.revenue += e.revenue.total;
      bucket.expenses += e.expenses.total + e.boothFee + e.mileageCost;
      bucket.net += e.profit;
      monthBuckets.set(month, bucket);
    }
    const monthlyTrend = [...monthBuckets.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, v]) => ({ month, ...v }));

    const ranked = [...perEvent].sort((a, b) => b.profit - a.profit);
    const bestMarkets = ranked.slice(0, 5);
    const worstMarkets =
      ranked.length <= 5 ? [] : ranked.slice(-5).reverse();

    return NextResponse.json({
      perEvent,
      portfolio,
      monthlyTrend,
      bestMarkets,
      worstMarkets,
      irsMileageRate,
    });
  } catch (error) {
    console.error("Profitability GET error:", error);
    return NextResponse.json(
      { error: "Failed to load profitability" },
      { status: 500 }
    );
  }
}
