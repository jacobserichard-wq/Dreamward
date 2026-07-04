// app/api/shopify/webhook/route.ts
//
// Phase 8d commit 2 of 3.
//
// PUBLIC endpoint that receives Shopify webhook POSTs. NO session
// auth (Shopify doesn't send a session cookie); security comes from
// HMAC-SHA256 signature verification against the Dreamward app
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
// GDPR compliance handlers (3) — MANDATORY for Shopify App Store
// approval (added 2026-07-03 for the public-distribution submission):
//   - customers/data_request → log the request for manual fulfilment
//   - customers/redact       → anonymize customer PII on named orders
//   - shop/redact            → drop the connection + anonymize the
//                              shop's order PII (48h after uninstall)
// These route BEFORE the connection lookup below: shop/redact arrives
// after uninstall, when the shopify_connections row may already be
// deleted, so they resolve the shop themselves and no-op cleanly when
// there's nothing left to redact. All three are HMAC-verified like any
// other webhook, so a forged redact can't wipe a live merchant's data.
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
  extractShopifyLineItems,
  type ShopifyOrder,
  type ShopifyRefund,
} from "@/lib/shopify";
import { bulkInsertLineItemsForParent } from "@/lib/cogs/lineItems";

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

  // ── 3b. GDPR compliance webhooks (mandatory for App Store) ────
  // Handled here, BEFORE the connection lookup, because shop/redact
  // fires 48h after uninstall (connection row may be gone) and must
  // still succeed. Deliberate divergence from the "always 200" rule:
  // a redact/erase failure returns 500 so Shopify RETRIES — silently
  // 200-ing a failed data deletion would break our GDPR obligation.
  if (
    topic === "customers/data_request" ||
    topic === "customers/redact" ||
    topic === "shop/redact"
  ) {
    let gdpr: unknown;
    try {
      gdpr = JSON.parse(rawBody);
    } catch (err) {
      console.error("Shopify compliance webhook JSON parse failed:", err);
      return NextResponse.json({ error: "Bad JSON" }, { status: 400 });
    }
    try {
      switch (topic) {
        case "customers/data_request":
          await handleCustomerDataRequest(
            shopDomain,
            gdpr as CustomerDataRequestPayload
          );
          break;
        case "customers/redact":
          await handleCustomerRedact(shopDomain, gdpr as CustomerRedactPayload);
          break;
        case "shop/redact":
          await handleShopRedact(shopDomain, gdpr as ShopRedactPayload);
          break;
      }
      return NextResponse.json({ received: true, topic });
    } catch (err) {
      console.error(`Shopify compliance handler failed (topic=${topic}):`, err);
      // 500 → Shopify retries (up to 48h). Correct for a data-deletion
      // obligation: better a retry than a false "handled".
      return NextResponse.json(
        { error: "compliance handler failed" },
        { status: 500 }
      );
    }
  }

  // ── 4. Map shop → Dreamward client ────────────────────────────
  // shop_domain is UNIQUE in shopify_connections, so at most one
  // row matches. If none matches, the Dreamward connection was
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
  // Phase 12c: capture the parent id from RETURNING so we can fan
  // out line items into processed_item_line_items. RETURNING fires
  // on both INSERT and DO UPDATE paths, so webhook redelivery
  // (which hits DO UPDATE) still gets the parent id and re-runs
  // the line-item upsert. The (processed_item_id, external_id)
  // UNIQUE constraint on processed_item_line_items + ON CONFLICT
  // DO NOTHING in bulkInsertLineItemsForParent makes that
  // idempotent: redeliveries skip rather than duplicating.
  const upsertRes = await pool.query<{ id: number }>(
    `INSERT INTO processed_items (
       vendor, invoice_number, amount, tax_amount, due_date, status,
       category, source, source_ref_id, confidence, summary,
       extracted_data, client_id
     ) VALUES (
       $1, $2, $3, $4, $5,
       $6, $7, $8, $9, $10,
       $11, $12, $13
     )
     ON CONFLICT (client_id, source, source_ref_id)
       WHERE source_ref_id IS NOT NULL
     DO UPDATE
       SET vendor = EXCLUDED.vendor,
           invoice_number = EXCLUDED.invoice_number,
           amount = EXCLUDED.amount,
           tax_amount = EXCLUDED.tax_amount,
           due_date = EXCLUDED.due_date,
           status = EXCLUDED.status,
           summary = EXCLUDED.summary,
           extracted_data = EXCLUDED.extracted_data
     RETURNING id`,
    [
      row.vendor,
      row.invoice_number,
      row.amount,
      row.tax_amount,
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

  const parentId = upsertRes.rows[0]?.id;
  if (parentId) {
    const lineItems = extractShopifyLineItems(order);
    if (lineItems.length > 0) {
      // Atomic: line items + stock draw + FIFO consumption commit together,
      // so a crash mid-recordSaleAdjustments can't desync inventory_adjustments
      // from quantity_on_hand / cost layers. The parent row above is already
      // committed and stays decoupled — a line-item failure here rolls back
      // only the items/stock and is recoverable via the daily reconcile cron.
      const db = await pool.connect();
      try {
        await db.query("BEGIN");
        await bulkInsertLineItemsForParent({
          dbClient: db,
          parentId,
          clientId,
          platform: "shopify",
          soldAt: row.due_date,
          items: lineItems,
        });
        await db.query("COMMIT");
      } catch (txErr) {
        await db.query("ROLLBACK").catch(() => {});
        throw txErr;
      } finally {
        db.release();
      }
    }
  }
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
    amount: string;
    tax_amount: string | null;
    extracted_data: Record<string, unknown>;
  }>(
    `SELECT vendor, invoice_number, amount, tax_amount, extracted_data
       FROM processed_items
      WHERE client_id = $1
        AND source = 'shopify'
        AND source_ref_id = $2`,
    [clientId, String(refund.order_id)]
  );

  // Defaults if the original row isn't found (edge case — webhook
  // delivery order isn't strictly guaranteed; daily cron will
  // backfill the original later).
  const orig = original.rows[0];
  const customerName = orig?.vendor ?? "Shopify refund";
  const originalOrderName = orig?.invoice_number ?? `#${refund.order_id}`;
  const currency =
    typeof orig?.extracted_data?.currency === "string"
      ? (orig.extracted_data.currency as string)
      : "USD";
  const originalAmount = orig ? Number(orig.amount) || 0 : 0;
  // Prefer the tax_amount column; fall back to extracted_data.tax for
  // orders ingested before tax was separated onto the column.
  const originalTax = orig
    ? orig.tax_amount != null
      ? Number(orig.tax_amount) || 0
      : Number(orig.extracted_data?.tax) || 0
    : 0;

  const row = mapRefundToProcessedItem({
    refund,
    originalOrderName,
    customerName,
    currency,
    originalAmount,
    originalTax,
  });

  await pool.query(
    `INSERT INTO processed_items (
       vendor, invoice_number, amount, tax_amount, due_date, status,
       category, source, source_ref_id, confidence, summary,
       extracted_data, client_id
     ) VALUES (
       $1, $2, $3, $4, $5,
       $6, $7, $8, $9, $10,
       $11, $12, $13
     )
     ON CONFLICT (client_id, source, source_ref_id)
       WHERE source_ref_id IS NOT NULL
     DO UPDATE
       SET amount = EXCLUDED.amount,
           tax_amount = EXCLUDED.tax_amount,
           summary = EXCLUDED.summary,
           extracted_data = EXCLUDED.extracted_data`,
    [
      row.vendor,
      row.invoice_number,
      row.amount,
      row.tax_amount,
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

// ─────────────────────────────────────────────────────────────────
// GDPR compliance handlers (Shopify App Store mandatory)
// ─────────────────────────────────────────────────────────────────
//
// What Dreamward stores about a Shopify customer: the customer NAME
// on processed_items.vendor (a misnomer — for income rows it's the
// buyer, see lib/shopify.mapOrderToProcessedItem) and the raw Shopify
// `customer` object under extracted_data.customer (id/email/name).
// Redaction strips both; it does NOT delete the financial rows, so
// the merchant's own books + FIFO/COGS ledger stay intact.

interface CustomerDataRequestPayload {
  shop_domain?: string;
  customer?: { id?: number; email?: string | null };
  orders_requested?: number[];
  data_request?: { id?: number };
}

interface CustomerRedactPayload {
  shop_domain?: string;
  customer?: { id?: number; email?: string | null };
  orders_to_redact?: number[];
}

interface ShopRedactPayload {
  shop_id?: number;
  shop_domain?: string;
}

// Resolve a shop domain → Dreamward client_id, or null if no active
// connection exists (shop_domain is UNIQUE, so at most one row).
async function resolveClientForShop(
  shopDomain: string
): Promise<number | null> {
  const res = await pool.query<{ client_id: number }>(
    `SELECT client_id FROM shopify_connections WHERE shop_domain = $1`,
    [shopDomain]
  );
  return res.rows[0]?.client_id ?? null;
}

// The jsonb keys that can hold customer PII in extracted_data. Only
// `customer` is set today (the raw Shopify customer object); the rest
// are defensive so a future mapper change can't silently leak PII —
// removing a non-existent key is a no-op.
const PII_KEYS = [
  "customer",
  "customer_name",
  "email",
  "phone",
  "billing_address",
  "shipping_address",
] as const;
const STRIP_PII_SQL = PII_KEYS.map((k) => `- '${k}'`).join(" ");

/**
 * customers/data_request — a merchant asks what data we hold about a
 * customer. Dreamward has no self-serve export, so we LOG the request
 * with enough detail to fulfil it manually inside Shopify's 30-day
 * window. Logging (not a silent 200) is the compliant minimum for an
 * app that holds this little customer PII.
 */
async function handleCustomerDataRequest(
  shopDomain: string,
  payload: CustomerDataRequestPayload
) {
  const clientId = await resolveClientForShop(shopDomain);
  console.warn(
    "[GDPR customers/data_request] fulfil manually within 30 days:",
    JSON.stringify({
      shopDomain,
      clientId,
      customerId: payload.customer?.id ?? null,
      customerEmail: payload.customer?.email ?? null,
      ordersRequested: payload.orders_requested ?? [],
      requestId: payload.data_request?.id ?? null,
    })
  );
}

/**
 * customers/redact — erase a specific customer's PII. Anonymize the
 * exact orders Shopify names (orders_to_redact), scoped to the shop's
 * client: strip the name off `vendor` and drop the PII keys from
 * extracted_data. Financial rows survive.
 */
async function handleCustomerRedact(
  shopDomain: string,
  payload: CustomerRedactPayload
) {
  const clientId = await resolveClientForShop(shopDomain);
  const orderIds = (payload.orders_to_redact ?? []).map((id) => String(id));
  if (clientId === null || orderIds.length === 0) return; // nothing to redact
  const res = await pool.query(
    `UPDATE processed_items
        SET vendor = 'Redacted (GDPR)',
            extracted_data = COALESCE(extracted_data, '{}'::jsonb) ${STRIP_PII_SQL},
            updated_at = NOW()
      WHERE client_id = $1
        AND source = 'shopify'
        AND source_ref_id = ANY($2::text[])`,
    [clientId, orderIds]
  );
  console.warn(
    `[GDPR customers/redact] anonymized ${res.rowCount ?? 0} order(s) for ${shopDomain}`
  );
}

/**
 * shop/redact — 48h after uninstall, erase the shop's data. Drop the
 * connection (tokens + shop identity) and anonymize customer PII on
 * ALL of that shop's imported orders in one transaction. Idempotent:
 * a missing connection just means it's already gone.
 */
async function handleShopRedact(
  shopDomain: string,
  payload: ShopRedactPayload
) {
  void payload; // shop identity comes from the (HMAC-trusted) header
  const clientId = await resolveClientForShop(shopDomain);
  if (clientId === null) {
    console.log(
      `[GDPR shop/redact] no connection for ${shopDomain} — nothing to do`
    );
    return;
  }
  const db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query(
      `UPDATE processed_items
          SET vendor = 'Redacted (GDPR)',
              extracted_data = COALESCE(extracted_data, '{}'::jsonb) ${STRIP_PII_SQL},
              updated_at = NOW()
        WHERE client_id = $1 AND source = 'shopify'`,
      [clientId]
    );
    await db.query(`DELETE FROM shopify_connections WHERE client_id = $1`, [
      clientId,
    ]);
    await db.query("COMMIT");
  } catch (err) {
    await db.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    db.release();
  }
  console.warn(
    `[GDPR shop/redact] redacted shop ${shopDomain} (client ${clientId})`
  );
}
