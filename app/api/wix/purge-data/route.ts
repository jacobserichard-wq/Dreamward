// app/api/wix/purge-data/route.ts
//
// Phase 10e. Destructive POST endpoint that deletes all
// processed_items rows imported from Wix for the signed-in client.
//
// ─────────────────────────────────────────────────────────────────
// Why this is separate from /api/wix/disconnect:
// ─────────────────────────────────────────────────────────────────
// Disconnect = "stop syncing new orders, but keep my historical
// reports intact" (locked decision 4.8 mirroring Shopify Phase 8b).
//
// Purge = "I want the Wix-imported orders GONE from my FlowWork
// reports too". Different intent, different UX, separate destructive
// op. Surfaced as a second button in the card (under Disconnect)
// with a stronger ConfirmModal warning.
//
// Returns the deleted row count so the UI can show "Deleted N
// orders from Wix" confirmation.
//
// Idempotent — running twice just returns 0 the second time. Safe
// to re-call.
//
// Pro-gated + session-authenticated (proxy.ts matcher). Anyone who
// can hit this endpoint can already disconnect their connection,
// so no additional auth complexity — but the destructive nature
// merits explicit Pro+session checks even though they're redundant
// with the matcher.

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
        { error: "Wix integration is a Pro feature." },
        { status: 403 }
      );
    }

    // Single-statement delete — no need to load anything first.
    // The DB's foreign-key constraints (if any) would error if a
    // row was referenced elsewhere; processed_items has no FK in
    // our schema so this is a clean cascade-free delete.
    const result = await pool.query(
      `DELETE FROM processed_items
        WHERE client_id = $1 AND source = 'wix'`,
      [client.id]
    );

    const deleted = result.rowCount ?? 0;
    console.log(
      `Wix purge: deleted ${deleted} processed_items for client_id=${client.id}`
    );

    return NextResponse.json({ deleted });
  } catch (err) {
    console.error("Wix purge error:", err);
    return NextResponse.json(
      { error: "Couldn't delete Wix data. Please try again." },
      { status: 500 }
    );
  }
}
