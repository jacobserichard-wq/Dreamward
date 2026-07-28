// app/api/items/bulk-status/route.ts
//
// PATCH /api/items/bulk-status
// Body: { ids: number[], status: "pending" | "paid" | "overdue" | "needs_review" }
//
// Bulk companion to the single-item status PATCH on /api/items (which is
// untouched — the per-card toggles still use it). Powers "Approve all" on
// the Transactions review queue: one UPDATE ... id = ANY($ids) instead of
// a round-trip per card. Status changes have no side effects (the single-
// item path is a plain UPDATE too), so a batch is semantically identical
// to clicking each card's status button.

import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getSessionClient } from "@/lib/getClient";

const VALID_STATUSES = new Set(["pending", "paid", "overdue", "needs_review"]);

// Generous ceiling — the review queue is tens of rows, not thousands. Caps
// the ANY() array so a runaway caller can't ship a megabyte of ids.
const MAX_BATCH = 500;

export async function PATCH(request: NextRequest) {
  try {
    const client = await getSessionClient();
    if (!client) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await request.json().catch(() => null);
    const ids = body?.ids;
    const status = body?.status;

    if (
      !Array.isArray(ids) ||
      ids.length === 0 ||
      !ids.every((id) => Number.isInteger(id) && id > 0)
    ) {
      return NextResponse.json(
        { error: "ids must be a non-empty array of item ids" },
        { status: 400 }
      );
    }
    if (ids.length > MAX_BATCH) {
      return NextResponse.json(
        { error: `Too many ids (max ${MAX_BATCH} per request)` },
        { status: 400 }
      );
    }
    if (typeof status !== "string" || !VALID_STATUSES.has(status)) {
      return NextResponse.json({ error: "Invalid status" }, { status: 400 });
    }

    // Tenant scoping lives in the WHERE, not in id pre-validation — ids
    // belonging to another client (or already deleted) simply don't match,
    // and the response reflects what actually changed.
    const result = await pool.query<{ id: number }>(
      `UPDATE processed_items
          SET status = $1, updated_at = NOW()
        WHERE client_id = $2 AND id = ANY($3)
        RETURNING id`,
      [status, client.id, ids]
    );

    return NextResponse.json({
      updated: result.rowCount ?? 0,
      ids: result.rows.map((r) => r.id),
    });
  } catch (error) {
    console.error("Error bulk-updating item status:", error);
    return NextResponse.json(
      { error: "Failed to update items" },
      { status: 500 }
    );
  }
}
