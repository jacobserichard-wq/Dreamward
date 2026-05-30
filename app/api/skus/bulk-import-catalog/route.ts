// app/api/skus/bulk-import-catalog/route.ts
//
// Phase 12e commit 1. POST endpoint that takes a user-curated
// list of catalog rows (the merchant edited the codes/costs in
// the preview) and writes them as new FlowWork SKUs + initial
// sku_cost_history rows + sku_aliases (with retroactive resolve).
//
// POST /api/skus/bulk-import-catalog
//   Body: {
//     platform: 'shopify' | 'wix' | 'square',
//     effectiveDate: 'YYYY-MM-DD',
//     rows: Array<{
//       externalId: string,    // platform-side alias key
//       code: string,          // FlowWork SKU code
//       name: string,
//       cost?: number,         // default 0
//       externalSku?: string,  // platform-side SKU code (display only)
//     }>
//   }
//   Returns: { imported, skipped, errored, totalResolved, results: PerRowResult[] }
//
// The totalResolved field is the sum of resolvedCount across every
// alias created — i.e., how many existing processed_item_line_items
// rows got matched_sku_id filled in retroactively. The UI surfaces
// it in the success message ("Imported 47 SKUs, mapped 312
// historical sales").
//
// Each row is processed inside its own SAVEPOINT so partial failure
// is fine. Three insert steps per row:
//   1. INSERT into skus  (skip on duplicate code via 23505)
//   2. INSERT into sku_cost_history
//   3. INSERT into sku_aliases via createAliasWithResolve (also
//      runs the retroactive matched_sku_id UPDATE in the same
//      transaction)
//
// Pro-gated. Tenant-scoped throughout.

import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getSessionClient } from "@/lib/getClient";
import {
  createAliasWithResolve,
  type AliasPlatform,
} from "@/lib/cogs/aliases";

interface CatalogRow {
  externalId?: unknown;
  code?: unknown;
  name?: unknown;
  cost?: unknown;
  externalSku?: unknown;
}

interface BulkBody {
  platform?: unknown;
  effectiveDate?: unknown;
  rows?: unknown;
}

interface PerRowResult {
  index: number;
  externalId: string;
  code: string;
  status: "imported" | "skipped" | "errored";
  skuId?: number;
  resolvedCount?: number;
  error?: string;
}

