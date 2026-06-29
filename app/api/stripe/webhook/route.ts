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

    // Idempotency: Stripe delivers at-least-once + replays on non-2xx.
    // Record the event id; if it's already there, this is a replay — ack
    // and skip so side effects (emails, backfill re-arm) don't re-run.
    const dedup = await pool.query(
      `INSERT INTO processed_stripe_events (event_id) VALUES ($1)
       ON CONFLICT (event_id) DO NOTHING RETURNING event_id`,
      [event.id]
    );
    if (dedup.rowCount === 0) {
      return NextResponse.json({ received: true, duplicate: true });
    }

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;

        // Phase 8c commit 5: fork on the flowwork_event metadata to
        // distinguish the Shopify backfill upgrade (mode='payment',
        // no subscription) from the standard subscription checkout
        // (mode='subscription'). Set by the upgrade-backfill route's
        // session create call.
        const flowworkEvent = session.metadata?.flowwork_event;

        if (flowworkEvent === "shopify_backfill_upgrade") {
          // ── Shopify backfill $99 one-time payment ─────────────
          const connectionIdRaw = session.metadata?.flowwork_connection_id;
          const paymentIntentId =
            typeof session.payment_intent === "string"
              ? session.payment_intent
              : null;
          if (!connectionIdRaw) {
            console.error(
              "shopify_backfill_upgrade webhook missing flowwork_connection_id metadata"
            );
            break;
          }
          const connectionId = parseInt(connectionIdRaw, 10);
          if (!Number.isInteger(connectionId)) {
            console.error(
              "shopify_backfill_upgrade webhook: invalid connection_id metadata:",
              connectionIdRaw
            );
            break;
          }

          // Flip the paid marker + reset the cap so the existing
          // backfill route + the frontend polling can resume
          // pulling orders past the 30k limit. last_sync_status set
          // to 'in_progress' so the UI knows to start polling again.
          await pool.query(
            `UPDATE shopify_connections
                SET backfill_extended_paid_at = NOW(),
                    backfill_capped_at_30k = false,
                    stripe_payment_intent_id = $1,
                    last_sync_status = 'in_progress',
                    last_sync_error = NULL,
                    updated_at = NOW()
              WHERE id = $2`,
            [paymentIntentId, connectionId]
          );
          console.log(
            `Shopify backfill upgrade paid for connection ${connectionId} (payment_intent=${paymentIntentId})`
          );

          // Don't trigger backfill here — the frontend polling logic
          // (ShopifyConnectionCard's useEffect) re-runs on the next
          // /integrations mount + sees the new flags + resumes
          // polling/POSTing the backfill route. Triggering from this
          // webhook would require system-level auth on the backfill
          // route, which we deliberately avoided.
          break;
        }

        // ── Standard subscription checkout (existing behavior) ──
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

        if (status === "active" || status === "trialing") {
          // Healthy (or recovered from past_due) → set band + clear any
          // running grace clock so access is fully restored.
          const priceId = subscription.items.data[0]?.price?.id;
          const plan = planFromPriceId(priceId) ?? "trial";
          await pool.query(
            "UPDATE clients SET plan = $1, stripe_subscription_id = $2, " +
            "past_due_since = NULL, updated_at = NOW() " +
            "WHERE stripe_customer_id = $3",
            [plan, subscription.id, customerId]
          );
          console.log("Subscription active:", plan);
        } else if (status === "canceled" || status === "unpaid") {
          await pool.query(
            "UPDATE clients SET plan = 'canceled', stripe_subscription_id = $1, " +
            "past_due_since = NULL, updated_at = NOW() " +
            "WHERE stripe_customer_id = $2",
            [subscription.id, customerId]
          );
          console.log("Subscription canceled/unpaid");
        } else if (status === "past_due") {
          // KEEP their band — past_due starts a 7-day grace period, not an
          // immediate cutoff. Start the grace clock if it isn't already
          // running (COALESCE, so dunning retries don't reset it). `plan` is
          // left untouched, so access stays at their band. The nightly cron
          // sends the daily countdown + flips to read-only after 7 days.
          const before = await pool.query<{
            email: string;
            business_name: string | null;
            past_due_since: string | null;
          }>(
            "SELECT email, business_name, past_due_since FROM clients " +
            "WHERE stripe_customer_id = $1",
            [customerId]
          );
          await pool.query(
            "UPDATE clients SET past_due_since = COALESCE(past_due_since, NOW()), " +
            "stripe_subscription_id = $1, updated_at = NOW() " +
            "WHERE stripe_customer_id = $2",
            [subscription.id, customerId]
          );
          // Immediate notice — only on the FIRST past_due event (so dunning
          // retries don't re-spam). The cron handles the daily reminders next.
          const c = before.rows[0];
          if (c && c.past_due_since == null) {
            try {
              await sendEmail({
                to: c.email,
                ...paymentFailedEmail(c.business_name ?? ""),
              });
            } catch (err) {
              console.error("Payment-failed email send failed:", err);
            }
          }
          console.log("Subscription past_due — grace clock started/continued");
        } else {
          // incomplete / incomplete_expired / paused — keep sub id synced.
          await pool.query(
            "UPDATE clients SET stripe_subscription_id = $1, updated_at = NOW() " +
            "WHERE stripe_customer_id = $2",
            [subscription.id, customerId]
          );
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
