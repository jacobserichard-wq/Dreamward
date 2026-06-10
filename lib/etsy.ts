// lib/etsy.ts
//
// Etsy Open API v3 client (Etsy integration commit 2 — design in
// session-notes/design-etsy-integration.md). Sister of lib/square.ts
// / lib/shopify.ts / lib/wix.ts: typed fetch helpers, OAuth flow,
// and pure mappers from Etsy's shapes to ours.
//
// Etsy specifics that shape this module:
//
//   - OAuth 2.0 authorization-code grant with MANDATORY PKCE
//     (S256). The app keystring (ETSY_API_KEY) acts as the OAuth
//     client_id; token exchange needs no client secret — the PKCE
//     verifier is the proof.
//   - Access tokens live ONE HOUR; refresh tokens 90 days, and
//     refreshing ROTATES the refresh token. ensureFreshToken wraps
//     the check so callers never hold a stale token; the caller
//     persists rotated tokens.
//   - Every API request needs BOTH headers: `x-api-key: <keystring>`
//     and `Authorization: Bearer <access token>`.
//   - Orders are "receipts"; line items are "transactions" and come
//     NESTED inside each receipt from getShopReceipts — no second
//     fetch needed for COGS fanout (nicer than Square, which makes
//     us fetch the Order separately).
//   - Money is { amount, divisor, currency_code } — amount/divisor
//     gives the decimal value.
//   - No webhooks in v1 (their payloads require a re-fetch anyway);
//     ongoing sync is the cron's 25h-lookback reconciliation pass.

import { createHash, randomBytes } from "crypto";
import type { InternalLineItem } from "@/lib/cogs/lineItems";

const ETSY_API_BASE = "https://api.etsy.com/v3";
const ETSY_AUTHORIZE_URL = "https://www.etsy.com/oauth/connect";
const ETSY_TOKEN_URL = "https://api.etsy.com/v3/public/oauth/token";

/** Scopes: receipts/transactions for sales import; listings for the
 *  catalog pull. Both read-only — FlowWork never writes to a shop. */
export const ETSY_SCOPES = ["transactions_r", "listings_r"] as const;

export function getEtsyApiKey(): string {
  const key = process.env.ETSY_API_KEY;
  if (!key) {
    throw new Error(
      "ETSY_API_KEY is not set. Create the app at etsy.com/developers and add its keystring to the environment."
    );
  }
  return key;
}

// ---------------------------------------------------------------------
// PKCE + authorize URL
// ---------------------------------------------------------------------

/** RFC 7636 code verifier: 32 random bytes, base64url → 43 chars. */
export function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

/** S256 challenge for a verifier. */
export function codeChallengeS256(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function buildAuthorizeUrl(opts: {
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: getEtsyApiKey(),
    redirect_uri: opts.redirectUri,
    scope: ETSY_SCOPES.join(" "),
    state: opts.state,
    code_challenge: opts.codeChallenge,
    code_challenge_method: "S256",
  });
  return `${ETSY_AUTHORIZE_URL}?${params.toString()}`;
}

// ---------------------------------------------------------------------
// Token exchange + refresh
// ---------------------------------------------------------------------

export interface EtsyTokenResponse {
  access_token: string; // format: "{user_id}.{token}"
  token_type: string;
  expires_in: number; // seconds (3600)
  refresh_token: string;
}

