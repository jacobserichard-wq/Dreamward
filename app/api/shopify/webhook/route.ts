// app/api/shopify/webhook/route.ts
//
// Phase 8d commit 2 of 3.
//
// PUBLIC endpoint that receives Shopify webhook POSTs. NO session
// auth (Shopify doesn't send a session cookie); security comes from
// HMAC-SHA256 signature verification against the FlowWork app
// client secret.
//
// proxy.ts intentionally EXCLUDES /api/shopify/webhook from the
// authenticated matcher (sibling pattern to /api/stripe/webhook +
// /api/cron). This route is documented as public there.
//
// Routing:
//   - X-Shopify-Hmac-SHA256:  signature header to verify
//   - X-Shopify-Shop-Domain:  the shop sending the event
//   - X-Shopify-Topic:        the event type (orders/create, etc.)
//
// Per-topic handlers (4):
//   - orders/create     → INSERT new processed_items row
//   - orders/updated    → UPSERT (matches existing by source_ref_id)
//   - orders/cancelled  → soft-cancel (status='cancelled', preserve row)
//   - refunds/create    → INSERT a NEGATIVE row with source_ref_id='refund-{id}'
//
// Idempotency:
//   - orders/create + orders/updated use ON CONFLICT DO UPDATE so
//     Shopify retrying the same event doesn't create duplicates
//     (matches the unique partial index from migration 0010).
//   - refunds/create uses the same pattern keyed on
//     source_ref_id = 'refund-{refundId}'.
//
// Critical: ALWAYS return 200 quickly. Shopify treats any non-2xx
// (or >5s response) as a delivery failure + retries with backoff.
// Real errors get logged + we 200 anyway — the daily reconciliation
// cron (8e) will fill in anything that slips through.

import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  verifyWebhookHmac,
  mapOrderToProcessedItem,
  mapRefundToProcessedItem,
  type ShopifyOrder,
  type ShopifyRefund,
} from "@/lib/shopify";

interface ShopifyConnectionLookup {
  id: number;
  client_id: number;
}