const VALID_PLATFORMS = new Set(["shopify", "wix", "square"]);

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function parseCost(v: unknown): number {
  if (v == null || v === "") return 0;
  const s =
    typeof v === "number" ? String(v) : String(v).replace(/[$,\s]/g, "");
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
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
    if (client.plan !== "pro") {
      return NextResponse.json(
        { error: "SKU catalog is a Pro feature." },
        { status: 403 }
      );
    }

    const body = (await req.json().catch(() => null)) as BulkBody | null;
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    if (!isNonEmptyString(body.platform) || !VALID_PLATFORMS.has(body.platform)) {
      return NextResponse.json(
        { error: "platform must be shopify, wix, or square" },
        { status: 400 }
      );
    }
    if (
      !isNonEmptyString(body.effectiveDate) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(body.effectiveDate)
    ) {
      return NextResponse.json(
        { error: "effectiveDate must be YYYY-MM-DD" },
        { status: 400 }
      );
    }
    if (!Array.isArray(body.rows) || body.rows.length === 0) {
      return NextResponse.json(
        { error: "rows must be a non-empty array" },
        { status: 400 }
      );
    }
    if (body.rows.length > 500) {
      return NextResponse.json(
        { error: "Maximum 500 rows per request — split into batches" },
        { status: 400 }
      );
    }

    const platform = body.platform as AliasPlatform;
    const effectiveDate = body.effectiveDate;

    // Pre-validate row shapes (cheap, before any DB work).
    interface ValidatedRow {
      index: number;
      externalId: string;
      code: string;
      name: string;
      cost: number;
      externalSku: string | null;
    }
    const validated: ValidatedRow[] = [];
    const results: PerRowResult[] = [];
    body.rows.forEach((rawRow, index) => {
      const r = rawRow as CatalogRow;
      if (!isNonEmptyString(r.externalId)) {
        results.push({
          index,
          externalId: "",
          code: isNonEmptyString(r.code) ? r.code : "",
          status: "errored",
          error: "externalId is required",
        });
        return;
      }
      if (!isNonEmptyString(r.code)) {
        results.push({
          index,
          externalId: r.externalId,
          code: "",
          status: "errored",
          error: "code is required",
        });
        return;
      }
      if (r.code.trim().length > 64) {
        results.push({
          index,
          externalId: r.externalId,
          code: r.code.trim(),
          status: "errored",
          error: "code is too long (max 64 chars)",
        });
        return;
      }
      if (!isNonEmptyString(r.name)) {
        results.push({
          index,
          externalId: r.externalId,
          code: r.code.trim(),
          status: "errored",
          error: "name is required",
        });
        return;
      }
      validated.push({
        index,
        externalId: r.externalId.trim(),
        code: r.code.trim(),
        name: r.name.trim(),
        cost: parseCost(r.cost),
        externalSku: isNonEmptyString(r.externalSku) ? r.externalSku.trim() : null,
      });
    });

    let imported = 0;
    let skipped = 0;
    let errored = results.length;
    let totalResolved = 0;

    const dbClient = await pool.connect();
    try {
      await dbClient.query("BEGIN");

      for (const v of validated) {
        await dbClient.query("SAVEPOINT row_insert");
        try {
          // 1. Insert the SKU
          const skuRes = await dbClient.query<{ id: number }>(
            `INSERT INTO skus (client_id, code, name)
             VALUES ($1, $2, $3)
             RETURNING id`,
            [client.id, v.code, v.name]
          );
          const skuId = skuRes.rows[0].id;

          // 2. Initial cost row
          await dbClient.query(
            `INSERT INTO sku_cost_history (sku_id, cost, currency, effective_date)
             VALUES ($1, $2, 'USD', $3)`,
            [skuId, v.cost, effectiveDate]
          );

          // 3. Alias + retroactive resolve (using the shared helper)
          // Note: createAliasWithResolve does its own SQL on the
          // shared pool by default, but here we pass dbClient so it
          // joins the same transaction — otherwise rolling back this
          // SAVEPOINT wouldn't undo the alias.
          const aliasResult = await createAliasWithResolve({
            dbClient,
            clientId: client.id,
            alias: {
              skuId,
              platform,
              externalId: v.externalId,
              externalSku: v.externalSku,
            },
          });

          await dbClient.query("RELEASE SAVEPOINT row_insert");
          imported++;
          totalResolved += aliasResult.resolvedCount;
          results.push({
            index: v.index,
            externalId: v.externalId,
            code: v.code,
            status: "imported",
            skuId,
            resolvedCount: aliasResult.resolvedCount,
          });
        } catch (rowErr) {
          await dbClient.query("ROLLBACK TO SAVEPOINT row_insert");
          const e = rowErr as { code?: string; message?: string };
          if (e?.code === "23505") {
            // Could be UNIQUE on skus(client_id, code) OR
            // UNIQUE on sku_aliases(platform, external_id).
            // Either way → skipped with a friendly hint.
            skipped++;
            results.push({
              index: v.index,
              externalId: v.externalId,
              code: v.code,
              status: "skipped",
              error:
                "Already exists in your catalog (either the code or the platform mapping). Unmap or rename first.",
            });
          } else {
            errored++;
            results.push({
              index: v.index,
              externalId: v.externalId,
              code: v.code,
              status: "errored",
              error: e?.message ?? "unknown",
            });
          }
        }
      }

      await dbClient.query("COMMIT");
    } catch (txErr) {
      await dbClient.query("ROLLBACK").catch(() => {});
      throw txErr;
    } finally {
      dbClient.release();
    }

    results.sort((a, b) => a.index - b.index);

    return NextResponse.json({
      imported,
      skipped,
      errored,
      totalResolved,
      results,
    });
  } catch (err) {
    console.error("Bulk-import-catalog POST error:", err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Failed to bulk import",
      },
      { status: 500 }
    );
  }
}
