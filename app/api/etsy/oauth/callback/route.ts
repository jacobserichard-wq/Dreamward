// app/api/etsy/oauth/callback/route.ts
//
// Etsy integration commit 3. GET endpoint Etsy redirects sellers to
// after the consent screen:
//
//   /api/etsy/oauth/callback?code=...&state=...
//
// Etsy doesn't sign callbacks; CSRF protection is the state cookie,
// and the PKCE verifier cookie proves this server started the flow
// (the token exchange fails without the matching verifier).
//
// Flow:
//   1. CSRF: state cookie matches the round-tripped state param
//   2. Dreamward session + paying-tier gate
//   3. Exchange code + verifier → access (1h) + refresh (90d) tokens
//   4. Resolve the shop (users/me → shop id + display name)
//   5. Encrypt both tokens (AES-256-GCM, lib/crypto)
//   6. UPSERT etsy_connections (client_id UNIQUE)
//   7. Redirect to /integrations?connected_etsy=1

import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getSessionClient } from "@/lib/getClient";
import { exchangeCodeForToken, fetchShopIdentity } from "@/lib/etsy";
import { encryptForDb } from "@/lib/crypto";
import { isPayingTier } from "@/lib/plans";

const STATE_COOKIE = "etsy_oauth_state";
const VERIFIER_COOKIE = "etsy_oauth_verifier";

function redirectWithError(req: NextRequest, message: string): NextResponse {
  const url = new URL("/integrations", req.url);
  url.searchParams.set("error", message);
  const res = NextResponse.redirect(url);
  res.cookies.delete(STATE_COOKIE);
  res.cookies.delete(VERIFIER_COOKIE);
  return res;
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;

  // ── 1. CSRF ─────────────────────────────────────────────────
  const stateParam = params.get("state");
  const stateCookie = req.cookies.get(STATE_COOKIE)?.value;
  if (!stateParam || !stateCookie || stateParam !== stateCookie) {
    return redirectWithError(
      req,
      "OAuth state mismatch. Please start the Etsy connection over."
    );
  }
  const verifier = req.cookies.get(VERIFIER_COOKIE)?.value;
  if (!verifier) {
    return redirectWithError(
      req,
      "OAuth session expired. Please start the Etsy connection over."
    );
  }

  // ── 2. Auth + plan gate ─────────────────────────────────────
  const client = await getSessionClient();
  if (!client) {
    const url = new URL("/signin", req.url);
    url.searchParams.set("callbackUrl", "/integrations");
    return NextResponse.redirect(url);
  }
  if (!isPayingTier(client.plan)) {
    return redirectWithError(
      req,
      "The Etsy integration requires an active subscription."
    );
  }

  // User declined on Etsy's consent screen.
  const errorParam = params.get("error");
  if (errorParam) {
    return redirectWithError(
      req,
      `Etsy connection declined (${errorParam}). You can try again any time.`
    );
  }

  const code = params.get("code");
  if (!code) {
    return redirectWithError(
      req,
      "Etsy OAuth callback missing authorization code."
    );
  }

  // ── 3. Exchange code for the token pair ─────────────────────
  const redirectUri = `${process.env.NEXTAUTH_URL}/api/etsy/oauth/callback`;
  let tokens: Awaited<ReturnType<typeof exchangeCodeForToken>>;
  try {
    tokens = await exchangeCodeForToken({
      code,
      redirectUri,
      codeVerifier: verifier,
    });
  } catch (err) {
    console.error("Etsy token exchange failed:", err);
    return redirectWithError(
      req,
      "Couldn't exchange the OAuth code with Etsy. If your Etsy app key is newly created, Etsy may still be reviewing it (24-48h)."
    );
  }

  // ── 4. Resolve the shop ─────────────────────────────────────
  let shopId: string;
  let shopName: string | null;
  try {
    const identity = await fetchShopIdentity(tokens.access_token);
    shopId = identity.shopId;
    shopName = identity.shopName;
  } catch (err) {
    console.error("Etsy shop lookup failed:", err);
    return redirectWithError(
      req,
      err instanceof Error && err.message.includes("doesn't have a shop")
        ? "That Etsy account has no shop — connect a seller account."
        : "Connected to Etsy but couldn't load your shop. Please try again."
    );
  }

  // ── 5. Encrypt both tokens ──────────────────────────────────
  let accessBlob: ReturnType<typeof encryptForDb>;
  let refreshBlob: ReturnType<typeof encryptForDb>;
  try {
    accessBlob = encryptForDb(tokens.access_token);
    refreshBlob = encryptForDb(tokens.refresh_token);
  } catch (err) {
    console.error("Etsy token encryption failed:", err);
    return redirectWithError(
      req,
      "Server is misconfigured (token encryption). Contact support."
    );
  }

  // ── 6. Upsert the connection ────────────────────────────────
  // Re-connecting replaces the stored tokens (the seller may be
  // re-authorizing after a revoke) — ON CONFLICT keeps it idempotent
  // rather than erroring like the Square route does.
  const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
  try {
    await pool.query(
      `INSERT INTO etsy_connections (
         client_id, shop_id, shop_name,
         access_token_ciphertext, access_token_iv, access_token_auth_tag,
         access_token_expires_at,
         refresh_token_ciphertext, refresh_token_iv, refresh_token_auth_tag,
         refresh_token_obtained_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
       ON CONFLICT (client_id) DO UPDATE SET
         shop_id = EXCLUDED.shop_id,
         shop_name = EXCLUDED.shop_name,
         access_token_ciphertext = EXCLUDED.access_token_ciphertext,
         access_token_iv = EXCLUDED.access_token_iv,
         access_token_auth_tag = EXCLUDED.access_token_auth_tag,
         access_token_expires_at = EXCLUDED.access_token_expires_at,
         refresh_token_ciphertext = EXCLUDED.refresh_token_ciphertext,
         refresh_token_iv = EXCLUDED.refresh_token_iv,
         refresh_token_auth_tag = EXCLUDED.refresh_token_auth_tag,
         refresh_token_obtained_at = NOW(),
         updated_at = NOW()`,
      [
        client.id,
        shopId,
        shopName,
        accessBlob.ciphertext,
        accessBlob.iv,
        accessBlob.authTag,
        expiresAt,
        refreshBlob.ciphertext,
        refreshBlob.iv,
        refreshBlob.authTag,
      ]
    );
  } catch (err) {
    console.error("Etsy connection upsert failed:", err);
    return redirectWithError(
      req,
      "Couldn't save the Etsy connection. Please try again."
    );
  }

  // ── 7. Success ──────────────────────────────────────────────
  const url = new URL("/integrations", req.url);
  url.searchParams.set("connected_etsy", "1");
  if (shopName) url.searchParams.set("shop", shopName);
  const res = NextResponse.redirect(url);
  res.cookies.delete(STATE_COOKIE);
  res.cookies.delete(VERIFIER_COOKIE);
  return res;
}
