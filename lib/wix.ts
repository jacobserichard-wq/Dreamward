// lib/wix.ts
//
// Phase 10 architecture pivot. Typed Wix Stores API client + token
// minting + webhook verification. Pure — no DB I/O. Route handlers
// (app/api/wix/*) own DB writes; this module owns the protocol.
//
// ─────────────────────────────────────────────────────────────────
// Why this looks different than every other OAuth integration in
// the codebase (Shopify, etc.):
// ─────────────────────────────────────────────────────────────────
// Wix's "Custom Authentication" — the OAuth 2.0 redirect flow with
// authorize URLs, code exchange, encrypted refresh-token storage,
// and refresh-before-use logic — is DEPRECATED and no longer
// available for new apps as of Wix's 2025 policy update.
//
// The supported pattern for new apps is **Client Credentials**:
//
//   POST https://www.wixapis.com/oauth2/token
//   {
//     "grant_type":    "client_credentials",
//     "client_id":     <WIX_CLIENT_ID>,
//     "client_secret": <WIX_CLIENT_SECRET>,
//     "instance_id":   <site-specific Wix App Instance UUID>
//   }
//   → { access_token, expires_in }  (short-lived; ~5 min)
//
// We store NO tokens. We store only the per-site instance_id (binding
// Dreamward's client_id ↔ Wix's instance_id) in wix_connections + mint
// fresh tokens on demand. An in-process cache trims minting to roughly
// once per ~5 min per site.
//
// The instance_id arrives from Wix via:
//   1. POST /api/wix/installed  — JWT-signed app-installed webhook
//                                 (machine-to-machine; uses jose
//                                 to verify against WIX_WEBHOOK_PUBLIC_KEY)
//   2. GET /api/wix/installed/redirect — browser-redirected merchant
//                                        with instanceId in URL params
//                                        (uses NextAuth session to
//                                        bind to a Dreamward client)
//
// See session-notes/phase-10-wix-architecture-pivot.md for the full
// architecture decision record + commit-by-commit refactor plan.
//
// ─────────────────────────────────────────────────────────────────
// Still TODO during 10c–10e:
//   - Stores API base path — currently assuming /stores/v2 but Wix
//     Dev Center App Settings → "Wix Stores Catalog V1 & V3
//     compatibility: App is compatible" suggests v3 is the modern
//     default. Verify when 10c (backfill) ships.

import { jwtVerify, importSPKI } from "jose";

// ---------------------------------------------------------------------
// Env-var loading (lazy + validating)
// ---------------------------------------------------------------------

function loadAppCreds(): { appId: string; appSecret: string } {
  const appId = process.env.WIX_CLIENT_ID;
  const appSecret = process.env.WIX_CLIENT_SECRET;
  if (!appId) throw new Error("WIX_CLIENT_ID env var is not set");
  if (!appSecret) throw new Error("WIX_CLIENT_SECRET env var is not set");
  return { appId, appSecret };
}

function loadWebhookPublicKey(): string {
  const raw = process.env.WIX_WEBHOOK_PUBLIC_KEY;
  if (!raw) throw new Error("WIX_WEBHOOK_PUBLIC_KEY env var is not set");
  // Wix Dev Center provides the key in PEM (multi-line, with BEGIN/END
  // markers + newlines) or as a base64-encoded single line. Mirror
  // @wix/sdk's parsePublicKeyIfEncoded helper: if it looks like PEM,
  // pass through; otherwise base64-decode to PEM.
  if (raw.includes("\n") || raw.includes("\r")) return raw.trim();
  return Buffer.from(raw, "base64").toString("utf-8");
}

// ---------------------------------------------------------------------
// Token minting (Client Credentials + in-process cache)
// ---------------------------------------------------------------------

/** Cached token entry. expiresAt is wall-clock ms; we trim by 60s
 *  to avoid serving a token that expires mid-flight. */
interface CachedToken {
  accessToken: string;
  expiresAt: number; // epoch ms
}
const tokenCache = new Map<string, CachedToken>();
const TOKEN_SAFETY_MARGIN_MS = 60_000;

