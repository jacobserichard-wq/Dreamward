import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import pool from "@/lib/db";
import { isAdminEmail } from "@/lib/admin";
import { tierForAnnualRevenue } from "@/lib/plans";
import { computeTrailingRevenue } from "@/lib/revenueTier";
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
         COUNT(pi.id) as total_items,
         COUNT(pi.id) FILTER (WHERE pi.processed_at >= date_trunc('month', CURRENT_DATE)) as items_this_month
       FROM clients c
       LEFT JOIN processed_items pi ON pi.client_id = c.id
       GROUP BY c.id
       ORDER BY c.created_at DESC`
    );

    // Enrich each account with its trailing-12-month revenue (the same
    // net-of-refunds figure the pricing bands key off) + the band that
    // revenue would land them on. Per-account computeTrailingRevenue is a
    // few queries each — fine at owner-dashboard scale (a handful of
    // accounts); revisit if the account count grows large.
    const clients = await Promise.all(
      result.rows.map(async (c) => {
        const trailingRevenue = await computeTrailingRevenue(
          c.id,
          (c.industry || "other") as Industry
        );
        return {
          ...c,
          trailing_revenue: trailingRevenue,
          would_be_band: tierForAnnualRevenue(trailingRevenue),
        };
      })
    );

    return NextResponse.json({ clients });
  } catch (error) {
    console.error("Admin API error:", error);
    return NextResponse.json({ error: "Failed to load admin data" }, { status: 500 });
  }
}