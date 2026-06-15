import { NextRequest, NextResponse } from "next/server";
import { stripe, PLANS } from "@/lib/stripe";
import { getSessionClient } from "@/lib/getClient";
import { computeTrailingRevenue } from "@/lib/revenueTier";
import { tierForAnnualRevenue } from "@/lib/plans";
import { type Industry } from "@/lib/categories";

export async function POST(_req: NextRequest) {
  try {
    const client = await getSessionClient();
    if (!client?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Revenue-driven: the customer never picks a tier. We compute their
    // trailing-12-month revenue and start the subscription on the band
    // it maps to. The monthly reconcile cron (lib/revenueTier) keeps
    // the band current from there. A brand-new account with little/no
    // tracked revenue lands on band1 ($10) — the right floor.
    const industry = (client.industry ?? "general") as Industry;
    const revenue = await computeTrailingRevenue(client.id, industry);
    const band = tierForAnnualRevenue(revenue);
    const plan = PLANS[band];
    if (!plan.priceId) {
      // No silent fallback: surface the misconfiguration rather than
      // billing an arbitrary band.
      return NextResponse.json(
        { error: "Pricing isn't configured yet — please contact support." },
        { status: 500 }
      );
    }

    // Sub-session 33: the Pro onboarding-call offering was removed,
    // so every band lands on the dashboard after checkout. The
    // /welcome-pro page + Calendly flow are retired.
    const successPath = "/dashboard";

    const checkoutSession = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      customer_email: client.email,
      line_items: [{ price: plan.priceId, quantity: 1 }],
      subscription_data: {
        trial_period_days: 14,
        metadata: { clientId: String(client.id) },
      },
      success_url: `${process.env.NEXTAUTH_URL}${successPath}?session_id={CHECKOUT_SESSION_ID}`,
      // Cancel returns to /billing (the page the checkout launched
      // from). The old /pricing target 404'd — that route never
      // existed.
      cancel_url: `${process.env.NEXTAUTH_URL}/billing`,
      metadata: { clientId: String(client.id) },
    });

    return NextResponse.json({ url: checkoutSession.url });
  } catch (error) {
    console.error("Checkout error:", error);
    return NextResponse.json(
      { error: "Failed to create checkout session" },
      { status: 500 }
    );
  }
}
