// app/api/wix/installed/route.ts
//
// Wix "app installed" webhook receiver. PUBLIC route — Wix POSTs
// machine-to-machine, no NextAuth session. Verifies the RS256 JWT
// against WIX_WEBHOOK_PUBLIC_KEY (lib/wix.verifyAppInstalledWebhook).
//
// ─────────────────────────────────────────────────────────────────
// SECURITY (2026-07-02): this webhook NO LONGER auto-binds.
// ─────────────────────────────────────────────────────────────────
// The previous design fetched the Wix site's *business email* and
// bound instance_id → the Dreamward client whose email matched. That
// email is set by the installing merchant inside Wix and is NOT proven
// — so a merchant could set it to a victim's Dreamward address and have
// their Wix orders written into the victim's books (cross-tenant data
// pollution). The JWT proves the request came from Wix; it does NOT
// prove who owns the Dreamward account.
//
// Binding now happens ONLY through the session-authenticated
// /api/wix/bind path, where client_id comes from the signed-in session
// (proven) and never from an email. This webhook simply verifies +
// acknowledges the install so Wix stops retrying; the merchant connects
// the site while signed in to Dreamward (Integrations → Wix → paste
// instance ID).
//
// FUTURE UX (tracked in the launch checklist): when Wix goes to App
// Market, record verified installs in a pending-hint table keyed by the
// claimed email as a HINT ONLY, and let the matching signed-in user
// CONFIRM the connection — client_id still coming from the session, the
// email never authorizing anything on its own.
//
// Always 200 on a well-formed verified request (Wix retries failures
// aggressively). 401 on signature / iss / aud / exp failure. 400 on
// malformed input. NOT in proxy.ts matcher — must remain public.

import { NextRequest, NextResponse } from "next/server";
import { verifyAppInstalledWebhook } from "@/lib/wix";

export async function POST(req: NextRequest) {
  // ── 1. Read body + extract JWT ──────────────────────────────
  let jwt: string;
  try {
    const raw = await req.text();
    if (!raw) {
      return NextResponse.json(
        { error: "Empty request body" },
        { status: 400 }
      );
    }
    // JWT shape: 3 base64url segments separated by "."
    if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(raw.trim())) {
      jwt = raw.trim();
    } else {
      // Some Wix delivery flavors wrap as { jwt: "..." } JSON
      try {
        const parsed = JSON.parse(raw) as { jwt?: string };
        if (typeof parsed.jwt === "string") {
          jwt = parsed.jwt;
        } else {
          return NextResponse.json(
            { error: "Body is neither a JWT nor a { jwt } envelope" },
            { status: 400 }
          );
        }
      } catch {
        return NextResponse.json(
          { error: "Body is not a valid JWT" },
          { status: 400 }
        );
      }
    }
  } catch (err) {
    console.error("Wix webhook: failed to read request body:", err);
    return NextResponse.json(
      { error: "Couldn't read request body" },
      { status: 400 }
    );
  }

  // ── 2. Verify JWT signature (RS256 vs WIX_WEBHOOK_PUBLIC_KEY) ─
  const payload = await verifyAppInstalledWebhook({ jwt });
  if (!payload) {
    console.warn(
      "Wix webhook: JWT verification failed (signature/iss/aud/exp)"
    );
    return NextResponse.json(
      { error: "Webhook signature verification failed" },
      { status: 401 }
    );
  }

  // ── 3. Acknowledge only — do NOT bind (see security note) ───
  // Binding is session-authed via /api/wix/bind. We intentionally do no
  // email lookup and touch no tenant data here, so an unverified,
  // merchant-controlled email can never associate this install with a
  // Dreamward account.
  const instanceId =
    typeof payload.instanceId === "string" ? payload.instanceId : null;
  const eventType =
    typeof payload.eventType === "string" ? payload.eventType : "(unknown)";
  console.log(
    `Wix webhook: verified install event=${eventType} ` +
      `instance=${instanceId ?? "(none)"} — acknowledged, NOT auto-bound ` +
      `(binding is session-authenticated via /api/wix/bind)`
  );
  return NextResponse.json({ acknowledged: true, action: "logged_no_autobind" });
}