async function tokenRequest(
  body: Record<string, string>
): Promise<EtsyTokenResponse> {
  const res = await fetch(ETSY_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Etsy token request failed (${res.status}): ${text}`);
  }
  return (await res.json()) as EtsyTokenResponse;
}

export async function exchangeCodeForToken(opts: {
  code: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<EtsyTokenResponse> {
  return tokenRequest({
    grant_type: "authorization_code",
    client_id: getEtsyApiKey(),
    redirect_uri: opts.redirectUri,
    code: opts.code,
    code_verifier: opts.codeVerifier,
  });
}

export async function refreshAccessToken(
  refreshToken: string
): Promise<EtsyTokenResponse> {
  return tokenRequest({
    grant_type: "refresh_token",
    client_id: getEtsyApiKey(),
    refresh_token: refreshToken,
  });
}

/** Etsy access tokens are "{user_id}.{secret}" — the numeric user id
 *  prefix identifies the token's owner (handy for getMe-less flows). */
export function userIdFromAccessToken(accessToken: string): string | null {
  const dot = accessToken.indexOf(".");
  if (dot <= 0) return null;
  const id = accessToken.slice(0, dot);
  return /^\d+$/.test(id) ? id : null;
}

export interface FreshTokenResult {
  accessToken: string;
  /** Set when a refresh happened — caller MUST persist both new
   *  tokens (Etsy rotates the refresh token on every refresh). */
  rotated: EtsyTokenResponse | null;
}

/** Returns a usable access token, refreshing when within 5 minutes
 *  of expiry. The caller persists `rotated` when non-null. */
export async function ensureFreshToken(opts: {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}): Promise<FreshTokenResult> {
  const fiveMinutes = 5 * 60 * 1000;
  if (opts.expiresAt.getTime() - Date.now() > fiveMinutes) {
    return { accessToken: opts.accessToken, rotated: null };
  }
  const rotated = await refreshAccessToken(opts.refreshToken);
  return { accessToken: rotated.access_token, rotated };
}

// ---------------------------------------------------------------------
// Typed GET helper
// ---------------------------------------------------------------------

export async function etsyGet<T = unknown>(opts: {
  path: string; // e.g. "/application/shops/123/receipts"
  accessToken: string;
  searchParams?: Record<string, string>;
}): Promise<T> {
  const url = new URL(`${ETSY_API_BASE}${opts.path}`);
  for (const [k, v] of Object.entries(opts.searchParams ?? {})) {
    url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), {
    headers: {
      "x-api-key": getEtsyApiKey(),
      Authorization: `Bearer ${opts.accessToken}`,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Etsy GET ${opts.path} failed (${res.status}): ${text}`);
  }
  return (await res.json()) as T;
}

// ---------------------------------------------------------------------
// Shop identity
// ---------------------------------------------------------------------

interface EtsyMeResponse {
  user_id: number;
  shop_id: number | null;
}

interface EtsyShopResponse {
  shop_id: number;
  shop_name: string;
}

/** Resolve the authorizing user's shop (id + display name). Throws
 *  when the account has no shop — FlowWork needs a seller account. */
export async function fetchShopIdentity(
  accessToken: string
): Promise<{ shopId: string; shopName: string | null }> {
  const me = await etsyGet<EtsyMeResponse>({
    path: "/application/users/me",
    accessToken,
  });
  if (!me.shop_id) {
    throw new Error(
      "This Etsy account doesn't have a shop. Connect a seller account."
    );
  }
  let shopName: string | null = null;
  try {
    const shop = await etsyGet<EtsyShopResponse>({
      path: `/application/shops/${me.shop_id}`,
      accessToken,
    });
    shopName = shop.shop_name ?? null;
  } catch {
    // Display-name fetch is cosmetic — never fail the connect on it.
  }
  return { shopId: String(me.shop_id), shopName };
}

// ---------------------------------------------------------------------
// Receipts (orders) + nested transactions (line items)
// ---------------------------------------------------------------------

interface EtsyMoney {
  amount: number;
  divisor: number;
  currency_code: string;
}

function moneyToDecimal(m: EtsyMoney | null | undefined): number {
  if (!m || !m.divisor) return 0;
  return m.amount / m.divisor;
}

export interface EtsyTransaction {
  transaction_id: number;
  title: string | null;
  listing_id: number | null;
  product_id: number | null;
  sku: string | null;
  quantity: number;
  price: EtsyMoney;
}

export interface EtsyReceipt {
  receipt_id: number;
  status: string | null; // "Paid" | "Completed" | "Open" | "Canceled" | ...
  is_paid: boolean;
  name: string | null; // buyer name
  buyer_email: string | null;
  create_timestamp: number; // unix seconds
  grandtotal: EtsyMoney;
  transactions: EtsyTransaction[];
}

interface EtsyReceiptsResponse {
  count: number;
  results: EtsyReceipt[];
}

export const ETSY_RECEIPTS_PAGE_SIZE = 100;

/** One page of receipts, newest first. `minCreated` (unix seconds)
 *  bounds the reconciliation lookback; `offset` drives the chunked
 *  backfill. Returns the page plus the total count so callers can
 *  decide whether to continue. */
