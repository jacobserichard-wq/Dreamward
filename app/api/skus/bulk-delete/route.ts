// app/api/skus/bulk-delete/route.ts
//
// POST /api/skus/bulk-delete  { ids: number[] }   (or { batchId: string })
//
// Bulk removal for the SKUs tab — clean up a bad bulk import in one shot.
// For each SKU (scoped to the caller's client): if it has NO history
// (no matched sales, not used in a recipe, no production runs) it's
// HARD-deleted; if it has history it's ARCHIVED (active=false) instead,
// so a mistakenly-imported SKU that already has sales isn't destroyed.
//
// Pass `ids` (from the list's multi-select) or `batchId` ("undo last
// import" — every row stamped with that import_batch_id). All in one
// transaction. Returns { deleted, archived }.

import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getSessionClient } from "@/lib/getClient";
import { isPayingTier } from "@/lib/plans";

export async function POST(req: NextRequest) {
  try {
    const client = await getSessionClient();
    if (!client) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    if (!isPayingTier(client.plan)) {
      return NextResponse.json(
        { error: "SKU management is a Pro feature." },
        { status: 403 }
      );
    }

    const body = (await req.json().catch(() => null)) as {
      ids?: unknown;
      batchId?: unknown;
    } | null;
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const ids = Array.isArray(body.ids)
      ? body.ids.filter((x): x is number => Number.isInteger(x) && x > 0)
      : [];
    const batchId =
      typeof body.batchId === "string" && body.batchId.trim()
        ? body.batchId.trim()
        : null;
    if (ids.length === 0 && !batchId) {
      return NextResponse.json(
        { error: "Provide ids[] or a batchId" },
        { status: 400 }
      );
    }

    const db = await pool.connect();
    try {
      await db.query("BEGIN");

      // Resolve the target SKUs (tenant-scoped) + whether each has history.
      const targets = await db.query<{ id: number; has_history: boolean }>(
        `SELECT s.id,
                (EXISTS (SELECT 1 FROM processed_item_line_items
                          WHERE matched_sku_id = s.id)
                 OR EXISTS (SELECT 1 FROM bom_components
                             WHERE component_sku_id = s.id)
                 OR EXISTS (SELECT 1 FROM production_runs
                             WHERE finished_sku_id = s.id)) AS has_history
           FROM skus s
          WHERE s.client_id = $1
            AND (
              ($2::int[] IS NOT NULL AND s.id = ANY($2::int[]))
              OR ($3::text IS NOT NULL AND s.import_batch_id = $3)
            )`,
        [client.id, ids.length > 0 ? ids : null, batchId]
      );

      const cleanIds = targets.rows.filter((r) => !r.has_history).map((r) => r.id);
      const historyIds = targets.rows.filter((r) => r.has_history).map((r) => r.id);

      let deleted = 0;
      let archived = 0;
      if (cleanIds.length > 0) {
        const del = await db.query(
          `DELETE FROM skus WHERE client_id = $1 AND id = ANY($2::int[])`,
          [client.id, cleanIds]
        );
        deleted = del.rowCount ?? 0;
      }
      if (historyIds.length > 0) {
        const arch = await db.query(
          `UPDATE skus SET active = false, updated_at = NOW()
            WHERE client_id = $1 AND id = ANY($2::int[]) AND active = true`,
          [client.id, historyIds]
        );
        archived = arch.rowCount ?? 0;
      }

      await db.query("COMMIT");
      return NextResponse.json({
        deleted,
        archived,
        archivedIds: historyIds,
      });
    } catch (txErr) {
      await db.query("ROLLBACK").catch(() => {});
      throw txErr;
    } finally {
      db.release();
    }
  } catch (err) {
    console.error("Bulk-delete SKUs error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to delete SKUs" },
      { status: 500 }
    );
  }
}
