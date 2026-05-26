// app/api/wix/installed/route.ts
//
// Phase 10 email-matching binding (replaces the JWT-only-stub from
// the previous architecture pivot). Wix webhook receiver for the
// app-installed event. PUBLIC route — Wix POSTs machine-to-machine,
// no NextAuth session.
//
// ─────────────────────────────────────────────────────────────────
// Why we're not redirect-binding anymore:
// ─────────────────────────────────────────────────────────────────
// The previous design assumed Wix would redirect the merchant's
// browser back to /api/wix/installed/redirect with the instanceId
// after install completed. Empirical install test on prod proved
// Wix Studio Custom Apps don't expose a configurable post-install
// redirect URL — Wix sends merchants to its own manage-apps page.
// See session-notes/phase-10-wix-email-matching.md § 1.
//
// This webhook is now the PRIMARY binding path:
//   1. Wix POSTs the install event here with the new instance_id
//   2. We mint a Client Credentials token for that instance
//   3. Call Wix's site-properties API to retrieve the site's
//      business email (our scope already grants this access —
//      "Read site, business, and email details")
//   4. Lookup clients table by email
//   5. If exactly 1 match → INSERT wix_connections binding
//      If 0 matches → log "unbound", merchant can re-attempt later
//      If >1 matches → log "ambiguous", don't auto-bind
//
// ─────────────────────────────────────────────────────────────────
// JWT verification status:
// ─────────────────────────────────────────────────────────────────
// We *unpack* the JWT (jose.decodeJwt — no signature check) and do
// a soft `iss === 'wix.com'` claim check. We do NOT verify the RS256
// signature because the public key isn't surfaced in Wix Studio
// Custom Apps' Dev Center UI. Risk analysis: an attacker would need
// to ALREADY control a FlowWork user's email to gain anything from
// a forged install webhook (we only bind to existing clients matched
// by email). Real attack surface is small. JWT signature verification
// is a TODO for when we find the public key — lib/wix.ts already
// has verifyAppInstalledWebhook ready to drop in.
//
// Always returns 200 on a well-formed request — Wix re-delivers
// failed webhooks aggressively, and we don't want retry storms.
// Only returns 400 on malformed input.
//
// NOT in proxy.ts matcher — must remain public for Wix to reach.

import { NextRequest, NextResponse } from "next/server";
import { decodeJwt } from "jose";
import pool from "@/lib/db";
import { mintAccessToken, wixGet } from "@/lib/wix";

// Wix's site-properties API response shape — only the fields we
// need. Wix returns more; we ignore the rest. Multiple email-bearing
// fields exist (top-level + nested) — we try them in order.
interface WixSiteProperties {
  email?: string | null;
  contact?: { email?: string | null } | null;
  businessContactData?: { email?: string | null } | null;
  // Display name as fallback if not yet stored — convenient to
  // hydrate at bind time so the connection card doesn't have to
  // do a separate API call.
  businessName?: string | null;
}

