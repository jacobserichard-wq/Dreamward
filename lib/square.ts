// lib/square.ts
//
// Phase 11a commit 2. Square OAuth helpers + REST API client +
// token-refresh logic + Payments-API mapping helpers. Pure — no DB
// I/O. Route handlers (app/api/square/*) own DB writes; this module
// makes the HTTP calls and shapes the data.
//
// ─────────────────────────────────────────────────────────────────
// Why Square is so much cleaner than Wix:
// ─────────────────────────────────────────────────────────────────
// Standard OAuth 2.0 Authorization Code flow with refresh tokens.
// Same pattern as every other SaaS integration (Shopify is similar
// but uses permanent tokens instead of expiring ones). No custom
// install URLs, no dashboard extensions, no per-app weirdness.
//
// Sandbox vs Production: Square offers a first-class sandbox env
// with separate API base URLs + separate credentials. Toggled via
// SQUARE_ENVIRONMENT env var (defaults to 'production'). Connection
// rows store which env they belong to so a single FlowWork user
// can have both connected during dev without collisions.
//
// Token lifecycle:
//   - Access tokens expire after 30 days
//   - Refresh tokens expire after 90 days AND rotate on each refresh
//   - withAccessToken() handles pre-emptive refresh + persists the
//     rotated refresh token back to the DB

import { createHmac, timingSafeEqual } from "crypto";

// ---------------------------------------------------------------------
// Environment selection + endpoint config
// ---------------------------------------------------------------------

/**
 * Square environment. Determines which API base URL + OAuth URLs
 * to use. 'production' = real money; 'sandbox' = test env with
 * fake cards. Defaults to production so accidental misconfig in
 * Vercel fails closed (sandbox credentials hitting production
 * endpoints would 401, vs. production credentials hitting sandbox
 * which would just succeed against test data — worse outcome).
 */
export type SquareEnvironment = "sandbox" | "production";

export function getSquareEnvironment(): SquareEnvironment {
  const env = process.env.SQUARE_ENVIRONMENT?.toLowerCase();
  return env === "sandbox" ? "sandbox" : "production";
}

/** API base URL for the configured environment. */
export function getSquareApiBase(env?: SquareEnvironment): string {
  const e = env ?? getSquareEnvironment();
  return e === "sandbox"
    ? "https://connect.squareupsandbox.com"
    : "https://connect.squareup.com";
}

/** OAuth authorize URL — where we redirect the merchant to consent. */
export function getSquareOauthAuthorizeUrl(env?: SquareEnvironment): string {
  const e = env ?? getSquareEnvironment();
  return e === "sandbox"
    ? "https://connect.squareupsandbox.com/oauth2/authorize"
    : "https://connect.squareup.com/oauth2/authorize";
}

// ---------------------------------------------------------------------
// Env-var loading (lazy + validating)
// ---------------------------------------------------------------------

function loadOauthCreds(): {
  clientId: string;
  clientSecret: string;
} {
  const clientId = process.env.SQUARE_CLIENT_ID;
  const clientSecret = process.env.SQUARE_CLIENT_SECRET;
  if (!clientId) throw new Error("SQUARE_CLIENT_ID env var is not set");
  if (!clientSecret) throw new Error("SQUARE_CLIENT_SECRET env var is not set");
  return { clientId, clientSecret };
}

function loadWebhookSignatureKey(): string {
  const key = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
  if (!key) throw new Error("SQUARE_WEBHOOK_SIGNATURE_KEY env var is not set");
  return key;
}

// ---------------------------------------------------------------------
// OAuth — authorize URL + code exchange + refresh
// ---------------------------------------------------------------------

/**
 * Default OAuth scopes for the bookkeeping use case + the upcoming
 * Phase 12 COGS system.
 *
 * Phase 11 needs:
 *   - PAYMENTS_READ — list/get payment objects (revenue rollups)
 *   - MERCHANT_PROFILE_READ — business name for the UI
 *
 * Phase 12 (COGS) needs the next two ahead of time so merchants
 * who connect today don't have to re-consent when COGS ships:
 *   - ORDERS_READ — line items per payment (which SKUs were sold +
 *     quantities + per-line prices). Payments alone don't carry
 *     line-item data; Orders do.
 *   - ITEMS_READ — Square's catalog including the `cost` field
 *     merchants can set per item variation. Lets us auto-suggest
 *     SKU→cost matches when the merchant builds their FlowWork
 *     SKU catalog.
 *
 * See session-notes/phase-12-cogs-design.md for the full COGS plan.
 *
 * Trade-off: adding more scopes here means the consent screen shows
 * more permissions, which CAN reduce conversion. We accept that to
 * avoid the bigger friction of re-consent flow once COGS ships.
 */
