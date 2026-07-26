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
import { getShopifyAccessToken } from "@/lib/shopifyToken";
import { listCatalog } from "@/lib/shopify";
import { isPayingTier } from "@/lib/plans";

interface ShopifyConnRow {
  id: number;
  shop_domain: string;
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
    if (!isPayingTier(client.plan)) {
      return NextResponse.json(
        { error: "SKU catalog import is a Pro feature." },
        { status: 403 }
      );
    }

    const connRes = await pool.query<ShopifyConnRow>(
      `SELECT id, shop_domain
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

    const accessToken = await getShopifyAccessToken(conn.id);

    const variations = await listCatalog({
      shopDomain: conn.shop_domain,
      accessToken,
    });

    // The bulk-import page (and /api/skus/bulk-import-catalog) expect
    // externalId — same boundary rename the Square catalog route does.
    // Without it row.externalId is undefined and every Import errors
    // "externalId is required" (found 2026-07-26, first real Shopify
    // bulk import ever attempted). externalId = the variant id, which
    // is also what order line items carry as variant_id, so aliases
    // created from these rows match Shopify sales.
    const rows = variations.map((v) => ({
      externalId: v.variantId,
      productId: v.productId,
      displayName: v.displayName,
      sku: v.sku,
      cost: v.cost,
      currency: v.currency,
    }));

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
