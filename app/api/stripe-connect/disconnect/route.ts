// app/api/stripe-connect/disconnect/route.ts
//
// Disconnect the client's Stripe Connect account: revoke our OAuth access
// (deauthorize) and remove the local connection. Already-ingested income
// stays (historical reports shouldn't change); this just stops future
// sync. Mirrors the Square disconnect route.

import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getSessionClient } from "@/lib/getClient";
import { deauthorizeConnect } from "@/lib/stripeConnect";

export async function POST() {
  try {
    const client = await getSessionClient();
    if (!client) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const conn = await pool.query<{ stripe_account_id: string }>(
      "SELECT stripe_account_id FROM stripe_connections WHERE client_id = $1",
      [client.id]
    );
    if (conn.rowCount === 0) {
      return NextResponse.json({ ok: true }); // nothing connected — no-op
    }

    // Revoke at Stripe first (best-effort — if it's already gone there, we
    // still want to clear the local row).
    try {
      await deauthorizeConnect(conn.rows[0].stripe_account_id);
    } catch (err) {
      console.error(
        "Stripe deauthorize failed (removing local connection anyway):",
        err
      );
    }

    await pool.query("DELETE FROM stripe_connections WHERE client_id = $1", [
      client.id,
    ]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Stripe Connect disconnect error:", err);
    return NextResponse.json(
      { error: "Failed to disconnect Stripe" },
      { status: 500 }
    );
  }
}
