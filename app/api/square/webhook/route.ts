// app/api/square/webhook/route.ts
//
// Phase 11d. Public webhook receiver for Square payment events.
// Square POSTs HMAC-SHA256-signed payloads here when payments are
// created/updated.
//
// Subscribe in Square Developer Dashboard → Webhooks → Add
// Subscription:
//   - URL: https://flowworks.it.com/api/square/webhook
//   - API Version: 2025-04-16 (matches our lib/square Square-Version)
//   - Event types: payment.created, payment.updated
//   - Signature key: copy from the subscription details + add to
//     Vercel as SQUARE_WEBHOOK_SIGNATURE_KEY
//
// Flow per delivery:
//   1. Read raw body (HMAC verification needs the unmodified text)
//   2. Verify Square-Signature header via lib/square.verifyWebhookSignature
//      (HMAC-SHA256 of notification_url + raw_body, timing-safe compare)
//   3. Parse JSON envelope: { merchant_id, type, event_id, created_at,
//      data: { type: 'payment', id, object: { payment: {...} } } }
//   4. Look up square_connections by merchant_id + environment
//      (sandbox/prod can have the same merchant_id; environment is
//      derived from SQUARE_ENVIRONMENT)
//   5. Route by event type — payment.created / payment.updated →
//      upsert into processed_items via mapPaymentToProcessedItem
//   6. touchSyncState: update last_sync_at + add event type to
//      webhook_subscription_ids (so the card flips "Webhooks pending"
//      → "Live sync active")

import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  getSquareEnvironment,
  mapPaymentToProcessedItem,
  verifyWebhookSignature,
  type SquarePayment,
} from "@/lib/square";

// Square's webhook subscription is keyed by notification URL.
// Must match exactly what we registered in the Dev Console.
function notificationUrl(): string {
  return (
    process.env.SQUARE_WEBHOOK_NOTIFICATION_URL ||
    "https://flowworks.it.com/api/square/webhook"
  );
}

interface SquareConnectionLookupRow {
  id: number;
  client_id: number;
  webhook_subscription_ids: string[];
}

