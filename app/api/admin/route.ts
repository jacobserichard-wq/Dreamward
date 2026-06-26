import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getAdminSessionEmail } from "@/lib/admin";

export async function GET() {
  try {
    const admin = await getAdminSessionEmail();
    if (!admin) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const result = await pool.query(
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

    return NextResponse.json({ clients: result.rows });
  } catch (error) {
    console.error("Admin API error:", error);
    return NextResponse.json({ error: "Failed to load admin data" }, { status: 500 });
  }
}