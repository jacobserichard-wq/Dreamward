// app/api/expenses/[id]/route.ts
//
// Phase 9.3.1 commit 1 of 2. PATCH + DELETE endpoints for an
// individual expense (processed_items row). Companion to the
// list/create endpoints at /api/expenses.
//
// PATCH /api/expenses/[id]
//   Body: { vendor?, amount?, dueDate?, category?, channel?,
//           eventId?, notes? } — any subset
//   Returns: { expense: ExpenseRow } (full updated row)
//
// DELETE /api/expenses/[id]
//   Returns: { deleted: true }
//
// Both tenant-scoped on client_id every query — a forged URL with a
// foreign-client's expense ID returns 404, never 200.

import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getSessionClient } from "@/lib/getClient";
import {
  getCategoriesForIndustry,
  type Industry,
} from "@/lib/categories";
import { CANONICAL_CHANNELS } from "@/lib/profitability/channels";
import { reverseSaleAdjustments } from "@/lib/inventory/adjustments";

const VALID_CHANNEL_IDS = new Set(CANONICAL_CHANNELS.map((c) => c.id));

interface ProcessedItemRow {
  id: number;
  vendor: string | null;
  amount: string;
  due_date: string | null;
  category: string | null;
  source: string | null;
  channel: string | null;
  event_id: number | null;
  status: string | null;
  notes: string | null;
  processed_at: string;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function parseAmount(v: unknown): number | null {
  if (v == null || v === "") return null;
  const s = typeof v === "number" ? String(v) : String(v).replace(/[$,\s]/g, "");
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function serializeRow(row: ProcessedItemRow) {
  return {
    id: row.id,
    vendor: row.vendor,
    amount: Number(row.amount),
    dueDate: row.due_date,
    category: row.category,
    source: row.source,
    channel: row.channel,
    eventId: row.event_id,
    status: row.status,
    notes: row.notes,
    createdAt: row.processed_at,
  };
}

// ---------------------------------------------------------------------
// PATCH — update an existing expense
// ---------------------------------------------------------------------

interface PatchExpenseBody {
  vendor?: unknown;
  amount?: unknown;
  dueDate?: unknown;
  category?: unknown;
  channel?: unknown;
  eventId?: unknown;
  notes?: unknown;
}

export async function PATCH(
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

    const { id: idParam } = await params;
    const id = Number(idParam);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const body = (await req.json().catch(() => null)) as PatchExpenseBody | null;
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    // ── Build dynamic SET clause from the fields provided ──────
    const updates: string[] = [];
    const values: unknown[] = [];
    let p = 1;

    if (body.vendor !== undefined) {
      if (!isNonEmptyString(body.vendor)) {
        return NextResponse.json(
          { error: "Vendor cannot be empty" },
          { status: 400 }
        );
      }
      updates.push(`vendor = $${p++}`);
      values.push(body.vendor.trim());
    }

    if (body.amount !== undefined) {
      const amount = parseAmount(body.amount);
      if (amount == null) {
        return NextResponse.json(
          { error: "Amount must be a positive number" },
          { status: 400 }
        );
      }
      updates.push(`amount = $${p++}`);
      values.push(amount);
    }

    if (body.dueDate !== undefined) {
      if (
        !isNonEmptyString(body.dueDate) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(body.dueDate)
      ) {
        return NextResponse.json(
          { error: "Date must be YYYY-MM-DD" },
          { status: 400 }
        );
      }
      updates.push(`due_date = $${p++}`);
      values.push(body.dueDate);
    }

    if (body.category !== undefined) {
      if (!isNonEmptyString(body.category)) {
        return NextResponse.json(
          { error: "Category cannot be empty" },
          { status: 400 }
        );
      }
      // Server-side guard against accidentally tagging an expense
      // with an income-typed category (same logic as POST).
      const industry = (client.industry ?? "other") as Industry;
      const seeded = new Map<string, "income" | "expense">();
      for (const c of getCategoriesForIndustry(industry)) {
        seeded.set(c.name, c.type);
      }
      if (seeded.get(body.category) === "income") {
        return NextResponse.json(
          {
            error: `"${body.category}" is an income category, not an expense.`,
          },
          { status: 400 }
        );
      }
      updates.push(`category = $${p++}`);
      values.push(body.category);
    }

    if (body.channel !== undefined) {
      if (body.channel === null || body.channel === "") {
        updates.push(`channel = NULL`);
      } else if (
        !isNonEmptyString(body.channel) ||
        !VALID_CHANNEL_IDS.has(body.channel as never)
      ) {
        return NextResponse.json(
          { error: "Invalid channel" },
          { status: 400 }
        );
      } else {
        updates.push(`channel = $${p++}`);
        values.push(body.channel);
      }
    }

    if (body.eventId !== undefined) {
      if (body.eventId === null || body.eventId === "") {
        updates.push(`event_id = NULL`);
      } else {
        const parsed = Number(body.eventId);
        if (!Number.isInteger(parsed) || parsed <= 0) {
          return NextResponse.json(
            { error: "Invalid eventId" },
            { status: 400 }
          );
        }
        const eventCheck = await pool.query<{ id: number }>(
          `SELECT id FROM events WHERE id = $1 AND client_id = $2`,
          [parsed, client.id]
        );
        if (eventCheck.rowCount === 0) {
          return NextResponse.json(
            { error: "Event not found" },
            { status: 400 }
          );
        }
        updates.push(`event_id = $${p++}`);
        values.push(parsed);
      }
    }

    if (body.notes !== undefined) {
      const notes =
        typeof body.notes === "string" ? body.notes.trim() : null;
      if (notes === "" || notes === null) {
        updates.push(`notes = NULL`);
      } else {
        updates.push(`notes = $${p++}`);
        values.push(notes);
      }
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { error: "No fields to update" },
        { status: 400 }
      );
    }

    updates.push(`updated_at = NOW()`);

    // ── Tenant-scoped UPDATE ──────────────────────────────────
    const result = await pool.query<ProcessedItemRow>(
      `UPDATE processed_items
          SET ${updates.join(", ")}
        WHERE id = $${p++} AND client_id = $${p++}
        RETURNING id, vendor, amount, due_date, category, source,
                  channel, event_id, status, notes, processed_at`,
      [...values, id, client.id]
    );

    if (result.rowCount === 0) {
      return NextResponse.json(
        { error: "Expense not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ expense: serializeRow(result.rows[0]) });
  } catch (err) {
    console.error("Expense PATCH error:", err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Failed to update expense",
      },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------
// DELETE — remove an expense
// ---------------------------------------------------------------------

export async function DELETE(
  _req: NextRequest,
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

    const { id: idParam } = await params;
    const id = Number(idParam);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    // Phase 9.4: collect attachment Blob pathnames BEFORE the
    // processed_items DELETE so we can clean up Vercel Blob
    // storage. The expense_attachments rows themselves are
    // removed by the FK CASCADE on processed_item_id, but that
    // only handles the DB side — without explicit del() the
    // Blob bytes would be orphaned + paid-for forever.
    //
    // Best-effort cleanup: Blob delete errors don't block the
    // expense deletion. Worst case we leak some storage; the
    // user got the experience they expected.
    const pathnamesRes = await pool.query<{ blob_pathname: string }>(
      `SELECT ea.blob_pathname
         FROM expense_attachments ea
         JOIN processed_items pi ON pi.id = ea.processed_item_id
        WHERE ea.processed_item_id = $1
          AND pi.client_id = $2`,
      [id, client.id]
    );

    // Restore inventory for any sale line items, then delete — atomically.
    // Without this the FK cascade drops the line items and SET-NULLs the
    // ledger rows, leaving stock permanently drawn.
    const db = await pool.connect();
    let result: { rowCount: number | null };
    try {
      await db.query("BEGIN");
      const liRes = await db.query<{ id: number }>(
        `SELECT id FROM processed_item_line_items
          WHERE processed_item_id = $1 AND client_id = $2`,
        [id, client.id]
      );
      const lineItemIds = liRes.rows.map((r) => r.id);
      if (lineItemIds.length > 0) {
        await reverseSaleAdjustments({ dbClient: db, lineItemIds });
      }
      const del = await db.query(
        `DELETE FROM processed_items
          WHERE id = $1 AND client_id = $2`,
        [id, client.id]
      );
      if ((del.rowCount ?? 0) === 0) {
        await db.query("ROLLBACK");
        return NextResponse.json(
          { error: "Expense not found" },
          { status: 404 }
        );
      }
      await db.query("COMMIT");
      result = { rowCount: del.rowCount };
    } catch (txErr) {
      await db.query("ROLLBACK").catch(() => {});
      throw txErr;
    } finally {
      db.release();
    }
    void result;

    // Fire blob deletions in parallel after the DB delete
    // succeeded. Errors are logged but don't fail the request.
    if (pathnamesRes.rowCount && pathnamesRes.rowCount > 0) {
      const { deleteAttachment } = await import("@/lib/blob");
      await Promise.allSettled(
        pathnamesRes.rows.map((r) => deleteAttachment(r.blob_pathname))
      ).then((settled) => {
        for (const r of settled) {
          if (r.status === "rejected") {
            console.warn(
              "Expense DELETE: blob cleanup failed (storage may leak):",
              r.reason
            );
          }
        }
      });
    }

    return NextResponse.json({ deleted: true });
  } catch (err) {
    console.error("Expense DELETE error:", err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Failed to delete expense",
      },
      { status: 500 }
    );
  }
}
