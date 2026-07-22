// app/api/shopify/install/route.ts
//
// App Store install entry point (2026-07-21, App Store submission
// prerequisite). This is the URL registered as the app's "App URL"
// in the Shopify Partner/Dev dashboard.
//
// Why it exists: App-Store-initiated installs hit the app COLD —
// Shopify sends the merchant here with ?shop=&hmac=&timestamp= and
// NO Dreamward session exists. The in-app initiate route
// (/api/shopify/oauth/initiate) requires a signed-in Pro session, so
// it can't serve this entry. This route verifies Shopify's HMAC,
// sets the same CSRF state cookie the callback expects, and starts
// OAuth immediately — no session required. Shopify's review flow
// REQUIRES that clicking Install leads directly into OAuth, which
// this satisfies.
//
// After OAuth, the callback stores the token as a PENDING connection
// (client_id NULL — migration 0046) and sends the merchant to
// sign in; /api/shopify/bind claims the pending row for the signed-in
// account (session authorizes the claim — the Wix bind pattern).
//
// PUBLIC route: intentionally absent from proxy.ts's matcher.
// Security comes from Shopify's HMAC on the query string — we refuse
// to start OAuth for a request Shopify didn't sign, so this can't be
// used to phish arbitrary shops into a consent screen from our domain.

import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import pool from "@/lib/db";
import {
  normalizeShopDomain,
  verifyOAuthCallbackHmac,
  buildAuthorizeUrl,
} from "@/lib/shopify";

const STATE_COOKIE_NAME = "shopify_oauth_state";

function callbackUrl(req: NextRequest): string {
  return (
    process.env.SHOPIFY_OAUTH_CALLBACK_URL ||
    new URL("/api/shopify/oauth/callback", req.url).toString()
  );
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;

  // ── 1. Validate the shop param ────────────────────────────────
  const shopDomain = normalizeShopDomain(params.get("shop") ?? "");
  if (!shopDomain) {
    return NextResponse.json(
      { error: "Missing or invalid shop parameter" },
      { status: 400 }
    );
  }

  // ── 2. Verify Shopify's HMAC on the query string ──────────────
  // Same signing scheme as the OAuth callback. Without a valid HMAC
  // we refuse — this endpoint must not be a generic "start OAuth for
  // any shop" springboard on our domain.
  if (!verifyOAuthCallbackHmac(params)) {
    return NextResponse.json(
      { error: "Invalid request signature" },
      { status: 401 }
    );
  }

  // ── 3. Already installed AND bound? Go to the app ─────────────
  // A merchant clicking the app icon in their Shopify admin lands
  // here too. If their shop is already connected to a Dreamward
  // account, OAuth again would be pointless — send them to the app
  // (signin gate handles the rest).
  try {
    const existing = await pool.query<{ client_id: number | null }>(
      `SELECT client_id FROM shopify_connections WHERE shop_domain = $1`,
      [shopDomain]
    );
    if (existing.rows.length > 0 && existing.rows[0].client_id !== null) {
      return NextResponse.redirect(new URL("/integrations", req.url));
    }
    // Pending (client_id NULL) or absent → run/re-run OAuth: a fresh
    // token never hurts, and the callback upserts by shop_domain.
  } catch (err) {
    console.error("Shopify install: existing-connection check failed:", err);
    // Non-fatal — proceed with OAuth; the callback handles conflicts.
  }

  // ── 4. Start OAuth with the standard CSRF state cookie ────────
  const state = randomBytes(32).toString("hex");
  const authorizeUrl = buildAuthorizeUrl({
    shopDomain,
    state,
    redirectUri: callbackUrl(req),
    // Keep in lockstep with /api/shopify/oauth/initiate. read_orders →
    // order/refund sync; read_all_orders → full-history backfill
    // (granted 2026-07-21); read_products → catalog bulk-import.
    scopes: ["read_orders", "read_all_orders", "read_products"],
  });

  const res = NextResponse.redirect(authorizeUrl);
  res.cookies.set(STATE_COOKIE_NAME, state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax", // sent on the top-level GET redirect back from Shopify
    maxAge: 60 * 10,
    path: "/",
  });
  return res;
}
