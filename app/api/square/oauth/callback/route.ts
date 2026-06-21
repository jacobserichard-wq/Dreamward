// app/api/square/oauth/callback/route.ts
//
// Phase 11a commit 4. GET endpoint Square redirects merchants to
// after they approve the OAuth consent. URL shape:
//
//   /api/square/oauth/callback?code=...&state=...&response_type=code
//
// Square doesn't sign callbacks (unlike Shopify's HMAC), so CSRF
// protection is purely state-cookie based.
//
// Flow:
//   1. CSRF: verify state cookie matches state query param
//   2. Verify Dreamward session + Pro plan
//   3. Exchange code → access_token + refresh_token + merchant_id
//   4. Encrypt BOTH tokens (access has 30-day expiry, refresh
//      90-day; both rotate over time and live in DB)
//   5. Fetch the merchant's business name for the card UI
//      (best-effort — null on failure)
//   6. INSERT into square_connections; UNIQUE conflicts → friendly
//      error redirect
//   7. Redirect to /integrations?connected_square=1&merchant=<name>

import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getSessionClient } from "@/lib/getClient";
import {
  exchangeCodeForToken,
  fetchMerchantBusinessName,
  getSquareEnvironment,
} from "@/lib/square";
import { encryptForDb } from "@/lib/crypto";
import { isPayingTier } from "@/lib/plans";
import { normalizeImportStartDate } from "@/lib/importRange";

const STATE_COOKIE_NAME = "square_oauth_state";
const IMPORT_DATE_COOKIE_NAME = "square_import_start_date";

function redirectWithError(req: NextRequest, message: string): NextResponse {
  const url = new URL("/integrations", req.url);
  url.searchParams.set("error", message);
  const res = NextResponse.redirect(url);
  res.cookies.delete(STATE_COOKIE_NAME);
  res.cookies.delete(IMPORT_DATE_COOKIE_NAME);
  return res;
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;

  // ── 1. CSRF: state cookie matches state param ───────────────
  const stateParam = params.get("state");
  const stateCookie = req.cookies.get(STATE_COOKIE_NAME)?.value;
  if (!stateParam || !stateCookie || stateParam !== stateCookie) {
    return redirectWithError(
      req,
      "OAuth state mismatch. Please start the Square connection over."
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
      "Square integration is a Pro feature. Upgrade to connect."
    );
  }

  // ── 3. User-denied case ─────────────────────────────────────
  // If the merchant declines on Square's consent screen, Square
  // redirects with ?response_type=code&error=access_denied (no code).
  const errorParam = params.get("error");
  if (errorParam) {
    return redirectWithError(
      req,
      `Square OAuth declined (${errorParam}). You can try again any time.`
    );
  }

  const code = params.get("code");
  if (!code) {
    return redirectWithError(
      req,
      "Square OAuth callback missing authorization code."
    );
  }

  // ── 4. Exchange code for tokens ─────────────────────────────
  let tokenResult: Awaited<ReturnType<typeof exchangeCodeForToken>>;
  try {
    tokenResult = await exchangeCodeForToken({ code });
  } catch (err) {
    console.error("Square token exchange failed:", err);
    return redirectWithError(
      req,
      "Couldn't exchange OAuth code with Square. Please try again."
    );
  }

  // ── 5. Encrypt both tokens ──────────────────────────────────
  let accessBlob: ReturnType<typeof encryptForDb>;
  let refreshBlob: ReturnType<typeof encryptForDb>;
  try {
    accessBlob = encryptForDb(tokenResult.access_token);
    refreshBlob = encryptForDb(tokenResult.refresh_token);
  } catch (err) {
    console.error("Square token encryption failed:", err);
    return redirectWithError(
      req,
      "Server is misconfigured (token encryption). Contact support."
    );
  }

  // ── 6. Fetch business name (best-effort) ────────────────────
  const businessName = await fetchMerchantBusinessName({
    accessToken: tokenResult.access_token,
    merchantId: tokenResult.merchant_id,
  });

  // ── 7. Persist the connection ───────────────────────────────
  const environment = getSquareEnvironment();
  const scopes = tokenResult.scope ? tokenResult.scope.split(" ") : [];
  // "Import from" cutoff carried via the sibling cookie ("" → null = all).
  const importStartDate = normalizeImportStartDate(
    req.cookies.get(IMPORT_DATE_COOKIE_NAME)?.value
  );

  try {
    await pool.query(
      `INSERT INTO square_connections (
         client_id,
         merchant_id,
         business_name,
         access_token_ciphertext,
         access_token_iv,
         access_token_auth_tag,
         access_token_expires_at,
         refresh_token_ciphertext,
         refresh_token_iv,
         refresh_token_auth_tag,
         scopes,
         environment,
         import_start_date
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        client.id,
        tokenResult.merchant_id,
        businessName,
        accessBlob.ciphertext,
        accessBlob.iv,
        accessBlob.authTag,
        tokenResult.expires_at,
        refreshBlob.ciphertext,
        refreshBlob.iv,
        refreshBlob.authTag,
        scopes,
        environment,
        importStartDate,
      ]
    );
  } catch (err) {
    console.error("Square connection insert failed:", err);
    const msg = err instanceof Error ? err.message : String(err);
    const friendly = msg.includes("square_connections_client_id_key")
      ? "You already have a Square account connected. Disconnect the existing one before connecting a new account."
      : msg.includes("merchant_id")
        ? "This Square account is already connected to a different Dreamward account."
        : "Couldn't save the Square connection. Please try again.";
    return redirectWithError(req, friendly);
  }

  // ── 8. Success: redirect to /integrations ───────────────────
  const url = new URL("/integrations", req.url);
  url.searchParams.set("connected_square", "1");
  if (businessName) url.searchParams.set("merchant", businessName);
  const res = NextResponse.redirect(url);
  res.cookies.delete(STATE_COOKIE_NAME);
  res.cookies.delete(IMPORT_DATE_COOKIE_NAME);
  return res;

  // NOTE: Phase 11c will fire-and-forget the backfill kickoff here.
  // Phase 11d will register webhook subscriptions here.
}
