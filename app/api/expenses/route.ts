// app/api/expenses/route.ts
//
// Phase 9.3 commits 3 + 4 of ~8. GET + POST endpoints for the new
// /expenses page. Typed view onto processed_items filtered to
// expense-kind rows with channel-aware filters.
//
// GET /api/expenses
//   Query params:
//     ?channel=<id>       — filter to one channel (markets, shopify, etc.)
//     ?event_id=<num>     — filter to a specific event
//     ?from=YYYY-MM-DD    — inclusive lower bound on due_date
//     ?to=YYYY-MM-DD      — inclusive upper bound on due_date
//     ?limit=<num>        — default 100, max 500
//     ?offset=<num>       — default 0
//   Returns:
//     { expenses: ExpenseRow[], summary: { totalAmount, count } }
//
// POST /api/expenses
//   Body: {
//     vendor: string,           — required
//     amount: number,           — required, > 0
//     dueDate: YYYY-MM-DD,      — required
//     category: string,         — required, must be an expense-type
//                                 category for the user's industry
//     channel?: ChannelId,      — optional; if set, must be a known channel
//     eventId?: number,         — optional; if set, must belong to this client
//     notes?: string,           — optional
//   }
//   Returns: { expense: ExpenseRow }
//
// Plan gating: all signed-in plans (trial/starter/growth/pro). Expense
// tracking is the most basic Dreamward capability — no upsell needed.

import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getSessionClient } from "@/lib/getClient";
import {
  getCategoriesForIndustry,
  type Industry,
} from "@/lib/categories";
import { CANONICAL_CHANNELS } from "@/lib/profitability/channels";
import { receiveExpenseIntoInventory } from "@/lib/inventory/receiveFromExpense";

const VALID_CHANNEL_IDS = new Set(CANONICAL_CHANNELS.map((c) => c.id));

interface ProcessedItemRow {
  id: number;
  vendor: string | null;
  amount: string; // pg NUMERIC → string
  due_date: string | null;
  category: string | null;
  source: string | null;
  channel: string | null;
  event_id: number | null;
  status: string | null;
  notes: string | null;
  // Real column name in processed_items is `processed_at` (the table
  // predates the migration folder; it doesn't have a `created_at`).
  // We map this to createdAt in the API response for nicer JS naming
  // but the SQL ref is processed_at.
  processed_at: string;
}

// ---------------------------------------------------------------------
// GET — list expenses
// ---------------------------------------------------------------------