/**
 * Mint a short-lived Wix access token for a specific app instance
 * (i.e., a specific merchant's Wix site) using Client Credentials.
 *
 * Hot path is cached: a single mint per instance_id covers ~5 min
 * of API calls. Cache is per-process — Vercel cold starts re-mint,
 * which is fine (single HTTP call, no rate limits we've observed).
 *
 * Throws on HTTP error so callers can surface to the user instead
 * of returning a stale or nullish token.
 */
export async function mintAccessToken(opts: {
  instanceId: string;
}): Promise<{ accessToken: string; expiresAt: Date }> {
  const cached = tokenCache.get(opts.instanceId);
  if (cached && cached.expiresAt - TOKEN_SAFETY_MARGIN_MS > Date.now()) {
    return {
      accessToken: cached.accessToken,
      expiresAt: new Date(cached.expiresAt),
    };
  }

  const { appId, appSecret } = loadAppCreds();
  const res = await fetch("https://www.wixapis.com/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: appId,
      client_secret: appSecret,
      instance_id: opts.instanceId,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Wix token mint failed: HTTP ${res.status} ${body.slice(0, 200)}`
    );
  }
  const data = (await res.json()) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!data.access_token || typeof data.expires_in !== "number") {
    throw new Error("Wix token mint returned an unexpected payload shape");
  }

  const expiresAtMs = Date.now() + data.expires_in * 1000;
  tokenCache.set(opts.instanceId, {
    accessToken: data.access_token,
    expiresAt: expiresAtMs,
  });
  return {
    accessToken: data.access_token,
    expiresAt: new Date(expiresAtMs),
  };
}

/**
 * Drop a cached token (e.g., on disconnect) so a future re-connect
 * doesn't serve the stale entry. Safe no-op when nothing's cached.
 */
export function clearCachedToken(instanceId: string): void {
  tokenCache.delete(instanceId);
}

// ---------------------------------------------------------------------
// Webhook verification (RS256-signed JWT, per Wix's pattern)
// ---------------------------------------------------------------------

/**
 * Verify an RS256-signed JWT from a Wix webhook delivery.
 *
 * Wix wraps webhook payloads in a JWT with these top-level claims:
 *   { iss: 'wix.com', aud: <app_id>, exp, iat,
 *     eventType: 'wix.app_market.v1.app_installed' (or similar),
 *     instanceId: <UUID — the site-app instance the event is for>,
 *     identity: { type: 'WIX_USER' | 'APP' | ..., id: <UUID> },
 *     data: <JSON-encoded string with event-specific payload> }
 *
 * The previous version of this function returned only the parsed
 * `data` field — which loses the critical `instanceId` (top-level,
 * NOT inside data). Now returns the full verified envelope, with
 * `data` parsed in place when it's a JSON string. Caller can pull
 * whatever fields it needs.
 *
 * Returns null on any verification failure (bad signature, expired,
 * wrong iss/aud) — caller should 401 the request.
 */
export async function verifyAppInstalledWebhook(opts: {
  jwt: string;
}): Promise<Record<string, unknown> | null> {
  try {
    const publicKeyPem = loadWebhookPublicKey();
    const publicKey = await importSPKI(publicKeyPem, "RS256");
    // No issuer/audience options: empirical testing (sub-session 25,
    // 2026-05-26) showed Wix's webhook JWTs don't include `iss` or
    // `aud` claims at all, despite their docs implying iss='wix.com'.
    // jose rejects any JWT missing a required claim, so passing those
    // options as required would always fail. Signature verification
    // against Wix's RSA public key is the real security boundary —
    // anything that validates is genuinely from Wix.
    const verified = await jwtVerify(opts.jwt, publicKey);
    // Clone the envelope and parse `data` in place if it's a string —
    // gives the caller a single object to work with.
    const envelope = { ...verified.payload } as Record<string, unknown>;
    const rawData = envelope.data;
    if (typeof rawData === "string") {
      try {
        envelope.data = JSON.parse(rawData);
      } catch {
        // Leave as raw string when not parseable — caller decides.
      }
    }
    return envelope;
  } catch (err) {
    // Surface enough info to diagnose which check failed without
    // leaking the JWT itself. jose throws typed errors:
    //   JWSSignatureVerificationFailed — bad signature
    //   JWTClaimValidationFailed — wrong iss/aud/exp/nbf
    //   JWTInvalid / JWTExpired — malformed / expired
    //   JOSEAlgNotAllowed — alg mismatch
    // The .code property + name combination is the diagnostic.
    const name = err instanceof Error ? err.name : "Unknown";
    const message = err instanceof Error ? err.message : String(err);
    const code = (err as { code?: string })?.code ?? "(no code)";
    console.warn(
      `Wix webhook verify failed — name=${name} code=${code} ` +
        `message=${message}`
    );
    return null;
  }
}

// ---------------------------------------------------------------------
// API client
// ---------------------------------------------------------------------

const WIX_API_BASE = "https://www.wixapis.com";

/**
 * Bare REST GET against Wix's API. Auth via Authorization header
 * (raw access token; no "Bearer " prefix — verified against
 * @wix/sdk AppStrategy.getAuthHeaders). Path is appended to
 * WIX_API_BASE.
 *
 * Callers should obtain accessToken via mintAccessToken() first.
 *
 * ⚠️ TODO: confirm /stores/v2 vs /stores/v3 path during Phase 10c.
 */
export async function wixGet<T = unknown>(opts: {
  accessToken: string;
  path: string; // e.g. "/stores/v3/orders/query"
}): Promise<T> {
  const url = `${WIX_API_BASE}${opts.path}`;
  const res = await fetch(url, {
    headers: {
      Authorization: opts.accessToken,
      Accept: "application/json",
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Wix GET ${opts.path}: HTTP ${res.status} ${body.slice(0, 200)}`
    );
  }
  return (await res.json()) as T;
}

