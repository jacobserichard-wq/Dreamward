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
  subscribeWebhook,
  SHOPIFY_WEBHOOK_TOPICS,
  type ShopifyTokenSet,
} from "@/lib/shopify";
import { encryptForDb } from "@/lib/crypto";
import { isPayingTier } from "@/lib/plans";
import { normalizeImportStartDate } from "@/lib/importRange";
import { ensureShopifyBilling } from "@/lib/shopifyAppPricing";

const STATE_COOKIE_NAME = "shopify_oauth_state";
const IMPORT_DATE_COOKIE_NAME = "shopify_import_start_date";

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
  res.cookies.delete(IMPORT_DATE_COOKIE_NAME);
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

  // ── 4. Resolve session (OPTIONAL as of the App Store flow) ────
  // Two legitimate arrivals here:
  //   a) In-app connect: signed-in Pro user started at
  //      /api/shopify/oauth/initiate. Session present → bind directly.
  //   b) App Store install: merchant started at /api/shopify/install
  //      with NO Dreamward account. Session absent → store the token
  //      as a PENDING connection (client_id NULL, migration 0046) and
  //      route them through signin; /api/shopify/bind claims it after.
  // Either way the code must be exchanged NOW — it's single-use and
  // short-lived; bouncing to signin first would discard the install.
  const client = await getSessionClient();
  if (client && !isPayingTier(client.plan)) {
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

  let tokenResult: ShopifyTokenSet;
  try {
    tokenResult = await exchangeCodeForToken({ shopDomain, code });
  } catch (err) {
    console.error("Shopify token exchange failed:", err);
    return redirectWithError(
      req,
      "Couldn't exchange OAuth code with Shopify. Please try again."
    );
  }

  // ── 6. Encrypt the tokens ─────────────────────────────────────
  // Expiring offline tokens (2026-07-21): the exchange returns a
  // ~1h access token + ~90d refresh token; both stored encrypted.
  let encrypted: ReturnType<typeof encryptForDb>;
  let encryptedRefresh: ReturnType<typeof encryptForDb> | null;
  try {
    encrypted = encryptForDb(tokenResult.accessToken);
    encryptedRefresh = tokenResult.refreshToken
      ? encryptForDb(tokenResult.refreshToken)
      : null;
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
  // "Import from" cutoff carried via the sibling cookie ("" → null = all).
  const importStartDate = normalizeImportStartDate(
    req.cookies.get(IMPORT_DATE_COOKIE_NAME)?.value
  );

  // ── 7-cold. NO session: store as PENDING, route through signin ──
  // Upsert by shop_domain: a re-install refreshes the token. If the
  // shop is already BOUND to an account, keep that binding (this is
  // just a token refresh from a re-auth) and let the signin flow take
  // the merchant back to their app.
  if (!client) {
    try {
      await pool.query(
        `INSERT INTO shopify_connections (
           client_id, shop_domain,
           access_token_ciphertext, access_token_iv, access_token_auth_tag,
           access_token_expires_at,
           refresh_token_ciphertext, refresh_token_iv, refresh_token_auth_tag,
           refresh_token_expires_at,
           scopes, import_start_date
         ) VALUES (NULL, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NULL)
         ON CONFLICT (shop_domain) DO UPDATE SET
           access_token_ciphertext  = EXCLUDED.access_token_ciphertext,
           access_token_iv          = EXCLUDED.access_token_iv,
           access_token_auth_tag    = EXCLUDED.access_token_auth_tag,
           access_token_expires_at  = EXCLUDED.access_token_expires_at,
           refresh_token_ciphertext = EXCLUDED.refresh_token_ciphertext,
           refresh_token_iv         = EXCLUDED.refresh_token_iv,
           refresh_token_auth_tag   = EXCLUDED.refresh_token_auth_tag,
           refresh_token_expires_at = EXCLUDED.refresh_token_expires_at,
           scopes                   = EXCLUDED.scopes,
           updated_at               = NOW()`,
        [
          shopDomain,
          encrypted.ciphertext,
          encrypted.iv,
          encrypted.authTag,
          tokenResult.accessTokenExpiresAt,
          encryptedRefresh?.ciphertext ?? null,
          encryptedRefresh?.iv ?? null,
          encryptedRefresh?.authTag ?? null,
          tokenResult.refreshTokenExpiresAt,
          tokenResult.scopes,
        ]
      );
    } catch (err) {
      console.error("Shopify pending-connection upsert failed:", err);
      return redirectWithError(
        req,
        "Couldn't save the Shopify connection. Please try again."
      );
    }
    // Send the merchant through signin; /integrations picks up the
    // shopify_pending param after auth and calls /api/shopify/bind.
    const signin = new URL("/signin", req.url);
    signin.searchParams.set(
      "callbackUrl",
      `/integrations?shopify_pending=${encodeURIComponent(shopDomain)}`
    );
    const res = NextResponse.redirect(signin);
    res.cookies.delete(STATE_COOKIE_NAME);
    res.cookies.delete(IMPORT_DATE_COOKIE_NAME);
    return res;
  }

  // ── 7-warm. Session present: bind directly ────────────────────
  // Upsert by shop_domain so an App-Store install that created a
  // pending row gets claimed here when the merchant was already
  // signed in. Guard: never steal a shop bound to ANOTHER account.
  let connectionId: number;
  try {
    const existing = await pool.query<{ client_id: number | null }>(
      `SELECT client_id FROM shopify_connections WHERE shop_domain = $1`,
      [shopDomain]
    );
    const owner = existing.rows[0]?.client_id ?? null;
    if (owner !== null && owner !== client.id) {
      return redirectWithError(
        req,
        "That Shopify store is already connected to a different Dreamward account."
      );
    }
    connectionId = (await pool.query<{ id: number }>(
      `INSERT INTO shopify_connections (
         client_id, shop_domain,
         access_token_ciphertext, access_token_iv, access_token_auth_tag,
         access_token_expires_at,
         refresh_token_ciphertext, refresh_token_iv, refresh_token_auth_tag,
         refresh_token_expires_at,
         scopes, import_start_date
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       ON CONFLICT (shop_domain) DO UPDATE SET
         client_id                = EXCLUDED.client_id,
         access_token_ciphertext  = EXCLUDED.access_token_ciphertext,
         access_token_iv          = EXCLUDED.access_token_iv,
         access_token_auth_tag    = EXCLUDED.access_token_auth_tag,
         access_token_expires_at  = EXCLUDED.access_token_expires_at,
         refresh_token_ciphertext = EXCLUDED.refresh_token_ciphertext,
         refresh_token_iv         = EXCLUDED.refresh_token_iv,
         refresh_token_auth_tag   = EXCLUDED.refresh_token_auth_tag,
         refresh_token_expires_at = EXCLUDED.refresh_token_expires_at,
         scopes                   = EXCLUDED.scopes,
         import_start_date        = COALESCE(EXCLUDED.import_start_date,
                                             shopify_connections.import_start_date),
         updated_at               = NOW()
       RETURNING id`,
      [
        client.id,
        shopDomain,
        encrypted.ciphertext,
        encrypted.iv,
        encrypted.authTag,
        tokenResult.accessTokenExpiresAt,
        encryptedRefresh?.ciphertext ?? null,
        encryptedRefresh?.iv ?? null,
        encryptedRefresh?.authTag ?? null,
        tokenResult.refreshTokenExpiresAt,
        tokenResult.scopes,
        importStartDate,
      ]
    )).rows[0].id;
  } catch (err) {
    // Most likely: UNIQUE(client_id) violation (this client already
    // has a DIFFERENT store connected — v1 allows only one).
    console.error("Shopify connection insert failed:", err);
    const msg =
      err instanceof Error && err.message.includes("unique")
        ? "You already have a Shopify store connected. Disconnect the existing one before connecting a new store."
        : "Couldn't save the Shopify connection. Please try again.";
    return redirectWithError(req, msg);
  }

  // ── 7b. Register webhooks (Phase 8d) ──────────────────────────
  // Subscribe to orders/create + orders/updated + orders/cancelled
  // + refunds/create so we get real-time updates. The webhook IDs
  // get persisted on shopify_connections.webhook_subscription_ids
  // so the disconnect flow can DELETE them on Shopify's side.
  //
  // Best-effort: failures get logged but DON'T block the connect.
  // Daily reconciliation cron (8e) compensates if any webhook
  // never fires. User can also re-trigger registration manually
  // by disconnecting + reconnecting.
  try {
    const webhookAddress = new URL(
      "/api/shopify/webhook",
      req.url
    ).toString();
    const webhookIds: string[] = [];
    for (const topic of SHOPIFY_WEBHOOK_TOPICS) {
      try {
        const { id } = await subscribeWebhook({
          shopDomain,
          accessToken: tokenResult.accessToken,
          topic,
          address: webhookAddress,
        });
        webhookIds.push(id);
      } catch (err) {
        console.warn(`Webhook subscribe failed for topic ${topic}:`, err);
      }
    }
    if (webhookIds.length > 0) {
      await pool.query(
        `UPDATE shopify_connections
            SET webhook_subscription_ids = $1,
                updated_at = NOW()
          WHERE client_id = $2`,
        [webhookIds, client.id]
      );
    }
  } catch (err) {
    console.warn(
      "Webhook registration block failed (will rely on daily cron):",
      err
    );
  }

  // ── 8. Kick off the backfill (fire-and-forget) ─────────────────
  // Phase 8c: post-connect we POST to /api/shopify/backfill to start
  // pulling orders into processed_items. The endpoint is chunked +
  // resumable so even if the first call only processes a chunk before
  // Vercel times out, the frontend polling will continue the work.
  //
  // Fire-and-forget: we don't await the fetch result. The user lands
  // on /integrations with the in-progress backfill rendering via the
  // ShopifyConnectionCard's polling. Awaiting here would just hold
  // the redirect for ~50s with no UX benefit.
  try {
    // Construct an absolute URL for the internal POST. Forwards the
    // session cookie so the backfill route can authenticate.
    const backfillUrl = new URL("/api/shopify/backfill", req.url);
    const cookieHeader = req.headers.get("cookie") ?? "";
    fetch(backfillUrl.toString(), {
      method: "POST",
      headers: { cookie: cookieHeader },
    }).catch((err) => {
      // Logged but not surfaced — the frontend will detect the
      // not-yet-started state and trigger backfill on first poll.
      console.warn("Backfill kickoff failed (will retry from UI):", err);
    });
  } catch (err) {
    console.warn("Backfill kickoff exception:", err);
  }

  // ── 8b. App Store billing (Shopify App Pricing, req 1.2) ──────
  // Stripe-paying clients pass straight through; everyone else on
  // this shop bills through Shopify. If the merchant hasn't picked
  // a plan yet, send them to Shopify's hosted plan page instead of
  // /integrations — its welcome link brings them back to us.
  const billing = await ensureShopifyBilling({
    clientId: client.id,
    connectionId,
    shopDomain,
    accessToken: tokenResult.accessToken,
  });
  if (billing.planSelectionUrl) {
    const res = NextResponse.redirect(billing.planSelectionUrl);
    res.cookies.delete(STATE_COOKIE_NAME);
    res.cookies.delete(IMPORT_DATE_COOKIE_NAME);
    return res;
  }

  // ── 9. Success: redirect to /integrations ─────────────────────
  const url = new URL("/integrations", req.url);
  url.searchParams.set("connected", "1");
  url.searchParams.set("shop", shopDomain);
  const res = NextResponse.redirect(url);
  res.cookies.delete(STATE_COOKIE_NAME);
  res.cookies.delete(IMPORT_DATE_COOKIE_NAME);
  return res;
}
