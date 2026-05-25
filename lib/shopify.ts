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
 * @param redirectUri the FlowWork callback URL Shopify will redirect to
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
// API client (used by future sub-phases 8c + 8d)
// ---------------------------------------------------------------------

/**
 * Bare REST GET against Shopify's admin API. All calls authenticate
 * via the X-Shopify-Access-Token header. URL is built from the shop
 * domain + pinned SHOPIFY_API_VERSION + caller-supplied path.
 *
 * Future commits (8c backfill, 8d webhook handlers) will layer
 * paginated helpers on top of this. v1 just exports the primitive.
 */
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