/** Bare REST POST. Same auth + base-URL conventions as wixGet. */
export async function wixPost<T = unknown>(opts: {
  accessToken: string;
  path: string;
  body: unknown;
}): Promise<T> {
  const url = `${WIX_API_BASE}${opts.path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: opts.accessToken,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(opts.body),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Wix POST ${opts.path}: HTTP ${res.status} ${body.slice(0, 200)}`
    );
  }
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------
// Orders API (Phase 10c — backfill + webhook ingestion)
// ---------------------------------------------------------------------
//
// Endpoint: POST https://www.wixapis.com/ecom/v1/orders/search
// Verified (sub-session 26, 2026-05-27):
//   - The Wix Stores v2 orders API is deprecated; v3 / eCommerce is
//     the current path (per Wix docs migration table reference).
//   - Cursor pagination with cursorPaging.limit default 100.
//   - Filterable fields include id, number, createdDate,
//     priceSummary.total.amount, paymentStatus, buyerInfo.email,
//     billingInfo.contactDetails.firstName/lastName,
//     lineItems.productName.original.
//
// ⚠️ Response shape (specifically the cursor location) wasn't fully
// documented externally — the parser below tries multiple known
// Wix conventions. We log the raw response on the first call to
// confirm the actual structure.

/**
 * Wix eCommerce Order schema. Minimal subset for bookkeeping —
 * everything we need to map to processed_items. Wix's actual
 * response object has many more fields (we ignore them).
 */
export interface WixOrder {
  id: string;
  number?: string | number; // human-friendly order number
  createdDate?: string; // ISO timestamp
  paymentStatus?: string; // 'PAID' | 'NOT_PAID' | 'REFUNDED' | 'PARTIALLY_PAID' | etc.
  fulfillmentStatus?: string;
  priceSummary?: {
    total?: { amount?: string; currency?: string };
    subtotal?: { amount?: string };
    tax?: { amount?: string };
    shipping?: { amount?: string };
    discount?: { amount?: string };
  };
  // Top-level currency may also appear separately from priceSummary
  currency?: string;
  // Present on the Get Order detail (not the search list / webhook
  // payload). balanceSummary.refunded.amount is the CUMULATIVE amount
  // refunded on the order — the authoritative source for refund sync.
  balanceSummary?: {
    balance?: { amount?: string; formattedAmount?: string };
    paid?: { amount?: string; formattedAmount?: string };
    refunded?: { amount?: string; formattedAmount?: string };
  };
  buyerInfo?: {
    email?: string | null;
    contactId?: string | null;
  } | null;
  billingInfo?: {
    contactDetails?: {
      firstName?: string | null;
      lastName?: string | null;
    } | null;
  } | null;
  lineItems?: Array<{
    id?: string;
    productName?: { original?: string };
    quantity?: number;
    price?: { amount?: string };
    /** Wix's stable reference to the catalog item being sold. The
     *  alias join key (sku_aliases.external_id) is
     *  catalogReference.catalogItemId. appId distinguishes which
     *  Wix app sourced the line item (Stores vs. Bookings vs.
     *  Restaurants etc.); we capture it for diagnostics but the
     *  matching key is just catalogItemId. */
    catalogReference?: {
      appId?: string | null;
      catalogItemId?: string | null;
      /** Wix-internal map of variant options (size, color, etc.).
       *  Kept opaque — not used for SKU matching v1. */
      options?: Record<string, unknown> | null;
    } | null;
    /** Some Wix order shapes expose a top-level SKU code at the
     *  line item level. Display only — matching is by catalogItemId. */
    physicalProperties?: { sku?: string | null } | null;
  }>;
}

