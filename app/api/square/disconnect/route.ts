// app/api/square/disconnect/route.ts
//
// Phase 11a commit 5 (bundled with connection). POST endpoint that
// disconnects the client's Square account.
//
// Flow:
//   1. Load the connection row (404 if none)
//   2. Decrypt the access token, call Square's /oauth2/revoke so
//      the token stops being valid Square-side (defense in depth —
//      even if our DB leaks tokens, they'd already be revoked).
//      Best-effort: a revoke failure doesn't block local disconnect.
//   3. DELETE the square_connections row
//
// IMPORTANT: does NOT delete the historical processed_items rows
// ingested from Square. Same decision as Shopify Phase 8b and Wix
// Phase 10e — disconnect stops new syncs but preserves history.
// The "delete connected data" destructive op will land in 11e as
// /api/square/purge-data (mirror of /api/wix/purge-data).

import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getSessionClient } from "@/lib/getClient";
import { decryptFromDb } from "@/lib/crypto";
import { revokeAccessToken } from "@/lib/square";

interface SquareConnectionRow {
  access_token_ciphertext: Buffer;
  access_token_iv: Buffer;
  access_token_auth_tag: Buffer;
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
    if (client.plan !== "pro") {
      return NextResponse.json(
        { error: "Square integration is a Pro feature." },
        { status: 403 }
      );
    }

    const found = await pool.query<SquareConnectionRow>(
      `SELECT access_token_ciphertext,
              access_token_iv,
              access_token_auth_tag
         FROM square_connections
        WHERE client_id = $1`,
      [client.id]
    );
    if (found.rows.length === 0) {
      return NextResponse.json(
        { error: "No Square connection to disconnect" },
        { status: 404 }
      );
    }

    // Best-effort Square-side token revoke. Decrypt the token,
    // call /oauth2/revoke. Logged but non-blocking on failure.
    try {
      const accessToken = decryptFromDb({
        ciphertext: found.rows[0].access_token_ciphertext,
        iv: found.rows[0].access_token_iv,
        authTag: found.rows[0].access_token_auth_tag,
      });
      await revokeAccessToken({ accessToken });
    } catch (err) {
      console.warn(
        "Square disconnect: revoke failed (proceeding with local delete):",
        err
      );
    }

    // Delete the connection row. Historical processed_items
    // (source='square') intentionally preserved.
    await pool.query(
      `DELETE FROM square_connections WHERE client_id = $1`,
      [client.id]
    );

    return NextResponse.json({ disconnected: true });
  } catch (err) {
    console.error("Square disconnect error:", err);
    return NextResponse.json(
      { error: "Couldn't disconnect Square" },
      { status: 500 }
    );
  }
}
