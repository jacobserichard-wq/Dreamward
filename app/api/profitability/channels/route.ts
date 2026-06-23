// app/api/profitability/channels/route.ts
//
// Phase 9.1 commit 2 of 7. GET endpoint that returns per-channel
// profitability for a given time range. Drives the dashboard
// ChannelTable + the /profitability "By Channel" tab.
//
// Mirrors the existing /api/profitability fetch pattern — same
// classifier rules, same IRS rate honesty (rateSource flag), same
// plan gating. Difference: this endpoint groups data by CHANNEL
// (revenue source) instead of by EVENT, and accepts a year query
// param to scope the time window.
//
// Query params:
//   ?year=2026 (default: current UTC year)
//   ?mode=attributable | allocated (default: attributable)
//
// Response shape: see lib/profitability/channels.ts ChannelAggregateResult.

import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getSessionClient } from "@/lib/getClient";
import type { Industry } from "@/lib/categories";
import {
  buildKindClassifier,
  computeChannels,
  type ChannelTxnRow,
  type ChannelEventRow,
} from "@/lib/profitability/channels";
import { loadOperatingRateFromPrefs } from "@/lib/mileageRates";
import { isPayingTier } from "@/lib/plans";

function isPlanAllowed(plan: string | null | undefined): boolean {
  return isPayingTier(plan);
}

interface EventRow {
  id: number;
  revenue: string | null;
  booth_fee: string;
  total_miles: string | null;
}