interface WixOrdersSearchResponse {
  orders?: WixOrder[];
  // Wix uses several cursor conventions across APIs — handle multiple
  metadata?: {
    cursors?: { next?: string | null; prev?: string | null };
    count?: number;
    hasNext?: boolean;
  };
  pagingMetadata?: {
    cursors?: { next?: string | null };
    count?: number;
    hasNext?: boolean;
  };
}

/**
 * Fetch one page of orders for a Wix store. Cursor-paginated;
 * pass the cursor from the previous response to get the next page.
 * Returns null nextCursor when there are no more pages.
 *
 * Sorted ascending by createdDate so backfill imports oldest first
 * (matches Shopify backfill behavior — lets the merchant see
 * historical context populate naturally).
 */
export async function fetchOrdersPage(opts: {
  accessToken: string;
  cursor?: string | null;
  limit?: number; // default 100, Wix max 100
}): Promise<{
  orders: WixOrder[];
  nextCursor: string | null;
}> {
  const limit = Math.min(opts.limit ?? 100, 100);
  const body: Record<string, unknown> = {
    search: {
      cursorPaging: opts.cursor
        ? { limit, cursor: opts.cursor }
        : { limit },
      sort: [{ fieldName: "createdDate", order: "ASC" }],
    },
  };

  const raw = await wixPost<WixOrdersSearchResponse>({
    accessToken: opts.accessToken,
    path: "/ecom/v1/orders/search",
    body,
  });

  // Defensive cursor extraction — try the known shapes in order.
  // Log the raw response keys on first call (when cursor is undefined)
  // so we can verify the shape empirically.
  if (!opts.cursor) {
    console.log(
      "Wix orders/search first-page response keys:",
      Object.keys(raw),
      "metadata keys:",
      raw.metadata ? Object.keys(raw.metadata) : null,
      "pagingMetadata keys:",
      raw.pagingMetadata ? Object.keys(raw.pagingMetadata) : null
    );
  }

  const nextCursor =
    raw.metadata?.cursors?.next ??
    raw.pagingMetadata?.cursors?.next ??
    null;

  return {
    orders: raw.orders ?? [],
    nextCursor: nextCursor || null,
  };
}

/**
 * Shape we INSERT into processed_items for one Wix order. Mirrors
 * the MappedOrderRow pattern from lib/shopify, with `channel`
 * explicitly tagged (Shopify shipped before the channel column
 * existed in Phase 9.3; new integrations like Wix set it directly).
 */
export interface MappedWixOrderRow {
  vendor: string;
  invoice_number: string;
  amount: number;
  due_date: string;          // YYYY-MM-DD (pg DATE)
  status: string;            // 'paid' | 'pending' | 'cancelled'
  category: string;          // hardcoded "Online Sales"
  source: "wix";
  source_ref_id: string;     // Wix order ID (UUID-string)
  channel: "wix";            // explicit channel tag for rollups
  confidence: number;        // 100 — direct API, no AI extraction
  summary: string;
  extracted_data: Record<string, unknown>;
}

/**
 * Map a Wix eCommerce order into the processed_items row shape.
 * Mirrors lib/shopify.mapOrderToProcessedItem with Wix-specific
 * field paths (priceSummary.total.amount, buyerInfo.email,
 * billingInfo.contactDetails.{firstName,lastName}, etc.).
 *
 * Defensive against missing fields — Wix's API is loose about what
 * it returns based on order state, so we fall back gracefully.
 */
