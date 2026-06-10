// app/api/wix/webhook/route.ts
//
// Phase 10d. Public webhook receiver for Wix order events. Wix
// POSTs JWT-signed payloads here when order state changes (created,
// paid, refunded, cancelled, etc.) on any site where our app is
// installed.
//
// Subscribe in Wix Dev Center → Develop → Webhooks → Create Webhook:
//   - Event category: eCommerce (or Stores, depending on Wix's
//     labeling) → "Order Created" / "Order Paid" / etc.
//   - Callback URL: https://godreamward.com/api/wix/webhook
//   - Public Key: already in WIX_WEBHOOK_PUBLIC_KEY env var
//
// Flow per delivery:
//   1. Read raw JWT from request body
//   2. Verify signature via lib/wix.verifyAppInstalledWebhook
//      (it's a generic Wix webhook JWT verifier; the function name
//      mentions "AppInstalled" for historical reasons but works
//      for any Wix webhook signed by the same key)
//   3. Extract eventType + instanceId from envelope
//   4. Look up wix_connections row by instance_id (404-equivalent
//      → log + 200; could be a webhook for an instance bound to a
//      different Dreamward account or one we don't track)
//   5. Route by event type:
//      - Order created/paid/updated → parse order from data field
//        + upsert into processed_items
//      - Order cancelled → upsert with status='cancelled'
//      - Anything else → log + 200 (no-op)
//   6. Update wix_connections.last_sync_at + add eventType to
//      webhook_subscription_ids array if not already present.
//      The array tracks "event types we've received at least once"
//      — non-empty array makes the card's "Webhooks pending"
//      indicator flip to "Live sync active".
//
// Always returns 200 on verified payloads — Wix retries failed
// deliveries aggressively, and we don't want retry storms for
// events we intentionally ignore. Returns 401 on signature
// verification failure, 400 on malformed body.
//
// NOT in proxy.ts matcher — must remain public for Wix to reach.

import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  mapWixOrderToProcessedItem,
  extractWixLineItems,
  verifyAppInstalledWebhook,
  type WixOrder,
} from "@/lib/wix";
import { bulkInsertLineItemsForParent } from "@/lib/cogs/lineItems";

interface WixConnectionRow {
  id: number;
  client_id: number;
  webhook_subscription_ids: string[];
}

