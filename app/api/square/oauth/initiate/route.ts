// app/api/square/oauth/initiate/route.ts
//
// Phase 11a commit 3. Kicks off Square OAuth. Mirrors the Shopify
// initiate route from Phase 8a, simpler because Square doesn't need
// a shop-domain input upfront (the merchant picks their Square
// account on Square's consent screen).
//
// Flow:
//   1. Auth + Pro gate
//   2. Generate CSRF state token, store in short-lived httpOnly cookie
//   3. Build the Square authorize URL
//   4. Return { authorizeUrl } — client redirects browser to it

import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { getSessionClient } from "@/lib/getClient";
import { buildOauthAuthorizeUrl } from "@/lib/square";
import { isPayingTier } from "@/lib/plans";
import { normalizeImportStartDate } from "@/lib/importRange";

const STATE_COOKIE_NAME = "square_oauth_state";
// Carries the connect-time "import from" cutoff across the OAuth redirect
// (Square's flow has no place to round-trip arbitrary data, so we stash it
// in a sibling httpOnly cookie the callback reads). Empty = all history.
const IMPORT_DATE_COOKIE_NAME = "square_import_start_date";
const STATE_COOKIE_MAX_AGE_SECONDS = 600; // 10 minutes

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
            "Square integration is a Pro feature. Upgrade your plan to connect.",
        },
        { status: 403 }
      );
    }

    // ── Read the chosen import cutoff (bad/missing → null = all) ──
    const body = (await req.json().catch(() => null)) as {
      importStartDate?: unknown;
    } | null;
    const importStartDate = normalizeImportStartDate(body?.importStartDate);

    // ── Generate CSRF state ─────────────────────────────────────
    // 32 random bytes hex-encoded = 64 chars of entropy. Callback
    // verifies the cookie value against Square's round-tripped state.
    const state = randomBytes(32).toString("hex");

    // ── Build the authorize URL ─────────────────────────────────
    // Default scopes (PAYMENTS_READ + MERCHANT_PROFILE_READ) come
    // from lib/square.SQUARE_DEFAULT_SCOPES. Override by passing
    // a `scopes` array if we need more permissions later.
    const authorizeUrl = buildOauthAuthorizeUrl({ state });

    // ── Set the state cookie + return ───────────────────────────
    // httpOnly + sameSite=lax so the cookie survives the OAuth
    // redirect roundtrip from Square back to our callback.
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
    // Sibling cookie carrying the import cutoff (empty = all history).
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
    console.error("Square OAuth initiate error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Couldn't start Square OAuth: ${msg}` },
      { status: 500 }
    );
  }
}
