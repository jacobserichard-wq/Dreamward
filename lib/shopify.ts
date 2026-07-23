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

/** Token set returned by the code exchange and the refresh grant.
 *  Expiring offline tokens (mandatory for public apps since Spring
 *  '26): accessToken lives ~1 hour, refreshToken ~90 days. The
 *  expiry fields are null only if Shopify hands back a legacy
 *  non-expiring token (shouldn't happen with expiring=1, but the
 *  parser doesn't assume). */
export interface ShopifyTokenSet {
  accessToken: string;
  scopes: string[];
  refreshToken: string | null;
  /** Absolute expiry timestamps, computed from expires_in at parse time. */
  accessTokenExpiresAt: Date | null;
  refreshTokenExpiresAt: Date | null;
}

function parseTokenResponse(data: {
  access_token?: string;
  scope?: string;
  expires_in?: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
}): ShopifyTokenSet {
  if (!data.access_token) {
    throw new Error("Shopify token endpoint returned no access_token");
  }
  const now = Date.now();
  return {
    accessToken: data.access_token,
    scopes: (data.scope ?? "").split(",").filter((s) => s.length > 0),
    refreshToken: data.refresh_token ?? null,
    accessTokenExpiresAt:
      typeof data.expires_in === "number"
        ? new Date(now + data.expires_in * 1000)
        : null,
    refreshTokenExpiresAt:
      typeof data.refresh_token_expires_in === "number"
        ? new Date(now + data.refresh_token_expires_in * 1000)
        : null,
  };
}

/**
 * Exchange the OAuth `code` we got back at the callback for an
 * offline access token. `expiring: "1"` requests the expiring
 * variant (1h access + 90-day refresh token) — required for public
 * apps; the Admin API 403s non-expiring tokens. Shopify returns the
 * actual granted scopes (which may be a SUBSET of what we requested —
 * the merchant can deny individual scopes during consent).
 */
