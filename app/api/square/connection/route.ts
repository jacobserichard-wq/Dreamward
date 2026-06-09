// app/api/square/connection/route.ts
//
// Phase 11a commit 5. GET endpoint returning the current Square
// connection state for the signed-in client. Drives the
// /integrations page's SquareConnectionCard (Phase 11b).
//
// Returns:
//   { connected: false } when no row exists
//   { connected: true, merchantId, businessName, environment, ... }
//
// Pro-gated. Encrypted token blobs never leave the server — only
// metadata + sync state is surfaced.

import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getSessionClient } from "@/lib/getClient";
import { isPayingTier } from "@/lib/plans";

interface SquareConnectionRow {
  merchant_id: string;
  business_name: string | null;
  scopes: string[];
  connected_at: string;
  last_sync_at: string | null;
  last_sync_status: string | null;
  last_sync_error: string | null;
  webhook_subscription_ids: string[];
  backfill_started_at: string | null;
  backfill_completed_at: string | null;
  backfill_payments_imported: number;
  access_token_expires_at: string;
  environment: string;
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
    if (!isPayingTier(client.plan)) {
      return NextResponse.json(
        {
          error:
            "Square integration is a Pro feature. Upgrade your plan to connect.",
        },
        { status: 403 }
      );
    }

    const result = await pool.query<SquareConnectionRow>(
      `SELECT merchant_id,
              business_name,
              scopes,
              connected_at,
              last_sync_at,
              last_sync_status,
              last_sync_error,
              webhook_subscription_ids,
              backfill_started_at,
              backfill_completed_at,
              backfill_payments_imported,
              access_token_expires_at,
              environment
         FROM square_connections
        WHERE client_id = $1`,
      [client.id]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ connected: false });
    }

    const row = result.rows[0];
    return NextResponse.json({
      connected: true,
      merchantId: row.merchant_id,
      businessName: row.business_name,
      environment: row.environment,
      scopes: row.scopes,
      connectedAt: row.connected_at,
      lastSyncAt: row.last_sync_at,
      lastSyncStatus: row.last_sync_status,
      lastSyncError: row.last_sync_error,
      webhookCount: row.webhook_subscription_ids.length,
      // Surface token expiry so the UI can warn when the refresh
      // chain is about to break (90-day refresh-token window).
      accessTokenExpiresAt: row.access_token_expires_at,
      backfill: {
        startedAt: row.backfill_started_at,
        completedAt: row.backfill_completed_at,
        paymentsImported: row.backfill_payments_imported,
      },
    });
  } catch (err) {
    console.error("Square connection GET error:", err);
    return NextResponse.json(
      { error: "Couldn't load Square connection state" },
      { status: 500 }
    );
  }
}
