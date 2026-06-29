// app/api/stripe-connect/webhook/route.ts
//
// Stripe CONNECT webhook — ongoing sync of a connected account's charges
// into income. Separate endpoint + secret from the billing webhook
// (/api/stripe/webhook). Connect events carry the connected account id in
// the top-level `event.account`, which maps back to a Dreamward client via
// stripe_connections.
//
// Configure in Stripe Dashboard → Connect webhook with events:
//   charge.succeeded   → ingest as income (idempotent vs the backfill)
//   charge.refunded    → adjust the income row to net-of-refund
// Secret → env STRIPE_CONNECT_WEBHOOK_SECRET.

import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import pool from "@/lib/db";
import {
  isIngestibleCharge,
  chargeToProcessedItem,
  chargeToLineItem,
  chargeSoldAtIso,
} from "@/lib/stripeConnect";
import { bulkInsertLineItemsAcrossParents } from "@/lib/cogs/lineItems";

/** Insert a charge as an income transaction + one SKU-less line item.
 *  Idempotent — ON CONFLICT dedups against the backfill / replays. */
async function ingestCharge(clientId: number, charge: Stripe.Charge) {
  const r = chargeToProcessedItem(charge);
  const ins = await pool.query<{ id: number }>(
    `INSERT INTO processed_items (
       vendor, invoice_number, amount, due_date, status,
       category, source, source_ref_id, channel, confidence,
       summary, extracted_data, client_id
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13)
     ON CONFLICT (client_id, source, source_ref_id)
       WHERE source_ref_id IS NOT NULL
     DO NOTHING
     RETURNING id`,
    [
      r.vendor,
      r.invoice_number,
      r.amount,
      r.due_date,
      r.status,
      r.category,
      r.source,
      r.source_ref_id,
      r.channel,
      r.confidence,
      r.summary,
      JSON.stringify(r.extracted_data),
      clientId,
    ]
  );
  if (ins.rowCount && ins.rowCount > 0) {
    await bulkInsertLineItemsAcrossParents({
      clientId,
      platform: "stripe",
      parents: [
        {
          parentId: ins.rows[0].id,
          soldAt: chargeSoldAtIso(charge),
          items: [chargeToLineItem(charge)],
        },
      ],
    });
  }
}

/** Re-net an already-ingested charge after a refund. Updates the income
 *  row + its line item to the new net; fully-refunded → cancelled. */
async function applyRefund(clientId: number, charge: Stripe.Charge) {
  const captured = charge.amount_captured ?? charge.amount ?? 0;
  const net = (captured - (charge.amount_refunded ?? 0)) / 100;
  const status = net <= 0 ? "cancelled" : "paid";
  const upd = await pool.query<{ id: number }>(
    `UPDATE processed_items
        SET amount = $3, status = $4, updated_at = NOW()
      WHERE client_id = $1 AND source = 'stripe' AND source_ref_id = $2
      RETURNING id`,
    [clientId, charge.id, net, status]
  );
  if (upd.rowCount && upd.rows[0]) {
    await pool.query(
      `UPDATE processed_item_line_items
          SET unit_price = $3
        WHERE processed_item_id = $1 AND external_id = $2`,
      [upd.rows[0].id, charge.id, net]
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.text();
    const sig = request.headers.get("stripe-signature");
    const secret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET;
    if (!secret) {
      console.error("STRIPE_CONNECT_WEBHOOK_SECRET is not configured");
      return NextResponse.json(
        { error: "Webhook not configured" },
        { status: 500 }
      );
    }
    if (!sig) {
      return NextResponse.json({ error: "Missing signature" }, { status: 400 });
    }

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(body, sig, secret);
    } catch (err) {
      console.error("Connect webhook signature verification failed:", err);
      return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
    }

    // Idempotency: skip replays (Stripe delivers at-least-once). Shared
    // table with the platform webhook — event ids are globally unique.
    const dedup = await pool.query(
      `INSERT INTO processed_stripe_events (event_id) VALUES ($1)
       ON CONFLICT (event_id) DO NOTHING RETURNING event_id`,
      [event.id]
    );
    if (dedup.rowCount === 0) {
      return NextResponse.json({ received: true, duplicate: true });
    }

    // Connect events carry the connected account id; platform events don't.
    const accountId = event.account;
    if (!accountId) {
      return NextResponse.json({ received: true });
    }

    const conn = await pool.query<{ client_id: number }>(
      "SELECT client_id FROM stripe_connections WHERE stripe_account_id = $1",
      [accountId]
    );
    if (conn.rowCount === 0) {
      return NextResponse.json({ received: true }); // unknown account — ignore
    }
    const clientId = conn.rows[0].client_id;

    if (event.type === "charge.succeeded") {
      const charge = event.data.object as Stripe.Charge;
      if (isIngestibleCharge(charge)) await ingestCharge(clientId, charge);
    } else if (event.type === "charge.refunded") {
      await applyRefund(clientId, event.data.object as Stripe.Charge);
    }

    // Mark live sync active (record this event type once).
    await pool.query(
      `UPDATE stripe_connections
          SET webhook_event_types =
                ARRAY(SELECT DISTINCT unnest(webhook_event_types || ARRAY[$2]::text[])),
              last_sync_at = NOW(),
              updated_at = NOW()
        WHERE stripe_account_id = $1`,
      [accountId, event.type]
    );

    return NextResponse.json({ received: true });
  } catch (err) {
    console.error("Stripe Connect webhook error:", err);
    return NextResponse.json(
      { error: "Webhook handler failed" },
      { status: 500 }
    );
  }
}
