// app/api/wix/oauth/initiate/route.ts
//
// Phase 10a commit 3 of ~5. Mirrors /api/shopify/oauth/initiate.
//
// POST endpoint that kicks off the Wix OAuth flow:
//   1. Validates the user is signed in + on Pro tier
//   2. Generates a CSRF state token, stores it in a short-lived
//      httpOnly cookie
//   3. Returns { authorizeUrl } so the client redirects the browser
//
// Unlike Shopify, Wix doesn't need a shop-domain input upfront — the
// merchant picks which Wix site to install on from inside Wix's
// consent screen. So no body validation needed here (just plan gate).

import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { getSessionClient } from "@/lib/getClient";
import { buildAuthorizeUrl } from "@/lib/wix";

const STATE_COOKIE_NAME = "wix_oauth_state";
const STATE_COOKIE_MAX_AGE_SECONDS = 600;

function callbackUrl(): string {
  return (
    process.env.WIX_OAUTH_CALLBACK_URL ||
    "https://flowworks.it.com/api/wix/oauth/callback"
  );
}

export async function POST() {
  try {
    // ── Auth + plan gate (same as Shopify) ─────────────────────
    const client = await getSessionClient();
    if (!client) {
      return NextResponse.json(
        { error: "Not authenticated" },
        { status: 401 }
      );
    }
    if (client.plan !== "pro") {
      return NextResponse.json(
        {
          error:
            "Wix integration is a Pro feature. Upgrade your plan to connect a Wix site.",
        },
        { status: 403 }
      );
    }

    // ── Generate CSRF state ────────────────────────────────────
    const state = randomBytes(32).toString("hex");

    // ── Build authorize URL ────────────────────────────────────
    // Scopes are NOT passed at install time on Wix (unlike Shopify
    // / vanilla OAuth 2.0). They're pre-configured in the Wix Dev
    // Center under Develop → Permissions and shown to the merchant
    // on the consent screen automatically. Currently configured
    // there:
    //   - Wix Stores → Read Orders (for order data backfill)
    //   - Site Content → Read Site URLs (for the connection card label)
    //   - Wix Developers → Read site, business, and email details
    //     (auto-added by Wix; useful for siteDisplayName lookup)
    //
    // If you add/remove permissions in the Dev Center, you must
    // release a new app version (Distribute → Versions) and existing
    // merchants will be prompted to re-auth on next install attempt.
    const authorizeUrl = buildAuthorizeUrl({
      state,
      redirectUri: callbackUrl(),
    });

    // ── Set the state cookie + return ──────────────────────────
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
    return res;
  } catch (err) {
    console.error("Wix OAuth initiate error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Couldn't start Wix OAuth: ${msg}` },
      { status: 500 }
    );
  }
}
