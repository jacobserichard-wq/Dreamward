// app/api/wix/connection/route.ts
//
// Phase 10b. GET endpoint returning the current Wix connection
// state for the signed-in client. Drives the /integrations page's
// WixConnectionCard.
//
// Returns:
//   { connected: false } when no connection exists
//   { connected: true, instanceId, siteDisplayName, ... } otherwise
//
// Pro-gated (matches every other /api/wix/* route + the Shopify
// pattern from Phase 8b).
//
// Explicit column list — encrypted token blobs NEVER leave the
// server. Surfacing them would defeat the AES-256-GCM encryption.

import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getSessionClient } from "@/lib/getClient";

interface WixConnectionRow {
  instance_id: string;
  site_display_name: string | null;
  scopes: string[];
  connected_at: string;
  last_sync_at: string | null;
  last_sync_status: string | null;
  last_sync_error: string | null;
  webhook_subscription_ids: string[];
  backfill_started_at: string | null;
  backfill_completed_at: string | null;
  backfill_total_orders: number | null;
  backfill_orders_imported: number;
  access_token_expires_at: string | null;
}

export async function GET() {
  try {
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
            "Wix integration is a Pro feature. Upgrade your plan to connect a site.",
        },
        { status: 403 }
      );
    }

    const result = await pool.query<WixConnectionRow>(
      `SELECT instance_id,
              site_display_name,
              scopes,
              connected_at,
              last_sync_at,
              last_sync_status,
              last_sync_error,
              webhook_subscription_ids,
              backfill_started_at,
              backfill_completed_at,
              backfill_total_orders,
              backfill_orders_imported,
              access_token_expires_at
         FROM wix_connections
        WHERE client_id = $1`,
      [client.id]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ connected: false });
    }

    const row = result.rows[0];
    return NextResponse.json({
      connected: true,
      instanceId: row.instance_id,
      siteDisplayName: row.site_display_name,
      scopes: row.scopes,
      connectedAt: row.connected_at,
      lastSyncAt: row.last_sync_at,
      lastSyncStatus: row.last_sync_status,
      lastSyncError: row.last_sync_error,
      webhookCount: row.webhook_subscription_ids.length,
      // Surface token expiry so the UI can show "needs reconnect"
      // when the refresh token chain breaks (rare; happens if Wix
      // revokes the app on the merchant's site).
      accessTokenExpiresAt: row.access_token_expires_at,
      backfill: {
        startedAt: row.backfill_started_at,
        completedAt: row.backfill_completed_at,
        totalOrders: row.backfill_total_orders,
        ordersImported: row.backfill_orders_imported,
      },
    });
  } catch (err) {
    console.error("Wix connection GET error:", err);
    return NextResponse.json(
      { error: "Couldn't load Wix connection state" },
      { status: 500 }
    );
  }
}
