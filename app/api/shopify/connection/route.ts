// app/api/shopify/connection/route.ts
//
// Phase 8b commit 1 of 3 (of sub-phase 8b; commit 6 of Phase 8 overall).
//
// GET endpoint returning the current Shopify connection state for the
// signed-in client. Drives the /integrations page's connection card
// + the disconnect/upgrade UI.
//
// Returns:
//   { connected: false } when no connection exists
//   { connected: true, shopDomain, connectedAt, ...sync state... } otherwise
//
// Pro-gated (matches every other /api/shopify/* route).
//
// Why a separate endpoint vs piggy-backing on /api/client: the client
// info endpoint is hit on every page mount; the Shopify state is only
// relevant to /integrations. Splitting keeps the per-page payload
// small + lets us cache/invalidate independently in future.

import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getSessionClient } from "@/lib/getClient";

interface ShopifyConnectionRow {
  shop_domain: string;
  scopes: string[];
  connected_at: string;
  last_sync_at: string | null;
  last_sync_status: string | null;
  last_sync_error: string | null;
  backfill_started_at: string | null;
  backfill_completed_at: string | null;
  backfill_total_orders: number | null;
  backfill_orders_imported: number;
  backfill_capped_at_30k: boolean;
  backfill_extended_paid_at: string | null;
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
            "Shopify integration is a Pro feature. Upgrade your plan to connect a store.",
        },
        { status: 403 }
      );
    }

    // Explicit column list — no access_token_* fields. The encrypted
    // token never leaves the server; surfacing it here would defeat
    // the encryption.
    const result = await pool.query<ShopifyConnectionRow>(
      `SELECT shop_domain,
              scopes,
              connected_at,
              last_sync_at,
              last_sync_status,
              last_sync_error,
              backfill_started_at,
              backfill_completed_at,
              backfill_total_orders,
              backfill_orders_imported,
              backfill_capped_at_30k,
              backfill_extended_paid_at
         FROM shopify_connections
        WHERE client_id = $1`,
      [client.id]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ connected: false });
    }

    const row = result.rows[0];
    return NextResponse.json({
      connected: true,
      shopDomain: row.shop_domain,
      scopes: row.scopes,
      connectedAt: row.connected_at,
      lastSyncAt: row.last_sync_at,
      lastSyncStatus: row.last_sync_status,
      lastSyncError: row.last_sync_error,
      backfill: {
        startedAt: row.backfill_started_at,
        completedAt: row.backfill_completed_at,
        totalOrders: row.backfill_total_orders,
        ordersImported: row.backfill_orders_imported,
        cappedAt30k: row.backfill_capped_at_30k,
        extendedPaidAt: row.backfill_extended_paid_at,
      },
    });
  } catch (err) {
    console.error("Shopify connection GET error:", err);
    return NextResponse.json(
      { error: "Couldn't load Shopify connection state" },
      { status: 500 }
    );
  }
}
