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
// FlowWork's client_id ↔ Wix's instance_id) in wix_connections + mint
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
//                                        bind to a FlowWork client)
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
    const { appId } = loadAppCreds();
    const publicKeyPem = loadWebhookPublicKey();
    const publicKey = await importSPKI(publicKeyPem, "RS256");
    const verified = await jwtVerify(opts.jwt, publicKey, {
      issuer: "wix.com",
      audience: appId,
    });
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
// Order types (Phase 10c will use these — stubbed shape for now)
// ---------------------------------------------------------------------

/** Minimal subset of Wix Stores Order schema we expect to use for
 *  bookkeeping. ⚠️ TODO: validate exact field names against Wix
 *  Stores API v2/v3 docs during 10c implementation. */
export interface WixOrder {
  id: string;
  number: number; // human-friendly order number
  dateCreated: string; // ISO timestamp
  totals: {
    total: string; // decimal-as-string
    subtotal: string;
    tax: string;
    shipping: string;
    discount: string;
  };
  currency: string; // ISO 4217
  paymentStatus: string; // 'PAID' | 'PENDING' | 'REFUNDED' | etc.
  fulfillmentStatus: string; // 'FULFILLED' | 'NOT_FULFILLED' | etc.
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
