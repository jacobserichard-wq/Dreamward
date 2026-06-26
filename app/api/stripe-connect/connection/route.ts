// app/api/stripe-connect/connection/route.ts
//
// GET the current Stripe Connect (sales channel) connection state for the
// signed-in client. Drives StripeConnectionCard on /integrations. Mirrors
// /api/square/connection. Encrypted token never leaves the server — only
// metadata + sync state.

import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getSessionClient } from "@/lib/getClient";
import { isPayingTier } from "@/lib/plans";

interface StripeConnectionRow {
  stripe_account_id: string;
  business_name: string | null;
  livemode: boolean;
  connected_at: string;
  last_sync_at: string | null;
  last_sync_status: string | null;
  last_sync_error: string | null;
  webhook_event_types: string[];
  backfill_started_at: string | null;
  backfill_completed_at: string | null;
  backfill_charges_imported: number;
}

export async function GET() {
  try {
    const client = await getSessionClient();
    if (!client) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    if (!isPayingTier(client.plan)) {
      return NextResponse.json(
        { error: "Stripe integration is a Pro feature." },
        { status: 403 }
      );
    }

    const result = await pool.query<StripeConnectionRow>(
      `SELECT stripe_account_id, business_name, livemode,
              connected_at, last_sync_at, last_sync_status, last_sync_error,
              webhook_event_types,
              backfill_started_at, backfill_completed_at, backfill_charges_imported
         FROM stripe_connections
        WHERE client_id = $1`,
      [client.id]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ connected: false });
    }

    const row = result.rows[0];
    return NextResponse.json({
      connected: true,
      accountId: row.stripe_account_id,
      businessName: row.business_name,
      livemode: row.livemode,
      connectedAt: row.connected_at,
      lastSyncAt: row.last_sync_at,
      lastSyncStatus: row.last_sync_status,
      lastSyncError: row.last_sync_error,
      liveSyncActive: row.webhook_event_types.length > 0,
      backfill: {
        startedAt: row.backfill_started_at,
        completedAt: row.backfill_completed_at,
        chargesImported: row.backfill_charges_imported,
      },
    });
  } catch (err) {
    console.error("Stripe connection GET error:", err);
    return NextResponse.json(
      { error: "Couldn't load Stripe connection state" },
      { status: 500 }
    );
  }
}
