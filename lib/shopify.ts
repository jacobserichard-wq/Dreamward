// lib/shopify.ts
//
// Phase 8a commit 3 of 5. Designed in
// session-notes/phase-8-shopify-design.md §4 (lib/shopify.ts shape).
//
// Typed Shopify API client + OAuth helpers. Pure — no DB I/O.
// Route handlers (app/api/shopify/oauth/*) own DB writes; this
// module just makes the HTTP calls + handles the OAuth handshake.
//
// Shopify model recap:
//   - Each merchant store is identified by its `shop_domain`
//     (e.g., "my-store.myshopify.com")
//   - OAuth: redirect merchant to Shopify → consent screen →
//     Shopify redirects back to our callback with `code` → exchange
//     code for a PERMANENT access token (Shopify tokens don't expire
//     unless revoked, unlike Google's 1-hour tokens)
//   - All subsequent API calls authenticate via X-Shopify-Access-Token
//     header
//
// API version is pinned via SHOPIFY_API_VERSION env var. Bump every
// quarter (Shopify deprecates versions on a rolling schedule).

import { createHmac, timingSafeEqual } from "crypto";

// ---------------------------------------------------------------------
// Env-var loading (lazy + validating)
// ---------------------------------------------------------------------

function loadEnv(): {
  clientId: string;
  clientSecret: string;
  apiVersion: string;
} {
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
  const apiVersion = process.env.SHOPIFY_API_VERSION;
  if (!clientId) throw new Error("SHOPIFY_CLIENT_ID env var is not set");
  if (!clientSecret) throw new Error("SHOPIFY_CLIENT_SECRET env var is not set");
  if (!apiVersion) throw new Error("SHOPIFY_API_VERSION env var is not set (e.g., '2026-04')");
  return { clientId, clientSecret, apiVersion };
}

// ---------------------------------------------------------------------
// Shop-domain validation
// ---------------------------------------------------------------------

/**
 * Normalize + validate a shop domain. Accepts either the bare store
 * name ("my-store") or the full myshopify.com hostname
 * ("my-store.myshopify.com"). Returns the full hostname in canonical
 * lowercase form, or null if the input doesn't match a legitimate
 * Shopify store URL pattern.
 *
 * Why this matters: we use the shop_domain to build the OAuth
 * authorize URL — an attacker who can supply an arbitrary string
 * here could redirect us to a phishing host. Strict regex closes
 * that vector.
 */
export function normalizeShopDomain(input: string): string | null {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;
  // Accept either form: "my-store" or "my-store.myshopify.com"
  const withSuffix = trimmed.endsWith(".myshopify.com")
    ? trimmed
    : `${trimmed}.myshopify.com`;
  // Shopify store names: alphanumeric + hyphens, 3-60 chars (Shopify
  // doesn't publish a strict regex but this matches their docs).
  if (!/^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]\.myshopify\.com$/.test(withSuffix)) {
    return null;
  }
  return withSuffix;
}

// ---------------------------------------------------------------------
// OAuth — authorize URL + code exchange
// ---------------------------------------------------------------------

/**
 * Build the URL we redirect the merchant to for the OAuth consent
 * screen. The `state` parameter must be a fresh per-request random
 * value (stored in a short-lived cookie) so the callback handler can
 * verify the round-trip wasn't forged (CSRF protection).
 *
 * @param shopDomain canonical shop domain (use normalizeShopDomain first)
 * @param state CSRF nonce, 32+ random bytes hex-encoded
 * @param redirectUri the Dreamward callback URL Shopify will redirect to
 * @param scopes which scopes to request (v1: just "read_orders")
 */
export function buildAuthorizeUrl(opts: {
  shopDomain: string;
  state: string;
  redirectUri: string;
  scopes: string[];
}): string {
  const { clientId } = loadEnv();
  const params = new URLSearchParams({
    client_id: clientId,
    scope: opts.scopes.join(","),
    redirect_uri: opts.redirectUri,
    state: opts.state,
    // grant_options[]=per-user gives us a per-user (online) token;
    // omitting it gives us an offline (long-lived) token. We want
    // offline since cron-driven sync needs to work without a user
    // session (locked design decision §2.1).
  });
  return `https://${opts.shopDomain}/admin/oauth/authorize?${params.toString()}`;
}

