// lib/wix.ts
//
// Phase 10a commit 2 of ~5. Typed Wix Stores API client + OAuth
// helpers. Pure — no DB I/O. Route handlers (app/api/wix/oauth/*)
// own DB writes; this module makes the HTTP calls + OAuth handshake.
//
// ⚠️ TODO during smoke testing — verify these against actual Wix docs:
//   - Authorize URL exact path/params (my best read of Wix Dev Center
//     docs is https://www.wix.com/oauth/authorize; may differ for
//     headless vs platform apps)
//   - Token exchange endpoint shape (some Wix docs reference
//     /oauth/access, others /oauth/token; refresh_token rotation
//     semantics)
//   - Webhook verification: Wix uses JWT-signed payloads (HS256 with
//     app secret) — DIFFERENT from Shopify's HMAC-of-body pattern.
//     Implemented as a TODO stub until I see a real Wix webhook payload.
//   - Stores API base path — currently assuming /stores/v2 but Wix
//     has been migrating to /stores/v3 in 2025-2026.
//
// What's NOT a TODO (well-understood):
//   - General OAuth 2.0 flow shape (authorize → consent → code → exchange)
//   - Bearer token auth on API calls
//   - Token refresh on 401 / pre-expiry check
//   - Pagination cursor pattern (most modern APIs use cursor pagination)

import { createHmac, timingSafeEqual } from "crypto";

// ---------------------------------------------------------------------
// Env-var loading (lazy + validating)
// ---------------------------------------------------------------------

function loadEnv(): {
  clientId: string;
  clientSecret: string;
} {
  const clientId = process.env.WIX_CLIENT_ID;
  const clientSecret = process.env.WIX_CLIENT_SECRET;
  if (!clientId) throw new Error("WIX_CLIENT_ID env var is not set");
  if (!clientSecret) throw new Error("WIX_CLIENT_SECRET env var is not set");
  return { clientId, clientSecret };
}

// ---------------------------------------------------------------------
// OAuth — authorize URL + code exchange + refresh
// ---------------------------------------------------------------------

/**
 * Build the URL we redirect the merchant to for the OAuth consent
 * screen. State is a CSRF nonce stored in a short-lived cookie that
 * the callback handler verifies on return.
 *
 * ⚠️ TODO: verify URL pattern against Wix Dev Center docs. My best
 * read is the standard OAuth 2.0 authorize endpoint, but Wix's
 * "App Installation" flow (vs "Headless OAuth") may route differently.
 */
export function buildAuthorizeUrl(opts: {
  state: string;
  redirectUri: string;
  scopes: string[];
}): string {
  const { clientId } = loadEnv();
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: opts.redirectUri,
    scope: opts.scopes.join(" "),
    state: opts.state,
  });
  return `https://www.wix.com/oauth/authorize?${params.toString()}`;
}

/**
 * Token response shape from Wix's token endpoint. Both access + refresh
 * tokens come back together on initial exchange + on refresh (refresh
 * token may or may not rotate per Wix policy).
 */
export interface WixTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;        // seconds until access_token expires
  instance_id?: string;       // Wix App Instance UUID (returned on initial exchange)
  scope?: string;             // space-separated list of granted scopes
}

/**
 * Exchange the OAuth `code` we got back at the callback for an
 * access_token + refresh_token pair.
 *
 * ⚠️ TODO: verify endpoint URL + request body shape against Wix docs.
 * Currently using /oauth/access (the Wix "Headless OAuth" endpoint
 * per my memory). Older Wix apps used /oauth/token.
 */
export async function exchangeCodeForToken(opts: {
  code: string;
  redirectUri: string;
}): Promise<WixTokenResponse> {
  const { clientId, clientSecret } = loadEnv();
  const res = await fetch("https://www.wixapis.com/oauth/access", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: clientSecret,
      code: opts.code,
      redirect_uri: opts.redirectUri,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Wix token exchange failed: HTTP ${res.status} ${body.slice(0, 200)}`
    );
  }
  const data = (await res.json()) as WixTokenResponse;
  if (!data.access_token || !data.refresh_token) {
    throw new Error("Wix token exchange returned no tokens");
  }
  return data;
}

/**
 * Use the refresh_token to mint a new access_token. Called by the API
 * client when the cached access_token is near or past expiry.
 *
 * ⚠️ TODO: verify whether Wix rotates refresh tokens (returns a new
 * refresh_token in the response) or keeps the same one. If rotated,
 * caller must update the stored refresh_token too.
 */
export async function refreshAccessToken(
  refreshToken: string
): Promise<WixTokenResponse> {
  const { clientId, clientSecret } = loadEnv();
  const res = await fetch("https://www.wixapis.com/oauth/access", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Wix token refresh failed: HTTP ${res.status} ${body.slice(0, 200)}`
    );
  }
  return (await res.json()) as WixTokenResponse;
}

