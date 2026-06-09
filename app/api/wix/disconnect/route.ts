// app/api/wix/disconnect/route.ts
//
// Phase 10 Client Credentials rewrite. POST endpoint that disconnects
// the client's Wix site.
//
// Massively simplified vs the OAuth-2.0-redirect version:
//   - No tokens are stored to decrypt + revoke (Client Credentials
//     mints fresh tokens per-request; nothing persistent on our end).
//   - Webhook subscriptions are app-level (not per-instance) in the
//     Client Credentials model; Wix manages them. We have nothing
//     per-merchant to clean up Wix-side at disconnect time. (Future
//     work in 10d: subscribe to additional event categories for
//     real-time sync; same app-level subscription, no per-merchant
//     teardown needed at disconnect.)
//
// Flow:
//   1. Auth + Pro gate.
//   2. clearCachedToken(instanceId) — invalidate the in-process
//      token cache so a future re-connect doesn't serve a stale
//      cached entry from before the row was deleted.
//   3. DELETE the wix_connections row.
//
// IMPORTANT: this DOES NOT delete the historical processed_items
// rows ingested from Wix. Mirroring Shopify decision 4.8 —
// disconnect stops new ingestion + preserves historical data for
// tax reporting. The separate "delete connected data" destructive
// op will land in sub-phase 10e alongside the cron + purge route.

import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getSessionClient } from "@/lib/getClient";
import { clearCachedToken } from "@/lib/wix";
import { isPayingTier } from "@/lib/plans";

interface WixConnectionRow {
  instance_id: string;
}

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
        { error: "Wix integration is a Pro feature." },
        { status: 403 }
      );
    }

    // Load the connection row (single tenant — UNIQUE(client_id)
    // means at most one row). We only need instance_id so we can
    // clear the cache; everything else gets deleted unconditionally.
    const found = await pool.query<WixConnectionRow>(
      `SELECT instance_id
         FROM wix_connections
        WHERE client_id = $1`,
      [client.id]
    );
    if (found.rows.length === 0) {
      return NextResponse.json(
        { error: "No Wix connection to disconnect" },
        { status: 404 }
      );
    }

    // Invalidate cached token so a future re-connect (which may
    // happen seconds later) doesn't serve a stale entry. Safe
    // no-op when nothing's cached.
    clearCachedToken(found.rows[0].instance_id);

    // Delete the connection row. Historical processed_items
    // (source='wix') are intentionally preserved — see header
    // comment + Shopify decision 4.8 mirror.
    await pool.query(
      `DELETE FROM wix_connections WHERE client_id = $1`,
      [client.id]
    );

    return NextResponse.json({ disconnected: true });
  } catch (err) {
    console.error("Wix disconnect error:", err);
    return NextResponse.json(
      { error: "Couldn't disconnect Wix" },
      { status: 500 }
    );
  }
}