export async function POST(req: NextRequest) {
  // ── 1. Read raw body ────────────────────────────────────────
  let raw: string;
  try {
    raw = await req.text();
  } catch (err) {
    console.error("Square webhook: failed to read body:", err);
    return NextResponse.json(
      { error: "Couldn't read request body" },
      { status: 400 }
    );
  }
  if (!raw) {
    return NextResponse.json({ error: "Empty body" }, { status: 400 });
  }

  // ── 2. Verify Square-Signature header ───────────────────────
  // Square uses HMAC-SHA256 of (notification_url + raw_body). The
  // header name varies slightly by API version — accept both common
  // variants. Header value is base64 (not hex).
  const sig =
    req.headers.get("x-square-hmacsha256-signature") ||
    req.headers.get("x-square-signature") ||
    null;
  const verified = verifyWebhookSignature({
    rawBody: raw,
    signatureHeader: sig,
    notificationUrl: notificationUrl(),
  });
  if (!verified) {
    console.warn(
      "Square webhook: signature verification failed (header present: " +
        String(!!sig) +
        ")"
    );
    return NextResponse.json(
      { error: "Webhook signature verification failed" },
      { status: 401 }
    );
  }

  // ── 3. Parse envelope ───────────────────────────────────────
  let envelope: {
    merchant_id?: string;
    type?: string;
    event_id?: string;
    data?: {
      type?: string;
      id?: string;
      object?: { payment?: SquarePayment };
    };
  };
  try {
    envelope = JSON.parse(raw);
  } catch (err) {
    console.warn("Square webhook: malformed JSON body:", err);
    return NextResponse.json(
      { error: "Body is not valid JSON" },
      { status: 400 }
    );
  }

  const eventType = envelope.type ?? "(unknown)";
  const merchantId = envelope.merchant_id ?? null;

  if (!merchantId) {
    console.warn(
      `Square webhook: event=${eventType} has no merchant_id — envelope keys:`,
      Object.keys(envelope)
    );
    return NextResponse.json({ acknowledged: true, action: "no_merchant" });
  }

  // ── 4. Look up our binding ──────────────────────────────────
  // Match on (merchant_id, environment) since the unique key in
  // square_connections is (merchant_id, environment) — a single
  // FlowWork user can have both sandbox + prod connected.
  const environment = getSquareEnvironment();
  let conn: SquareConnectionLookupRow | null = null;
  try {
    const res = await pool.query<SquareConnectionLookupRow>(
      `SELECT id, client_id, webhook_subscription_ids
         FROM square_connections
        WHERE merchant_id = $1 AND environment = $2`,
      [merchantId, environment]
    );
    conn = res.rows[0] ?? null;
  } catch (err) {
    console.error("Square webhook: DB lookup failed:", err);
    return NextResponse.json({ acknowledged: true, dbError: true });
  }

  if (!conn) {
    // Webhook for a merchant we don't track — either unbound, or a
    // sandbox/prod mismatch with our env config.
    console.log(
      `Square webhook: event=${eventType} merchant=${merchantId} env=${environment} ` +
        `unbound — ignoring`
    );
    return NextResponse.json({ acknowledged: true, action: "unbound" });
  }

  // ── 5. Route by event type ──────────────────────────────────
  const isPaymentEvent =
    eventType === "payment.created" ||
    eventType === "payment.updated";

  if (!isPaymentEvent) {
    console.log(
      `Square webhook: event=${eventType} not a payment event — no-op`
    );
    await touchSyncState(conn.id, eventType);
    return NextResponse.json({ acknowledged: true, action: "no_op" });
  }

  // Extract the payment object. Square's webhook envelope wraps it
  // as data.object.payment.
  const payment = envelope.data?.object?.payment;
  if (!payment || typeof payment.id !== "string") {
    console.warn(
      `Square webhook: event=${eventType} has no parseable payment — data keys:`,
      envelope.data ? Object.keys(envelope.data) : null
    );
    await touchSyncState(conn.id, eventType);
    return NextResponse.json({ acknowledged: true, action: "no_payment" });
  }

  // ── 6. Upsert into processed_items ──────────────────────────
  try {
    const row = mapPaymentToProcessedItem(payment);
    await pool.query(
      `INSERT INTO processed_items (
         vendor, invoice_number, amount, due_date, status,
         category, source, source_ref_id, channel, confidence,
         summary, extracted_data, client_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (client_id, source, source_ref_id)
         WHERE source_ref_id IS NOT NULL
       DO UPDATE SET
         status = EXCLUDED.status,
         amount = EXCLUDED.amount,
         summary = EXCLUDED.summary,
         extracted_data = EXCLUDED.extracted_data`,
      [
        row.vendor,
        row.invoice_number,
        row.amount,
        row.due_date,
        row.status,
        row.category,
        row.source,
        row.source_ref_id,
        row.channel,
        row.confidence,
        row.summary,
        JSON.stringify(row.extracted_data),
        conn.client_id,
      ]
    );

    console.log(
      `Square webhook: event=${eventType} payment=${payment.id} → client_id=${conn.client_id} upserted`
    );
  } catch (err) {
    console.error("Square webhook: upsert failed:", err);
    return NextResponse.json({ acknowledged: true, dbError: true });
  }

  await touchSyncState(conn.id, eventType);
  return NextResponse.json({ acknowledged: true, action: "upserted" });
}

/**
 * Update last_sync_at + append eventType to webhook_subscription_ids
 * if not already present. Non-empty array flips the card's "Webhooks
 * pending" indicator to "Live sync active".
 */
async function touchSyncState(
  connectionId: number,
  eventType: string
): Promise<void> {
  try {
    await pool.query(
      `UPDATE square_connections
          SET last_sync_at = NOW(),
              last_sync_status = 'success',
              last_sync_error = NULL,
              webhook_subscription_ids =
                CASE
                  WHEN $2 = ANY(webhook_subscription_ids)
                  THEN webhook_subscription_ids
                  ELSE array_append(webhook_subscription_ids, $2)
                END,
              updated_at = NOW()
        WHERE id = $1`,
      [connectionId, eventType]
    );
  } catch (err) {
    console.warn("Square webhook: touchSyncState failed (non-fatal):", err);
  }
}
