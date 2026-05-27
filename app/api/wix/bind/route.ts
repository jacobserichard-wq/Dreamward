// app/api/wix/bind/route.ts
//
// Phase 10 manual-binding fallback. POST endpoint that lets a
// merchant explicitly link a Wix app install to their FlowWork
// account by pasting the instance ID, when the webhook auto-bind
// path didn't fire.
//
// ─────────────────────────────────────────────────────────────────
// Why this exists:
// ─────────────────────────────────────────────────────────────────
// The intended primary path is the /api/wix/installed webhook
// (Wix POSTs us on app install, we mint a Client Credentials
// token, match email to clients, bind automatically). Empirical
// testing during Phase 10 setup (2026-05-26) showed that Wix's
// App Installed webhook does NOT fire for installs done via
// Share Install Link or Install-on-Site — those install channels
// don't generate dispatch events. The webhook fires for App Market
// installs (which require Wix review submission).
//
// Until we go through App Market submission, the manual-binding
// path is how merchants connect: they install the app on their
// Wix site, then come back to FlowWork and paste the instance ID.
//
// Authentication: requires a FlowWork Pro session (proxy.ts
// matcher). The bind is for the signed-in client only.
//
// Validation:
//   1. instanceId must be present and look like a UUID
//   2. Client Credentials token mint must succeed (implicitly
//      validates the instance exists + our app credentials work)
//   3. site-properties API call must succeed (confirms we have
//      read access to that instance)
//
// Race / conflict handling:
//   - UNIQUE(client_id) → this client already has a Wix site
//     connected. Return 409 with a "disconnect first" message.
//   - UNIQUE(instance_id) → this Wix site is already bound to a
//     different FlowWork account. Return 409 with the appropriate
//     message (defensive — shouldn't happen often).

import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getSessionClient } from "@/lib/getClient";
import { mintAccessToken, wixGet } from "@/lib/wix";

// UUID v4-ish pattern (Wix uses standard 8-4-4-4-12 UUIDs for instance IDs)
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface WixSitePropertiesResponse {
  email?: string | null;
  contact?: { email?: string | null } | null;
  businessContactData?: { email?: string | null } | null;
  businessName?: string | null;
}

export async function POST(req: NextRequest) {
  const client = await getSessionClient();
  if (!client) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (client.plan !== "pro") {
    return NextResponse.json(
      { error: "Wix integration is a Pro feature." },
      { status: 403 }
    );
  }

  // ── Parse + validate the input ──────────────────────────────
  let instanceId: string;
  try {
    const body = (await req.json()) as { instanceId?: unknown };
    if (typeof body.instanceId !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid instanceId in request body" },
        { status: 400 }
      );
    }
    instanceId = body.instanceId.trim().toLowerCase();
    if (!UUID_RE.test(instanceId)) {
      return NextResponse.json(
        {
          error:
            "Instance ID must be a UUID like 12345678-1234-1234-1234-123456789012.",
        },
        { status: 400 }
      );
    }
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 }
    );
  }

  // ── Check for existing bindings before doing any Wix API work ─
  try {
    const existing = await pool.query<{
      client_id: number;
      instance_id: string;
    }>(
      `SELECT client_id, instance_id
         FROM wix_connections
        WHERE client_id = $1 OR instance_id = $2`,
      [client.id, instanceId]
    );

    if (existing.rows.length > 0) {
      const row = existing.rows[0];
      if (row.client_id === client.id && row.instance_id === instanceId) {
        // Already bound to the same client + instance — idempotent success
        return NextResponse.json({ bound: true, alreadyBound: true });
      }
      if (row.client_id === client.id) {
        return NextResponse.json(
          {
            error:
              "You already have a different Wix site connected. Disconnect it first, then add the new one.",
          },
          { status: 409 }
        );
      }
      // instance_id matches a different client_id
      return NextResponse.json(
        {
          error:
            "This Wix site is already connected to a different FlowWork account.",
        },
        { status: 409 }
      );
    }
  } catch (err) {
    console.error("Wix bind: existence check failed:", err);
    return NextResponse.json(
      { error: "Couldn't verify existing connections. Please try again." },
      { status: 500 }
    );
  }

  // ── Verify the instance exists + we have access ─────────────
  // This call does double duty: mintAccessToken fails fast on an
  // invalid instance ID (Wix rejects unknown instances), and the
  // site-properties response gives us the site display name to
  // hydrate the connection row with something user-friendly.
  let siteName: string | null = null;
  try {
    const { accessToken } = await mintAccessToken({ instanceId });
    const props = await wixGet<WixSitePropertiesResponse>({
      accessToken,
      path: "/site-properties/v4/properties",
    });
    siteName = props.businessName ?? null;
  } catch (err) {
    console.warn(
      `Wix bind: validation failed for instance=${instanceId} client=${client.id}:`,
      err
    );
    return NextResponse.json(
      {
        error:
          "Couldn't reach that Wix site. Double-check the instance ID and make sure the app is installed on the site.",
      },
      { status: 400 }
    );
  }

  // ── Insert binding ──────────────────────────────────────────
  try {
    await pool.query(
      `INSERT INTO wix_connections (
         client_id,
         instance_id,
         site_display_name,
         installed_at,
         scopes
       ) VALUES ($1, $2, $3, NOW(), $4)`,
      [client.id, instanceId, siteName, []]
    );
    console.log(
      `Wix bind: manually bound instance=${instanceId} → client_id=${client.id}`
    );
    return NextResponse.json({ bound: true, siteDisplayName: siteName });
  } catch (err) {
    console.error("Wix bind: INSERT failed:", err);
    return NextResponse.json(
      { error: "Couldn't save the connection. Please try again." },
      { status: 500 }
    );
  }
}
