// app/api/square/webhook/route.ts
//
// Phase 11d. Public webhook receiver for Square payment events.
// Square POSTs HMAC-SHA256-signed payloads here when payments are
// created/updated.
//
// Subscribe in Square Developer Dashboard → Webhooks → Add
// Subscription:
//   - URL: https://godreamward.com/api/square/webhook
//   - API Version: 2025-04-16 (matches our lib/square Square-Version)
//   - Event types: payment.created, payment.updated,
//     refund.created, refund.updated
//   - Signature key: copy from the subscription details + add to
//     Vercel as SQUARE_WEBHOOK_SIGNATURE_KEY
//
// Refunds (refund.created / refund.updated) → a separate NEGATIVE
// income row that nets against the original sale (see
// handleRefundEvent + lib/square.mapRefundToProcessedItem). Only
// COMPLETED refunds count.
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
import { decryptFromDb } from "@/lib/crypto";
import {
  getSquareEnvironment,
  mapPaymentToProcessedItem,
  mapRefundToProcessedItem,
  isCompletedRefund,
  verifyWebhookSignature,
  getOrder,
  extractSquareLineItems,
  extractSquareOrderMoney,
  type SquarePayment,
  type SquareRefund,
} from "@/lib/square";
import { bulkInsertLineItemsForParent } from "@/lib/cogs/lineItems";

