// app/api/etsy/disconnect/route.ts
//
// Etsy integration commit 3. Removes the stored connection (and
// with it the encrypted tokens). Etsy v3 has no server-side token
// revocation endpoint — the seller can additionally revoke
// FlowWork's grant under Etsy account settings → Privacy → Apps;
// the disconnect copy in the UI mentions this. Imported
// processed_items / line items remain (historical data is the
// merchant's, same policy as the other platforms).
//
// POST /api/etsy/disconnect → { disconnected: boolean }

import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getSessionClient } from "@/lib/getClient";
import { isPayingTier } from "@/lib/plans";

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
        { error: "This feature requires an active subscription." },
        { status: 403 }
      );
    }

    const res = await pool.query(
      `DELETE FROM etsy_connections WHERE client_id = $1 RETURNING id`,
      [client.id]
    );
    return NextResponse.json({ disconnected: (res.rowCount ?? 0) > 0 });
  } catch (err) {
    console.error("Etsy disconnect error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to disconnect" },
      { status: 500 }
    );
  }
}
