// lib/shopifyToken.ts
//
// One door to a usable Shopify Admin API token (2026-07-21, expiring
// offline tokens mandate). Every route that used to decrypt
// access_token_* straight off shopify_connections now calls
// getShopifyAccessToken(connectionId) instead, which:
//
//   1. Locks the row (SELECT ... FOR UPDATE) so concurrent callers —
//      backfill chunk + catalog pull, say — serialize instead of
//      double-refreshing. The loser of the race re-reads the row the
//      winner just updated and skips its own refresh.
//   2. Returns the stored access token if it has >2 min of life left
//      (or if the row predates migration 0047 — expires_at NULL means
//      a legacy non-expiring token; nothing to refresh, return as-is
//      and let the API accept/reject it).
//   3. Otherwise redeems the refresh token, persists the new pair
//      (encrypted, same AES-GCM columns pattern as Square), and
//      returns the fresh access token.
//
// A dead refresh token (>90 days idle, or invalidated) surfaces as a
// thrown error — callers already funnel Shopify failures into
// last_sync_error / UI banners, and the fix is a merchant reconnect.

import pool from "@/lib/db";
import { decryptFromDb, encryptForDb } from "@/lib/crypto";
import { refreshOfflineToken } from "@/lib/shopify";

const REFRESH_SKEW_MS = 2 * 60 * 1000;

interface TokenRow {
  shop_domain: string;
  access_token_ciphertext: Buffer;
  access_token_iv: Buffer;
  access_token_auth_tag: Buffer;
  access_token_expires_at: string | null;
  refresh_token_ciphertext: Buffer | null;
  refresh_token_iv: Buffer | null;
  refresh_token_auth_tag: Buffer | null;
}

export async function getShopifyAccessToken(
  connectionId: number
): Promise<string> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query<TokenRow>(
      `SELECT shop_domain,
              access_token_ciphertext, access_token_iv, access_token_auth_tag,
              access_token_expires_at,
              refresh_token_ciphertext, refresh_token_iv, refresh_token_auth_tag
         FROM shopify_connections
        WHERE id = $1
          FOR UPDATE`,
      [connectionId]
    );
    if (rows.length === 0) {
      throw new Error(`Shopify connection ${connectionId} not found`);
    }
    const row = rows[0];
    const accessToken = decryptFromDb({
      ciphertext: row.access_token_ciphertext,
      iv: row.access_token_iv,
      authTag: row.access_token_auth_tag,
    });

    const expiresAtMs = row.access_token_expires_at
      ? new Date(row.access_token_expires_at).getTime()
      : null;
    const stillFresh =
      expiresAtMs === null || expiresAtMs - Date.now() > REFRESH_SKEW_MS;
    if (stillFresh) {
      await client.query("COMMIT");
      return accessToken;
    }

    if (!row.refresh_token_ciphertext || !row.refresh_token_iv || !row.refresh_token_auth_tag) {
      throw new Error(
        `Shopify token for ${row.shop_domain} is expired and no refresh token is stored — reconnect required`
      );
    }
    const refreshToken = decryptFromDb({
      ciphertext: row.refresh_token_ciphertext,
      iv: row.refresh_token_iv,
      authTag: row.refresh_token_auth_tag,
    });
    const refreshed = await refreshOfflineToken({
      shopDomain: row.shop_domain,
      refreshToken,
    });

    const newAccess = encryptForDb(refreshed.accessToken);
    // Shopify always returns a new refresh token on refresh; guard
    // anyway so a missing one keeps the previous (still-replayable)
    // token instead of nulling the columns.
    const newRefresh = refreshed.refreshToken
      ? encryptForDb(refreshed.refreshToken)
      : null;
    await client.query(
      `UPDATE shopify_connections
          SET access_token_ciphertext = $1,
              access_token_iv = $2,
              access_token_auth_tag = $3,
              access_token_expires_at = $4,
              refresh_token_ciphertext = COALESCE($5, refresh_token_ciphertext),
              refresh_token_iv = COALESCE($6, refresh_token_iv),
              refresh_token_auth_tag = COALESCE($7, refresh_token_auth_tag),
              refresh_token_expires_at = COALESCE($8, refresh_token_expires_at),
              updated_at = NOW()
        WHERE id = $9`,
      [
        newAccess.ciphertext,
        newAccess.iv,
        newAccess.authTag,
        refreshed.accessTokenExpiresAt,
        newRefresh?.ciphertext ?? null,
        newRefresh?.iv ?? null,
        newRefresh?.authTag ?? null,
        refreshed.refreshTokenExpiresAt,
        connectionId,
      ]
    );
    await client.query("COMMIT");
    return refreshed.accessToken;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
