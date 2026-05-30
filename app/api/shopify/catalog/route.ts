// app/api/shopify/catalog/route.ts
//
// Phase 12e commit 1. GET endpoint that returns the connected
// Shopify shop's full product catalog (flattened to one row per
// variant) for the bulk-import UI.
//
// GET /api/shopify/catalog
//   Returns: { rows: ShopifyCatalogVariation[] }
//
// Session-authenticated + Pro-gated. Shopify access tokens don't
// expire (unlike Square's 30-day), so no refresh logic needed —
// straight decrypt + call.

import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getSessionClient } from "@/lib/getClient";
import { decryptFromDb } from "@/lib/crypto";
import { listCatalog } from "@/lib/shopify";

interface ShopifyConnRow {
  shop_domain: string;
  access_token_ciphertext: Buffer;
  access_token_iv: Buffer;
  access_token_auth_tag: Buffer;
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
    if (client.plan !== "pro") {
      return NextResponse.json(
        { error: "SKU catalog import is a Pro feature." },
        { status: 403 }
      );
    }

    const connRes = await pool.query<ShopifyConnRow>(
      `SELECT shop_domain,
              access_token_ciphertext, access_token_iv, access_token_auth_tag
         FROM shopify_connections
        WHERE client_id = $1`,
      [client.id]
    );
    if (connRes.rowCount === 0) {
      return NextResponse.json(
        { error: "No Shopify connection. Connect a store first." },
        { status: 404 }
      );
    }
    const conn = connRes.rows[0];

    const accessToken = decryptFromDb({
      ciphertext: conn.access_token_ciphertext,
      iv: conn.access_token_iv,
      authTag: conn.access_token_auth_tag,
    });

    const rows = await listCatalog({
      shopDomain: conn.shop_domain,
      accessToken,
    });

    return NextResponse.json({ rows });
  } catch (err) {
    console.error("Shopify catalog GET error:", err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Failed to load catalog",
      },
      { status: 502 }
    );
  }
}