export function mapWixOrderToProcessedItem(
  order: WixOrder
): MappedWixOrderRow {
  // Customer name preference: first+last, then email, then "Unknown"
  const first = order.billingInfo?.contactDetails?.firstName?.trim() || "";
  const last = order.billingInfo?.contactDetails?.lastName?.trim() || "";
  const fullName = [first, last].filter(Boolean).join(" ").trim();
  const customerName =
    fullName || order.buyerInfo?.email || "Unknown customer";

  // Date: use createdDate (ISO timestamp). Slice to YYYY-MM-DD for
  // the pg DATE column.
  const isoDate = order.createdDate || new Date().toISOString();
  const dueDate = isoDate.slice(0, 10);

  // Status mapping — Wix's paymentStatus enum:
  //   PAID, NOT_PAID, PARTIALLY_PAID, REFUNDED, PARTIALLY_REFUNDED,
  //   PENDING, CANCELLED (per Wix eCommerce docs)
  let status: string;
  const ps = order.paymentStatus?.toUpperCase() ?? "";
  if (ps === "CANCELLED") {
    status = "cancelled";
  } else if (ps === "PAID" || ps === "REFUNDED" || ps === "PARTIALLY_REFUNDED") {
    // Refunds preserve the original sale row; refund itself is a
    // separate Phase 10d webhook event (if we wire it up).
    status = "paid";
  } else {
    status = "pending";
  }

  // Amounts — Wix returns strings like "99.99"
  const totalAmount = Number(order.priceSummary?.total?.amount ?? "0") || 0;
  const currency = order.priceSummary?.total?.currency || order.currency || "USD";
  const lineItemCount = order.lineItems?.length ?? 0;

  // Invoice number — Wix's order.number is human-friendly (10001, etc.)
  const invoiceNumber = order.number
    ? `#${String(order.number)}`
    : `#${order.id.slice(0, 8)}`;

  return {
    vendor: customerName,
    invoice_number: invoiceNumber,
    amount: totalAmount,
    due_date: dueDate,
    status,
    category: "Online Sales",
    source: "wix",
    source_ref_id: order.id,
    channel: "wix",
    confidence: 100,
    summary: `Wix order ${invoiceNumber} — ${lineItemCount} item${lineItemCount === 1 ? "" : "s"}, ${currency} ${totalAmount.toFixed(2)}`,
    extracted_data: {
      wix_order_id: order.id,
      order_number: order.number,
      currency,
      payment_status: order.paymentStatus,
      fulfillment_status: order.fulfillmentStatus,
      buyer_email: order.buyerInfo?.email ?? null,
      subtotal: order.priceSummary?.subtotal?.amount ?? null,
      tax: order.priceSummary?.tax?.amount ?? null,
      shipping: order.priceSummary?.shipping?.amount ?? null,
      discount: order.priceSummary?.discount?.amount ?? null,
      line_items: (order.lineItems ?? []).map((li) => ({
        id: li.id,
        name: li.productName?.original,
        quantity: li.quantity,
        price: li.price?.amount,
        catalog_item_id: li.catalogReference?.catalogItemId ?? null,
        catalog_app_id: li.catalogReference?.appId ?? null,
        sku: li.physicalProperties?.sku ?? null,
      })),
    },
  };
}

// ---------------------------------------------------------------------
// Refunds (Phase 10d — wired up)
// ---------------------------------------------------------------------
//
// A Wix refund arrives as an order_updated event whose paymentStatus
// becomes REFUNDED / PARTIALLY_REFUNDED. The webhook order payload does
// NOT carry the refunded amount — only the status. So we fetch the
// Get Order detail for the authoritative CUMULATIVE
// balanceSummary.refunded.amount, and record ONE negative row per order
// (source_ref_id = 'wix-refund-{orderId}') holding the total refunded.
// Upserting to the cumulative total is idempotent and naturally correct
// across multiple partial refunds + corrections. Mirrors how Wix sale
// rows treat tax (folded into the total, no separate tax_amount), so a
// full refund nets the sale to zero.

