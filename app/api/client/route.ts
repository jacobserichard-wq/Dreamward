import { NextResponse } from "next/server";
import { getSessionClient } from "@/lib/getClient";
import { getPlanFeatures } from "@/lib/plans";

export async function GET() {
  try {
    const client = await getSessionClient();
    if (!client) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const features = getPlanFeatures(client.plan);

    return NextResponse.json({
      plan: client.plan,
      businessName: client.business_name,
      email: client.email,
      trialEndsAt: client.trial_ends_at,
      features: {
        maxItemsPerMonth: features.maxItemsPerMonth === Infinity ? null : features.maxItemsPerMonth,
        modules: features.modules,
        labels: features.labels,
      },
    });
  } catch (error) {
    console.error("Client API error:", error);
    return NextResponse.json({ error: "Failed to load client" }, { status: 500 });
  }
}