interface ClientLookupRow {
  id: number;
  email: string;
}

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
    // JWT shape sanity check: 3 base64url segments separated by "."
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

  // ── 2. Decode JWT (no signature verify — see file header) ───
  let payload: Record<string, unknown>;
  try {
    payload = decodeJwt(jwt) as Record<string, unknown>;
  } catch (err) {
    console.warn("Wix webhook: malformed JWT, couldn't decode:", err);
    return NextResponse.json(
      { error: "Couldn't decode JWT payload" },
      { status: 400 }
    );
  }

  // Soft check: issuer should be wix.com. Catches casual non-Wix
  // POSTs to this public endpoint. Not a real signature verification.
  if (payload.iss !== "wix.com") {
    console.warn(
      `Wix webhook: rejecting payload with iss=${String(payload.iss)} ` +
        `(expected 'wix.com')`
    );
    return NextResponse.json({ acknowledged: true, action: "rejected" });
  }

  // ── 3. Extract instanceId from envelope ─────────────────────
  // Wix wraps event payloads as { eventType, instanceId, data, identity }
  // at the top level of the JWT-decoded claims. instanceId here is the
  // site-app instance, exactly what we want.
  const instanceId =
    typeof payload.instanceId === "string" ? payload.instanceId : null;
  const eventType =
    typeof payload.eventType === "string" ? payload.eventType : "(unknown)";

  if (!instanceId) {
    console.warn(
      "Wix webhook: payload missing instanceId — keys:",
      Object.keys(payload)
    );
    return NextResponse.json({ acknowledged: true, action: "ignored" });
  }

  // ── 4. Short-circuit if already bound ───────────────────────
  // Webhooks can re-deliver (Wix retries failures, and we may
  // intentionally receive multiple events for the same instance over
  // its lifetime). If a row already exists, no work to do.
  try {
    const existing = await pool.query<{ id: number; client_id: number }>(
      `SELECT id, client_id
         FROM wix_connections
        WHERE instance_id = $1`,
      [instanceId]
    );
    if (existing.rows.length > 0) {
      console.log(
        `Wix webhook: event=${eventType} instance=${instanceId} ` +
          `already bound to client_id=${existing.rows[0].client_id} — no action`
      );
      return NextResponse.json({ acknowledged: true, action: "already_bound" });
    }
  } catch (err) {
    console.error("Wix webhook: existence check failed:", err);
    return NextResponse.json({ acknowledged: true, dbError: true });
  }

  // ── 5. Mint Client Credentials token + fetch site properties ─
  let siteEmail: string | null = null;
  let siteName: string | null = null;
  try {
    const { accessToken } = await mintAccessToken({ instanceId });
    const props = await wixGet<WixSiteProperties>({
      accessToken,
      path: "/site-properties/v4/properties",
    });
    // Try multiple field paths — Wix's SDK typings show both top-level
    // and nested email locations; the actual REST response shape isn't
    // fully documented externally, so be defensive.
    siteEmail =
      props.email ||
      props.contact?.email ||
      props.businessContactData?.email ||
      null;
    siteName = props.businessName ?? null;
  } catch (err) {
    console.error(
      `Wix webhook: failed to fetch site-properties for ` +
        `instance=${instanceId}:`,
      err
    );
    return NextResponse.json({
      acknowledged: true,
      action: "fetch_failed",
    });
  }

  if (!siteEmail) {
    console.warn(
      `Wix webhook: site-properties for instance=${instanceId} ` +
        `returned no email — can't auto-bind. Merchant can manually ` +
        `link via fallback UI (TODO).`
    );
    return NextResponse.json({ acknowledged: true, action: "no_email" });
  }

  // ── 6. Match against clients table ──────────────────────────
  const normalized = siteEmail.trim().toLowerCase();
  let matches: ClientLookupRow[];
  try {
    const res = await pool.query<ClientLookupRow>(
      `SELECT id, email
         FROM clients
        WHERE LOWER(email) = $1`,
      [normalized]
    );
    matches = res.rows;
  } catch (err) {
    console.error("Wix webhook: client lookup failed:", err);
    return NextResponse.json({ acknowledged: true, dbError: true });
  }

  if (matches.length === 0) {
    // No FlowWork account with this email yet. The merchant may sign
    // up later — at that point we'd need a "look for pending unbound
    // installs for my email" job (not built yet). For now, log + 200.
    console.warn(
      `Wix webhook: unbound install for instance=${instanceId} ` +
        `email=${normalized} — no FlowWork account matches`
    );
    return NextResponse.json({ acknowledged: true, action: "unbound_no_match" });
  }

  if (matches.length > 1) {
    // Shouldn't happen — UNIQUE(email) is enforced on clients — but
    // be defensive. If it does happen, don't pick arbitrarily.
    console.warn(
      `Wix webhook: ambiguous match for instance=${instanceId} ` +
        `email=${normalized} → ${matches.length} clients. Refusing to bind.`
    );
    return NextResponse.json({ acknowledged: true, action: "ambiguous" });
  }

  // ── 7. Bind ─────────────────────────────────────────────────
  const clientId = matches[0].id;
  try {
    await pool.query(
      `INSERT INTO wix_connections (
         client_id,
         instance_id,
         site_display_name,
         installed_at,
         scopes
       ) VALUES ($1, $2, $3, NOW(), $4)
       ON CONFLICT (client_id) DO UPDATE
         SET instance_id       = EXCLUDED.instance_id,
             site_display_name = EXCLUDED.site_display_name,
             installed_at      = NOW()`,
      [clientId, instanceId, siteName, []]
    );
    console.log(
      `Wix webhook: bound instance=${instanceId} → client_id=${clientId} ` +
        `via email=${normalized}`
    );
    return NextResponse.json({ acknowledged: true, action: "bound", clientId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // UNIQUE(instance_id) constraint can fire if a race created the
    // row between our existence-check (step 4) and this insert.
    if (msg.includes("wix_connections_instance_id_key") || msg.includes("instance_id")) {
      console.warn(
        `Wix webhook: race on instance=${instanceId} insert ` +
          `(another binding committed first) — ignoring`
      );
      return NextResponse.json({ acknowledged: true, action: "race_lost" });
    }
    console.error("Wix webhook: bind INSERT failed:", err);
    return NextResponse.json({ acknowledged: true, dbError: true });
  }
}
