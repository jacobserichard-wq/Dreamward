// app/api/skus/bulk-import-paste/route.ts
//
// Phase 12d commit 5 of 5. Bulk-create SKUs from a parsed
// spreadsheet paste. The client modal does smart column
// detection + preview; this endpoint takes the already-validated
// row array and writes them atomically.
//
// POST /api/skus/bulk-import-paste
//   Body: {
//     rows: Array<{
//       code: string,
//       name: string,
//       cost?: number,         // default 0
//       description?: string,
//       effectiveDate?: string, // YYYY-MM-DD; default today (UTC)
//     }>
//   }
//   Returns: { imported: number, skipped: number, errored: number,
//              results: PerRowResult[] }
//
// Crafty Base's spreadsheet importer is reportedly "highly prone
// to formatting errors, often corrupting existing data." Ours is
// strict INSERT-only (never updates existing SKUs), runs in a
// single transaction with per-row SAVEPOINTs for partial success,
// and returns explicit per-row results so the UI can show
// "47 imported · 3 skipped (code already exists) · 0 errored."
//
// Each SKU row writes to BOTH skus and sku_cost_history (same
// pattern as POST /api/skus single-create). The cost-history row
// gets the supplied effective_date (default today).
//
// Capped at 500 rows per request to keep transactions short and
// give clients a clear "split into batches" affordance for larger
// catalogs (rare for the maker persona).
//
// Pro-gated. Tenant-scoped on every INSERT via the SELECT path.

import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getSessionClient } from "@/lib/getClient";
import { isPayingTier } from "@/lib/plans";

interface BulkRow {
  code?: unknown;
  name?: unknown;
  cost?: unknown;
  description?: unknown;
  effectiveDate?: unknown;
}

interface BulkBody {
  rows?: unknown;
}

interface PerRowResult {
  /** Index in the original request — lets the UI highlight the
   *  exact row that failed. */
  index: number;
  status: "imported" | "skipped" | "errored";
  code: string;
  skuId?: number;
  error?: string;
}

function todayUtcIso(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

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
    if (!isPayingTier(client.plan)) {
      return NextResponse.json(
        { error: "This feature requires an active subscription." },
        { status: 403 }
      );
    }

    const body = (await req.json().catch(() => null)) as BulkBody | null;
    if (!body || !Array.isArray(body.rows)) {
      return NextResponse.json(
        { error: "rows must be an array" },
        { status: 400 }
      );
    }
    if (body.rows.length === 0) {
      return NextResponse.json(
        { error: "rows is empty" },
        { status: 400 }
      );
    }
    if (body.rows.length > 500) {
      return NextResponse.json(
        { error: "Maximum 500 rows per request — split into batches" },
        { status: 400 }
      );
    }

    // ── Pre-validate row shapes (cheap, before opening tx) ─────
    const validatedRows: Array<{
      index: number;
      code: string;
      name: string;
      description: string | null;
      cost: number;
      effectiveDate: string;
    }> = [];
    const results: PerRowResult[] = [];

    body.rows.forEach((rawRow, index) => {
      const r = rawRow as BulkRow;
      if (!isNonEmptyString(r.code)) {
        results.push({
          index,
          status: "errored",
          code: typeof r.code === "string" ? r.code : "",
          error: "code is required",
        });
        return;
      }
      if (r.code.trim().length > 64) {
        results.push({
          index,
          status: "errored",
          code: r.code.trim(),
          error: "code is too long (max 64 chars)",
        });
        return;
      }
      if (!isNonEmptyString(r.name)) {
        results.push({
          index,
          status: "errored",
          code: r.code.trim(),
          error: "name is required",
        });
        return;
      }
      const effectiveDate =
        typeof r.effectiveDate === "string" &&
        /^\d{4}-\d{2}-\d{2}$/.test(r.effectiveDate)
          ? r.effectiveDate
          : todayUtcIso();

      validatedRows.push({
        index,
        code: r.code.trim(),
        name: r.name.trim(),
        description: isNonEmptyString(r.description)
          ? r.description.trim()
          : null,
        cost: parseCost(r.cost),
        effectiveDate,
      });
    });

    // ── Insert loop in one transaction with per-row SAVEPOINTs ──
    let imported = 0;
    let skipped = 0;
    let errored = results.length; // pre-validation failures count as errored

    // Shared id for every row from this import → powers "Undo last import".
    const batchId = `imp_${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 8)}`;

    const dbClient = await pool.connect();
    try {
      await dbClient.query("BEGIN");

      for (const vrow of validatedRows) {
        await dbClient.query("SAVEPOINT row_insert");
        try {
          // Insert the SKU. UNIQUE (client_id, code) throws 23505
          // for duplicates — we map that to status='skipped' so
          // re-running an import after fixing a typo is safe.
          const skuRes = await dbClient.query<{ id: number }>(
            `INSERT INTO skus (client_id, code, name, description, import_batch_id)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id`,
            [client.id, vrow.code, vrow.name, vrow.description, batchId]
          );
          const skuId = skuRes.rows[0].id;

          // Insert the initial cost-history row.
          await dbClient.query(
            `INSERT INTO sku_cost_history
               (sku_id, cost, currency, effective_date)
             VALUES ($1, $2, 'USD', $3)`,
            [skuId, vrow.cost, vrow.effectiveDate]
          );

          await dbClient.query("RELEASE SAVEPOINT row_insert");
          imported++;
          results.push({
            index: vrow.index,
            status: "imported",
            code: vrow.code,
            skuId,
          });
        } catch (rowErr) {
          await dbClient.query("ROLLBACK TO SAVEPOINT row_insert");
          const e = rowErr as { code?: string; message?: string };
          if (e?.code === "23505") {
            skipped++;
            results.push({
              index: vrow.index,
              status: "skipped",
              code: vrow.code,
              error: "SKU code already exists in your catalog",
            });
          } else {
            errored++;
            results.push({
              index: vrow.index,
              status: "errored",
              code: vrow.code,
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

    // Sort results by original index so the UI table lines up.
    results.sort((a, b) => a.index - b.index);

    return NextResponse.json({
      imported,
      skipped,
      errored,
      results,
    });
  } catch (err) {
    console.error("Bulk-import-paste POST error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to bulk import" },
      { status: 500 }
    );
  }
}