// ---------------------------------------------------------------------
// HMAC verification for OAuth callback (CSRF protection)
// ---------------------------------------------------------------------

/**
 * Verify the HMAC Wix signs on OAuth callback redirects (if applicable).
 *
 * ⚠️ TODO: Unlike Shopify, Wix may not sign OAuth callback URLs the
 * same way. Standard OAuth 2.0 only requires state-param CSRF
 * protection (which we do separately via cookie). This function is
 * a placeholder for future webhook verification (see below).
 *
 * For now, the CSRF state-cookie check in the callback route is the
 * primary protection.
 */
export function verifyOAuthCallbackHmac(): boolean {
  // Wix OAuth callbacks don't include an hmac param (standard OAuth 2.0
  // relies on state-param + HTTPS for integrity). Return true so the
  // callback route can use a single check pattern across providers.
  return true;
}

/**
 * Verify the signature Wix attaches to webhook POSTs.
 *
 * ⚠️ TODO: Wix uses JWT-signed payloads (HS256 with app secret in some
 * docs, public-key verification in others). DIFFERENT from Shopify's
 * HMAC-of-body pattern. Implementation requires:
 *   1. Parse the Authorization header (likely Bearer <JWT>)
 *   2. Verify JWT signature using app secret or public key
 *   3. Compare JWT payload to request body (replay protection)
 *
 * Stubbed until 10d (webhook receiver). Shopify's verifyWebhookHmac
 * is in lib/shopify.ts as reference but the algorithm differs.
 */
export function verifyWebhookSignature(
  _rawBody: string | Buffer,
  _authHeader: string | null
): boolean {
  // TODO Phase 10d: implement Wix JWT verification.
  // Returning false in production until implemented — webhooks will
  // 401 (safer than silently accepting unverified payloads).
  return false;
}

// HMAC helper for future use (in case Wix introduces an HMAC pattern;
// or for cross-validating webhook signatures during 10d implementation).
export function computeHmacSha256(rawBody: string | Buffer, secret: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

export function timingSafeStringCompare(a: string, b: string): boolean {
  try {
    if (a.length !== b.length) return false;
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------
// API client (used by sub-phases 10c + 10d)
// ---------------------------------------------------------------------

const WIX_API_BASE = "https://www.wixapis.com";

/**
 * Bare REST GET against Wix's API. Bearer-token auth via
 * Authorization header. Path is appended to WIX_API_BASE.
 *
 * ⚠️ TODO: confirm /stores/v2 vs /stores/v3 — Wix has been migrating
 * to v3 for orders in 2025-2026.
 */
export async function wixGet<T = unknown>(opts: {
  accessToken: string;
  path: string;          // e.g. "/stores/v2/orders/query"
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
    throw new Error(`Wix GET ${opts.path}: HTTP ${res.status} ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

/**
 * Bare REST POST. Used for webhook subscription registration in 10d.
 */
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
    throw new Error(`Wix POST ${opts.path}: HTTP ${res.status} ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------
// Order types (Phase 10c will use these — stubbed shape for now)
// ---------------------------------------------------------------------

/** Minimal subset of Wix Stores Order schema we expect to use for
 *  bookkeeping. ⚠️ TODO: validate exact field names against Wix
 *  Stores API v2/v3 docs during 10c implementation. */
export interface WixOrder {
  id: string;
  number: number;                  // human-friendly order number
  dateCreated: string;             // ISO timestamp
  totals: {
    total: string;                 // decimal-as-string
    subtotal: string;
    tax: string;
    shipping: string;
    discount: string;
  };
  currency: string;                // ISO 4217
  paymentStatus: string;           // 'PAID' | 'PENDING' | 'REFUNDED' | etc.
  fulfillmentStatus: string;       // 'FULFILLED' | 'NOT_FULFILLED' | etc.
  buyerInfo: {
    email: string | null;
    firstName: string | null;
    lastName: string | null;
  } | null;
  lineItems: Array<{
    id: string;
    name: string;
    quantity: number;
    price: string;
  }>;
}

// ---------------------------------------------------------------------
// Site display name (for the connection card)
// ---------------------------------------------------------------------

/**
 * Fetch the connected Wix site's display name for the UI. The
 * instance_id we get from OAuth isn't user-friendly; this hits Wix's
 * Sites API to get "Acme Shop" or whatever the merchant named it.
 *
 * ⚠️ TODO: verify endpoint path + response shape.
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
