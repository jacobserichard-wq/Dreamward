// app/api/reports/refunds/route.ts
//
// Refunds & returns feed. Refunds are stored as negative-amount income
// rows (platform refunds come in negative so revenue nets out), so
// there's no refunds table — this endpoint separates the negative
// income from the positive sales over a period and rolls it up by
// channel for the Refunds report.
//
// GET /api/reports/refunds?from=YYYY-MM-DD&to=YYYY-MM-DD
//   Returns: {
//     grossSales, totalRefunds, refundRate,
//     byChannel: [{ channelLabel, gross, refunds, rate }],
//     refunds:   [{ label, channelLabel, amount, date }]   // amount > 0
//   }
//
// Pro-gated + tenant-scoped.

import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getSessionClient } from "@/lib/getClient";
import type { Industry } from "@/lib/categories";
import {
  buildKindClassifier,
  CANONICAL_CHANNELS,
  type ChannelId,
} from "@/lib/profitability/channels";
import { isPayingTier } from "@/lib/plans";

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

const CHANNEL_LABEL = new Map<ChannelId, string>(
  CANONICAL_CHANNELS.map((c) => [c.id, c.label])
);
const VALID = new Set<string>(CANONICAL_CHANNELS.map((c) => c.id));

function channelLabel(r: TxnRow): string {
  if (r.channel && VALID.has(r.channel)) {
    return CHANNEL_LABEL.get(r.channel as ChannelId) ?? r.channel;
  }
  if (r.source === "shopify") return "Shopify";
  if (r.source === "wix") return "Wix";
  if (r.source === "square") return "Square";
  if (r.source === "etsy") return "Etsy";
  if (r.event_id !== null) return "Markets";
  return r.category || "Uncategorized";
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

    const p = req.nextUrl.searchParams;
    const ymd = /^\d{4}-\d{2}-\d{2}$/;
    const from = p.get("from");
    const to = p.get("to");
    if (!from || !ymd.test(from) || !to || !ymd.test(to)) {
      return NextResponse.json(
        { error: "from and to must be YYYY-MM-DD" },
        { status: 400 }
      );
    }

    const [txnsRes, settingsRes] = await Promise.all([
      pool.query<TxnRow>(
        `SELECT amount, category, vendor, source, event_id, channel, due_date
           FROM processed_items
          WHERE client_id = $1
            AND due_date IS NOT NULL
            AND due_date >= $2
            AND due_date <= $3`,
        [client.id, from, to]
      ),
      pool.query<SettingsRow>(
        `SELECT custom_categories, preferences
           FROM client_settings WHERE client_id = $1`,
        [client.id]
      ),
    ]);

    const industry = (client.industry ?? "other") as Industry;
    const settings = settingsRes.rows[0] ?? null;
    const customExpense = Array.isArray(settings?.custom_categories)
      ? (settings!.custom_categories as string[])
      : [];
    const customIncome = Array.isArray(settings?.preferences?.custom_income_categories)
      ? (settings!.preferences!.custom_income_categories as string[])
      : [];
    const classify = buildKindClassifier(industry, customIncome, customExpense);

    let grossSales = 0;
    let totalRefunds = 0;
    const byChannel = new Map<string, { gross: number; refunds: number }>();
    const refunds: {
      label: string;
      channelLabel: string;
      amount: number;
      date: string | null;
    }[] = [];

    for (const r of txnsRes.rows) {
      const amount = Number(r.amount);
      if (!Number.isFinite(amount)) continue;
      if (classify(r.category) !== "income") continue;
      const label = channelLabel(r);
      const bucket = byChannel.get(label) ?? { gross: 0, refunds: 0 };
      if (amount < 0) {
        const abs = -amount;
        totalRefunds += abs;
        bucket.refunds += abs;
        refunds.push({
          label: r.vendor || r.category || "Refund",
          channelLabel: label,
          amount: abs,
          date: r.due_date,
        });
      } else {
        grossSales += amount;
        bucket.gross += amount;
      }
      byChannel.set(label, bucket);
    }

    refunds.sort((a, b) => b.amount - a.amount);

    return NextResponse.json({
      grossSales,
      totalRefunds,
      refundRate: grossSales > 0 ? totalRefunds / grossSales : null,
      byChannel: Array.from(byChannel.entries())
        .map(([channelLabel, v]) => ({
          channelLabel,
          gross: v.gross,
          refunds: v.refunds,
          rate: v.gross > 0 ? v.refunds / v.gross : null,
        }))
        .filter((c) => c.refunds > 0 || c.gross > 0)
        .sort((a, b) => b.refunds - a.refunds),
      refunds: refunds.slice(0, 500),
    });
  } catch (err) {
    console.error("Refunds report error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load refunds" },
      { status: 500 }
    );
  }
}