export const SQUARE_DEFAULT_SCOPES = [
  "PAYMENTS_READ",
  "ORDERS_READ",
  "ITEMS_READ",
  "MERCHANT_PROFILE_READ",
] as const;

/**
 * Build the URL we redirect the merchant to for the OAuth consent
 * screen. State is a CSRF nonce stored in a short-lived cookie that
 * the callback handler verifies on return.
 */
export function buildOauthAuthorizeUrl(opts: {
  state: string;
  scopes?: readonly string[];
}): string {
  const { clientId } = loadOauthCreds();
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    scope: (opts.scopes ?? SQUARE_DEFAULT_SCOPES).join(" "),
    state: opts.state,
    // Square's OAuth doesn't require redirect_uri on the authorize
    // URL when one is configured in the app's Dev Console — but
    // passing it doesn't hurt and lets us support multiple
    // environments without re-registering the URL each time.
    // (The redirect_uri must match one of the registered URLs.)
  });
  return `${getSquareOauthAuthorizeUrl()}?${params.toString()}`;
}

/**
 * Token response shape from Square's /oauth2/token endpoint.
 * Returned on both initial exchange and refresh.
 */
export interface SquareTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_at: string;       // ISO timestamp
  merchant_id: string;
  // present on initial exchange, sometimes omitted on refresh:
  short_lived?: boolean;
  token_type?: string;      // 'bearer'
  scope?: string;           // space-separated granted scopes (refresh may omit)
}

/**
 * Exchange the OAuth `code` for access + refresh tokens.
 * Called from the OAuth callback after the merchant approves.
 */
export async function exchangeCodeForToken(opts: {
  code: string;
}): Promise<SquareTokenResponse> {
  const { clientId, clientSecret } = loadOauthCreds();
  const res = await fetch(`${getSquareApiBase()}/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "Square-Version": "2025-04-16",
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "authorization_code",
      code: opts.code,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Square token exchange failed: HTTP ${res.status} ${body.slice(0, 200)}`
    );
  }
  const data = (await res.json()) as SquareTokenResponse;
  if (!data.access_token || !data.refresh_token || !data.merchant_id) {
    throw new Error("Square token exchange returned incomplete payload");
  }
  return data;
}

/**
 * Refresh an access token using the refresh token. Square rotates
 * the refresh token on every call — the caller MUST update both
 * stored tokens with the response values, not just access_token.
 */
export async function refreshAccessToken(opts: {
  refreshToken: string;
}): Promise<SquareTokenResponse> {
  const { clientId, clientSecret } = loadOauthCreds();
  const res = await fetch(`${getSquareApiBase()}/oauth2/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      "Square-Version": "2025-04-16",
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: opts.refreshToken,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Square token refresh failed: HTTP ${res.status} ${body.slice(0, 200)}`
    );
  }
  return (await res.json()) as SquareTokenResponse;
}

/**
 * Revoke an access token. Called at disconnect time so the token
 * stops being usable Square-side even if it leaks. Best-effort —
 * a failure here doesn't block the local disconnect.
 */
