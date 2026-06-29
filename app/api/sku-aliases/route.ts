// app/api/sku-aliases/route.ts
//
// Phase 12d commit 1 of 5. The manual mapping endpoint that powers
// the bulk-match UX on /skus/unmatched.
//
// POST /api/sku-aliases
//   Body: { skuId, platform, externalId, externalSku? }
//   Returns: { alias: AliasRow, resolvedCount: number }
//
//   The resolvedCount field is the magic moment for users — it's
//   how many historical line items just got their COGS lit up by
//   creating this mapping. The unmatched UI puts it in the success
//   toast: "Mapped 47 historical sales."
//
//   Crafty Base equivalent: nonexistent. Their users have to re-
//   import or manually adjust historical sales when they fix a
//   mapping. Our auto-resolve runs in the same transaction.
//
// DELETE /api/sku-aliases/[id] lives in its own file (Phase 12d
// commit 3) for the "unmap" path on /skus/[id].
//
// All endpoints Pro-gated, tenant-scoped on every query.

import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getSessionClient } from "@/lib/getClient";
import {
  createAliasWithResolve,
  type AliasPlatform,
} from "@/lib/cogs/aliases";
import { isPayingTier } from "@/lib/plans";

const VALID_PLATFORMS: AliasPlatform[] = ["shopify", "wix", "square"];

interface CreateAliasBody {
  skuId?: unknown;
  platform?: unknown;
  externalId?: unknown;
  externalSku?: unknown;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

export async function POST(req: NextRequest) {
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

    const body = (await req.json().catch(() => null)) as CreateAliasBody | null;
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    // ── Validate inputs ─────────────────────────────────────────
    const skuId = Number(body.skuId);
    if (!Number.isInteger(skuId) || skuId <= 0) {
      return NextResponse.json(
        { error: "skuId must be a positive integer" },
        { status: 400 }
      );
    }
    if (
      !isNonEmptyString(body.platform) ||
      !VALID_PLATFORMS.includes(body.platform as AliasPlatform)
    ) {
      return NextResponse.json(
        { error: `platform must be one of: ${VALID_PLATFORMS.join(", ")}` },
        { status: 400 }
      );
    }
    if (!isNonEmptyString(body.externalId)) {
      return NextResponse.json(
        { error: "externalId is required" },
        { status: 400 }
      );
    }
    const externalSku =
      typeof body.externalSku === "string" && body.externalSku.trim().length > 0
        ? body.externalSku.trim()
        : null;

    // ── Create + resolve in one transaction ────────────────────
    // createAliasWithResolve does an alias INSERT, a retroactive
    // matched_sku_id UPDATE, then N recordSaleAdjustments (ledger +
    // stock + FIFO). On the bare pool those auto-commit independently —
    // a mid-backfill crash leaves the alias created but stock/COGS only
    // partially applied. Own the transaction here so it's all-or-nothing.
    try {
      const db = await pool.connect();
      try {
        await db.query("BEGIN");
        const result = await createAliasWithResolve({
          dbClient: db,
          clientId: client.id,
          alias: {
            skuId,
            platform: body.platform as AliasPlatform,
            externalId: body.externalId.trim(),
            externalSku,
          },
        });
        await db.query("COMMIT");

        return NextResponse.json({
          alias: {
            id: result.aliasId,
            skuId,
            platform: body.platform,
            externalId: body.externalId.trim(),
            externalSku,
          },
          resolvedCount: result.resolvedCount,
        });
      } catch (txErr) {
        await db.query("ROLLBACK").catch(() => {});
        throw txErr;
      } finally {
        db.release();
      }
    } catch (err) {
      const e = err as { code?: string; message?: string };
      // SKU not found / wrong tenant
      if (e?.code === "SKU_NOT_FOUND") {
        return NextResponse.json(
          { error: "SKU not found" },
          { status: 404 }
        );
      }
      // Duplicate alias for (platform, external_id) — friendly 409
      if (e?.code === "23505") {
        return NextResponse.json(
          {
            error: `This ${body.platform} item is already mapped to another SKU. Unmap it first or pick a different external id.`,
          },
          { status: 409 }
        );
      }
      throw err;
    }
  } catch (err) {
    console.error("SKU alias POST error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create alias" },
      { status: 500 }
    );
  }
}