export async function exchangeCodeForToken(opts: {
  shopDomain: string;
  code: string;
}): Promise<ShopifyTokenSet> {
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
        expiring: "1",
      }),
    }
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Shopify token exchange failed: HTTP ${res.status} ${body.slice(0, 200)}`
    );
  }
  return parseTokenResponse(await res.json());
}

/**
 * Redeem a refresh token for a fresh access + refresh token pair.
 * Shopify invalidates the old refresh token on use (but replays the
 * same response for ~1h, so a retry with the same refresh token
 * after a transient failure is safe). Form-encoded per the docs.
 */
export async function refreshOfflineToken(opts: {
  shopDomain: string;
  refreshToken: string;
}): Promise<ShopifyTokenSet> {
  const { clientId, clientSecret } = loadEnv();
  const res = await fetch(
    `https://${opts.shopDomain}/admin/oauth/access_token`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "refresh_token",
        refresh_token: opts.refreshToken,
      }).toString(),
    }
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Shopify token refresh failed: HTTP ${res.status} ${body.slice(0, 200)}`
    );
  }
  return parseTokenResponse(await res.json());
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
 * Execute a GraphQL operation against the Admin API. ALL Shopify
 * data access goes through this — REST is retired (App Store
 * requirement 2.2.4: public apps created after 2025-04 must use
 * GraphQL exclusively; the REST orders endpoint also hard-403s
 * protected customer data).
 *
 * Throws on transport errors and on top-level GraphQL `errors`.
 * Mutations must additionally check their payload's userErrors.
 */
export async function shopifyGraphql<T = unknown>(opts: {
  shopDomain: string;
  accessToken: string;
  query: string;
  variables?: Record<string, unknown>;
}): Promise<T> {
  const { apiVersion } = loadEnv();
  const url = `https://${opts.shopDomain}/admin/api/${apiVersion}/graphql.json`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": opts.accessToken,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      query: opts.query,
      variables: opts.variables ?? {},
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Shopify GraphQL: HTTP ${res.status} ${body.slice(0, 200)}`
    );
  }
  const payload = (await res.json()) as {
    data?: T;
    errors?: Array<{ message: string }>;
  };
  if (payload.errors && payload.errors.length > 0) {
    throw new Error(
      `Shopify GraphQL errors: ${payload.errors
        .map((e) => e.message)
        .join("; ")
        .slice(0, 300)}`
    );
  }
  if (!payload.data) throw new Error("Shopify GraphQL: empty data");
  return payload.data;
}

/** Parse the trailing numeric ID out of a gid://shopify/Type/123. */
function gidToNumber(gid: string): number {
  const m = /(\d+)$/.exec(gid);
  return m ? Number(m[1]) : 0;
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

// GraphQL wire shapes + adapter. The rest of the codebase (mapper,
// backfill, webhook handler) speaks the REST-era ShopifyOrder shape;
// orderNodeToRest() converts at the boundary so the GraphQL
// migration has zero blast radius downstream.

interface GqlMoneySet {
  shopMoney: { amount: string; currencyCode?: string };
}

interface GqlOrderNode {
  legacyResourceId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  processedAt: string | null;
  cancelledAt: string | null;
  currencyCode: string;
  displayFinancialStatus: string | null;
  displayFulfillmentStatus: string | null;
  totalPriceSet: GqlMoneySet | null;
  subtotalPriceSet: GqlMoneySet | null;
  totalTaxSet: GqlMoneySet | null;
  totalShippingPriceSet: GqlMoneySet | null;
  customer: {
    legacyResourceId: string;
    firstName: string | null;
    lastName: string | null;
  } | null;
  lineItems: {
    nodes: Array<{
      id: string;
      name: string;
      quantity: number;
      sku: string | null;
      originalUnitPriceSet: GqlMoneySet | null;
      variant: { legacyResourceId: string } | null;
      product: { legacyResourceId: string } | null;
    }>;
  };
}

/** Shared field selection for order queries. lineItems capped at 250
 *  (connection max) — far beyond any maker order. Customer email is
 *  deliberately NOT queried: our protected-customer-data grant covers
 *  Name only, and the mapper falls back to "Unknown" without it. */
const ORDER_SELECTION = `
  legacyResourceId
  name
  createdAt
  updatedAt
  processedAt
  cancelledAt
  currencyCode
  displayFinancialStatus
  displayFulfillmentStatus
  totalPriceSet { shopMoney { amount } }
  subtotalPriceSet { shopMoney { amount } }
  totalTaxSet { shopMoney { amount } }
  totalShippingPriceSet { shopMoney { amount currencyCode } }
  customer { legacyResourceId firstName lastName }
  lineItems(first: 250) {
    nodes {
      id
      name
      quantity
      sku
      originalUnitPriceSet { shopMoney { amount } }
      variant { legacyResourceId }
      product { legacyResourceId }
    }
  }`;

function orderNodeToRest(node: GqlOrderNode): ShopifyOrder {
  // GraphQL enums are SCREAMING_SNAKE ("PARTIALLY_REFUNDED"); the
  // REST strings the mapper matches on are lowercase.
  const lower = (v: string | null) => (v ? v.toLowerCase() : null);
  return {
    id: Number(node.legacyResourceId),
    // GraphQL has no order_number field; the digits of name ("#1001")
    // are the same value.
    order_number: Number(node.name.replace(/\D/g, "")) || 0,
    name: node.name,
    created_at: node.createdAt,
    updated_at: node.updatedAt,
    processed_at: node.processedAt,
    cancelled_at: node.cancelledAt,
    total_price: node.totalPriceSet?.shopMoney.amount ?? "0",
    subtotal_price: node.subtotalPriceSet?.shopMoney.amount ?? "0",
    total_tax: node.totalTaxSet?.shopMoney.amount ?? "0",
    total_shipping_price_set: node.totalShippingPriceSet
      ? {
          shop_money: {
            amount: node.totalShippingPriceSet.shopMoney.amount,
            currency_code:
              node.totalShippingPriceSet.shopMoney.currencyCode ?? "",
          },
        }
      : null,
    currency: node.currencyCode,
    financial_status: lower(node.displayFinancialStatus),
    fulfillment_status: lower(node.displayFulfillmentStatus),
    customer: node.customer
      ? {
          id: Number(node.customer.legacyResourceId),
          email: null, // not queried — see ORDER_SELECTION comment
          first_name: node.customer.firstName,
          last_name: node.customer.lastName,
        }
      : null,
    line_items: node.lineItems.nodes.map((li) => ({
      id: gidToNumber(li.id),
      name: li.name,
      quantity: li.quantity,
      price: li.originalUnitPriceSet?.shopMoney.amount ?? "0",
      variant_id: li.variant ? Number(li.variant.legacyResourceId) : null,
      product_id: li.product ? Number(li.product.legacyResourceId) : null,
      sku: li.sku && li.sku.trim().length > 0 ? li.sku : null,
    })),
  };
}

/**
 * Fetch a single page of orders via GraphQL, keeping the REST-era
 * since_id resume semantics: the search filter `id:>N` + sortKey ID
 * gives ascending-ID pages, so the backfill's MAX(source_ref_id)
 * cursor keeps working unchanged.
 *
 * Returns the orders + nextSinceId. nextSinceId is the last order's
 * ID if a full page came back, OR null when fewer than `limit`
 * orders returned (indicates end of history).
 *
 * @param sinceId pass 0 (or omit) for the first call
 * @param limit 1-250 (connection max); 250 is most efficient
 * @param status 'any' (default) includes cancelled + closed
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
  const terms: string[] = [];
  if (opts.sinceId && opts.sinceId > 0) terms.push(`id:>${opts.sinceId}`);
  if (opts.createdAtMin) terms.push(`created_at:>='${opts.createdAtMin}'`);
  if (opts.status && opts.status !== "any")
    terms.push(`status:${opts.status}`);
  const data = await shopifyGraphql<{
    orders: { nodes: GqlOrderNode[] };
  }>({
    shopDomain: opts.shopDomain,
    accessToken: opts.accessToken,
    query: `query OrdersPage($first: Int!, $query: String) {
      orders(first: $first, query: $query, sortKey: ID) {
        nodes {${ORDER_SELECTION}
        }
      }
    }`,
    variables: {
      first: limit,
      query: terms.length > 0 ? terms.join(" AND ") : null,
    },
  });
  const orders = (data.orders?.nodes ?? []).map(orderNodeToRest);
  const nextSinceId =
    orders.length === limit ? orders[orders.length - 1].id : null;
  return { orders, nextSinceId };
}

/**
 * Fetch one order by its numeric (legacy) ID. Returns null when the
 * order doesn't exist. Used by reimport-line-items to hydrate
 * historical orders that were ingested before COGS tracking.
 */
export async function getOrder(opts: {
  shopDomain: string;
  accessToken: string;
  orderId: string | number;
}): Promise<ShopifyOrder | null> {
  const data = await shopifyGraphql<{ order: GqlOrderNode | null }>({
    shopDomain: opts.shopDomain,
    accessToken: opts.accessToken,
    query: `query GetOrder($id: ID!) {
      order(id: $id) {${ORDER_SELECTION}
      }
    }`,
    variables: { id: `gid://shopify/Order/${opts.orderId}` },
  });
  return data.order ? orderNodeToRest(data.order) : null;
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
  tax_amount: number;        // sales tax — excluded from revenue downstream
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
    // Separate sales tax so revenue (amount − tax) excludes it and the
    // "sales tax collected" liability picks it up — consistent with Square.
    tax_amount: Number(order.total_tax) || 0,
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
// Cost: Shopify keeps per-item cost on InventoryItem.unitCost, which
// requires the read_inventory scope we don't request — so cost is
// always null here and the bulk-import UI prompts the user. (The old
// REST version asked for a `cost` field products.json never returns,
// so nothing regressed; requesting read_inventory to prefill costs is
// a possible post-launch improvement.)
//
// Pagination: GraphQL cursor pagination over productVariants —
// flatter than products→variants nesting and 250-row pages are
// plenty for most maker catalogs.