// Square's webhook subscription is keyed by notification URL.
// Must match exactly what we registered in the Dev Console.
function notificationUrl(): string {
  return (
    process.env.SQUARE_WEBHOOK_NOTIFICATION_URL ||
    "https://godreamward.com/api/square/webhook"
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
      object?: { payment?: SquarePayment; refund?: SquareRefund };
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
  // Dreamward user can have both sandbox + prod connected.
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
  const isRefundEvent =
    eventType === "refund.created" ||
    eventType === "refund.updated";

  // Refunds → a separate NEGATIVE income row that nets against the
  // original Square sale (mirrors Shopify). No line-item fan-out.
  if (isRefundEvent) {
    await handleRefundEvent(conn, eventType, envelope.data?.object?.refund ?? null);
    await touchSyncState(conn.id, eventType);
    return NextResponse.json({ acknowledged: true, action: "refund" });
  }

  if (!isPaymentEvent) {
    console.log(
      `Square webhook: event=${eventType} not a payment/refund event — no-op`
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
  let parentId: number | null = null;
  let row: ReturnType<typeof mapPaymentToProcessedItem> | null = null;
  try {
    row = mapPaymentToProcessedItem(payment);
    // Phase 12c: RETURNING id so we can fan out line items below.
    // RETURNING fires on both INSERT and DO UPDATE paths so webhook
    // redelivery still gets the parent id and re-runs the line-item
    // INSERT (idempotent via the (processed_item_id, external_id)
    // UNIQUE index on processed_item_line_items).
    const upsertRes = await pool.query<{ id: number }>(
      `INSERT INTO processed_items (
         vendor, invoice_number, amount, due_date, status,
         category, source, source_ref_id, channel, confidence,
         summary, extracted_data, tax_amount, tip_amount, client_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (client_id, source, source_ref_id)
         WHERE source_ref_id IS NOT NULL
       DO UPDATE SET
         status = EXCLUDED.status,
         amount = EXCLUDED.amount,
         summary = EXCLUDED.summary,
         extracted_data = EXCLUDED.extracted_data,
         tip_amount = EXCLUDED.tip_amount
       RETURNING id`,
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
        row.tax_amount,
        row.tip_amount,
        conn.client_id,
      ]
    );
    parentId = upsertRes.rows[0]?.id ?? null;

    console.log(
      `Square webhook: event=${eventType} payment=${payment.id} → client_id=${conn.client_id} upserted`
    );
  } catch (err) {
    console.error("Square webhook: upsert failed:", err);
    return NextResponse.json({ acknowledged: true, dbError: true });
  }

  // ── 7. Phase 12c: fan line items into processed_item_line_items
  //
  // Square is the only platform where line items aren't in the
  // webhook payload — we have to fetch the parent Order to get
  // them. That means doing the access-token dance from the
  // webhook path. Pragmatic choice: read + decrypt the EXISTING
  // token, attempt getOrder, silently skip line items on failure.
  //
  // Why no token refresh here:
  //   - Webhooks are public, anonymous endpoints. A refresh
  //     failure (Square down, refresh token expired) shouldn't
  //     cascade into Square disabling the subscription via
  //     repeated 5xx returns. We always return 200.
  //   - The backfill + future daily-reconciliation paths DO
  //     refresh tokens. They'll re-ingest any line items we
  //     missed during a stale-token window via the Phase 12g
  //     re-import path.
  //
  // If the payment has no order_id, skip entirely (rare — Square
  // standalone API payments without an Order — they carry no SKU
  // detail by design).
  if (parentId && row && payment.order_id) {
    try {
      const tokenRow = await pool.query<{
        ciphertext: Buffer;
        iv: Buffer;
        auth_tag: Buffer;
      }>(
        `SELECT access_token_ciphertext AS ciphertext,
                access_token_iv        AS iv,
                access_token_auth_tag  AS auth_tag
           FROM square_connections
          WHERE id = $1`,
        [conn.id]
      );
      if (tokenRow.rows[0]) {
        const accessToken = decryptFromDb({
          ciphertext: tokenRow.rows[0].ciphertext,
          iv: tokenRow.rows[0].iv,
          authTag: tokenRow.rows[0].auth_tag,
        });
        const order = await getOrder({
          accessToken,
          orderId: payment.order_id,
        });
        if (order) {
          // The order carries the money breakdown — record it on the parent.
          // Tax is excluded from income downstream; tip + service stay in.
          const { tax, tip, service, discount } = extractSquareOrderMoney(order);
          await pool.query(
            `UPDATE processed_items
                SET tax_amount = $1, tip_amount = $2,
                    service_charge_amount = $3, discount_amount = $4
              WHERE id = $5 AND client_id = $6`,
            [tax, tip, service, discount, parentId, conn.client_id]
          );
          const items = extractSquareLineItems(order);
          if (items.length > 0) {
            await bulkInsertLineItemsForParent({
              parentId,
              clientId: conn.client_id,
              platform: "square",
              soldAt: row.due_date,
              items,
            });
          }
        }
      }
    } catch (lineItemErr) {
      // Don't fail the webhook — parent row is already saved.
      // Re-import path can fill in missed line items later.
      console.warn(
        `Square webhook: line-item fan-out failed for payment=${payment.id}:`,
        lineItemErr instanceof Error ? lineItemErr.message : lineItemErr
      );
    }
  }

  await touchSyncState(conn.id, eventType);
  return NextResponse.json({ acknowledged: true, action: "upserted" });
}

/**
 * Handle a refund.created / refund.updated event. Inserts a NEGATIVE
 * income row that nets against the original Square sale. Only COMPLETED
 * refunds count (PENDING is followed by an update when it settles).
 * Always swallows errors — the webhook must still return 200 so Square
 * doesn't disable the subscription; the backfill path re-syncs misses.
 */
async function handleRefundEvent(
  conn: SquareConnectionLookupRow,
  eventType: string,
  refund: SquareRefund | null
): Promise<void> {
  if (!refund || typeof refund.id !== "string") {
    console.warn(`Square webhook: event=${eventType} has no parseable refund`);
    return;
  }
  // Only COMPLETED refunds represent money actually returned. A PENDING
  // refund.created is followed by a refund.updated when it settles — we
  // ingest then. REJECTED/FAILED never count.
  if (!isCompletedRefund(refund)) {
    console.log(
      `Square webhook: refund=${refund.id} status=${refund.status} not completed — skipping`
    );
    return;
  }

  // Look up the original payment row (by source_ref_id = payment_id) to
  // inherit the buyer label + the tax slice to reverse. Square sale rows
  // exclude tax from income, so the refund must carry a negative
  // tax_amount for revenue AND salesTaxCollected to net back out.
  let original:
    | { vendor: string; amount: number; taxAmount: number | null }
    | null = null;
  if (refund.payment_id) {
    try {
      const res = await pool.query<{
        vendor: string;
        amount: string;
        tax_amount: string | null;
      }>(
        `SELECT vendor, amount, tax_amount
           FROM processed_items
          WHERE client_id = $1 AND source = 'square' AND source_ref_id = $2`,
        [conn.client_id, refund.payment_id]
      );
      if (res.rows[0]) {
        original = {
          vendor: res.rows[0].vendor,
          amount: Number(res.rows[0].amount),
          taxAmount:
            res.rows[0].tax_amount != null
              ? Number(res.rows[0].tax_amount)
              : null,
        };
      }
    } catch (err) {
      console.warn(
        `Square webhook: original-payment lookup failed for refund=${refund.id}:`,
        err instanceof Error ? err.message : err
      );
    }
  }

  const row = mapRefundToProcessedItem({ refund, original });
  try {
    await pool.query(
      `INSERT INTO processed_items (
         vendor, invoice_number, amount, due_date, status,
         category, source, source_ref_id, channel, confidence,
         summary, extracted_data, tax_amount, tip_amount, client_id
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (client_id, source, source_ref_id)
         WHERE source_ref_id IS NOT NULL
       DO UPDATE SET
         status = EXCLUDED.status,
         amount = EXCLUDED.amount,
         summary = EXCLUDED.summary,
         extracted_data = EXCLUDED.extracted_data,
         tax_amount = EXCLUDED.tax_amount`,
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
        row.tax_amount,
        row.tip_amount,
        conn.client_id,
      ]
    );
    console.log(
      `Square webhook: refund=${refund.id} → client_id=${conn.client_id} upserted (amount=${row.amount})`
    );
  } catch (err) {
    console.error(
      `Square webhook: refund upsert failed for ${refund.id}:`,
      err
    );
  }
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
