import { NextResponse } from "next/server";
import { getSessionClient } from "@/lib/getClient";
import { getPlanFeatures } from "@/lib/plans";
import { stripe } from "@/lib/stripe";
import pool from "@/lib/db";

export async function GET() {
  try {
    const client = await getSessionClient();
    if (!client) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const features = getPlanFeatures(client.plan);

    // Get usage count for current month
    const usageResult = await pool.query(
      `SELECT COUNT(*) as items_this_month 
       FROM processed_items 
       WHERE client_id = $1 
       AND processed_at >= date_trunc('month', CURRENT_DATE)`,
      [client.id]
    );

    const itemsThisMonth = parseInt(usageResult.rows[0].items_this_month) || 0;
    const maxItems = features.maxItemsPerMonth === Infinity ? null : features.maxItemsPerMonth;

    return NextResponse.json({
      plan: client.plan,
      email: client.email,
      businessName: client.business_name,
      trialEndsAt: client.trial_ends_at,
      stripeCustomerId: client.stripe_customer_id,
      stripeSubscriptionId: client.stripe_subscription_id,
      usage: {
        itemsThisMonth,
        maxItems,
      },
      features: {
        modules: features.modules,
        labels: features.labels,
      },
    });
  } catch (error) {
    console.error("Billing API error:", error);
    return NextResponse.json({ error: "Failed to load billing" }, { status: 500 });
  }
}