export async function fetchReceiptsPage(opts: {
  accessToken: string;
  shopId: string;
  offset?: number;
  minCreated?: number;
}): Promise<{ receipts: EtsyReceipt[]; totalCount: number }> {
  const searchParams: Record<string, string> = {
    limit: String(ETSY_RECEIPTS_PAGE_SIZE),
    offset: String(opts.offset ?? 0),
    sort_on: "created",
    sort_order: "desc",
  };
  if (opts.minCreated) {
    searchParams.min_created = String(opts.minCreated);
  }
  const data = await etsyGet<EtsyReceiptsResponse>({
    path: `/application/shops/${opts.shopId}/receipts`,
    accessToken: opts.accessToken,
    searchParams,
  });
  return { receipts: data.results ?? [], totalCount: data.count ?? 0 };
}

// ---------------------------------------------------------------------
// Mappers
// ---------------------------------------------------------------------

export interface MappedEtsyReceiptRow {
  vendor: string;
  invoice_number: string;
  amount: number;
  due_date: string; // YYYY-MM-DD
  status: string; // 'paid' | 'pending' | 'cancelled'
  category: string;
  source: "etsy";
  source_ref_id: string;
  channel: "etsy";
  confidence: number;
  summary: string;
  extracted_data: Record<string, unknown>;
}

export function mapReceiptToProcessedItem(
  receipt: EtsyReceipt
): MappedEtsyReceiptRow {
  const vendor = receipt.name || receipt.buyer_email || "Etsy buyer";

  const isoDate = new Date(
    (receipt.create_timestamp || 0) * 1000
  ).toISOString();
  const dueDate = isoDate.slice(0, 10);

  // Receipt statuses observed: Paid / Completed / Open / Payment
  // Processing / Canceled. is_paid is the reliable money-received
  // signal; Canceled overrides.
  let status: string;
  const rs = (receipt.status ?? "").toLowerCase();
  if (rs === "canceled" || rs === "cancelled") {
    status = "cancelled";
  } else if (receipt.is_paid || rs === "paid" || rs === "completed") {
    status = "paid";
  } else {
    status = "pending";
  }

  const amount = moneyToDecimal(receipt.grandtotal);
  const currency = receipt.grandtotal?.currency_code ?? "USD";
  const invoiceNumber = `#${receipt.receipt_id}`;

  return {
    vendor,
    invoice_number: invoiceNumber,
    amount,
    due_date: dueDate,
    status,
    category: "Sales",
    source: "etsy",
    source_ref_id: String(receipt.receipt_id),
    channel: "etsy",
    confidence: 100,
    summary: `Etsy order ${invoiceNumber} — ${currency} ${amount.toFixed(2)}`,
    extracted_data: {
      etsy_receipt_id: receipt.receipt_id,
      etsy_status: receipt.status,
      is_paid: receipt.is_paid,
      buyer_email: receipt.buyer_email ?? null,
      currency,
      line_item_count: receipt.transactions?.length ?? 0,
    },
  };
}

/** Receipt transactions → the platform-agnostic line-item shape that
 *  lib/cogs/lineItems.bulkInsertLineItemsForParent consumes.
 *  external_item_id = listing_id (what sku_aliases joins on). */
export function mapTransactionsToLineItems(
  receipt: EtsyReceipt
): InternalLineItem[] {
  return (receipt.transactions ?? []).map((t) => ({
    externalId: String(t.transaction_id),
    externalItemId: t.listing_id != null ? String(t.listing_id) : null,
    externalSku: t.sku || null,
    name: t.title || "Etsy item",
    quantity: t.quantity || 1,
    unitPrice: moneyToDecimal(t.price),
    currency: t.price?.currency_code ?? "USD",
  }));
}

// ---------------------------------------------------------------------
// Listings (catalog pull — commit 6 consumes this)
// ---------------------------------------------------------------------

export interface EtsyListing {
  listing_id: number;
  title: string;
  state: string;
  skus: string[];
  price: EtsyMoney;
}

interface EtsyListingsResponse {
  count: number;
  results: EtsyListing[];
}

export async function fetchListingsPage(opts: {
  accessToken: string;
  shopId: string;
  offset?: number;
}): Promise<{ listings: EtsyListing[]; totalCount: number }> {
  const data = await etsyGet<EtsyListingsResponse>({
    path: `/application/shops/${opts.shopId}/listings`,
    accessToken: opts.accessToken,
    searchParams: {
      state: "active",
      limit: "100",
      offset: String(opts.offset ?? 0),
    },
  });
  return { listings: data.results ?? [], totalCount: data.count ?? 0 };
}