export async function POST(req: NextRequest) {
  // ── 1. Read raw JWT ─────────────────────────────────────────
  let jwt: string;
  try {
    const raw = await req.text();
    if (!raw) {
      return NextResponse.json({ error: "Empty body" }, { status: 400 });
    }
    if (/^[A-Za-z0-9_.-]+$/.test(raw.trim())) {
      jwt = raw.trim();
    } else {
      try {
        const parsed = JSON.parse(raw) as { jwt?: string };
        if (typeof parsed.jwt === "string") {
          jwt = parsed.jwt;
        } else {
          return NextResponse.json(
            { error: "Body is neither a JWT nor a { jwt } envelope" },
            { status: 400 }
          );
        }
      } catch {
        return NextResponse.json(
          { error: "Body is not a valid JWT" },
          { status: 400 }
        );
      }
    }
  } catch (err) {
    console.error("Wix webhook: failed to read body:", err);
    return NextResponse.json(
      { error: "Couldn't read request body" },
      { status: 400 }
    );
  }

  // ── 2. Verify JWT signature ─────────────────────────────────
  const payload = await verifyAppInstalledWebhook({ jwt });
  if (!payload) {
    console.warn("Wix webhook: JWT verification failed");
    return NextResponse.json(
      { error: "Webhook signature verification failed" },
      { status: 401 }
    );
  }

  // ── 3. Extract envelope ─────────────────────────────────────
  // Wix wraps webhook payloads with top-level: { iss?, aud?,
  // eventType, instanceId, identity, data }. `data` is parsed in
  // place by verifyAppInstalledWebhook when it's a JSON string.
  const eventType =
    typeof payload.eventType === "string" ? payload.eventType : "(unknown)";
  const instanceId =
    typeof payload.instanceId === "string" ? payload.instanceId : null;

  if (!instanceId) {
    console.warn(
      `Wix webhook: event=${eventType} has no instanceId in envelope — keys:`,
      Object.keys(payload)
    );
    return NextResponse.json({ acknowledged: true, action: "no_instance" });
  }

  // ── 4. Look up our binding ──────────────────────────────────
  let conn: WixConnectionRow | null = null;
  try {
    const res = await pool.query<WixConnectionRow>(
      `SELECT id, client_id, webhook_subscription_ids
         FROM wix_connections
        WHERE instance_id = $1`,
      [instanceId]
    );
    conn = res.rows[0] ?? null;
  } catch (err) {
    console.error("Wix webhook: DB lookup failed:", err);
    // 200 — Wix shouldn't retry over a transient DB blip
    return NextResponse.json({ acknowledged: true, dbError: true });
  }

  if (!conn) {
    // Webhook for an instance we don't track. Could be a merchant
    // who installed the app but never linked it to Dreamward, or
    // someone else's install we shouldn't have heard about.
    console.log(
      `Wix webhook: event=${eventType} instance=${instanceId} ` +
        `unbound — ignoring`
    );
    return NextResponse.json({ acknowledged: true, action: "unbound" });
  }

  // ── 5. Route by event type ──────────────────────────────────
  // Wix order event type patterns observed (verified empirically
  // on first delivery — these are best guesses based on Wix's
  // event naming conventions):
  //   wix.ecom.v1.order_created
  //   wix.ecom.v1.order_updated
  //   wix.stores.v1.order_paid
  //   wix.stores.v1.order_canceled
  // We match by substring rather than exact equality so the
  // handler stays robust to Wix's namespace versioning changes.
  const lowerEvent = eventType.toLowerCase();
  const isOrderEvent =
    lowerEvent.includes("order_created") ||
    lowerEvent.includes("order_paid") ||
    lowerEvent.includes("order_updated") ||
    lowerEvent.includes("order_canceled") ||
    lowerEvent.includes("order_cancelled");

  if (!isOrderEvent) {
    console.log(
      `Wix webhook: event=${eventType} not an order event — no-op`
    );
    await touchSyncState(conn.id, eventType);
    return NextResponse.json({ acknowledged: true, action: "no_op" });
  }

  // Extract the order from the data payload. Wix sometimes wraps
  // it as { data: { order: {...} } } and sometimes as { data: {...} }
  // directly. Try both.
  const data = payload.data as Record<string, unknown> | undefined;
  let order: WixOrder | null = null;
  if (data) {
    if (typeof data.order === "object" && data.order !== null) {
      order = data.order as WixOrder;
    } else if (typeof data.id === "string") {
      order = data as unknown as WixOrder;
    }
  }

  if (!order || typeof order.id !== "string") {
    console.warn(
      `Wix webhook: event=${eventType} has no parseable order in data — ` +
        `data keys:`,
      data ? Object.keys(data) : null
    );
    await touchSyncState(conn.id, eventType);
    return NextResponse.json({ acknowledged: true, action: "no_order" });
  }

  // ── 6. Upsert into processed_items ──────────────────────────
  try {
    const row = mapWixOrderToProcessedItem(order);
    // Override status to 'cancelled' explicitly on cancel events
    // (mapper reads paymentStatus which may not reflect the cancel
    // on the order_canceled event).
    if (
      lowerEvent.includes("order_canceled") ||
      lowerEvent.includes("order_cancelled")
    ) {
      row.status = "cancelled";
    }

    // Phase 12c: RETURNING id on both INSERT and DO UPDATE paths
    // so we can fan line items into processed_item_line_items.
    // Webhook redelivery is safe — the (processed_item_id,
    // external_id) UNIQUE index on processed_item_line_items
    // makes the line-item INSERT a no-op via ON CONFLICT DO NOTHING.
    const upsertRes = await pool.query<{ id: number }>(
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
         extracted_data = EXCLUDED.extracted_data
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
        conn.client_id,
      ]
    );

    const parentId = upsertRes.rows[0]?.id;
    if (parentId) {
      const lineItems = extractWixLineItems(order);
      if (lineItems.length > 0) {
        await bulkInsertLineItemsForParent({
          parentId,
          clientId: conn.client_id,
          platform: "wix",
          soldAt: row.due_date,
          items: lineItems,
        });
      }
    }

    console.log(
      `Wix webhook: event=${eventType} order=${order.id} → client_id=${conn.client_id} upserted`
    );
  } catch (err) {
    console.error("Wix webhook: upsert failed:", err);
    return NextResponse.json({ acknowledged: true, dbError: true });
  }

  await touchSyncState(conn.id, eventType);
  return NextResponse.json({ acknowledged: true, action: "upserted" });
}

/**
 * Update last_sync_at + append eventType to webhook_subscription_ids
 * if not already present. The array's job is to track "we've seen at
 * least one delivery of this event type" — non-empty array makes the
 * card's "Webhooks pending" indicator flip to "Live sync active".
 */
async function touchSyncState(
  connectionId: number,
  eventType: string
): Promise<void> {
  try {
    await pool.query(
      `UPDATE wix_connections
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
    console.warn("Wix webhook: touchSyncState failed (non-fatal):", err);
  }
}