/**
 * Exchange the OAuth `code` we got back at the callback for a
 * permanent access token. Shopify returns the token + the actual
 * granted scopes (which may be a SUBSET of what we requested — the
 * merchant can deny individual scopes during consent).
 */
export async function exchangeCodeForToken(opts: {
  shopDomain: string;
  code: string;
}): Promise<{ accessToken: string; scopes: string[] }> {
  const { clientId, clientSecret } = loadEnv();
  const res = await fetch(
    `https://${opts.shopDomain}/admin/oauth/access_token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code: opts.code,
      }),
    }
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Shopify token exchange failed: HTTP ${res.status} ${body.slice(0, 200)}`
    );
  }
  const data = (await res.json()) as {
    access_token?: string;
    scope?: string;
  };
  if (!data.access_token) {
    throw new Error("Shopify token exchange returned no access_token");
  }
  return {
    accessToken: data.access_token,
    scopes: (data.scope ?? "").split(",").filter((s) => s.length > 0),
  };
}

// ---------------------------------------------------------------------
// HMAC verification for OAuth callback + webhook payloads
// ---------------------------------------------------------------------

/**
 * Verify the HMAC signature Shopify includes on the OAuth callback
 * redirect URL. Per docs: SHA-256 HMAC of the query string params
 * (sorted alphabetically by key, joined with `&`, EXCLUDING the hmac
 * param itself) using the app's client secret.
 *
 * Returns true if the signature matches. Use timingSafeEqual to
 * avoid timing attacks even though this is on the callback path
 * (defense in depth).
 *
 * @param params the parsed query params from the callback request
 *               (URLSearchParams or plain Record<string, string>)
 */
export function verifyOAuthCallbackHmac(
  params: URLSearchParams | Record<string, string>
): boolean {
  const { clientSecret } = loadEnv();
  const entries =
    params instanceof URLSearchParams
      ? Array.from(params.entries())
      : Object.entries(params);
  const providedHmac = (entries.find(([k]) => k === "hmac") ?? [])[1];
  if (!providedHmac || typeof providedHmac !== "string") return false;
  // Sort by key, exclude hmac + signature, rebuild the canonical
  // message string.
  const message = entries
    .filter(([k]) => k !== "hmac" && k !== "signature")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  const computed = createHmac("sha256", clientSecret).update(message).digest("hex");
  // Constant-time comparison (timing-safe)
  try {
    return timingSafeEqual(
      Buffer.from(computed, "hex"),
      Buffer.from(providedHmac, "hex")
    );
  } catch {
    // Different buffer lengths → not equal. timingSafeEqual throws
    // in that case which is fine — just return false.
    return false;
  }
}

/**
 * Verify the HMAC on a Shopify webhook POST. Shopify signs the RAW
 * request body (not the parsed JSON) with HMAC-SHA256 and includes
 * the base64-encoded result in the `X-Shopify-Hmac-SHA256` header.
 *
 * This is called by app/api/shopify/webhook/route.ts (sub-phase 8d),
 * not by 8a — but it lives here next to the OAuth HMAC helper so
 * both signature-verification paths are in one place.
 */
