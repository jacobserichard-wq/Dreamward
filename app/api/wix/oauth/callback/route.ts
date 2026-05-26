// app/api/wix/oauth/callback/route.ts
//
// Phase 10a commit 4 of ~5. Mirrors /api/shopify/oauth/callback.
//
// GET endpoint Wix redirects merchants to after they grant the app
// permissions. URL looks like:
//   /api/wix/oauth/callback?code=...&state=...&instanceId=...
//
// Flow:
//   1. Verify state cookie matches the state query param (CSRF)
//   2. Verify user session + Pro plan
//   3. Exchange code → access_token + refresh_token via
//      lib/wix.exchangeCodeForToken
//   4. Encrypt BOTH tokens via lib/crypto.encryptForDb (Wix has
//      short-lived access + long-lived refresh; both need encryption)
//   5. Fetch the site's display name for the UI
//   6. INSERT into wix_connections; UNIQUE(client_id) collision
//      = "already connected" message
//   7. Redirect to /integrations?connected_wix=1&site=<name>
//
// ✅ Phase 10b: install URL + token-exchange shape verified vs
// @wix/sdk source. The instance_id question is settled too —
// it's NEVER on the token response; it's always on the callback
// URL as `instanceId` query param. This route uses that param
// directly + no longer falls back to a (non-existent) token field.

import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getSessionClient } from "@/lib/getClient";
import { exchangeCodeForToken, fetchSiteDisplayName } from "@/lib/wix";
import { encryptForDb } from "@/lib/crypto";

const STATE_COOKIE_NAME = "wix_oauth_state";

function redirectWithError(req: NextRequest, message: string): NextResponse {
  const url = new URL("/integrations", req.url);
  url.searchParams.set("error", message);
  const res = NextResponse.redirect(url);
  res.cookies.delete(STATE_COOKIE_NAME);
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
      "OAuth state mismatch. Please start the Wix connection over."
    );
  }

  // ── 2. Auth + plan gate ─────────────────────────────────────
  const client = await getSessionClient();
  if (!client) {
    const url = new URL("/signin", req.url);
    url.searchParams.set("callbackUrl", "/integrations");
    return NextResponse.redirect(url);
  }
  if (client.plan !== "pro") {
    return redirectWithError(
      req,
      "Wix integration is a Pro feature. Upgrade to connect a site."
    );
  }

  // ── 3. Exchange code for tokens ─────────────────────────────
  const code = params.get("code");
  if (!code) {
    return redirectWithError(req, "OAuth callback missing authorization code.");
  }

  let tokenResult: Awaited<ReturnType<typeof exchangeCodeForToken>>;
  try {
    tokenResult = await exchangeCodeForToken({ code });
  } catch (err) {
    console.error("Wix token exchange failed:", err);
    return redirectWithError(
      req,
      "Couldn't exchange OAuth code with Wix. Please try again."
    );
  }

  // instanceId always comes from the callback URL — verified vs
  // @wix/sdk source (handleOAuthCallback reads it via
  // `params.get('instanceId')`). Wix never returns it in the token
  // exchange response body.
  const instanceId = params.get("instanceId");
  if (!instanceId) {
    return redirectWithError(
      req,
      "Wix didn't return a site instance ID. Please try again."
    );
  }

  // ── 4. Encrypt both tokens ──────────────────────────────────
  let accessBlob: ReturnType<typeof encryptForDb>;
  let refreshBlob: ReturnType<typeof encryptForDb>;
  try {
    accessBlob = encryptForDb(tokenResult.access_token);
    refreshBlob = encryptForDb(tokenResult.refresh_token);
  } catch (err) {
    console.error("Wix token encryption failed:", err);
    return redirectWithError(
      req,
      "Server is misconfigured (token encryption). Contact support."
    );
  }

  // ── 5. Fetch site display name (best-effort) ────────────────
  const siteDisplayName = await fetchSiteDisplayName({
    accessToken: tokenResult.access_token,
  });

  // ── 6. Persist the connection ───────────────────────────────
  const accessExpiresAt = new Date(
    Date.now() + tokenResult.expires_in * 1000
  ).toISOString();
  const scopes = tokenResult.scope ? tokenResult.scope.split(" ") : [];

  try {
    await pool.query(
      `INSERT INTO wix_connections (
         client_id,
         instance_id,
         site_display_name,
         access_token_ciphertext,
         access_token_iv,
         access_token_auth_tag,
         access_token_expires_at,
         refresh_token_ciphertext,
         refresh_token_iv,
         refresh_token_auth_tag,
         scopes
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        client.id,
        instanceId,
        siteDisplayName,
        accessBlob.ciphertext,
        accessBlob.iv,
        accessBlob.authTag,
        accessExpiresAt,
        refreshBlob.ciphertext,
        refreshBlob.iv,
        refreshBlob.authTag,
        scopes,
      ]
    );
  } catch (err) {
    console.error("Wix connection insert failed:", err);
    const msg =
      err instanceof Error && err.message.includes("unique")
        ? "You already have a Wix site connected. Disconnect the existing one before connecting a new site."
        : "Couldn't save the Wix connection. Please try again.";
    return redirectWithError(req, msg);
  }

  // ── 7. Success: redirect to /integrations ───────────────────
  const url = new URL("/integrations", req.url);
  url.searchParams.set("connected_wix", "1");
  if (siteDisplayName) url.searchParams.set("site", siteDisplayName);
  const res = NextResponse.redirect(url);
  res.cookies.delete(STATE_COOKIE_NAME);
  return res;

  // NOTE: sub-phases 10c (backfill kickoff) + 10d (webhook
  // subscription registration) will fire those off here before the
  // redirect.
}
