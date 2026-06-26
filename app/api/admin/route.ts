import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import pool from "@/lib/db";
import { isAdminEmail } from "@/lib/admin";
import { cacheClientRevenue } from "@/lib/revenueTier";
import { type Industry } from "@/lib/categories";

interface AdminClientRow {
  id: number;
  email: string;
  business_name: string | null;
  industry: string | null;
  plan: string;
  stripe_customer_id: string | null;
  onboarding_completed: boolean;
  trial_ends_at: string | null;
  created_at: string;
  updated_at: string;
  total_items: string;
  items_this_month: string;
  cached_trailing_revenue: string | null;
  cached_would_be_band: string | null;
  revenue_cached_at: string | null;
}

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    const email = session?.user?.email?.toLowerCase() ?? null;
    if (!isAdminEmail(email)) {
      // Echo the signed-in email so the denial screen can show what the
      // gate actually checked (catches "wrong account logged in").
      return NextResponse.json(
        { error: "Unauthorized", email: email ?? "(not signed in)" },
        { status: 403 }
      );
    }

    const result = await pool.query<AdminClientRow>(
      `SELECT
         c.id, c.email, c.business_name, c.industry, c.plan,
         c.stripe_customer_id, c.onboarding_completed,
         c.trial_ends_at, c.created_at, c.updated_at,
         c.cached_trailing_revenue, c.cached_would_be_band, c.revenue_cached_at,
         COUNT(pi.id) as total_items,
         COUNT(pi.id) FILTER (WHERE pi.processed_at >= date_trunc('month', CURRENT_DATE)) as items_this_month
       FROM clients c
       LEFT JOIN processed_items pi ON pi.client_id = c.id
       GROUP BY c.id
       ORDER BY c.created_at DESC`
    );

    // Read the nightly-cached trailing-12-month revenue + would-be band
    // (refreshed by the daily cron). A never-cached account (new signup, or
    // before the first cron run) is computed read-through and persisted
    // once here — so the page stays fast (no per-load recompute) without an
    // empty-until-tonight gap.
    const clients = await Promise.all(
      result.rows.map(async (c) => {
        let revenue =
          c.cached_trailing_revenue == null
            ? null
            : Number(c.cached_trailing_revenue);
        let band = c.cached_would_be_band;
        let cachedAt = c.revenue_cached_at;
        if (revenue == null || band == null) {
          const fresh = await cacheClientRevenue(
            c.id,
            (c.industry || "other") as Industry
          );
          revenue = fresh.revenue;
          band = fresh.band;
          cachedAt = new Date().toISOString();
        }
        return {
          ...c,
          trailing_revenue: revenue,
          would_be_band: band,
          revenue_cached_at: cachedAt,
        };
      })
    );

    return NextResponse.json({ clients });
  } catch (error) {
    console.error("Admin API error:", error);
    return NextResponse.json({ error: "Failed to load admin data" }, { status: 500 });
  }
}