export function verifyWebhookHmac(
  rawBody: string | Buffer,
  hmacHeader: string
): boolean {
  if (!hmacHeader) return false;
  const { clientSecret } = loadEnv();
  const computed = createHmac("sha256", clientSecret)
    .update(rawBody)
    .digest("base64");
  try {
    return timingSafeEqual(
      Buffer.from(computed),
      Buffer.from(hmacHeader)
    );
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------
// API client (used by sub-phases 8c + 8d)
// ---------------------------------------------------------------------

/**
 * Bare REST GET against Shopify's admin API. All calls authenticate
 * via the X-Shopify-Access-Token header. URL is built from the shop
 * domain + pinned SHOPIFY_API_VERSION + caller-supplied path.
 *
 * Sub-phase 8c layers paginated helpers on top; 8d uses this for
 * webhook subscription management.
 */
/**
 * Bare REST POST against Shopify's admin API. Used by webhook
 * subscription registration (8d) + future write-back operations.
 */
export async function shopifyPost<T = unknown>(opts: {
  shopDomain: string;
  accessToken: string;
  path: string;
  body: unknown;
}): Promise<T> {
  const { apiVersion } = loadEnv();
  const url = `https://${opts.shopDomain}/admin/api/${apiVersion}${opts.path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": opts.accessToken,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(opts.body),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Shopify POST ${opts.path}: HTTP ${res.status} ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

export async function shopifyGet<T = unknown>(opts: {
  shopDomain: string;
  accessToken: string;
  path: string;          // e.g. "/orders.json?limit=250"
}): Promise<T> {
  const { apiVersion } = loadEnv();
  const url = `https://${opts.shopDomain}/admin/api/${apiVersion}${opts.path}`;
  const res = await fetch(url, {
    headers: {
      "X-Shopify-Access-Token": opts.accessToken,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Shopify GET ${opts.path}: HTTP ${res.status} ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------
// Order types + pagination (Phase 8c)
// ---------------------------------------------------------------------

/** Minimal subset of Shopify's Order schema we actually need for
 *  bookkeeping. Shopify returns dozens more fields; we only pull
 *  what we use to keep the JSON payload small + the DB row tight. */
export interface ShopifyOrder {
  id: number;                          // numeric order ID (e.g., 5234567890123)
  order_number: number;                // human-friendly number (e.g., 1001)
  name: string;                        // formatted "#1001"
  created_at: string;                  // ISO timestamp
  updated_at: string;
  processed_at: string | null;         // when the order was placed
  cancelled_at: string | null;
  total_price: string;                 // decimal-as-string (Shopify uses string to avoid float drift)
  subtotal_price: string;
  total_tax: string;
  total_shipping_price_set: {
    shop_money: { amount: string; currency_code: string };
  } | null;
  currency: string;                    // ISO 4217, e.g., "USD"
  financial_status: string | null;     // 'paid' | 'pending' | 'refunded' | 'partially_refunded' | 'voided' | null
  fulfillment_status: string | null;
  customer: {
    id: number;
    email: string | null;
    first_name: string | null;
    last_name: string | null;
  } | null;
  line_items: Array<{
    id: number;
    name: string;
    quantity: number;
    price: string;
    /** Variant ID — the alias join key for sku_aliases when a SKU
     *  is sold via Shopify. Null for custom non-catalog line items
     *  (rare but possible via Shopify Admin manual orders). */
    variant_id: number | null;
    /** Product ID — the parent product, kept for diagnostics +
     *  potential fallback if a merchant maps by product instead of
     *  variant (not v1 behavior, but cheap to capture). */
    product_id: number | null;
    /** Platform-side SKU code from the merchant's catalog. Display
     *  only — sku_aliases joins on variant_id, not this string. */
    sku: string | null;
  }>;
}

/**
 * Fetch a single page of orders. Shopify's REST pagination uses
 * cursor-based `since_id` — pass the last order's ID to get the
 * next page (orders sorted by ID ascending = chronological).
 *
 * Returns the orders + nextSinceId. nextSinceId is the last order's
 * ID if a full page came back, OR null when fewer than `limit`
 * orders returned (indicates end of history).
 *
 * @param sinceId pass 0 (or omit) for the first call
 * @param limit 1-250 (Shopify max); 250 is most efficient
 * @param status 'any' to include cancelled + open; default Shopify
 *               behavior is 'open' which excludes cancelled
 */
export async function listOrders(opts: {
  shopDomain: string;
  accessToken: string;
  sinceId?: number;
  limit?: number;
  status?: "open" | "closed" | "cancelled" | "any";
  /** ISO 8601 timestamp — only orders created on/after this. Used by the
   *  backfill to honor the connection's import_start_date cutoff. */
  createdAtMin?: string;
}): Promise<{ orders: ShopifyOrder[]; nextSinceId: number | null }> {
  const limit = Math.min(Math.max(opts.limit ?? 250, 1), 250);
  const params = new URLSearchParams({
    limit: String(limit),
    status: opts.status ?? "any",
    // Restrict to fields we actually use. Keeps the JSON payload
    // ~5-10x smaller than the default response.
    fields: [
      "id",
      "order_number",
      "name",
      "created_at",
      "updated_at",
      "processed_at",
      "cancelled_at",
      "total_price",
      "subtotal_price",
      "total_tax",
      "total_shipping_price_set",
      "currency",
      "financial_status",
      "fulfillment_status",
      "customer",
      "line_items",
    ].join(","),
  });
  if (opts.sinceId && opts.sinceId > 0) {
    params.set("since_id", String(opts.sinceId));
  }
  if (opts.createdAtMin) {
    params.set("created_at_min", opts.createdAtMin);
  }
  const result = await shopifyGet<{ orders: ShopifyOrder[] }>({
    shopDomain: opts.shopDomain,
    accessToken: opts.accessToken,
    path: `/orders.json?${params.toString()}`,
  });
  const orders = result.orders ?? [];
  const nextSinceId =
    orders.length === limit ? orders[orders.length - 1].id : null;
  return { orders, nextSinceId };
}

// ---------------------------------------------------------------------
// Order → processed_item mapper
// ---------------------------------------------------------------------

/** Result row shape ready to bind into a parameterized INSERT into
 *  the processed_items table. */
export interface MappedOrderRow {
  vendor: string;
  invoice_number: string;
  amount: number;
  due_date: string;          // YYYY-MM-DD (pg DATE)
  status: string;            // 'paid' | 'pending' | 'cancelled'
  category: string;          // hardcoded "Online Sales" (see comment)
  source: "shopify";
  source_ref_id: string;     // Shopify order ID as string for the unique-index
  confidence: number;        // 100 — direct API, no AI extraction
  summary: string;
  extracted_data: Record<string, unknown>;
}

/**
 * Map a Shopify order into the processed_items row shape.
 *
 * Design choices:
 * - vendor = customer name (first + last) OR email OR "Unknown".
 *   "vendor" is a misnomer here — for income rows it's the customer.
 *   We're reusing the existing column to keep the data model simple.
 * - amount = total_price (includes tax + shipping; matches what
 *   actually hit the store's bank account)
 * - due_date = processed_at OR created_at, truncated to YYYY-MM-DD
 *   (matches the pg DATE type-parser override from sub-session 19)
 * - status: 'paid' if Shopify financial_status='paid'; 'cancelled'
 *   if cancelled_at non-null; otherwise 'pending'
 * - category = "Online Sales" hardcoded. The Etsy/Shopify/Instagram
 *   income category in lib/categories.ts:181 was literally written
 *   for this case. Skipping the per-order Claude call saves ~$1.50
 *   per customer per month + makes backfill ~10x faster. User can
 *   re-categorize manually if needed.
 * - confidence = 100 — direct API data, no AI extraction involved
 * - extracted_data captures the rich Shopify metadata (tax breakdown,
 *   shipping cost, line items, fulfillment status) for downstream
 *   reporting + future sales-tax features
 */
export function mapOrderToProcessedItem(order: ShopifyOrder): MappedOrderRow {
  const customerName = order.customer
    ? [order.customer.first_name, order.customer.last_name]
        .filter((n): n is string => typeof n === "string" && n.trim() !== "")
        .join(" ") ||
      order.customer.email ||
      "Unknown customer"
    : "Unknown customer";

  // Date selection: processed_at is when the order was placed +
  // payment captured. Falls back to created_at for older orders that
  // predate Shopify's processed_at field.
  const isoDate = order.processed_at || order.created_at;
  const dueDate = isoDate.slice(0, 10); // YYYY-MM-DD

  // Status mapping
  let status: string;
  if (order.cancelled_at) {
    status = "cancelled";
  } else if (order.financial_status === "paid") {
    status = "paid";
  } else if (
    order.financial_status === "refunded" ||
    order.financial_status === "partially_refunded"
  ) {
    status = "paid"; // the original sale still happened; refund is a separate row in 8d
  } else {
    status = "pending";
  }

  return {
    vendor: customerName,
    invoice_number: order.name || `#${order.order_number}`,
    amount: Number(order.total_price),
    due_date: dueDate,
    status,
    category: "Online Sales",
    source: "shopify",
    source_ref_id: String(order.id),
    confidence: 100,
    summary: `Shopify order ${order.name} — ${order.line_items.length} item${order.line_items.length === 1 ? "" : "s"}, ${order.currency} ${order.total_price}`,
    extracted_data: {
      shopify_order_id: order.id,
      order_number: order.order_number,
      currency: order.currency,
      subtotal: order.subtotal_price,
      tax: order.total_tax,
      shipping: order.total_shipping_price_set?.shop_money.amount ?? "0.00",
      financial_status: order.financial_status,
      fulfillment_status: order.fulfillment_status,
      cancelled_at: order.cancelled_at,
      line_items: order.line_items.map((li) => ({
        id: li.id,
        name: li.name,
        quantity: li.quantity,
        price: li.price,
        variant_id: li.variant_id,
        product_id: li.product_id,
        sku: li.sku,
      })),
    },
  };
}

/**
 * Phase 12c: extract line items from a Shopify order in the
 * platform-agnostic shape required by
 * lib/cogs/lineItems.bulkInsertLineItemsForParent.
 *
 * Each Shopify line item becomes one InternalLineItem:
 *   externalId       = String(line_item.id)
 *   externalItemId   = String(variant_id) — the alias join key
 *   externalSku      = line_item.sku — display only
 *   name, quantity   = as-is
 *   unitPrice        = Number(price)
 *   currency         = order-level currency (Shopify doesn't put
 *                      currency on individual line items)
 *
 * Line items with no variant_id (rare — manual orders typed in
 * Shopify Admin without a catalog item) still get inserted but
 * with externalItemId = null. They'll surface in the Unmatched UI
 * (Phase 12d) for the merchant to map manually.
 */
// ---------------------------------------------------------------------
// Phase 12e: Catalog API (bulk-import SKUs from Shopify)
// ---------------------------------------------------------------------
//
// Shopify's products endpoint returns Product objects each carrying
// an array of variants. For COGS, the VARIANT is our SKU unit —
// variant_id is what line items reference (and what gets stored as
// sku_aliases.external_id).
//
// Cost: `cost` field on variant returns the merchant-entered "cost
// per item" from the Shopify admin. Optional — only populated when
// the merchant enabled inventory tracking + filled it in. When
// absent we surface null and the bulk-import UI prompts the user.
//
// Pagination: Shopify supports both since_id and Link-header
// pagination. We use since_id (matches our orders fetcher pattern)
// against the variant id space. Variants pages are typically much
// smaller than orders pages — 250-row pages should be plenty for
// most maker catalogs.

interface ShopifyProductForCatalog {
  id: number;
  title: string;
  variants: Array<{
    id: number;
    title: string;
    sku: string | null;
    price: string;
    /** Per-item cost as a decimal string (e.g., "4.50"). May be
     *  absent on stores without inventory cost tracking enabled. */
    cost?: string | null;
  }>;
}

interface ShopifyProductsResponse {
  products: ShopifyProductForCatalog[];
}

/** Flattened, Dreamward-friendly shape returned by listCatalog. */
export interface ShopifyCatalogVariation {
  /** Variant id (the alias join key — same field that orders'
   *  line_items.variant_id references). */
  variantId: string;
  productId: string;
  /** "Product Title - Variant Title" when the variant has a
   *  distinct title, else just the product title. Variant title
   *  "Default Title" is Shopify's convention for single-variant
   *  products; we hide it for cleaner display names. */
  displayName: string;
  sku: string | null;
  cost: number | null;
  /** Shopify variants don't carry currency on cost; the store's
   *  currency lives on the order/shop. We surface null here and
   *  default to USD downstream. */
  currency: string | null;
}

/**
 * Fetch the merchant's full Shopify product catalog (every variant
 * across every product), paginated via since_id. Walks every page
 * automatically until an empty one returns.
 */
export async function listCatalog(opts: {
  shopDomain: string;
  accessToken: string;
}): Promise<ShopifyCatalogVariation[]> {
  const out: ShopifyCatalogVariation[] = [];
  let sinceId = 0;

  while (true) {
    const params = new URLSearchParams({
      limit: "250",
      // Restrict to what we need — shrinks payload ~5x.
      fields: "id,title,variants",
    });
    if (sinceId > 0) params.set("since_id", String(sinceId));

    const apiVersion = process.env.SHOPIFY_API_VERSION;
    if (!apiVersion)
      throw new Error("SHOPIFY_API_VERSION env var is not set");
    const url = `https://${opts.shopDomain}/admin/api/${apiVersion}/products.json?${params.toString()}`;
    const res = await fetch(url, {
      headers: {
        "X-Shopify-Access-Token": opts.accessToken,
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `Shopify products list failed: HTTP ${res.status} ${body.slice(0, 200)}`
      );
    }
    const data = (await res.json()) as ShopifyProductsResponse;
    const products = data.products ?? [];
    if (products.length === 0) break;

    for (const p of products) {
      for (const v of p.variants) {
        const costNum =
          v.cost != null && v.cost !== "" ? Number(v.cost) : null;
        const distinctTitle =
          v.title && v.title !== "Default Title" && v.title !== p.title;
        out.push({
          variantId: String(v.id),
          productId: String(p.id),
          displayName: distinctTitle
            ? `${p.title} - ${v.title}`
            : p.title,
          sku: v.sku && v.sku.trim().length > 0 ? v.sku : null,
          cost: Number.isFinite(costNum ?? NaN) ? costNum : null,
          currency: null,
        });
      }
    }

    if (products.length < 250) break; // last page
    sinceId = products[products.length - 1].id;
  }

  return out;
}

export function extractShopifyLineItems(
  order: ShopifyOrder
): import("./cogs/lineItems").InternalLineItem[] {
  return order.line_items.map((li) => ({
    externalId: String(li.id),
    externalItemId: li.variant_id != null ? String(li.variant_id) : null,
    externalSku: li.sku,
    name: li.name,
    quantity: li.quantity,
    unitPrice: Number(li.price) || 0,
    currency: order.currency,
  }));
}

// ---------------------------------------------------------------------
// Webhook subscriptions (Phase 8d)
// ---------------------------------------------------------------------

/** The webhook topics Dreamward subscribes to on connect. Each fires
 *  a POST to /api/shopify/webhook with the corresponding payload. */
export const SHOPIFY_WEBHOOK_TOPICS = [
  "orders/create",
  "orders/updated",
  "orders/cancelled",
  "refunds/create",
] as const;

export type ShopifyWebhookTopic = (typeof SHOPIFY_WEBHOOK_TOPICS)[number];

/**
 * Register a webhook subscription with Shopify. Returns the webhook
 * id (which we persist on shopify_connections.webhook_subscription_ids
 * so the disconnect flow can clean them up).
 *
 * Shopify deduplicates by (topic, address) — re-subscribing the same
 * topic+address combo returns the existing webhook ID rather than
 * creating a duplicate. So this is safe to call on reconnect.
 *
 * @param address the public URL Shopify will POST to on each event
 */
export async function subscribeWebhook(opts: {
  shopDomain: string;
  accessToken: string;
  topic: ShopifyWebhookTopic;
  address: string;
}): Promise<{ id: string }> {
  const result = await shopifyPost<{
    webhook: { id: number; topic: string; address: string; format: string };
  }>({
    shopDomain: opts.shopDomain,
    accessToken: opts.accessToken,
    path: "/webhooks.json",
    body: {
      webhook: {
        topic: opts.topic,
        address: opts.address,
        format: "json",
      },
    },
  });
  return { id: String(result.webhook.id) };
}

/**
 * Delete a webhook subscription. Best-effort caller — the disconnect
 * route logs failures but doesn't block on them (a webhook to a
 * deleted Dreamward connection is harmless — the receiver 404s on
 * its own client_id lookup).
 */
export async function unsubscribeWebhook(opts: {
  shopDomain: string;
  accessToken: string;
  webhookId: string;
}): Promise<void> {
  const { apiVersion } = loadEnv();
  const url = `https://${opts.shopDomain}/admin/api/${apiVersion}/webhooks/${opts.webhookId}.json`;
  const res = await fetch(url, {
    method: "DELETE",
    headers: {
      "X-Shopify-Access-Token": opts.accessToken,
      Accept: "application/json",
    },
  });
  if (!res.ok && res.status !== 404) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Shopify DELETE webhook ${opts.webhookId}: HTTP ${res.status} ${body.slice(0, 200)}`
    );
  }
}

// ---------------------------------------------------------------------
// Refund mapping (Phase 8d)
// ---------------------------------------------------------------------

/** Minimal subset of Shopify's Refund schema used by the webhook
 *  handler. transactions[] is the source of truth for the refund
 *  amount (refund_line_items[] only covers product-side amounts
 *  excluding tax/shipping refunds). */
export interface ShopifyRefund {
  id: number;
  order_id: number;
  created_at: string;
  processed_at: string | null;
  note: string | null;
  transactions: Array<{
    id: number;
    amount: string;        // decimal-as-string, positive even for refunds
    kind: string;          // 'refund' | 'capture' | 'authorization' | etc.
    status: string;        // 'success' | 'failure' | 'pending'
    gateway: string | null;
  }>;
  refund_line_items: Array<{
    line_item_id: number;
    quantity: number;
    subtotal: string;
  }>;
}

/** Refund mapped into a NEGATIVE processed_items row. The original
 *  order's row stays untouched (positive); the refund is a separate
 *  row with source_ref_id = 'refund-{refundId}' so reports can show
 *  gross sales + refunds separately when desired.
 *
 *  Caller passes the original order's customer name (looked up via
 *  the original processed_items row) — we don't have it on the
 *  refund payload itself. */
export function mapRefundToProcessedItem(opts: {
  refund: ShopifyRefund;
  originalOrderName: string;        // e.g., "#1001"
  customerName: string;             // copied from the original order's vendor field
  currency: string;                 // ISO 4217 from the original order
}): MappedOrderRow {
  // Sum successful refund transactions. Shopify reports amounts as
  // positive strings; we negate for the processed_items row so
  // downstream sum-of-amounts produces correct net revenue.
  const refundAmount = opts.refund.transactions
    .filter((t) => t.kind === "refund" && t.status === "success")
    .reduce((sum, t) => sum + Number(t.amount), 0);

  const date = (opts.refund.processed_at || opts.refund.created_at).slice(0, 10);

  return {
    vendor: opts.customerName,
    invoice_number: `${opts.originalOrderName}-refund`,
    amount: -refundAmount,
    due_date: date,
    status: "paid",                     // refund completed = paid
    category: "Online Sales",            // negative income, same category
    source: "shopify",
    source_ref_id: `refund-${opts.refund.id}`,
    confidence: 100,
    summary: `Refund of ${opts.currency} ${refundAmount.toFixed(2)} for order ${opts.originalOrderName}`,
    extracted_data: {
      shopify_refund_id: opts.refund.id,
      shopify_order_id: opts.refund.order_id,
      currency: opts.currency,
      note: opts.refund.note,
      line_item_count: opts.refund.refund_line_items.length,
      transactions: opts.refund.transactions.map((t) => ({
        kind: t.kind,
        amount: t.amount,
        status: t.status,
      })),
    },
  };
}
