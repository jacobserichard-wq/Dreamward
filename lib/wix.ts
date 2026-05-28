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