export async function GET(req: NextRequest) {
  try {
    const client = await getSessionClient();
    if (!client) {
      return NextResponse.json(
        { error: "Not authenticated" },
        { status: 401 }
      );
    }

    // ── Parse + validate filters ────────────────────────────────
    const params = req.nextUrl.searchParams;
    const channel = params.get("channel");
    const eventIdParam = params.get("event_id");
    const from = params.get("from");
    const to = params.get("to");
    const limit = Math.min(
      Math.max(Number(params.get("limit") ?? 100), 1),
      500
    );
    const offset = Math.max(Number(params.get("offset") ?? 0), 0);

    if (channel && !VALID_CHANNEL_IDS.has(channel as never)) {
      return NextResponse.json(
        { error: "Invalid channel" },
        { status: 400 }
      );
    }
    if (from && !/^\d{4}-\d{2}-\d{2}$/.test(from)) {
      return NextResponse.json({ error: "Invalid from date" }, { status: 400 });
    }
    if (to && !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return NextResponse.json({ error: "Invalid to date" }, { status: 400 });
    }

    // ── Industry classifier for kind filter ─────────────────────
    const industry = (client.industry ?? "other") as Industry;
    const seeded = new Map<string, "income" | "expense">();
    for (const c of getCategoriesForIndustry(industry)) {
      seeded.set(c.name, c.type);
    }

    // Custom income categories live on preferences (sub-session 19)
    const settingsResult = await pool.query<{
      custom_categories: string[] | null;
      preferences: { custom_income_categories?: string[] } | null;
    }>(
      `SELECT custom_categories, preferences FROM client_settings WHERE client_id = $1`,
      [client.id]
    );
    const settings = settingsResult.rows[0];
    const customIncome = new Set(
      Array.isArray(settings?.preferences?.custom_income_categories)
        ? settings!.preferences!.custom_income_categories!
        : []
    );

    // ── Build the WHERE clause dynamically + tenant-scope it ───
    const where: string[] = ["client_id = $1"];
    const args: unknown[] = [client.id];
    let p = 2;
    if (channel) {
      where.push(`channel = $${p++}`);
      args.push(channel);
    }
    if (eventIdParam) {
      const eventId = Number(eventIdParam);
      if (!Number.isInteger(eventId) || eventId <= 0) {
        return NextResponse.json(
          { error: "Invalid event_id" },
          { status: 400 }
        );
      }
      where.push(`event_id = $${p++}`);
      args.push(eventId);
    }
    if (from) {
      where.push(`due_date >= $${p++}`);
      args.push(from);
    }
    if (to) {
      where.push(`due_date <= $${p++}`);
      args.push(to);
    }

    const result = await pool.query<ProcessedItemRow>(
      `SELECT id, vendor, amount, due_date, category, source, channel,
              event_id, status, notes, processed_at
         FROM processed_items
        WHERE ${where.join(" AND ")}
        ORDER BY due_date DESC NULLS LAST, id DESC
        LIMIT $${p++} OFFSET $${p++}`,
      [...args, limit, offset]
    );

    // ── Filter to expense-kind rows in JS (cleaner than SQL CASE) ─
    // "Sales" = the Square + Etsy ingest income category (not seeded) — list
    // it so those sales are excluded from the expense list, not mis-included.
    const LEGACY_INCOME = new Set(["invoice", "ar_followup", "Sales"]);
    const LEGACY_EXPENSE = new Set(["expense"]);
    const expenses = result.rows.filter((r) => {
      if (!r.category) return false; // unknown-category rows aren't expenses
      if (LEGACY_INCOME.has(r.category)) return false;
      if (customIncome.has(r.category)) return false;
      const seededKind = seeded.get(r.category);
      if (seededKind === "income") return false;
      if (seededKind === "expense") return true;
      if (LEGACY_EXPENSE.has(r.category)) return true;
      // Custom expense categories (legacy custom_categories array) +
      // any unknown category is treated as expense by default. Matches
      // the existing /api/profitability classifier behavior.
      return true;
    });

    // ── Summary stats ───────────────────────────────────────────
    let totalAmount = 0;
    for (const r of expenses) {
      const a = Number(r.amount);
      if (Number.isFinite(a)) totalAmount += a;
    }

    // ── Phase 9.4 + sub-session 33: attachment count AND the first
    // attachment's id + mime per expense, in one grouped query.
    // The first attachment (earliest uploaded) drives an inline
    // thumbnail on the expense row — an image preview for image
    // mime types, a doc icon otherwise. ARRAY_AGG ... ORDER BY
    // picks the earliest deterministically.
    const attachmentInfo = new Map<
      number,
      { count: number; firstId: number | null; firstMime: string | null }
    >();
    if (expenses.length > 0) {
      const ids = expenses.map((r) => r.id);
      const acRes = await pool.query<{
        processed_item_id: number;
        n: number;
        first_id: number | null;
        first_mime: string | null;
      }>(
        `SELECT processed_item_id,
                COUNT(*)::int AS n,
                (ARRAY_AGG(id ORDER BY uploaded_at ASC, id ASC))[1] AS first_id,
                (ARRAY_AGG(mime_type ORDER BY uploaded_at ASC, id ASC))[1] AS first_mime
           FROM expense_attachments
          WHERE client_id = $1
            AND processed_item_id = ANY($2::int[])
          GROUP BY processed_item_id`,
        [client.id, ids]
      );
      for (const r of acRes.rows) {
        attachmentInfo.set(r.processed_item_id, {
          count: r.n,
          firstId: r.first_id,
          firstMime: r.first_mime,
        });
      }
    }

    return NextResponse.json({
      expenses: expenses.map((r) => {
        const ai = attachmentInfo.get(r.id);
        return {
          id: r.id,
          vendor: r.vendor,
          amount: Number(r.amount),
          dueDate: r.due_date,
          category: r.category,
          source: r.source,
          channel: r.channel,
          eventId: r.event_id,
          status: r.status,
          notes: r.notes,
          createdAt: r.processed_at,
          attachmentCount: ai?.count ?? 0,
          firstAttachmentId: ai?.firstId ?? null,
          firstAttachmentMime: ai?.firstMime ?? null,
        };
      }),
      summary: {
        totalAmount,
        count: expenses.length,
      },
    });
  } catch (err) {
    console.error("Expenses GET error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load expenses" },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------
// POST — create a new expense
// ---------------------------------------------------------------------

interface CreateExpenseBody {
  vendor?: unknown;
  amount?: unknown;
  dueDate?: unknown;
  category?: unknown;
  channel?: unknown;
  eventId?: unknown;
  notes?: unknown;
  /** Optional: receive this purchase into a component's stock on save
   *  (adds quantity + sets the component's unit cost). */
  receiveSkuId?: unknown;
  receiveQuantity?: unknown;
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

export async function POST(req: NextRequest) {
  try {
    const client = await getSessionClient();
    if (!client) {
      return NextResponse.json(
        { error: "Not authenticated" },
        { status: 401 }
      );
    }

    const body = (await req.json().catch(() => null)) as CreateExpenseBody | null;
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    // ── Validate required fields ────────────────────────────────
    if (!isNonEmptyString(body.vendor)) {
      return NextResponse.json(
        { error: "Vendor is required" },
        { status: 400 }
      );
    }
    const amount = parseAmount(body.amount);
    if (amount == null) {
      return NextResponse.json(
        { error: "Amount must be a positive number" },
        { status: 400 }
      );
    }
    if (
      !isNonEmptyString(body.dueDate) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(body.dueDate)
    ) {
      return NextResponse.json(
        { error: "Date must be YYYY-MM-DD" },
        { status: 400 }
      );
    }
    if (!isNonEmptyString(body.category)) {
      return NextResponse.json(
        { error: "Category is required" },
        { status: 400 }
      );
    }

    // ── Validate optional channel ───────────────────────────────
    let channel: string | null = null;
    if (body.channel != null && body.channel !== "") {
      if (
        !isNonEmptyString(body.channel) ||
        !VALID_CHANNEL_IDS.has(body.channel as never)
      ) {
        return NextResponse.json(
          { error: "Invalid channel" },
          { status: 400 }
        );
      }
      channel = body.channel;
    }

    // ── Validate optional event_id (tenant-scope check) ─────────
    let eventId: number | null = null;
    if (body.eventId != null && body.eventId !== "") {
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
      eventId = parsed;
    }

    // ── Validate category is an expense-type for this industry ──
    const industry = (client.industry ?? "other") as Industry;
    const seeded = new Map<string, "income" | "expense">();
    for (const c of getCategoriesForIndustry(industry)) {
      seeded.set(c.name, c.type);
    }
    const seededKind = seeded.get(body.category);
    if (seededKind === "income") {
      return NextResponse.json(
        {
          error: `"${body.category}" is an income category, not an expense. Pick an expense category.`,
        },
        { status: 400 }
      );
    }
    // Allow unknown categories (custom_categories legacy + custom user
    // additions) — the UI is responsible for surfacing the right list,
    // but the server doesn't reject if the category isn't in the
    // seeded taxonomy (would break custom-category workflows).

    // ── Auto-assign channel from event_id if not explicit ───────
    // If user picked an event but didn't pick a channel, that's
    // clearly a Markets expense — auto-tag.
    if (!channel && eventId !== null) {
      channel = "markets";
    }

    // ── Optional: receive this purchase into a component's stock ──
    let receiveSkuId: number | null = null;
    if (body.receiveSkuId != null && body.receiveSkuId !== "") {
      const parsed = Number(body.receiveSkuId);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        return NextResponse.json({ error: "Invalid component" }, { status: 400 });
      }
      receiveSkuId = parsed;
    }
    let receiveQuantity = 0;
    if (receiveSkuId !== null) {
      const q = Number(body.receiveQuantity);
      if (!Number.isFinite(q) || q <= 0) {
        return NextResponse.json(
          { error: "Quantity to receive must be a positive number" },
          { status: 400 }
        );
      }
      receiveQuantity = q;
    }

    const vendorTrim = body.vendor.trim();
    const notesVal = typeof body.notes === "string" ? body.notes.trim() : null;
    const insertSql = `INSERT INTO processed_items (
         client_id, vendor, amount, due_date, category,
         source, channel, event_id, status, notes,
         invoice_number, confidence, summary, processed_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5,
         'manual', $6, $7, 'paid', $8,
         '', 100, $9, NOW(), NOW()
       )
       RETURNING id, vendor, amount, due_date, category, source,
                 channel, event_id, status, notes, processed_at`;
    const insertParams = [
      client.id,
      vendorTrim,
      amount,
      body.dueDate,
      body.category,
      channel,
      eventId,
      notesVal,
      `Manual expense: ${vendorTrim} — $${amount.toFixed(2)}`,
    ];

    const toResponse = (row: ProcessedItemRow) => ({
      expense: {
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
      },
    });

    // No inventory receive → plain insert.
    if (receiveSkuId === null) {
      const result = await pool.query<ProcessedItemRow>(insertSql, insertParams);
      return NextResponse.json(toResponse(result.rows[0]));
    }

    // Receive path → validate the component, then create the expense +
    // receive it in one transaction so a crash can't half-apply.
    const sku = await pool.query<{ id: number }>(
      `SELECT id FROM skus WHERE id = $1 AND client_id = $2`,
      [receiveSkuId, client.id]
    );
    if (sku.rowCount === 0) {
      return NextResponse.json({ error: "Component not found" }, { status: 400 });
    }
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      const result = await db.query<ProcessedItemRow>(insertSql, insertParams);
      const row = result.rows[0];
      await receiveExpenseIntoInventory({
        dbClient: db,
        clientId: client.id,
        processedItemId: row.id,
        skuId: receiveSkuId,
        quantity: receiveQuantity,
        amount,
        vendor: vendorTrim,
        effectiveDate: body.dueDate as string,
      });
      await db.query("COMMIT");
      return NextResponse.json(toResponse(row));
    } catch (txErr) {
      await db.query("ROLLBACK").catch(() => {});
      throw txErr;
    } finally {
      db.release();
    }
  } catch (err) {
    console.error("Expenses POST error:", err);
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Failed to create expense",
      },
      { status: 500 }
    );
  }
}
