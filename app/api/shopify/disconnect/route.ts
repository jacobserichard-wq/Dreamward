// app/api/shopify/disconnect/route.ts
//
// Phase 8b commit 1 of 3. Companion to GET /api/shopify/connection.
//
// POST endpoint that disconnects the client's Shopify store:
//   1. Loads the connection row (404 if none)
//   2. Decrypts the access token (needed to authenticate Shopify-side
//      webhook deletion)
//   3. Iterates webhook_subscription_ids — DELETEs each subscription
//      via Shopify's API so they stop being delivered. Best-effort:
//      logs failures but doesn't block the disconnect (a webhook on
//      a deleted FlowWork connection is harmless — the receiver
//      would just 404 on its own client_id lookup).
//   4. DELETEs the shopify_connections row
//
// IMPORTANT: this DOES NOT delete the historical processed_items
// rows ingested from Shopify. Per locked decision 4.8, disconnect
// stops new ingestion + preserves historical data for tax reporting.
// The separate "delete connected data" destructive op lives at
// /api/shopify/purge-data and ships in sub-phase 8e.
//
// For Phase 8a/8b: webhook_subscription_ids is always an empty array
// (webhook registration lands in 8d), so the deletion loop is a
// no-op until then. Code is wired now so the iterator just works
// once 8d populates the array.

import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getSessionClient } from "@/lib/getClient";
import { decryptFromDb } from "@/lib/crypto";
import { isPayingTier } from "@/lib/plans";

interface ShopifyConnectionRow {
  shop_domain: string;
  access_token_ciphertext: Buffer;
  access_token_iv: Buffer;
  access_token_auth_tag: Buffer;
  webhook_subscription_ids: string[];
}

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
        {
          error:
            "Shopify integration is a Pro feature.",
        },
        { status: 403 }
      );
    }

    // Load the connection (single tenant — UNIQUE(client_id) means
    // at most one row).
    const found = await pool.query<ShopifyConnectionRow>(
      `SELECT shop_domain,
              access_token_ciphertext,
              access_token_iv,
              access_token_auth_tag,
              webhook_subscription_ids
         FROM shopify_connections
        WHERE client_id = $1`,
      [client.id]
    );
    if (found.rows.length === 0) {
      return NextResponse.json(
        { error: "No Shopify connection to disconnect" },
        { status: 404 }
      );
    }
    const conn = found.rows[0];

    // Best-effort Shopify-side webhook cleanup. Decrypts the token,
    // calls DELETE for each webhook ID. Failures get logged but
    // never block the local disconnect.
    if (conn.webhook_subscription_ids.length > 0) {
      try {
        const accessToken = decryptFromDb({
          ciphertext: conn.access_token_ciphertext,
          iv: conn.access_token_iv,
          authTag: conn.access_token_auth_tag,
        });
        const apiVersion = process.env.SHOPIFY_API_VERSION || "2026-04";
        for (const webhookId of conn.webhook_subscription_ids) {
          try {
            await fetch(
              `https://${conn.shop_domain}/admin/api/${apiVersion}/webhooks/${webhookId}.json`,
              {
                method: "DELETE",
                headers: {
                  "X-Shopify-Access-Token": accessToken,
                  Accept: "application/json",
                },
              }
            );
          } catch (err) {
            console.warn(
              `Shopify webhook ${webhookId} delete failed (best-effort):`,
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
    // (source='shopify') are intentionally preserved — see header
    // comment + design §1 decision 4.8.
    await pool.query(
      `DELETE FROM shopify_connections WHERE client_id = $1`,
      [client.id]
    );

    return NextResponse.json({ disconnected: true });
  } catch (err) {
    console.error("Shopify disconnect error:", err);
    return NextResponse.json(
      { error: "Couldn't disconnect Shopify" },
      { status: 500 }
    );
  }
}
