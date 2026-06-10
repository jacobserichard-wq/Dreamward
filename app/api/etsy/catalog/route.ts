// app/api/etsy/catalog/route.ts
//
// Etsy integration commit 6. GET endpoint that returns the
// connected shop's active listings (flattened to one row per
// listing) for the /skus/bulk-import UI. Same contract as the
// Shopify/Wix/Square catalog siblings: { rows: CatalogRow[] }.
//
// Etsy specifics:
//   - One row PER LISTING, not per variation. Receipt transactions
//     carry listing_id as the alias key (see mapTransactionsToLineItems
//     in lib/etsy.ts), so a listing's variations all resolve to the
//     same FlowWork SKU. The first variation SKU is surfaced as the
//     suggested code.
//   - cost is always null — Etsy's API exposes the retail price,
//     never the merchant's cost. The bulk-import preview lets the
//     merchant fill costs in (same situation as Wix).
//   - Token refresh inline via ensureFreshToken (1-hour access
//     tokens) with the rotated pair persisted immediately, same as
//     the backfill route.

import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getSessionClient } from "@/lib/getClient";
import { decryptFromDb, encryptForDb } from "@/lib/crypto";
import { ensureFreshToken, fetchListingsPage } from "@/lib/etsy";
import { isPayingTier } from "@/lib/plans";

// fetchListingsPage requests 100 per page; a short page ends the
// loop. The page cap is a runaway guard for enormous shops — if it
// trips, the response says so instead of silently truncating.
const LISTINGS_PAGE_SIZE = 100;
const MAX_PAGES = 50;

interface ConnectionRow {
  id: number;
  shop_id: string;
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
        { error: "This feature requires an active subscription." },
        { status: 403 }
      );
    }

    const connRes = await pool.query<ConnectionRow>(
      `SELECT id, shop_id,
              access_token_ciphertext, access_token_iv, access_token_auth_tag,
              access_token_expires_at,
              refresh_token_ciphertext, refresh_token_iv, refresh_token_auth_tag
         FROM etsy_connections
        WHERE client_id = $1`,
      [client.id]
    );
    if (connRes.rowCount === 0) {
      return NextResponse.json(
        { error: "No Etsy connection. Connect your shop first." },
        { status: 404 }
      );
    }
    const conn = connRes.rows[0];

    // ── Fresh access token (refresh + persist rotated pair) ──────
    const fresh = await ensureFreshToken({
      accessToken: decryptFromDb({
        ciphertext: conn.access_token_ciphertext,
        iv: conn.access_token_iv,
        authTag: conn.access_token_auth_tag,
      }),
      refreshToken: decryptFromDb({
        ciphertext: conn.refresh_token_ciphertext,
        iv: conn.refresh_token_iv,
        authTag: conn.refresh_token_auth_tag,
      }),
      expiresAt: new Date(conn.access_token_expires_at),
    });
    const accessToken = fresh.accessToken;
    if (fresh.rotated) {
      const a = encryptForDb(fresh.rotated.access_token);
      const r = encryptForDb(fresh.rotated.refresh_token);
      await pool.query(
        `UPDATE etsy_connections
            SET access_token_ciphertext = $1, access_token_iv = $2,
                access_token_auth_tag = $3,
                access_token_expires_at = NOW() + ($4 || ' seconds')::interval,
                refresh_token_ciphertext = $5, refresh_token_iv = $6,
                refresh_token_auth_tag = $7,
                refresh_token_obtained_at = NOW(),
                updated_at = NOW()
          WHERE id = $8`,
        [
          a.ciphertext,
          a.iv,
          a.authTag,
          String(fresh.rotated.expires_in),
          r.ciphertext,
          r.iv,
          r.authTag,
          conn.id,
        ]
      );
    }

    // ── Pull every active listing, page by page ──────────────────
    const listings = [];
    let offset = 0;
    let pages = 0;
    let truncated = false;
    for (;;) {
      const page = await fetchListingsPage({
        accessToken,
        shopId: conn.shop_id,
        offset,
      });
      listings.push(...page.listings);
      offset += page.listings.length;
      pages++;
      if (page.listings.length < LISTINGS_PAGE_SIZE) break;
      if (pages >= MAX_PAGES) {
        truncated = true;
        break;
      }
    }

    const rows = listings.map((l) => ({
      externalId: String(l.listing_id),
      displayName: l.title,
      sku: l.skus && l.skus.length > 0 ? l.skus[0] : null,
      cost: null,
      currency: l.price?.currency_code ?? null,
    }));

    return NextResponse.json({
      rows,
      ...(truncated
        ? {
            warning: `Showing your first ${rows.length.toLocaleString()} active listings — your shop has more. Email hello@flowworks.it.com and we'll raise the limit for you.`,
          }
        : {}),
    });
  } catch (err) {
    console.error("Etsy catalog GET error:", err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Failed to load catalog",
      },
      { status: 502 }
    );
  }
}
