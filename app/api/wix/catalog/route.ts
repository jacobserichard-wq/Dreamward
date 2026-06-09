// app/api/wix/catalog/route.ts
//
// Phase 12e commit 1. GET endpoint that returns the connected
// Wix site's full product catalog (flattened to one row per
// variant) for the bulk-import UI.
//
// GET /api/wix/catalog
//   Returns: { rows: WixCatalogVariation[] }
//
// Session-authenticated + Pro-gated. Wix uses Client Credentials —
// access token is minted fresh per request via mintAccessToken,
// no decrypt dance.

import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getSessionClient } from "@/lib/getClient";
import { listCatalog, mintAccessToken } from "@/lib/wix";
import { isPayingTier } from "@/lib/plans";

interface WixConnRow {
  instance_id: string;
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

    const connRes = await pool.query<WixConnRow>(
      `SELECT instance_id
         FROM wix_connections
        WHERE client_id = $1`,
      [client.id]
    );
    if (connRes.rowCount === 0) {
      return NextResponse.json(
        { error: "No Wix connection. Connect a site first." },
        { status: 404 }
      );
    }

    const { accessToken } = await mintAccessToken({
      instanceId: connRes.rows[0].instance_id,
    });
    const rows = await listCatalog({ accessToken });

    return NextResponse.json({ rows });
  } catch (err) {
    console.error("Wix catalog GET error:", err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Failed to load catalog",
      },
      { status: 502 }
    );
  }
}
