// app/api/stripe-connect/oauth/callback/route.ts
//
// Where Stripe redirects after the customer approves Connect OAuth:
//   /api/stripe-connect/oauth/callback?code=...&state=...
//
// Flow: verify state cookie → auth + Pro gate → handle decline → exchange
// code → encrypt access token → fetch account name → INSERT into
// stripe_connections (reject if one already exists) → redirect to
// /integrations?connected_stripe=1. Mirrors the Square callback.

import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getSessionClient } from "@/lib/getClient";
import {
  exchangeConnectCode,
  fetchConnectedAccountName,
} from "@/lib/stripeConnect";
import { encryptForDb } from "@/lib/crypto";
import { isPayingTier } from "@/lib/plans";

const STATE_COOKIE_NAME = "stripe_connect_oauth_state";

function redirectWithError(req: NextRequest, message: string): NextResponse {
  const url = new URL("/integrations", req.url);
  url.searchParams.set("error", message);
  const res = NextResponse.redirect(url);
  res.cookies.delete(STATE_COOKIE_NAME);
  return res;
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;

  // 1. CSRF: state cookie matches state param (Stripe doesn't sign callbacks)
  const stateParam = params.get("state");
  const stateCookie = req.cookies.get(STATE_COOKIE_NAME)?.value;
  if (!stateParam || !stateCookie || stateParam !== stateCookie) {
    return redirectWithError(
      req,
      "OAuth state mismatch. Please start the Stripe connection over."
    );
  }

  // 2. Auth + plan gate
  const client = await getSessionClient();
  if (!client) {
    const url = new URL("/signin", req.url);
    url.searchParams.set("callbackUrl", "/integrations");
    return NextResponse.redirect(url);
  }
  if (!isPayingTier(client.plan)) {
    return redirectWithError(
      req,
      "Stripe integration is a Pro feature. Upgrade to connect."
    );
  }

  // 3. User-denied case (Stripe redirects ?error=access_denied, no code)
  const errorParam = params.get("error");
  if (errorParam) {
    return redirectWithError(
      req,
      `Stripe connection declined (${errorParam}). You can try again any time.`
    );
  }

  const code = params.get("code");
  if (!code) {
    return redirectWithError(
      req,
      "Stripe OAuth callback missing authorization code."
    );
  }

  // 4. One Stripe account per client — reject a second before exchanging.
  const existing = await pool.query(
    "SELECT id FROM stripe_connections WHERE client_id = $1",
    [client.id]
  );
  if (existing.rowCount && existing.rowCount > 0) {
    return redirectWithError(
      req,
      "You already have a Stripe account connected. Disconnect it first to connect a different one."
    );
  }

  // 5. Exchange code → connected account + token
  let token: Awaited<ReturnType<typeof exchangeConnectCode>>;
  try {
    token = await exchangeConnectCode(code);
  } catch (err) {
    console.error("Stripe Connect token exchange failed:", err);
    return redirectWithError(
      req,
      "Couldn't complete the Stripe connection. Please try again."
    );
  }

  // 6. Encrypt the access token
  let accessBlob: ReturnType<typeof encryptForDb>;
  try {
    accessBlob = encryptForDb(token.accessToken);
  } catch (err) {
    console.error("Stripe Connect token encryption failed:", err);
    return redirectWithError(
      req,
      "Server is misconfigured (token encryption). Contact support."
    );
  }

  // 7. Fetch account display name (best-effort)
  const businessName = await fetchConnectedAccountName(token.stripeAccountId);

  // 8. Persist the connection
  try {
    await pool.query(
      `INSERT INTO stripe_connections (
         client_id, stripe_account_id, business_name,
         access_token_ciphertext, access_token_iv, access_token_auth_tag,
         scope, livemode
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        client.id,
        token.stripeAccountId,
        businessName,
        accessBlob.ciphertext,
        accessBlob.iv,
        accessBlob.authTag,
        token.scope,
        token.livemode,
      ]
    );
  } catch (err) {
    console.error("Stripe connection insert failed:", err);
    return redirectWithError(
      req,
      "Couldn't save the Stripe connection. Please try again."
    );
  }

  // 9. Success
  const url = new URL("/integrations", req.url);
  url.searchParams.set("connected_stripe", "1");
  if (businessName) url.searchParams.set("merchant", businessName);
  const res = NextResponse.redirect(url);
  res.cookies.delete(STATE_COOKIE_NAME);
  return res;

  // NOTE: P4 will fire-and-forget the backfill here; P5 relies on the
  // Connect webhook for ongoing sync.
}
