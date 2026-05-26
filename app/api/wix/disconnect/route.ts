// app/api/wix/disconnect/route.ts
//
// Phase 10b. Companion to GET /api/wix/connection. Mirrors the Shopify
// disconnect endpoint from Phase 8b — same flow, different provider.
//
// POST endpoint that disconnects the client's Wix site:
//   1. Loads the connection row (404 if none)
//   2. Decrypts the access token (needed to authenticate Wix-side
//      webhook deletion)
//   3. Iterates webhook_subscription_ids — DELETEs each subscription
//      via Wix's API so they stop being delivered. Best-effort:
//      logs failures but doesn't block the disconnect (a Wix webhook
//      delivered after disconnect is harmless — the receiver would
//      404 on its own client_id lookup).
//   4. DELETEs the wix_connections row
//
// IMPORTANT: this DOES NOT delete the historical processed_items rows
// ingested from Wix. Mirroring locked Shopify decision 4.8 — disconnect
// stops new ingestion + preserves historical data for tax reporting.
// The separate "delete connected data" destructive op will land in
// sub-phase 10e alongside the cron + purge route.
//
// For Phase 10a/10b: webhook_subscription_ids is always an empty array
// (webhook registration lands in 10d), so the deletion loop is a no-op
// until then. Code is wired now so the iterator just works once 10d
// populates the array.
//
// ⚠️ TODO during 10d implementation — verify the Wix webhook DELETE
// endpoint path. Currently assuming `/webhooks/v1/webhooks/{id}` per
// the Wix Headless API pattern, but this needs confirmation when we
// build the subscription registration in 10d.

import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getSessionClient } from "@/lib/getClient";
import { decryptFromDb } from "@/lib/crypto";

interface WixConnectionRow {
  instance_id: string;
  access_token_ciphertext: Buffer;
  access_token_iv: Buffer;
  access_token_auth_tag: Buffer;
  webhook_subscription_ids: string[];
}

const WIX_API_BASE = "https://www.wixapis.com";

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

    // Load the connection (single tenant — UNIQUE(client_id) means
    // at most one row).
    const found = await pool.query<WixConnectionRow>(
      `SELECT instance_id,
              access_token_ciphertext,
              access_token_iv,
              access_token_auth_tag,
              webhook_subscription_ids
         FROM wix_connections
        WHERE client_id = $1`,
      [client.id]
    );
    if (found.rows.length === 0) {
      return NextResponse.json(
        { error: "No Wix connection to disconnect" },
        { status: 404 }
      );
    }
    const conn = found.rows[0];

    // Best-effort Wix-side webhook cleanup. Decrypt the token, call
    // DELETE for each webhook ID. Failures get logged but never block
    // the local disconnect.
    if (conn.webhook_subscription_ids.length > 0) {
      try {
        const accessToken = decryptFromDb({
          ciphertext: conn.access_token_ciphertext,
          iv: conn.access_token_iv,
          authTag: conn.access_token_auth_tag,
        });
        for (const webhookId of conn.webhook_subscription_ids) {
          try {
            // ⚠️ TODO 10d: verify endpoint path. See file header.
            await fetch(
              `${WIX_API_BASE}/webhooks/v1/webhooks/${webhookId}`,
              {
                method: "DELETE",
                headers: {
                  Authorization: accessToken,
                  Accept: "application/json",
                },
              }
            );
          } catch (err) {
            console.warn(
              `Wix webhook ${webhookId} delete failed (best-effort):`,
              err
            );
          }
        }
      } catch (err) {
        console.warn(
          "Decrypting token for webhook cleanup failed — proceeding with disconnect anyway:",
          err
        );
      }
    }

    // Delete the connection row. Historical processed_items
    // (source='wix') are intentionally preserved — see header
    // comment + Shopify decision 4.8 mirror.
    await pool.query(
      `DELETE FROM wix_connections WHERE client_id = $1`,
      [client.id]
    );

    return NextResponse.json({ disconnected: true });
  } catch (err) {
    console.error("Wix disconnect error:", err);
    return NextResponse.json(
      { error: "Couldn't disconnect Wix" },
      { status: 500 }
    );
  }
}
