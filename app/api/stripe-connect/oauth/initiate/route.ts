// app/api/stripe-connect/oauth/initiate/route.ts
//
// Kicks off Stripe CONNECT OAuth — a customer connects THEIR own Stripe
// account so their charges sync in as income. Mirrors the Square initiate
// route. Separate from billing Stripe (/api/stripe/*).
//
// Flow: auth + Pro gate → CSRF state cookie → build Connect authorize URL
// → return { authorizeUrl } (client redirects the browser to it).

import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { getSessionClient } from "@/lib/getClient";
import { buildConnectAuthorizeUrl } from "@/lib/stripeConnect";
import { isPayingTier } from "@/lib/plans";

const STATE_COOKIE_NAME = "stripe_connect_oauth_state";
const STATE_COOKIE_MAX_AGE_SECONDS = 600; // 10 minutes

export async function POST(req: NextRequest) {
  try {
    const client = await getSessionClient();
    if (!client) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    if (!isPayingTier(client.plan)) {
      return NextResponse.json(
        {
          error:
            "Stripe integration is a Pro feature. Upgrade your plan to connect.",
        },
        { status: 403 }
      );
    }

    if (!process.env.STRIPE_CONNECT_CLIENT_ID) {
      return NextResponse.json(
        { error: "Stripe Connect isn't configured yet. Check back soon." },
        { status: 503 }
      );
    }

    const state = randomBytes(32).toString("hex");
    const redirectUri = `${process.env.NEXTAUTH_URL}/api/stripe-connect/oauth/callback`;
    const authorizeUrl = buildConnectAuthorizeUrl({ state, redirectUri });

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
    console.error("Stripe Connect OAuth initiate error:", err);
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: `Couldn't start the Stripe connection: ${msg}` },
      { status: 500 }
    );
  }
}
