// app/api/wix/installed/route.ts
//
// Phase 10 architecture pivot commit 4. Wix webhook receiver for
// the "app installed" event. PUBLIC route (no NextAuth session —
// Wix POSTs machine-to-machine), JWT-signature-verified via
// lib/wix.verifyAppInstalledWebhook.
//
// ─────────────────────────────────────────────────────────────────
// Role in the install flow:
// ─────────────────────────────────────────────────────────────────
// This webhook is the **resilience / observability layer**, NOT
// the primary path for binding a Wix instance_id to a FlowWork
// client_id. The primary path is /api/wix/installed/redirect
// (shipped in commit 5), which has the merchant's NextAuth
// session available + can do the binding directly.
//
// Concretely, this route's responsibilities are:
//   1. Verify Wix's JWT signature so we know the install event is
//      genuinely from Wix (RS256 vs WIX_WEBHOOK_PUBLIC_KEY).
//   2. Log the event for ops visibility.
//   3. If we already have a wix_connections row for the announced
//      instance_id (i.e., the redirect handler bound it), the
//      webhook is essentially redundant — log + 200.
//   4. If we DON'T have a row (rare — merchant closed the tab
//      before the redirect, or installed via Wix App Market path
//      that we don't support yet), we have no way to bind to a
//      client_id from the webhook alone. Log "unbound install"
//      + 200. Future Phase 10d work may add a state-token or
//      App-Market-flow path that handles this case.
//
// Always returns 200 on a verified payload — Wix re-delivers
// failed webhooks, and we don't want a retry storm over events
// we intentionally don't act on.
//
// Returns 401 on failed JWT verification (caller is unauthenticated
// or impersonating Wix). Returns 400 on a malformed request body.
//
// NOT in proxy.ts matcher — must remain public for Wix to reach.

import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { verifyAppInstalledWebhook } from "@/lib/wix";

interface WixConnectionLookupRow {
  id: number;
  client_id: number;
}

export async function POST(req: NextRequest) {
  // Wix delivers the webhook as the raw JWT in the request body
  // (plain text, not JSON-wrapped — verified against @wix/sdk
  // delivery conventions). Some Wix integrations also wrap in
  // { jwt: "..." } JSON; try the plain-text path first and fall
  // back if it doesn't look like a JWT.
  let jwt: string;
  try {
    const raw = await req.text();
    if (!raw) {
      return NextResponse.json(
        { error: "Empty request body" },
        { status: 400 }
      );
    }
    // JWT shape sanity check: three base64url-encoded segments
    // separated by "." (header.payload.signature).
    if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(raw.trim())) {
      jwt = raw.trim();
    } else {
      // Try JSON-wrapped: { jwt: "..." }
      try {
        const parsed = JSON.parse(raw) as { jwt?: string };
        if (typeof parsed.jwt === "string") {
          jwt = parsed.jwt;
        } else {
          return NextResponse.json(
            { error: "Request body is neither a JWT nor a { jwt: string } envelope" },
            { status: 400 }
          );
        }
      } catch {
        return NextResponse.json(
          { error: "Request body is not a valid JWT" },
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

  const payload = await verifyAppInstalledWebhook({ jwt });
  if (!payload) {
    console.warn("Wix webhook: JWT verification failed");
    return NextResponse.json(
      { error: "Webhook signature verification failed" },
      { status: 401 }
    );
  }

  // ── Extract instance_id from the verified payload ──────────────
  // Wix's app-platform webhook payloads typically have:
  //   { eventType: 'INSTALLED' | 'UNINSTALLED' | ..., instanceId,
  //     siteUrl?, timestamp? }
  // But the exact shape varies by event category — guard against
  // a missing instanceId and log enough context for diagnosis.
  const instanceId =
    typeof payload.instanceId === "string"
      ? payload.instanceId
      : typeof (payload as { instance_id?: unknown }).instance_id === "string"
        ? ((payload as { instance_id: string }).instance_id)
        : null;

  const eventType =
    typeof payload.eventType === "string"
      ? payload.eventType
      : typeof (payload as { event_type?: unknown }).event_type === "string"
        ? ((payload as { event_type: string }).event_type)
        : "(unknown)";

  if (!instanceId) {
    console.warn(
      "Wix webhook: verified payload missing instanceId — payload keys:",
      Object.keys(payload)
    );
    // Still 200 — we verified the signature, we just don't know what
    // to do with the payload. Don't make Wix retry.
    return NextResponse.json({ acknowledged: true, action: "ignored" });
  }

  // ── Cross-reference with wix_connections ───────────────────────
  try {
    const found = await pool.query<WixConnectionLookupRow>(
      `SELECT id, client_id
         FROM wix_connections
        WHERE instance_id = $1`,
      [instanceId]
    );

    if (found.rows.length > 0) {
      console.log(
        `Wix webhook: event=${eventType} instance=${instanceId} ` +
          `bound to client_id=${found.rows[0].client_id} (already in DB)`
      );
    } else {
      // Merchant either closed the install tab before the redirect
      // handler bound the row, OR installed via a path we don't
      // support yet (Wix App Market). Can't bind without a FlowWork
      // session — log and move on. Future work: state-token path.
      console.warn(
        `Wix webhook: event=${eventType} instance=${instanceId} ` +
          `received for unbound instance — will be bound when merchant ` +
          `signs into FlowWork and hits /api/wix/installed/redirect`
      );
    }
    return NextResponse.json({ acknowledged: true });
  } catch (err) {
    console.error("Wix webhook: DB lookup failed:", err);
    // 200 anyway — the signature was valid, the DB issue is on our
    // side. Wix shouldn't retry over a transient DB blip.
    return NextResponse.json({ acknowledged: true, dbError: true });
  }
}