/**
 * Fetch a single order's full detail (includes balanceSummary, absent
 * from the search list + webhook payload). Returns null if not found.
 * Throws on transport/HTTP errors (caller decides how to handle).
 */
export async function fetchWixOrder(opts: {
  accessToken: string;
  orderId: string;
}): Promise<WixOrder | null> {
  const raw = await wixGet<{ order?: WixOrder }>({
    accessToken: opts.accessToken,
    path: `/ecom/v1/orders/${encodeURIComponent(opts.orderId)}`,
  });
  return raw.order ?? null;
}

/**
 * Map a Wix refund into a NEGATIVE processed_items row that nets
 * against the original sale. `refundedAmount` is the positive
 * cumulative total refunded (from balanceSummary.refunded). The row's
 * amount is set to the negative of that total, so re-running on a later
 * partial refund just updates the same row to the new cumulative.
 */
export function mapWixRefundToProcessedItem(opts: {
  order: WixOrder;
  refundedAmount: number; // positive, cumulative, major units
  currency: string;
}): MappedWixOrderRow {
  const base = mapWixOrderToProcessedItem(opts.order);
  const dueDate = new Date().toISOString().slice(0, 10);
  return {
    vendor: base.vendor,
    invoice_number: `${base.invoice_number}-refund`,
    amount: -opts.refundedAmount, // NEGATIVE — nets against Wix income
    due_date: dueDate,
    status: "paid", // refund completed = settled
    category: base.category, // "Online Sales" — same as the sale so it nets
    source: "wix",
    source_ref_id: `wix-refund-${opts.order.id}`,
    channel: "wix",
    confidence: 100,
    summary: `Wix refund for order ${base.invoice_number} — ${opts.currency} ${opts.refundedAmount.toFixed(2)}`,
    extracted_data: {
      wix_order_id: opts.order.id,
      refunded_amount: opts.refundedAmount,
      currency: opts.currency,
      payment_status: opts.order.paymentStatus ?? null,
      cumulative: true,
    },
  };
}

/**
 * Phase 12c: extract line items from a Wix order in the
 * platform-agnostic shape required by
 * lib/cogs/lineItems.bulkInsertLineItemsForParent.
 *
 * Each Wix lineItem becomes one InternalLineItem:
 *   externalId       = lineItem.id (Wix line-item UUID)
 *   externalItemId   = catalogReference.catalogItemId — the
 *                      alias join key
 *   externalSku      = physicalProperties.sku — display only
 *   name             = productName.original or "Untitled"
 *   quantity         = lineItem.quantity or 1
 *   unitPrice        = Number(price.amount) or 0
 *   currency         = order-level currency from priceSummary or
 *                      the order.currency fallback (USD if neither)
 *
 * Skips line items with no id (rare but defensive — every Wix
 * order line item should have a uuid).
 */
// ---------------------------------------------------------------------
// Phase 12e: Catalog API (bulk-import SKUs from Wix Stores)
// ---------------------------------------------------------------------
//
// Wix's eCommerce V3 catalog returns Products, each with optional
// variants and a stable catalogItemId (different from the product
// id). When line items come in via orders, their
// catalogReference.catalogItemId is what sku_aliases.external_id
// stores — so that's what we use as the import key.
//
// Cost: Wix doesn't expose product cost via the public Catalog
// API. Their inventory cost tracking lives in a separate add-on
// app. We always surface cost = null and prompt the merchant in
// the bulk-import UI.

interface WixCatalogProduct {
  id?: string;
  name?: string;
  /** Wix-internal stable catalog identifier — this is what line
   *  items reference via catalogReference.catalogItemId. */
  catalogItemId?: string;
  /** Single-variant products carry the SKU at the product level.
   *  Multi-variant products put it on each variant (handled below). */
  physicalProperties?: { sku?: string | null } | null;
  variants?: Array<{
    id?: string;
    physicalProperties?: { sku?: string | null } | null;
    /** Variant-level name composed by Wix from the option values
     *  (e.g., "Small / Red"). */
    name?: string;
  }>;
  /** Sell-side currency for diagnostics — cost stays null. */
  priceData?: { currency?: string };
}