interface TxnRow {
  amount: string;
  category: string | null;
  source: string | null;
  event_id: number | null;
  /** Phase 9.3: explicit channel set by the user at expense-entry
   *  time (or backfilled from existing signals by migration 0011).
   *  When non-null, the channels classifier uses this verbatim. */
  channel: string | null;
  tax_amount: string | null;
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

export async function GET(req: NextRequest) {
  try {
    const client = await getSessionClient();
    if (!client) {
      return NextResponse.json(
        { error: "Not authenticated" },
        { status: 401 }
      );
    }
    if (!isPlanAllowed(client.plan)) {
      return NextResponse.json(
        { error: "Channel profitability is a Growth or Pro feature" },
        { status: 403 }
      );
    }

    // ── Parse query params ──────────────────────────────────────
    const url = req.nextUrl.searchParams;
    const now = new Date();
    const yearParam = url.get("year");
    const year = yearParam ? Number(yearParam) : now.getUTCFullYear();
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      return NextResponse.json(
        { error: "Invalid year param" },
        { status: 400 }
      );
    }
    const modeParam = url.get("mode");
    const mode: "attributable" | "allocated" =
      modeParam === "allocated" ? "allocated" : "attributable";

    // Year boundaries — inclusive Jan 1 → Dec 31 in UTC. Matches the
    // pg DATE-column type-parser override; comparing YYYY-MM-DD
    // strings is correct.
    const yearStart = `${year}-01-01`;
    const yearEnd = `${year}-12-31`;

    // Optional explicit date range (from/to) overrides the year bounds,
    // letting callers scope the rollup to specific months. Both must be
    // valid YYYY-MM-DD; otherwise we fall back to the full year.
    const ymd = /^\d{4}-\d{2}-\d{2}$/;
    const fromParam = url.get("from");
    const toParam = url.get("to");
    const rangeStart = fromParam && ymd.test(fromParam) ? fromParam : yearStart;
    const rangeEnd = toParam && ymd.test(toParam) ? toParam : yearEnd;

    // ── Parallel fetch (same shape as /api/profitability) ───────
    const [eventsResult, txnsResult, settingsResult, appSettingResult] =
      await Promise.all([
        pool.query<EventRow>(
          // Events whose date range overlaps the year window. Use
          // start_date for the range check (matches what /api/events
          // does). total_miles uses the §8.2 conditional from
          // /api/profitability so multi-day events with
          // returns_home_nightly multiply the round_trip_miles by
          // day count.
          `SELECT id, revenue, booth_fee,
                  CASE
                    WHEN round_trip_miles IS NULL THEN NULL
                    WHEN returns_home_nightly THEN
                      round_trip_miles * ((end_date - start_date) + 1)
                    ELSE round_trip_miles
                  END AS total_miles
             FROM events
            WHERE client_id = $1
              AND start_date >= $2
              AND start_date <= $3`,
          [client.id, rangeStart, rangeEnd]
        ),
        pool.query<TxnRow>(
          // ALL processed_items in the year (NOT just event-linked).
          // due_date is the canonical "when did this hit" column
          // (matches /api/reports/annual). Some legacy rows may have
          // null due_date — exclude them from the rollup rather than
          // guess (would skew which year they land in).
          `SELECT amount, category, source, event_id, channel, tax_amount
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
        pool.query<AppSettingRow>(
          `SELECT value FROM app_settings WHERE key = 'irs_mileage_rate'`
        ),
      ]);

    // ── Build classifier (same rules as /api/profitability) ─────
    const industry = (client.industry ?? "other") as Industry;
    const settings = settingsResult.rows[0] ?? null;
    const customExpense: string[] = Array.isArray(settings?.custom_categories)
      ? (settings!.custom_categories as string[])
      : [];
    const prefIncome = settings?.preferences?.custom_income_categories;
    const customIncome: string[] = Array.isArray(prefIncome) ? prefIncome : [];
    const classify = buildKindClassifier(industry, customIncome, customExpense);

    // ── IRS rate (for the rate metadata returned in the response;
    //     not actually used in channel math anymore — channel math
    //     uses the operating rate below) ──
    const irsRateRaw = appSettingResult.rows[0]?.value;
    const parsedRate = irsRateRaw == null ? NaN : Number(irsRateRaw);
    const hasConfiguredRate = Number.isFinite(parsedRate) && parsedRate > 0;
    const irsMileageRate = hasConfiguredRate ? parsedRate : 0.7;
    const rateSource: "config" | "fallback" = hasConfiguredRate
      ? "config"
      : "fallback";

    // ── Operating rate (gas ÷ MPG) — what we actually USE for
    //     channel profitability math. The honest cash cost of
    //     driving. Falls back to defaults (~$3.67/gal ÷ 30 mpg =
    //     $0.12/mi) when the user hasn't set vehicle prefs. ──
    const operating = loadOperatingRateFromPrefs(settings?.preferences);
    const operatingMileageRate = operating.rate;

    // ── Convert raw rows into the helper's input shape ──────────
    const txns: ChannelTxnRow[] = txnsResult.rows
      .map((r) => {
        const amount = Number(r.amount);
        if (!Number.isFinite(amount)) return null;
        return {
          amount,
          tax: Number(r.tax_amount) || 0,
          category: r.category,
          source: r.source,
          event_id: r.event_id,
          kind: classify(r.category),
          // Phase 9.3 commit 2: pass through the explicit channel
          // column so the classifier can honor user-set tags.
          channel: r.channel,
        };
      })
      .filter((r): r is ChannelTxnRow => r !== null);

    const events: ChannelEventRow[] = eventsResult.rows.map((e) => {
      const totalMiles = e.total_miles == null ? 0 : Number(e.total_miles);
      // Operating rate, not IRS rate — this is the cash cost driving
      // the Markets channel net profit. IRS rate stays on /reports +
      // /api/reports/annual for Schedule C deduction math.
      const mileageCost = totalMiles * operatingMileageRate;
      return {
        id: e.id,
        revenue: e.revenue == null ? 0 : Number(e.revenue),
        booth_fee: Number(e.booth_fee),
        mileage_cost: mileageCost,
      };
    });

    // ── Aggregate via the pure helper ───────────────────────────
    const result = computeChannels({
      txns,
      events,
      mode,
      industry,
    });

    return NextResponse.json({
      year,
      mode,
      // IRS rate fields kept on the response for parity with
      // /api/profitability + /reports; the channel math itself
      // uses operating rate below.
      rateSource,
      irsMileageRate,
      // Operating rate metadata — what channel mileage was actually
      // computed at. UI can label honestly ("$0.12/mi gas-only" vs
      // "$0.70/mi IRS standard"). source='config' if user set BOTH
      // gas + MPG in /settings; 'default' if either falls back.
      operatingRate: operating.rate,
      operatingRateSource: operating.source,
      gasPricePerGallon: operating.gasPrice,
      mpg: operating.mpg,
      ...result,
    });
  } catch (err) {
    console.error("Channel profitability error:", err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Aggregation failed",
      },
      { status: 500 }
    );
  }
}
