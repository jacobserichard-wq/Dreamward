// app/api/etsy/connection/route.ts
//
// Etsy integration commit 3. Connection state for the /integrations
// card. Same contract as the Shopify/Square/Wix siblings:
//
//   { connected: false }
//   { connected: true, shopId, shopName, connectedAt, backfillDone }

import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getSessionClient } from "@/lib/getClient";
import { isPayingTier } from "@/lib/plans";

interface ConnectionRowDb {
  shop_id: string;
  shop_name: string | null;
  backfill_done: boolean;
  created_at: string;
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
        { error: "This feature requires an active subscription." },
        { status: 403 }
      );
    }

    const res = await pool.query<ConnectionRowDb>(
      `SELECT shop_id, shop_name, backfill_done, created_at
         FROM etsy_connections
        WHERE client_id = $1`,
      [client.id]
    );
    if (res.rowCount === 0) {
      return NextResponse.json({ connected: false });
    }
    const row = res.rows[0];
    return NextResponse.json({
      connected: true,
      shopId: row.shop_id,
      shopName: row.shop_name,
      connectedAt: row.created_at,
      backfillDone: row.backfill_done,
    });
  } catch (err) {
    console.error("Etsy connection GET error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load" },
      { status: 500 }
    );
  }
}