export async function revokeAccessToken(opts: {
  accessToken: string;
}): Promise<void> {
  const { clientId, clientSecret } = loadOauthCreds();
  const res = await fetch(
    `${getSquareApiBase()}/oauth2/revoke`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "Square-Version": "2025-04-16",
        Authorization: `Client ${clientSecret}`,
      },
      body: JSON.stringify({
        client_id: clientId,
        access_token: opts.accessToken,
      }),
    }
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Square token revoke failed: HTTP ${res.status} ${body.slice(0, 200)}`
    );
  }
}

// ---------------------------------------------------------------------
// HMAC webhook signature verification
// ---------------------------------------------------------------------

/**
 * Verify the Square-Signature header on an incoming webhook.
 * Square uses HMAC-SHA256 of `notification_url + raw_body` with
 * the signature key from the Dev Console (different from the OAuth
 * client secret).
 *
 * Returns true if the signature matches, false otherwise. Uses
 * a timing-safe compare to avoid leaking timing info to attackers.
 */
export function verifyWebhookSignature(opts: {
  rawBody: string;
  signatureHeader: string | null;
  notificationUrl: string;
}): boolean {
  if (!opts.signatureHeader) return false;
  try {
    const key = loadWebhookSignatureKey();
    const expected = createHmac("sha256", key)
      .update(opts.notificationUrl + opts.rawBody)
      .digest("base64");
    const expectedBuf = Buffer.from(expected);
    const receivedBuf = Buffer.from(opts.signatureHeader);
    if (expectedBuf.length !== receivedBuf.length) return false;
    return timingSafeEqual(expectedBuf, receivedBuf);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------
// API client
// ---------------------------------------------------------------------

/**
 * Bare REST GET against Square's API. Authorization via Bearer
 * token. Path is appended to the env-specific API base.
 */
export async function squareGet<T = unknown>(opts: {
  accessToken: string;
  path: string;             // e.g. "/v2/payments?cursor=..."
}): Promise<T> {
  const res = await fetch(`${getSquareApiBase()}${opts.path}`, {
    headers: {
      Authorization: `Bearer ${opts.accessToken}`,
      Accept: "application/json",
      "Square-Version": "2025-04-16",
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Square GET ${opts.path}: HTTP ${res.status} ${body.slice(0, 200)}`
    );
  }
  return (await res.json()) as T;
}

/**
 * Fetch the merchant's business name for the UI. Best-effort —
 * returns null on failure so connect doesn't fail just because
 * we couldn't pretty-print the name.
 */
