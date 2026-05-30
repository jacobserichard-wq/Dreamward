// app/api/skus/[id]/resolve-by-name/route.ts
//
// Phase 12d commit 3 of 5. Resolves Square POS "Custom Amount"
// line items (external_item_id IS NULL) to a FlowWork SKU by
// direct UPDATE on processed_item_line_items where the display
// name matches.
//
// POST /api/skus/[id]/resolve-by-name
//   Body: { platform, name }
//   Returns: { resolvedCount }
//
// Why this is a separate endpoint from POST /api/sku-aliases:
//
//   The standard alias path requires a non-null external_id
//   (it's part of UNIQUE (platform, external_id) on sku_aliases).
//   Square "Custom Amount" ring-ups come in with no catalog
//   reference at all — there's no stable external id to alias
//   off of. Mapping them requires updating the line items
//   directly by name.
//
// Limitation that we accept for v1:
//
//   This resolve covers HISTORICAL line items only. Future Square
//   Custom Amount sales with the same name will land in
//   /skus/unmatched again — no auto-resolution. A future
//   enhancement (Phase 12g polish) could add name-based fallback
//   lookup in bulkInsertLineItemsForParent so re-encountering the
//   same name auto-resolves at write time.
//
//   Crafty Base context: their tool doesn't handle this case AT
//   ALL — Square Custom Amount sales just sit there throwing off
//   stock numbers. Even our limited v1 (resolve historical, not
//   future) puts us miles ahead.
//
// Pro-gated. Tenant-scoped on every clause.

import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getSessionClient } from "@/lib/getClient";

const VALID_PLATFORMS = new Set(["shopify", "wix", "square"]);

interface ResolveBody {
  platform?: unknown;
  name?: unknown;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
        { error: "SKU catalog is a Pro feature." },
        { status: 403 }
      );
    }

    const { id: idParam } = await params;
    const skuId = Number(idParam);
    if (!Number.isInteger(skuId) || skuId <= 0) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const body = (await req.json().catch(() => null)) as ResolveBody | null;
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    if (!isNonEmptyString(body.platform) || !VALID_PLATFORMS.has(body.platform)) {
      return NextResponse.json(
        { error: "platform must be shopify, wix, or square" },
        { status: 400 }
      );
    }
    if (!isNonEmptyString(body.name)) {
      return NextResponse.json(
        { error: "name is required" },
        { status: 400 }
      );
    }

    // ── Verify SKU ownership, then UPDATE matching line items ──
    //
    // The UPDATE's WHERE clause includes EXISTS (SELECT 1 FROM skus)
    // so a forged sku_id can't bind matched_sku_id to another
    // tenant's catalog. matched_sku_id IS NULL ensures we don't
    // overwrite an existing manual mapping.
    const result = await pool.query<{ id: number }>(
      `UPDATE processed_item_line_items
          SET matched_sku_id = $1
        WHERE client_id = $2
          AND platform = $3
          AND external_item_id IS NULL
          AND name = $4
          AND matched_sku_id IS NULL
          AND EXISTS (
            SELECT 1 FROM skus s
             WHERE s.id = $1 AND s.client_id = $2
          )
        RETURNING id`,
      [skuId, client.id, body.platform, body.name.trim()]
    );

    // If the SKU doesn't belong to this client, the EXISTS clause
    // prevents any updates AND no rows are returned. Distinguish
    // "SKU not found" from "nothing matched" so the UI can warn.
    if (result.rowCount === 0) {
      const ownsRes = await pool.query<{ id: number }>(
        `SELECT id FROM skus WHERE id = $1 AND client_id = $2`,
        [skuId, client.id]
      );
      if (ownsRes.rowCount === 0) {
        return NextResponse.json(
          { error: "SKU not found" },
          { status: 404 }
        );
      }
    }

    return NextResponse.json({ resolvedCount: result.rowCount ?? 0 });
  } catch (err) {
    console.error("Resolve-by-name POST error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to resolve" },
      { status: 500 }
    );
  }
}
