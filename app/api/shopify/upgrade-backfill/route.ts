// app/api/shopify/upgrade-backfill/route.ts
//
// Phase 8c commit 4 of 5.
//
// POST endpoint that creates a Stripe Checkout Session for the
// one-time $99 backfill upgrade. Locked design decision 4.7:
// 30,000 orders free; users with bigger stores pay $99 to unlock
// unlimited backfill of remaining historical orders.
//
// Flow:
//   1. Verify Pro tier + has connection + connection is capped at 30k
//   2. Create Stripe Checkout Session (mode='payment', not subscription)
//      with $99 as a single ad-hoc line item
//   3. Store the payment_intent ID on shopify_connections.stripe_payment_intent_id
//      so the Stripe webhook (commit 8c.5) can match the completion
//      event back to the correct connection
//   4. Return { checkoutUrl } so the client redirects the browser
//
// Note: we DON'T use a pre-created Stripe Price for this — the $99
// is a one-time price_data inline (cheaper to maintain than another
// Stripe Price object + matches the design's "configurable via
// SHOPIFY_BACKFILL_EXTENDED_PRICE_CENTS env var" pattern).

import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { getSessionClient } from "@/lib/getClient";
import { isPayingTier } from "@/lib/plans";

// Default price if env var not set (locked design decision 4.7 = $99)
const DEFAULT_PRICE_CENTS = 9900;

interface ConnectionRow {
  id: number;
  shop_domain: string;
  stripe_customer_id_existing: string | null; // from clients table join
  backfill_capped_at_30k: boolean;
  backfill_extended_paid_at: string | null;
}

export async function POST(req: NextRequest) {
  try {
    const client = await getSessionClient();
    if (!client) {
      return NextResponse.json(
        { error: "Not authenticated" },
        { status: 401 }
      );
    }
    if (!isPayingTier(client.plan)) {
      return NextResponse.json(
        { error: "Shopify integration is a Pro feature." },
        { status: 403 }
      );
    }

    // Load connection state + the user's existing Stripe customer ID
    // (from clients table) so Checkout reuses that customer record
    // instead of creating a new one.
    const found = await pool.query<ConnectionRow>(
      `SELECT sc.id,
              sc.shop_domain,
              c.stripe_customer_id AS stripe_customer_id_existing,
              sc.backfill_capped_at_30k,
              sc.backfill_extended_paid_at
         FROM shopify_connections sc
         JOIN clients c ON c.id = sc.client_id
        WHERE sc.client_id = $1`,
      [client.id]
    );
    if (found.rows.length === 0) {
      return NextResponse.json(
        { error: "No Shopify connection. Connect a store first." },
        { status: 404 }
      );
    }
    const conn = found.rows[0];

    if (conn.backfill_extended_paid_at) {
      return NextResponse.json(
        { error: "Extended backfill is already paid for." },
        { status: 409 }
      );
    }
    if (!conn.backfill_capped_at_30k) {
      return NextResponse.json(
        {
          error:
            "Your backfill hasn't hit the 30k cap yet. No upgrade needed.",
        },
        { status: 400 }
      );
    }

    // Price in cents (env-var overridable for A/B testing without deploy)
    const priceCents = Number(
      process.env.SHOPIFY_BACKFILL_EXTENDED_PRICE_CENTS ?? DEFAULT_PRICE_CENTS
    );

    // Build absolute URLs for success/cancel — req.url has the
    // request origin so this works in production AND Vercel previews.
    const successUrl = new URL("/integrations", req.url);
    successUrl.searchParams.set("upgrade", "success");
    const cancelUrl = new URL("/integrations", req.url);
    cancelUrl.searchParams.set("upgrade", "cancelled");

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      // Reuse the user's existing Stripe customer if there is one
      // (avoids duplicate customer records for a user already on Pro)
      ...(conn.stripe_customer_id_existing
        ? { customer: conn.stripe_customer_id_existing }
        : { customer_email: client.email }),
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: priceCents,
            product_data: {
              name: "FlowWork — Unlimited Shopify backfill",
              description: `Unlocks unlimited historical order import for ${conn.shop_domain}`,
            },
          },
        },
      ],
      success_url: successUrl.toString(),
      cancel_url: cancelUrl.toString(),
      // Metadata round-trips with the webhook payload so the handler
      // (commit 8c.5) can identify which connection to mark paid.
      metadata: {
        flowwork_event: "shopify_backfill_upgrade",
        flowwork_client_id: String(client.id),
        flowwork_connection_id: String(conn.id),
      },
      payment_intent_data: {
        metadata: {
          flowwork_event: "shopify_backfill_upgrade",
          flowwork_client_id: String(client.id),
          flowwork_connection_id: String(conn.id),
        },
      },
    });

    if (!session.url) {
      throw new Error("Stripe returned a session without a URL");
    }

    // Optimistically store the session ID on the connection so the
    // webhook handler has a fallback identifier if metadata is lost.
    // payment_intent is null at session-creation time (only populated
    // post-completion), so we update again from the webhook handler
    // with the real intent ID.
    await pool.query(
      `UPDATE shopify_connections
          SET stripe_payment_intent_id = $1,
              updated_at = NOW()
        WHERE id = $2`,
      [session.id, conn.id]
    );

    return NextResponse.json({ checkoutUrl: session.url });
  } catch (err) {
    console.error("Shopify upgrade-backfill error:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Couldn't create checkout",
      },
      { status: 500 }
    );
  }
}
