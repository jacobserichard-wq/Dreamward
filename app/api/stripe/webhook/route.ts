import { NextRequest, NextResponse } from "next/server";
import { stripe, planFromPriceId } from "@/lib/stripe";
import pool from "@/lib/db";
import { sendEmail, paymentFailedEmail } from "@/lib/email";

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const sig = request.headers.get("stripe-signature");
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!webhookSecret) {
      console.error("STRIPE_WEBHOOK_SECRET is not configured");
      return NextResponse.json({ error: "Webhook not configured" }, { status: 500 });
    }
    if (!sig) {
      return NextResponse.json({ error: "Missing signature" }, { status: 400 });
    }

    let event;
    try {
      event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
    } catch (err) {
      console.error("Webhook signature verification failed:", err);
      return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    }

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const clientId = session.metadata?.clientId;
        const customerId = session.customer;
        const subscriptionId = session.subscription;

        if (clientId) {
          const result = await pool.query(
            "UPDATE clients SET stripe_customer_id = $1, " +
            "stripe_subscription_id = $2, updated_at = NOW() " +
            "WHERE id = $3 RETURNING *",
            [customerId, subscriptionId, parseInt(clientId)]
          );
          console.log("Checkout completed for:", result.rows[0]?.email);
        } else {
          console.error("No clientId in checkout session metadata");
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data.object;
        const customerId = subscription.customer;
        const status = subscription.status;

        let plan = "trial";
        if (status === "active" || status === "trialing") {
          const priceId = subscription.items.data[0]?.price?.id;
          plan = planFromPriceId(priceId) ?? "trial";
        } else if (status === "canceled" || status === "unpaid") {
          plan = "canceled";
        }

        await pool.query(
          "UPDATE clients SET plan = $1, " +
          "stripe_subscription_id = $2, updated_at = NOW() " +
          "WHERE stripe_customer_id = $3",
          [plan, subscription.id, customerId]
        );
        console.log("Subscription updated:", plan);

        // Send payment failed email
        if (status === "past_due" || status === "unpaid") {
          const clientResult = await pool.query(
            "SELECT email, business_name FROM clients WHERE stripe_customer_id = $1",
            [customerId]
          );
          if (clientResult.rows[0]) {
            const c = clientResult.rows[0];
            const email = paymentFailedEmail(c.business_name);
            try {
              await sendEmail({ to: c.email, ...email });
            } catch (err) {
              // Don't 5xx the webhook on email failure — Stripe would retry
              // and we'd re-run the whole subscription update.
              console.error("Payment-failed email send failed:", err);
            }
          }
        }
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object;
        await pool.query(
          "UPDATE clients SET plan = 'canceled', " +
          "stripe_subscription_id = NULL, updated_at = NOW() " +
          "WHERE stripe_customer_id = $1",
          [subscription.customer]
        );
        console.log("Subscription canceled");
        break;
      }
    }

    return NextResponse.json({ received: true });
  } catch (error) {
    console.error("Webhook error:", error);
    return NextResponse.json({ error: "Webhook failed" }, { status: 400 });
  }
}
