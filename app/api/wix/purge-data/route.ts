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
        { error: "Wix integration is a Pro feature." },
        { status: 403 }
      );
    }

    // Inventory-aware purge (lib/purgePlatformData): reverses the
    // sale adjustments under the doomed rows so stock credits back,
    // then deletes — all in one transaction.
    const { deleted, adjustmentsReversed } = await purgePlatformData({
      clientId: client.id,
      source: "wix",
    });
    console.log(
      `Wix purge: deleted ${deleted} processed_items, reversed ` +
        `${adjustmentsReversed} stock adjustments for client_id=${client.id}`
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
