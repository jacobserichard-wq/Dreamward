// app/api/etsy/purge-data/route.ts
//
// Etsy integration commit 6. Destructive POST endpoint that
// hard-deletes every processed_items row with source='etsy' for the
// signed-in client. Mirrors /api/square/purge-data — see
// /api/wix/purge-data for the original design rationale.
//
// Line items cascade with the parent rows (0018 ON DELETE CASCADE).
// KNOWN GAP shared with the Square/Wix purges: inventory
// sale-adjustment ledger rows survive with source_line_item_id
// nulled (0020 ON DELETE SET NULL), so stock stays decremented by
// the purged sales. Merchants can fix counts with a recount on the
// inventory page. A cross-platform inventory-aware purge is queued
// as follow-up work — fixing it for Etsy alone would just make the
// platforms inconsistent.
//
// Separate from /api/etsy/disconnect by design — disconnect
// preserves historical data; purge removes it.

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

    const result = await pool.query(
      `DELETE FROM processed_items
        WHERE client_id = $1 AND source = 'etsy'`,
      [client.id]
    );

    const deleted = result.rowCount ?? 0;
    console.log(
      `Etsy purge: deleted ${deleted} processed_items for client_id=${client.id}`
    );

    return NextResponse.json({ deleted });
  } catch (err) {
    console.error("Etsy purge error:", err);
    return NextResponse.json(
      { error: "Couldn't delete Etsy data. Please try again." },
      { status: 500 }
    );
  }
}
