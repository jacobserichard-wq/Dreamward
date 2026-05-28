// app/api/square/purge-data/route.ts
//
// Phase 11e. Destructive POST endpoint that hard-deletes every
// processed_items row with source='square' for the signed-in
// client. Mirrors /api/wix/purge-data — see that route's header
// for the design rationale.
//
// Separate from /api/square/disconnect by design — disconnect
// preserves historical data; purge removes it.

import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getSessionClient } from "@/lib/getClient";

export async function POST() {
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
        { error: "Square integration is a Pro feature." },
        { status: 403 }
      );
    }

    const result = await pool.query(
      `DELETE FROM processed_items
        WHERE client_id = $1 AND source = 'square'`,
      [client.id]
    );

    const deleted = result.rowCount ?? 0;
    console.log(
      `Square purge: deleted ${deleted} processed_items for client_id=${client.id}`
    );

    return NextResponse.json({ deleted });
  } catch (err) {
    console.error("Square purge error:", err);
    return NextResponse.json(
      { error: "Couldn't delete Square data. Please try again." },
      { status: 500 }
    );
  }
}
