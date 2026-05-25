// app/api/shopify/oauth/callback/route.ts
//
// Phase 8a commit 5 of 5. Designed in
// session-notes/phase-8-shopify-design.md §3 (sub-phase 8a #5).
//
// GET endpoint that Shopify redirects the merchant to after they
// click "Install" on the consent screen. URL looks like:
//
//   /api/shopify/oauth/callback?code=...&hmac=...&host=...&shop=...&state=...&timestamp=...
//
// Flow:
//   1. Verify the `state` query param matches our short-lived cookie
//      (CSRF protection — see initiate route for cookie set)
//   2. Verify the HMAC Shopify signed the callback URL with
//      (sub-stage of CSRF + integrity protection)
//   3. Verify the `shop` param is a legitimate myshopify.com domain
//      (defense against an attacker crafting a callback URL pointing
//      at an arbitrary host)
//   4. Verify the authenticated user is still signed in + Pro
//   5. Exchange the `code` for a permanent access token via
//      lib/shopify.exchangeCodeForToken
//   6. Encrypt the token via lib/crypto.encryptForDb
//   7. INSERT into shopify_connections (or 409 if this client already
//      has a connection — v1 enforces 1 store per client at the DB
//      level via UNIQUE(client_id))
//   8. Redirect to /integrations?connected=1 (success) OR
//      /integrations?error=<msg> (failure)
//
// Subsequent sub-phases (8c backfill, 8d webhook registration) will
// extend this handler to fire-and-forget the backfill kickoff + the
// webhook subscriptions. For 8a we just persist the encrypted token
// and call the OAuth handshake done.

import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getSessionClient } from "@/lib/getClient";
import {
  normalizeShopDomain,
  exchangeCodeForToken,
  verifyOAuthCallbackHmac,
} from "@/lib/shopify";
import { encryptForDb } from "@/lib/crypto";

const STATE_COOKIE_NAME = "shopify_oauth_state";

// Where we redirect on success or error. The /integrations page
// (commit 8b) reads ?connected=1 / ?error=... query params to show
// appropriate banners.
function integrationsUrl(req: NextRequest): string {
  // Build absolute URL from the request origin so this works on
  // production AND any Vercel preview deployment.
  const url = new URL("/integrations", req.url);
  return url.toString();
}

function redirectWithError(req: NextRequest, message: string): NextResponse {
  const url = new URL("/integrations", req.url);
  url.searchParams.set("error", message);
  // Clear the state cookie either way — it's single-use.
  const res = NextResponse.redirect(url);
  res.cookies.delete(STATE_COOKIE_NAME);
  return res;
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;

  // ── 1. CSRF: state cookie matches state param ─────────────────
  const stateParam = params.get("state");
  const stateCookie = req.cookies.get(STATE_COOKIE_NAME)?.value;
  if (!stateParam || !stateCookie || stateParam !== stateCookie) {
    return redirectWithError(
      req,
      "OAuth state mismatch. Please start the connection over."
    );
  }

  // ── 2. HMAC: Shopify signed the callback URL ─────────────────
  if (!verifyOAuthCallbackHmac(params)) {
    return redirectWithError(
      req,
      "OAuth signature verification failed. Please start over."
    );
  }

  // ── 3. Validate shop param ────────────────────────────────────
  const shopParam = params.get("shop") ?? "";
  const shopDomain = normalizeShopDomain(shopParam);
  if (!shopDomain) {
    return redirectWithError(req, "Invalid shop domain in callback URL.");
  }

  // ── 4. Auth + plan gate ───────────────────────────────────────
  const client = await getSessionClient();
  if (!client) {
    // Session expired during the OAuth round-trip — relatively rare
    // but possible. Send them back through signin.
    const url = new URL("/signin", req.url);
    url.searchParams.set("callbackUrl", "/integrations");
    return NextResponse.redirect(url);
  }
  if (client.plan !== "pro") {
    return redirectWithError(
      req,
      "Shopify integration is a Pro feature. Upgrade to connect a store."
    );
  }

  // ── 5. Exchange code for token ────────────────────────────────
  const code = params.get("code");
  if (!code) {
    return redirectWithError(req, "OAuth callback missing authorization code.");
  }

  let tokenResult: { accessToken: string; scopes: string[] };
  try {
    tokenResult = await exchangeCodeForToken({ shopDomain, code });
  } catch (err) {
    console.error("Shopify token exchange failed:", err);
    return redirectWithError(
      req,
      "Couldn't exchange OAuth code with Shopify. Please try again."
    );
  }

  // ── 6. Encrypt the token ──────────────────────────────────────
  let encrypted: ReturnType<typeof encryptForDb>;
  try {
    encrypted = encryptForDb(tokenResult.accessToken);
  } catch (err) {
    // Most likely cause: SHOPIFY_TOKEN_ENCRYPTION_KEY env var is
    // missing or malformed. Surface this clearly so the operator
    // can fix it without digging through logs.
    console.error("Shopify token encryption failed:", err);
    return redirectWithError(
      req,
      "Server is misconfigured (token encryption). Contact support."
    );
  }

  // ── 7. Persist the connection ─────────────────────────────────
  try {
    await pool.query(
      `INSERT INTO shopify_connections (
         client_id,
         shop_domain,
         access_token_ciphertext,
         access_token_iv,
         access_token_auth_tag,
         scopes
       ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        client.id,
        shopDomain,
        encrypted.ciphertext,
        encrypted.iv,
        encrypted.authTag,
        tokenResult.scopes,
      ]
    );
  } catch (err) {
    // Most likely: UNIQUE(client_id) violation (this client already
    // has a connected store — v1 allows only one). Surface a clean
    // message; the /integrations page can show the existing
    // connection so the user knows what's there.
    console.error("Shopify connection insert failed:", err);
    const msg =
      err instanceof Error && err.message.includes("unique")
        ? "You already have a Shopify store connected. Disconnect the existing one before connecting a new store."
        : "Couldn't save the Shopify connection. Please try again.";
    return redirectWithError(req, msg);
  }

  // ── 8. Success: redirect to /integrations ─────────────────────
  const url = new URL("/integrations", req.url);
  url.searchParams.set("connected", "1");
  url.searchParams.set("shop", shopDomain);
  const res = NextResponse.redirect(url);
  res.cookies.delete(STATE_COOKIE_NAME);
  return res;

  // NOTE: future sub-phases (8c backfill + 8d webhook registration)
  // will fire those off here before the redirect. For 8a we stop at
  // "token persisted"; the /integrations page (8b) shows a
  // "Connected" state without yet attempting backfill or webhook
  // subscriptions.
}
