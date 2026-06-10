// app/api/etsy/purge-data/route.ts
//
// Etsy integration commit 6. Destructive POST endpoint that
// hard-deletes every processed_items row with source='etsy' for the
// signed-in client. Mirrors /api/square/purge-data — see
// /api/wix/purge-data for the original design rationale.
//
// Inventory-aware via lib/purgePlatformData: line items cascade
// with the parent rows (0018 ON DELETE CASCADE), and their sale
// adjustments are reversed first so stock credits back — the
// SET NULL gap that originally shipped here is closed for all
// platforms by the shared helper.
//
// Separate from /api/etsy/disconnect by design — disconnect
// preserves historical data; purge removes it.

import { NextResponse } from "next/server";
import { getSessionClient } from "@/lib/getClient";
import { isPayingTier } from "@/lib/plans";
import { purgePlatformData } from "@/lib/purgePlatformData";

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

    const { deleted, adjustmentsReversed } = await purgePlatformData({
      clientId: client.id,
      source: "etsy",
    });
    console.log(
      `Etsy purge: deleted ${deleted} processed_items, reversed ` +
        `${adjustmentsReversed} stock adjustments for client_id=${client.id}`
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