export async function POST(req: NextRequest) {
  // ── 1. Read raw body for HMAC verification ───────────────────
  // CRITICAL: must use the raw bytes, not the JSON-parsed body.
  // Parsing whitespace-normalizes the payload and the HMAC won't match.
  const rawBody = await req.text();

  // ── 2. Verify HMAC ───────────────────────────────────────────
  const hmacHeader = req.headers.get("x-shopify-hmac-sha256") ?? "";
  if (!verifyWebhookHmac(rawBody, hmacHeader)) {
    console.warn("Shopify webhook rejected: HMAC verification failed");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  // ── 3. Identify shop + topic ─────────────────────────────────
  const shopDomain = req.headers.get("x-shopify-shop-domain") ?? "";
  const topic = req.headers.get("x-shopify-topic") ?? "";
  if (!shopDomain || !topic) {
    console.warn("Shopify webhook missing shop-domain or topic header");
    return NextResponse.json({ error: "Missing headers" }, { status: 400 });
  }

  // ── 4. Map shop → FlowWork client ────────────────────────────
  // shop_domain is UNIQUE in shopify_connections, so at most one
  // row matches. If none matches, the FlowWork connection was
  // disconnected but Shopify hasn't processed the webhook deletion
  // yet — silently 200 (idempotent, no work to do).
  const lookup = await pool.query<ShopifyConnectionLookup>(
    `SELECT id, client_id FROM shopify_connections WHERE shop_domain = $1`,
    [shopDomain]
  );
  if (lookup.rows.length === 0) {
    console.log(
      `Shopify webhook for ${shopDomain} but no active connection — ignoring`
    );
    return NextResponse.json({ received: true, action: "no_connection" });
  }
  const { client_id: clientId } = lookup.rows[0];

  // ── 5. Parse payload + route on topic ────────────────────────
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch (err) {
    console.error("Shopify webhook JSON parse failed:", err);
    return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
  }

  try {
    switch (topic) {
      case "orders/create":
      case "orders/updated":
        await handleOrderUpsert(clientId, payload as ShopifyOrder);
        break;

      case "orders/cancelled":
        await handleOrderCancelled(clientId, payload as ShopifyOrder);
        break;

      case "refunds/create":
        await handleRefundCreate(clientId, payload as ShopifyRefund);
        break;

      default:
        console.log(`Shopify webhook topic '${topic}' received but no handler — ignoring`);
        return NextResponse.json({ received: true, action: "unhandled_topic" });
    }

    // Bump last_sync_at so the UI shows recent activity
    await pool.query(
      `UPDATE shopify_connections
          SET last_sync_at = NOW(),
              last_sync_status = 'success',
              updated_at = NOW()
        WHERE client_id = $1`,
      [clientId]
    );

    return NextResponse.json({ received: true, topic });
  } catch (err) {
    // Log + 200 anyway. Shopify retries 5xx but we don't want
    // repeated delivery attempts to amplify a transient issue.
    // Daily reconciliation cron (8e) picks up anything missed.
    console.error(`Shopify webhook handler failed (topic=${topic}):`, err);
    return NextResponse.json({
      received: true,
      handler_error: err instanceof Error ? err.message : "unknown",
    });
  }
}

// ─────────────────────────────────────────────────────────────────
// Per-topic handlers
// ─────────────────────────────────────────────────────────────────

/**
 * orders/create + orders/updated. UPSERT into processed_items keyed
 * on (client_id, source, source_ref_id) — matches the unique partial
 * index from migration 0010. Updates EVERY mutable field so an
 * orders/updated event correctly overwrites any changed values.
 */
async function handleOrderUpsert(clientId: number, order: ShopifyOrder) {
  const row = mapOrderToProcessedItem(order);
  await pool.query(
    `INSERT INTO processed_items (
       vendor, invoice_number, amount, due_date, status,
       category, source, source_ref_id, confidence, summary,
       extracted_data, client_id
     ) VALUES (
       $1, $2, $3, $4, $5,
       $6, $7, $8, $9, $10,
       $11, $12
     )
     ON CONFLICT (client_id, source, source_ref_id) DO UPDATE
       SET vendor = EXCLUDED.vendor,
           invoice_number = EXCLUDED.invoice_number,
           amount = EXCLUDED.amount,
           due_date = EXCLUDED.due_date,
           status = EXCLUDED.status,
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
      row.confidence,
      row.summary,
      JSON.stringify(row.extracted_data),
      clientId,
    ]
  );
}

/**
 * orders/cancelled. Set status='cancelled' on the existing row;
 * preserve all other fields so the audit trail (original amount,
 * customer, etc.) stays intact. Does NOT DELETE — cancelled orders
 * still appear in historical reports for accuracy.
 *
 * Edge case: if we somehow never saw the create event, INSERT a new
 * row with status='cancelled' (better to have a partial record than
 * none — daily cron will fill in the rest).
 */
async function handleOrderCancelled(clientId: number, order: ShopifyOrder) {
  const row = mapOrderToProcessedItem(order);
  // mapOrderToProcessedItem already sets status='cancelled' when
  // cancelled_at is non-null, so we can reuse the upsert path here.
  await handleOrderUpsert(clientId, order);
  void row; // satisfy linter — kept for clarity
}

/**
 * refunds/create. Looks up the ORIGINAL order's processed_items row
 * to pull customer name + currency (the refund payload doesn't
 * carry them). Inserts a NEGATIVE-amount row with source_ref_id =
 * 'refund-{refundId}' so the dedup index treats it as distinct from
 * the original order.
 */
async function handleRefundCreate(clientId: number, refund: ShopifyRefund) {
  // Look up the original order's row to inherit customer name + currency
  const original = await pool.query<{
    vendor: string;
    invoice_number: string;
    extracted_data: Record<string, unknown>;
  }>(
    `SELECT vendor, invoice_number, extracted_data
       FROM processed_items
      WHERE client_id = $1
        AND source = 'shopify'
        AND source_ref_id = $2`,
    [clientId, String(refund.order_id)]
  );

  // Defaults if the original row isn't found (edge case — webhook
  // delivery order isn't strictly guaranteed; daily cron will
  // backfill the original later).
  const customerName = original.rows[0]?.vendor ?? "Shopify refund";
  const originalOrderName =
    original.rows[0]?.invoice_number ?? `#${refund.order_id}`;
  const currency =
    typeof original.rows[0]?.extracted_data?.currency === "string"
      ? (original.rows[0].extracted_data.currency as string)
      : "USD";

  const row = mapRefundToProcessedItem({
    refund,
    originalOrderName,
    customerName,
    currency,
  });

  await pool.query(
    `INSERT INTO processed_items (
       vendor, invoice_number, amount, due_date, status,
       category, source, source_ref_id, confidence, summary,
       extracted_data, client_id
     ) VALUES (
       $1, $2, $3, $4, $5,
       $6, $7, $8, $9, $10,
       $11, $12
     )
     ON CONFLICT (client_id, source, source_ref_id) DO UPDATE
       SET amount = EXCLUDED.amount,
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
      row.confidence,
      row.summary,
      JSON.stringify(row.extracted_data),
      clientId,
    ]
  );
}