interface WixProductsQueryResponse {
  products?: WixCatalogProduct[];
  /** Wix uses pagingMetadata.cursors.next for cursor pagination,
   *  mirroring orders. */
  pagingMetadata?: { cursors?: { next?: string | null } };
}

/** Flattened, Dreamward-friendly shape returned by listCatalog.
 *  Single-variant products produce one row; multi-variant products
 *  produce one row per variant. */
export interface WixCatalogVariation {
  /** catalogItemId — the alias join key for sku_aliases.external_id
   *  when line items come in. */
  externalId: string;
  /** Wix internal product id (for diagnostics; not used for
   *  matching). */
  productId: string;
  displayName: string;
  sku: string | null;
  /** Always null — Wix doesn't expose cost. */
  cost: number | null;
  currency: string | null;
}

/**
 * Fetch the merchant's full Wix Stores catalog. Cursor-paginated
 * via the Query Products endpoint; we walk every page.
 */
export async function listCatalog(opts: {
  accessToken: string;
}): Promise<WixCatalogVariation[]> {
  const out: WixCatalogVariation[] = [];
  let cursor: string | null = null;

  while (true) {
    const body: Record<string, unknown> = {
      query: {
        paging: { limit: 100 },
      },
    };
    if (cursor) {
      (body.query as Record<string, unknown>).cursorPaging = { cursor };
    }

    const res = await fetch("https://www.wixapis.com/stores/v3/products/query", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      throw new Error(
        `Wix catalog query failed: HTTP ${res.status} ${txt.slice(0, 200)}`
      );
    }
    const data = (await res.json()) as WixProductsQueryResponse;
    const products = data.products ?? [];
    if (products.length === 0) break;

    for (const p of products) {
      // Wix's catalogItemId is the matcher. If absent (rare —
      // archived items), fall back to id.
      const externalId = p.catalogItemId ?? p.id;
      if (!externalId) continue;
      const productName = p.name ?? "Untitled product";
      const currency = p.priceData?.currency ?? null;

      if (p.variants && p.variants.length > 0) {
        for (const v of p.variants) {
          const variantName = v.name && v.name.trim().length > 0 ? v.name : null;
          out.push({
            externalId,
            productId: p.id ?? externalId,
            displayName: variantName
              ? `${productName} (${variantName})`
              : productName,
            sku: v.physicalProperties?.sku ?? null,
            cost: null,
            currency,
          });
        }
      } else {
        out.push({
          externalId,
          productId: p.id ?? externalId,
          displayName: productName,
          sku: p.physicalProperties?.sku ?? null,
          cost: null,
          currency,
        });
      }
    }

    cursor = data.pagingMetadata?.cursors?.next ?? null;
    if (!cursor) break;
  }

  return out;
}

export function extractWixLineItems(
  order: WixOrder
): import("./cogs/lineItems").InternalLineItem[] {
  const currency =
    order.priceSummary?.total?.currency || order.currency || "USD";
  return (order.lineItems ?? [])
    .filter((li): li is NonNullable<typeof li> & { id: string } =>
      typeof li?.id === "string" && li.id.length > 0
    )
    .map((li) => ({
      externalId: li.id,
      externalItemId: li.catalogReference?.catalogItemId ?? null,
      externalSku: li.physicalProperties?.sku ?? null,
      name: li.productName?.original ?? "Untitled item",
      quantity: typeof li.quantity === "number" ? li.quantity : 1,
      unitPrice: Number(li.price?.amount ?? "0") || 0,
      currency,
    }));
}

// ---------------------------------------------------------------------
// Site display name (for the connection card)
// ---------------------------------------------------------------------

/**
 * Fetch the connected Wix site's display name for the UI. The
 * instance_id we get from install isn't user-friendly; this hits
 * Wix's Sites API to get "Acme Shop" or whatever the merchant
 * named it.
 *
 * ⚠️ TODO: verify endpoint path + response shape during 10c.
 */
export async function fetchSiteDisplayName(opts: {
  accessToken: string;
}): Promise<string | null> {
  try {
    const data = await wixGet<{ site?: { displayName?: string } }>({
      accessToken: opts.accessToken,
      path: "/sites/v1/sites/current",
    });
    return data.site?.displayName ?? null;
  } catch {
    // Non-fatal — connection still works without the display name.
    return null;
  }
}