interface GqlVariantNode {
  legacyResourceId: string;
  title: string | null;
  sku: string | null;
  product: { legacyResourceId: string; title: string };
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
 * across every product) via GraphQL cursor pagination. Walks every
 * page automatically until hasNextPage is false.
 */
export async function listCatalog(opts: {
  shopDomain: string;
  accessToken: string;
}): Promise<ShopifyCatalogVariation[]> {
  const out: ShopifyCatalogVariation[] = [];
  let after: string | null = null;

  while (true) {
    const data: {
      productVariants: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: GqlVariantNode[];
      };
    } = await shopifyGraphql({
      shopDomain: opts.shopDomain,
      accessToken: opts.accessToken,
      query: `query CatalogPage($first: Int!, $after: String) {
        productVariants(first: $first, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes {
            legacyResourceId
            title
            sku
            product { legacyResourceId title }
          }
        }
      }`,
      variables: { first: 250, after },
    });

    const page = data.productVariants;
    for (const v of page.nodes) {
      const distinctTitle =
        v.title && v.title !== "Default Title" && v.title !== v.product.title;
      out.push({
        variantId: v.legacyResourceId,
        productId: v.product.legacyResourceId,
        displayName: distinctTitle
          ? `${v.product.title} - ${v.title}`
          : v.product.title,
        sku: v.sku && v.sku.trim().length > 0 ? v.sku : null,
        cost: null, // needs read_inventory — see header comment
        currency: null,
      });
    }

    if (!page.pageInfo.hasNextPage || !page.pageInfo.endCursor) break;
    after = page.pageInfo.endCursor;
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

/** REST-style topic ("orders/create") → GraphQL enum (ORDERS_CREATE).
 *  The webhook DELIVERIES still carry the REST-style topic in the
 *  X-Shopify-Topic header, so the receiving route is unchanged. */
function topicToEnum(topic: ShopifyWebhookTopic): string {
  return topic.toUpperCase().replace(/\//g, "_");
}

/**
 * Register a webhook subscription with Shopify. Returns the
 * subscription id — a gid string — which we persist on
 * shopify_connections.webhook_subscription_ids so the disconnect
 * flow can clean them up. (Legacy rows hold bare numeric REST ids;
 * unsubscribeWebhook accepts both.)
 *
 * Idempotent on reconnect: unlike REST, the GraphQL create errors
 * with "already been taken" for an existing (topic, uri) pair — in
 * that case we look up and return the existing subscription's id.
 *
 * @param address the public URL Shopify will POST to on each event
 */
export async function subscribeWebhook(opts: {
  shopDomain: string;
  accessToken: string;
  topic: ShopifyWebhookTopic;
  address: string;
}): Promise<{ id: string }> {
  const topicEnum = topicToEnum(opts.topic);
  const data = await shopifyGraphql<{
    webhookSubscriptionCreate: {
      webhookSubscription: { id: string } | null;
      userErrors: Array<{ field: string[] | null; message: string }>;
    };
  }>({
    shopDomain: opts.shopDomain,
    accessToken: opts.accessToken,
    query: `mutation WebhookCreate($topic: WebhookSubscriptionTopic!, $webhookSubscription: WebhookSubscriptionInput!) {
      webhookSubscriptionCreate(topic: $topic, webhookSubscription: $webhookSubscription) {
        webhookSubscription { id }
        userErrors { field message }
      }
    }`,
    variables: {
      topic: topicEnum,
      webhookSubscription: { callbackUrl: opts.address, format: "JSON" },
    },
  });
  const payload = data.webhookSubscriptionCreate;
  if (payload.webhookSubscription) return { id: payload.webhookSubscription.id };

  const messages = payload.userErrors.map((e) => e.message).join("; ");
  if (/taken|exists/i.test(messages)) {
    // Already subscribed — find and return the existing id.
    const lookup = await shopifyGraphql<{
      webhookSubscriptions: {
        nodes: Array<{ id: string; topic: string; uri: string }>;
      };
    }>({
      shopDomain: opts.shopDomain,
      accessToken: opts.accessToken,
      query: `query WebhookLookup($topics: [WebhookSubscriptionTopic!]) {
        webhookSubscriptions(first: 50, topics: $topics) {
          nodes { id topic uri }
        }
      }`,
      variables: { topics: [topicEnum] },
    });
    const existing = lookup.webhookSubscriptions.nodes.find(
      (n) => n.uri === opts.address
    );
    if (existing) return { id: existing.id };
  }
  throw new Error(
    `Shopify webhook subscribe (${opts.topic}) failed: ${messages || "no subscription returned"}`
  );
}

/**
 * Delete a webhook subscription. Best-effort caller — the disconnect
 * route logs failures but doesn't block on them (a webhook to a
 * deleted Dreamward connection is harmless — the receiver 404s on
 * its own client_id lookup).
 *
 * Accepts both gid ids (GraphQL era) and bare numeric ids persisted
 * by the retired REST implementation.
 */
export async function unsubscribeWebhook(opts: {
  shopDomain: string;
  accessToken: string;
  webhookId: string;
}): Promise<void> {
  const gid = opts.webhookId.startsWith("gid://")
    ? opts.webhookId
    : `gid://shopify/WebhookSubscription/${opts.webhookId}`;
  const data = await shopifyGraphql<{
    webhookSubscriptionDelete: {
      deletedWebhookSubscriptionId: string | null;
      userErrors: Array<{ field: string[] | null; message: string }>;
    };
  }>({
    shopDomain: opts.shopDomain,
    accessToken: opts.accessToken,
    query: `mutation WebhookDelete($id: ID!) {
      webhookSubscriptionDelete(id: $id) {
        deletedWebhookSubscriptionId
        userErrors { field message }
      }
    }`,
    variables: { id: gid },
  });
  const errs = data.webhookSubscriptionDelete.userErrors;
  // "not found" parity with the REST 404 tolerance: already gone is fine.
  if (errs.length > 0 && !/not found|doesn't exist/i.test(errs.map((e) => e.message).join(" "))) {
    throw new Error(
      `Shopify webhook delete ${opts.webhookId}: ${errs.map((e) => e.message).join("; ")}`
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
  originalAmount: number;           // original order total (incl tax) — for the tax slice
  originalTax: number;              // original order's total tax — for the tax slice
}): MappedOrderRow {
  // Sum successful refund transactions. Shopify reports amounts as
  // positive strings; we negate for the processed_items row so
  // downstream sum-of-amounts produces correct net revenue.
  const refundAmount = opts.refund.transactions
    .filter((t) => t.kind === "refund" && t.status === "success")
    .reduce((sum, t) => sum + Number(t.amount), 0);

  // Proportional tax reversal (mirrors Square): the share of the order
  // refunded × its tax. Negated so the sales-tax-collected liability nets
  // back down by the same amount the original sale added. Approximate when
  // refunds are uneven across lines, but correct for full refunds.
  const taxSlice =
    opts.originalAmount > 0
      ? Math.min(1, refundAmount / opts.originalAmount) * opts.originalTax
      : 0;

  const date = (opts.refund.processed_at || opts.refund.created_at).slice(0, 10);

  return {
    vendor: opts.customerName,
    invoice_number: `${opts.originalOrderName}-refund`,
    amount: -refundAmount,
    tax_amount: -taxSlice,
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
