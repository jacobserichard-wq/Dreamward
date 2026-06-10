// app/api/etsy/oauth/initiate/route.ts
//
// Etsy integration commit 3. Kicks off the Etsy OAuth flow. Mirrors
// the Square initiate route with one Etsy addition: v3 REQUIRES
// PKCE, so alongside the CSRF state cookie we set a second
// short-lived httpOnly cookie carrying the code_verifier — the
// callback needs it for the token exchange.
//
// Flow:
//   1. Auth + paying-tier gate
//   2. Generate CSRF state + PKCE verifier; store both in cookies
//   3. Build the Etsy authorize URL (S256 challenge of the verifier)
//   4. Return { authorizeUrl } — client redirects the browser

import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { getSessionClient } from "@/lib/getClient";
import {
  buildAuthorizeUrl,
  generateCodeVerifier,
  codeChallengeS256,
} from "@/lib/etsy";
import { isPayingTier } from "@/lib/plans";

const STATE_COOKIE = "etsy_oauth_state";
const VERIFIER_COOKIE = "etsy_oauth_verifier";
const COOKIE_MAX_AGE_SECONDS = 600; // 10 minutes

export async function POST() {
  try {
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
            "The Etsy integration requires an active subscription. Start your plan to connect.",
        },
        { status: 403 }
      );
    }

    const state = randomBytes(32).toString("hex");
    const verifier = generateCodeVerifier();

    const redirectUri = `${process.env.NEXTAUTH_URL}/api/etsy/oauth/callback`;
    const authorizeUrl = buildAuthorizeUrl({
      redirectUri,
      state,
      codeChallenge: codeChallengeS256(verifier),
    });

    const res = NextResponse.json({ authorizeUrl });
    const cookieOpts = {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax" as const,
      maxAge: COOKIE_MAX_AGE_SECONDS,
      path: "/",
    };
    res.cookies.set({ name: STATE_COOKIE, value: state, ...cookieOpts });
    res.cookies.set({ name: VERIFIER_COOKIE, value: verifier, ...cookieOpts });
    return res;
  } catch (err) {
    console.error("Etsy OAuth initiate error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Couldn't start Etsy OAuth: ${msg}` },
      { status: 500 }
    );
  }
}
