// app/api/shopify/oauth/initiate/route.ts
//
// Phase 8a commit 4 of 5. Designed in
// session-notes/phase-8-shopify-design.md §3 (sub-phase 8a #4).
//
// POST endpoint that kicks off the Shopify OAuth flow:
//   1. Validates the user is signed in + on Pro tier (locked
//      decision 4.4)
//   2. Validates + normalizes the shop domain the user typed
//   3. Generates a CSRF state token, stores it in a short-lived
//      httpOnly cookie
//   4. Returns { authorizeUrl } so the client can redirect the
//      browser
//
// The actual token exchange happens at the callback route (commit 5)
// after Shopify redirects the merchant back to Dreamward.
//
// Why POST + JSON body (not GET + redirect): we want to verify Pro
// status server-side BEFORE issuing the redirect, and we want the
// client to set the state cookie atomically with reading the URL.
// A POST cleanly captures both.

import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { getSessionClient } from "@/lib/getClient";
import {
  normalizeShopDomain,
  buildAuthorizeUrl,
} from "@/lib/shopify";
import { isPayingTier } from "@/lib/plans";
import { normalizeImportStartDate } from "@/lib/importRange";

// Cookie name for the CSRF state token. Read by the callback route.
// Short TTL since the OAuth flow takes seconds, not minutes.
const STATE_COOKIE_NAME = "shopify_oauth_state";
// Sibling cookie carrying the "import from" cutoff across the redirect.
const IMPORT_DATE_COOKIE_NAME = "shopify_import_start_date";
const STATE_COOKIE_MAX_AGE_SECONDS = 600; // 10 minutes — generous for slow merchants

// The OAuth redirect URI registered with Shopify. Must EXACTLY match
// what's set in the Shopify Partner dashboard's "Redirect URLs" field
// or Shopify rejects with redirect_uri_mismatch.
//
// Reads from env so dev / preview / prod can use different values
// without code change. Defaults to the production URL.
function callbackUrl(): string {
  return (
    process.env.SHOPIFY_OAUTH_CALLBACK_URL ||
    "https://godreamward.com/api/shopify/oauth/callback"
  );
}

export async function POST(req: NextRequest) {
  try {
    // ── Auth + plan gate ────────────────────────────────────────
    const client = await getSessionClient();
    if (!client) {
      return NextResponse.json(
        { error: "Not authenticated" },
        { status: 401 }
      );
    }
    if (!isPayingTier(client.plan)) {
      return NextResponse.json(
        {
          error:
            "Shopify integration is a Pro feature. Upgrade your plan to connect a store.",
        },
        { status: 403 }
      );
    }

    // ── Validate shop domain ────────────────────────────────────
    const body = (await req.json().catch(() => null)) as {
      shopDomain?: unknown;
      importStartDate?: unknown;
    } | null;
    const raw = body && typeof body.shopDomain === "string" ? body.shopDomain : "";
    const shopDomain = normalizeShopDomain(raw);
    const importStartDate = normalizeImportStartDate(body?.importStartDate);
    if (!shopDomain) {
      return NextResponse.json(
        {
          error:
            "Invalid shop domain. Enter your store URL — for example 'my-store' or 'my-store.myshopify.com'.",
        },
        { status: 400 }
      );
    }

    // ── Generate CSRF state ─────────────────────────────────────
    // 32 random bytes hex-encoded = 64 chars of entropy. The callback
    // route reads this cookie + compares to the state param Shopify
    // round-trips back.
    const state = randomBytes(32).toString("hex");

    // ── Build the authorize URL ─────────────────────────────────
    const authorizeUrl = buildAuthorizeUrl({
      shopDomain,
      state,
      // read_orders  → order + refund sync (webhooks + backfill)
      // read_products → catalog pull for SKU bulk-import
      //   (lib/shopify.fetchProducts hits /admin/api/.../products.json,
      //   which 403s without this scope). Added 2026-07-03 during the
      //   App Store scope review — safe now (0 installs, no re-consent
      //   needed for existing merchants). Keep this list MINIMAL: every
      //   extra scope is a line on the merchant's consent screen and a
      //   question in App Store review.
      // read_all_orders → lifts Shopify's 60-day order-history window
      //   for the initial backfill. Access request GRANTED in the
      //   Partner dashboard 2026-07-21; only meaningful alongside
      //   read_orders.
      redirectUri: callbackUrl(),
      scopes: ["read_orders", "read_all_orders", "read_products"],
    });

    // ── Set the state cookie + return ───────────────────────────
    // httpOnly so JS on the page can't read it; sameSite=lax so the
    // cookie is sent on the OAuth callback (which is a GET top-level
    // navigation from the Shopify consent screen). secure=true on
    // production HTTPS.
    const res = NextResponse.json({ authorizeUrl });
    res.cookies.set({
      name: STATE_COOKIE_NAME,
      value: state,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: STATE_COOKIE_MAX_AGE_SECONDS,
      path: "/",
    });
    res.cookies.set({
      name: IMPORT_DATE_COOKIE_NAME,
      value: importStartDate ?? "",
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: STATE_COOKIE_MAX_AGE_SECONDS,
      path: "/",
    });
    return res;
  } catch (err) {
    // loadEnv() inside lib/shopify throws clear messages for missing
    // env vars. Surface those distinctly from "user error" 4xx codes.
    console.error("Shopify OAuth initiate error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Couldn't start Shopify OAuth: ${msg}` },
      { status: 500 }
    );
  }
}
