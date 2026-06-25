// app/api/square/catalog/route.ts
//
// Phase 12e commit 1. GET endpoint that returns the connected
// Square merchant's full catalog (flattened to one row per
// variation) for the bulk-import UI.
//
// GET /api/square/catalog
//   Returns: { rows: SquareCatalogVariation[] }
//
// Session-authenticated + Pro-gated. Handles token refresh
// inline (same pattern as the backfill route) since catalog
// pulls can run anytime, not just during a fresh backfill.

import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getSessionClient } from "@/lib/getClient";
import { decryptFromDb, encryptForDb } from "@/lib/crypto";
import { listCatalog, refreshAccessToken } from "@/lib/square";
import { isPayingTier } from "@/lib/plans";

const TOKEN_REFRESH_THRESHOLD_MS = 60 * 60 * 1000; // 1h headroom

interface SquareConnRow {
  id: number;
  access_token_ciphertext: Buffer;
  access_token_iv: Buffer;
  access_token_auth_tag: Buffer;
  access_token_expires_at: string;
  refresh_token_ciphertext: Buffer;
  refresh_token_iv: Buffer;
  refresh_token_auth_tag: Buffer;
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

    const connRes = await pool.query<SquareConnRow>(
      `SELECT id,
              access_token_ciphertext, access_token_iv, access_token_auth_tag,
              access_token_expires_at,
              refresh_token_ciphertext, refresh_token_iv, refresh_token_auth_tag
         FROM square_connections
        WHERE client_id = $1`,
      [client.id]
    );
    if (connRes.rowCount === 0) {
      return NextResponse.json(
        { error: "No Square connection. Connect an account first." },
        { status: 404 }
      );
    }
    const conn = connRes.rows[0];

    // Decrypt + pre-emptive refresh if within threshold
    let accessToken = decryptFromDb({
      ciphertext: conn.access_token_ciphertext,
      iv: conn.access_token_iv,
      authTag: conn.access_token_auth_tag,
    });
    const refreshToken = decryptFromDb({
      ciphertext: conn.refresh_token_ciphertext,
      iv: conn.refresh_token_iv,
      authTag: conn.refresh_token_auth_tag,
    });

    const expiresAtMs = new Date(conn.access_token_expires_at).getTime();
    if (expiresAtMs - Date.now() < TOKEN_REFRESH_THRESHOLD_MS) {
      const refreshed = await refreshAccessToken({ refreshToken });
      accessToken = refreshed.access_token;
      const newAccessBlob = encryptForDb(refreshed.access_token);
      const newRefreshBlob = encryptForDb(refreshed.refresh_token);
      await pool.query(
        `UPDATE square_connections
            SET access_token_ciphertext = $1, access_token_iv = $2, access_token_auth_tag = $3,
                access_token_expires_at = $4,
                refresh_token_ciphertext = $5, refresh_token_iv = $6, refresh_token_auth_tag = $7,
                updated_at = NOW()
          WHERE id = $8`,
        [
          newAccessBlob.ciphertext,
          newAccessBlob.iv,
          newAccessBlob.authTag,
          refreshed.expires_at,
          newRefreshBlob.ciphertext,
          newRefreshBlob.iv,
          newRefreshBlob.authTag,
          conn.id,
        ]
      );
    }

    const variations = await listCatalog({ accessToken });

    // Map to the bulk-import client's CatalogRow shape. listCatalog returns
    // variationId/itemId, but the client (and the Shopify/Wix/Etsy routes)
    // expect externalId/productId — without this rename row.externalId is
    // undefined and the preview crashes on `id.length`. externalId =
    // variationId is also the right alias key: Square line items reference
    // the variation via catalog_object_id (= this id), so future orders
    // auto-match.
    const rows = variations.map((v) => ({
      externalId: v.variationId,
      productId: v.itemId,
      displayName: v.displayName,
      sku: v.sku,
      cost: v.cost,
      currency: v.currency,
    }));

    return NextResponse.json({ rows });
  } catch (err) {
    console.error("Square catalog GET error:", err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Failed to load catalog",
      },
      { status: 502 }
    );
  }
}
