import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { stripe, PLANS } from "@/lib/stripe";
import { getSessionClient } from "@/lib/getClient";

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session?.user?.email) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { planId } = await req.json();
    const plan = PLANS[planId as keyof typeof PLANS];
    if (!plan) {
      return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
    }

    const client = await getSessionClient();

    // Sub-session 33: the Pro onboarding-call offering was removed,
    // so every tier (including Pro) lands on the dashboard after
    // checkout. The /welcome-pro page + Calendly flow are retired.
    const successPath = "/dashboard";

    const checkoutSession = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      customer_email: session.user.email,
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