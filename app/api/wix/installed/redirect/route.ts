// app/api/wix/installed/redirect/route.ts
//
// Phase 10 architecture pivot commit 5. Browser landing endpoint
// Wix redirects merchants to after they install FlowWork on their
// Wix site. AUTHENTICATED route — the merchant must be signed into
// FlowWork for us to know which client_id to bind the instance_id to.
//
// ─────────────────────────────────────────────────────────────────
// This is the PRIMARY binding path. The webhook receiver at
// /api/wix/installed is the resilience / observability layer.
// ─────────────────────────────────────────────────────────────────
//
// Wix Dev Center config required (one-time, Jacob does in UI):
//   Develop → App Settings → Post-installation navigation
//     → Choose destination: External URL
//     → URL: https://flowworks.it.com/api/wix/installed/redirect
//   Wix will append ?instanceId=<UUID> automatically per their
//   post-install convention.
//
// Flow:
//   1. Read instanceId from URL query params; error if missing.
//   2. Read FlowWork session. If missing, redirect to /signin with
//      callbackUrl preserving instanceId so the merchant lands back
//      here after signing in.
//   3. Pro-gate check — non-Pro → /integrations?error=Upgrade+...
//   4. INSERT wix_connections row binding (client_id, instance_id,
//      installed_at). Handle UNIQUE conflicts:
//        - (client_id) conflict + same instance_id → re-install,
//          update installed_at
//        - (client_id) conflict + different instance_id → error
//          "you already have a Wix site connected; disconnect first"
//        - (instance_id) conflict, different client_id → error
//          "this Wix site is already connected to another FlowWork
//          account"
//   5. Mint a Client Credentials access token via lib/wix.mintAccessToken
//      to fetch the site's display name (best-effort — failure doesn't
//      block the success flow; we just leave site_display_name NULL
//      and the connection card falls back to a truncated instance UUID).
//   6. Redirect to /integrations?connected_wix=1&site=<displayName>
//      → /integrations page renders the green success toast.

import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getSessionClient } from "@/lib/getClient";
import { mintAccessToken, fetchSiteDisplayName } from "@/lib/wix";

function redirectWithError(req: NextRequest, message: string): NextResponse {
  const url = new URL("/integrations", req.url);
  url.searchParams.set("error", message);
  return NextResponse.redirect(url);
}

function redirectWithSuccess(
  req: NextRequest,
  siteDisplayName: string | null
): NextResponse {
  const url = new URL("/integrations", req.url);
  url.searchParams.set("connected_wix", "1");
  if (siteDisplayName) url.searchParams.set("site", siteDisplayName);
  return NextResponse.redirect(url);
}

export async function GET(req: NextRequest) {
  // ── 1. Extract instanceId ───────────────────────────────────
  const instanceId = req.nextUrl.searchParams.get("instanceId");
  if (!instanceId) {
    return redirectWithError(
      req,
      "Wix didn't include an instanceId in the install redirect. Please try again."
    );
  }

  // ── 2. Auth: must be signed into FlowWork ───────────────────
  const client = await getSessionClient();
  if (!client) {
    // Preserve instanceId on the round-trip through /signin so the
    // merchant lands back here with the same context. Build the
    // callbackUrl manually so the inner `?` survives encoding.
    const callbackUrl = `/api/wix/installed/redirect?instanceId=${encodeURIComponent(instanceId)}`;
    const signinUrl = new URL("/signin", req.url);
    signinUrl.searchParams.set("callbackUrl", callbackUrl);
    return NextResponse.redirect(signinUrl);
  }

  // ── 3. Pro gate ─────────────────────────────────────────────
  if (client.plan !== "pro") {
    return redirectWithError(
      req,
      "Wix integration is a Pro feature. Upgrade to connect a Wix site."
    );
  }

  // ── 4. Bind client_id ↔ instance_id ─────────────────────────
  // ON CONFLICT (client_id) DO UPDATE handles the re-install case
  // for the same Wix site; if instance_id changed (merchant has a
  // different Wix site), the WHERE filters it out so RETURNING is
  // empty and we error explicitly. A pre-existing instance_id under
  // a different client_id throws on the UNIQUE(instance_id) check
  // which we catch below.
  try {
    const upsert = await pool.query<{ id: number }>(
      `INSERT INTO wix_connections (client_id, instance_id, installed_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (client_id) DO UPDATE
         SET installed_at = NOW()
         WHERE wix_connections.instance_id = EXCLUDED.instance_id
       RETURNING id`,
      [client.id, instanceId]
    );

    if (upsert.rows.length === 0) {
      // The ON CONFLICT WHERE filter rejected the update — the existing
      // row for this client_id points at a different instance_id.
      return redirectWithError(
        req,
        "You already have a different Wix site connected. Disconnect it first, then try again."
      );
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("wix_connections_instance_id_key") || msg.includes("instance_id")) {
      return redirectWithError(
        req,
        "This Wix site is already connected to a different FlowWork account."
      );
    }
    console.error("Wix install bind failed:", err);
    return redirectWithError(
      req,
      "Couldn't record the Wix connection. Please try again."
    );
  }

  // ── 5. Best-effort site display name fetch ──────────────────
  // Mint a fresh token (uses Client Credentials), call Sites API,
  // store the name. All failures here are non-fatal — the user
  // already has a connected row; the UI will just show a fallback
  // label until the next successful refresh.
  let siteDisplayName: string | null = null;
  try {
    const { accessToken } = await mintAccessToken({ instanceId });
    siteDisplayName = await fetchSiteDisplayName({ accessToken });
    if (siteDisplayName) {
      await pool.query(
        `UPDATE wix_connections
            SET site_display_name = $1
          WHERE instance_id = $2`,
        [siteDisplayName, instanceId]
      );
    }
  } catch (err) {
    console.warn(
      "Wix install: site display name fetch failed (non-fatal):",
      err
    );
  }

  // ── 6. Redirect to /integrations with success toast ─────────
  return redirectWithSuccess(req, siteDisplayName);
}