export async function fetchMerchantBusinessName(opts: {
  accessToken: string;
  merchantId: string;
}): Promise<string | null> {
  try {
    const data = await squareGet<{
      merchant?: { business_name?: string };
    }>({
      accessToken: opts.accessToken,
      path: `/v2/merchants/${encodeURIComponent(opts.merchantId)}`,
    });
    return data.merchant?.business_name?.trim() || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------
// Payment types + listing
// ---------------------------------------------------------------------

/**
 * Minimal subset of Square Payment schema for bookkeeping. Square
 * returns much more; we ignore what we don't need.
 */
export interface SquarePayment {
  id: string;
  created_at: string;             // ISO timestamp
  updated_at?: string;
  status: string;                 // 'APPROVED' | 'PENDING' | 'COMPLETED' | 'CANCELED' | 'FAILED'
  amount_money: {
    amount: number;               // INTEGER in smallest currency unit (cents for USD)
    currency: string;             // ISO 4217
  };
  tip_money?: { amount: number; currency: string };
  total_money?: { amount: number; currency: string };
  source_type?: string;           // 'CARD' | 'CASH' | 'EXTERNAL' | 'WALLET' | etc.
  receipt_number?: string;        // human-friendly receipt code
  receipt_url?: string;
  order_id?: string;
  customer_id?: string;
  location_id?: string;
  buyer_email_address?: string;
  note?: string;
  reference_id?: string;
  card_details?: {
    card?: { card_brand?: string; last_4?: string };
  };
}

interface SquarePaymentsListResponse {
  payments?: SquarePayment[];
  cursor?: string;                // next page token; absent on last page
  errors?: Array<{ category?: string; code?: string; detail?: string }>;
}

/**
 * Fetch one page of payments for the connected merchant. Cursor-
 * paginated; pass cursor from previous response to get next page.
 * Returns null nextCursor when no more pages.
 *
 * Sort order: Square defaults to created_at DESC; for backfill we'd
 * prefer ASC (oldest first, lets historical context populate
 * naturally). The `sort_order=ASC` query param flips it.
 */
export async function fetchPaymentsPage(opts: {
  accessToken: string;
  cursor?: string | null;
  limit?: number;                 // Square max 100, default 100
  sortOrder?: "ASC" | "DESC";     // default ASC for backfill
  beginTime?: string;             // ISO; for incremental sync
}): Promise<{
  payments: SquarePayment[];
  nextCursor: string | null;
}> {
  const params = new URLSearchParams();
  if (opts.cursor) params.set("cursor", opts.cursor);
  params.set("limit", String(Math.min(opts.limit ?? 100, 100)));
  params.set("sort_order", opts.sortOrder ?? "ASC");
  if (opts.beginTime) params.set("begin_time", opts.beginTime);

  const data = await squareGet<SquarePaymentsListResponse>({
    accessToken: opts.accessToken,
    path: `/v2/payments?${params.toString()}`,
  });

  if (data.errors && data.errors.length > 0) {
    const first = data.errors[0];
    throw new Error(
      `Square payments listing returned errors: ${first.category}/${first.code} ${first.detail ?? ""}`
    );
  }

  return {
    payments: data.payments ?? [],
    nextCursor: data.cursor ?? null,
  };
}

// ---------------------------------------------------------------------
// Payment → processed_items row mapper
// ---------------------------------------------------------------------

/**
 * Shape we INSERT into processed_items for one Square payment.
 * Mirrors the MappedOrderRow pattern from lib/shopify + the
 * MappedWixOrderRow from lib/wix.
 */
export interface MappedSquarePaymentRow {
  vendor: string;
  invoice_number: string;
  amount: number;
  due_date: string;               // YYYY-MM-DD
  status: string;                 // 'paid' | 'pending' | 'cancelled'
  category: string;
  source: "square";
  source_ref_id: string;          // Square payment ID
  channel: "square";
  confidence: number;
  summary: string;
  extracted_data: Record<string, unknown>;
}

/**
 * Map a Square Payment into a processed_items row.
 *
 * Square's amount_money.amount is INTEGER in the smallest currency
 * unit (cents for USD), unlike Shopify (decimal string) and Wix
 * (decimal string). We convert to decimal for the amount column.
 */
export function mapPaymentToProcessedItem(
  payment: SquarePayment
): MappedSquarePaymentRow {
  // Vendor: buyer email if present, else card last-4, else
  // "Square customer"
  let vendor = "Square customer";
  if (payment.buyer_email_address) {
    vendor = payment.buyer_email_address;
  } else if (payment.card_details?.card?.last_4) {
    const brand = payment.card_details.card.card_brand ?? "Card";
    vendor = `${brand} ending in ${payment.card_details.card.last_4}`;
  }

  // Date: created_at is when the payment was initiated; that's
  // what bookkeepers care about for revenue recognition.
  const isoDate = payment.created_at || new Date().toISOString();
  const dueDate = isoDate.slice(0, 10);

  // Status mapping. Square statuses:
  //   APPROVED  — authorized but not yet settled (rare to leave here)
  //   PENDING   — waiting on processor
  //   COMPLETED — settled, money received
  //   CANCELED  — voided before capture
  //   FAILED    — declined / errored
  let status: string;
  const ps = payment.status?.toUpperCase();
  if (ps === "CANCELED" || ps === "FAILED") {
    status = "cancelled";
  } else if (ps === "COMPLETED" || ps === "APPROVED") {
    status = "paid";
  } else {
    status = "pending";
  }

  // Convert cents → dollars (or smallest unit → main unit).
  // Square's total_money includes tips; amount_money is base amount.
  // We use total_money when present, else amount_money.
  const amountCents =
    payment.total_money?.amount ?? payment.amount_money.amount;
  const currency =
    payment.total_money?.currency ?? payment.amount_money.currency;
  const amount = amountCents / 100;

  // Invoice number: receipt_number is short + human-readable (e.g.,
  // "A1B2"). Fall back to the first 8 chars of the payment ID.
  const invoiceNumber = payment.receipt_number
    ? `#${payment.receipt_number}`
    : `#${payment.id.slice(0, 8)}`;

  // Source-type label for the summary (helps bookkeepers distinguish
  // POS card swipes from cash from online checkout etc.)
  const sourceLabel = payment.source_type
    ? payment.source_type.charAt(0) + payment.source_type.slice(1).toLowerCase()
    : "Square";

  return {
    vendor,
    invoice_number: invoiceNumber,
    amount,
    due_date: dueDate,
    status,
    category: "Sales",
    source: "square",
    source_ref_id: payment.id,
    channel: "square",
    confidence: 100,
    summary: `Square ${sourceLabel} payment ${invoiceNumber} — ${currency} ${amount.toFixed(2)}`,
    extracted_data: {
      square_payment_id: payment.id,
      receipt_number: payment.receipt_number ?? null,
      receipt_url: payment.receipt_url ?? null,
      source_type: payment.source_type ?? null,
      currency,
      base_amount_cents: payment.amount_money.amount,
      tip_amount_cents: payment.tip_money?.amount ?? 0,
      total_amount_cents: amountCents,
      square_status: payment.status,
      location_id: payment.location_id ?? null,
      order_id: payment.order_id ?? null,
      customer_id: payment.customer_id ?? null,
      buyer_email: payment.buyer_email_address ?? null,
      card_brand: payment.card_details?.card?.card_brand ?? null,
      card_last_4: payment.card_details?.card?.last_4 ?? null,
      note: payment.note ?? null,
    },
  };
}
