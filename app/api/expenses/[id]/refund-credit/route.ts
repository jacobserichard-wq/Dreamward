// app/api/expenses/[id]/refund-credit/route.ts
//
// POST /api/expenses/[id]/refund-credit
//   Body: { amount: number, note?: string }
//
// Logs a vendor refund/credit against an expense. A vendor refunding
// you is NOT income — it's money back on something you bought, so we
// record it as a *contra-expense*: a negative-amount processed_items
// row in the SAME category + channel as the original. The reports
// aggregation nets negative expenses (lib/reports/aggregate.ts), the
// channel rollup and profitability endpoint already sum without a
// skip, so the credit reduces that category's spend everywhere and
// never touches revenue.
//
// Distinct from a SALES refund (RefundForm → "Returns & Refunds"),
// which reduces revenue. This endpoint refuses income/refund rows so
// the two never get crossed.
//
// Tenant scope: the original expense must belong to this client.
// Forged ids return 404.

import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getSessionClient } from "@/lib/getClient";
import { getCategoriesForIndustry, type Industry } from "@/lib/categories";

interface OriginalRow {
  id: number;
  vendor: string;
  amount: string;
  category: string | null;
  channel: string | null;
  event_id: number | null;
}

interface InsertedRow {
  id: number;
  vendor: string;
  amount: string;
  due_date: string;
  category: string | null;
  source: string;
  channel: string | null;
  event_id: number | null;
  status: string;
  notes: string | null;
  processed_at: string;
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

    const { id: idParam } = await params;
    const expenseId = Number(idParam);
    if (!Number.isInteger(expenseId) || expenseId <= 0) {
      return NextResponse.json({ error: "Invalid id" }, { status: 400 });
    }

    const body = (await req.json().catch(() => null)) as {
      amount?: unknown;
      note?: unknown;
    } | null;
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    // ── Load the original expense (tenant-scoped) ───────────────
    const orig = await pool.query<OriginalRow>(
      `SELECT id, vendor, amount, category, channel, event_id
         FROM processed_items
        WHERE id = $1 AND client_id = $2`,
      [expenseId, client.id]
    );
    if (orig.rowCount === 0) {
      return NextResponse.json(
        { error: "Expense not found" },
        { status: 404 }
      );
    }
    const original = orig.rows[0];
    const originalAmount = Number(original.amount);

    // ── Guard: only positive expense rows can take a credit ─────
    // A sales refund is reduced via "Refund this", not here; an
    // already-negative row is itself a credit.
    if (original.category === "Returns & Refunds") {
      return NextResponse.json(
        {
          error:
            "That's a sales refund, not an expense. Use “Refund this” on the original sale instead.",
        },
        { status: 400 }
      );
    }
    const industry = (client.industry ?? "other") as Industry;
    const kindByCat = new Map<string, "income" | "expense">();
    for (const c of getCategoriesForIndustry(industry)) {
      kindByCat.set(c.name, c.type);
    }
    if (original.category && kindByCat.get(original.category) === "income") {
      return NextResponse.json(
        {
          error:
            "That's a sale, not an expense. Use “Refund this” to refund a sale.",
        },
        { status: 400 }
      );
    }
    if (!Number.isFinite(originalAmount) || originalAmount <= 0) {
      return NextResponse.json(
        { error: "That row is already a credit — nothing to refund." },
        { status: 400 }
      );
    }

    // ── Validate the refund amount ──────────────────────────────
    const raw = Number(body.amount);
    if (!Number.isFinite(raw) || raw <= 0) {
      return NextResponse.json(
        { error: "Enter how much the vendor refunded (a positive amount)." },
        { status: 400 }
      );
    }
    // Round to cents and cap at the original — a credit can't exceed
    // what you paid, or it would turn the expense into net income (a
    // typo guard, not an accounting limit).
    const refund = Math.round(raw * 100) / 100;
    if (refund > originalAmount + 0.001) {
      return NextResponse.json(
        {
          error: `The refund can't be more than the original $${originalAmount.toFixed(
            2
          )}.`,
        },
        { status: 400 }
      );
    }

    const note =
      typeof body.note === "string" && body.note.trim()
        ? body.note.trim()
        : null;
    const creditAmount = -refund;
    const today = new Date().toISOString().slice(0, 10);
    const vendorLabel = `Refund — ${original.vendor}`.slice(0, 200);
    const summary = `Vendor refund/credit against expense #${original.id} (${
      original.vendor
    })`;

    // status='pending' (not 'paid') so the credit lands in the active
    // transactions list rather than the default-hidden "Settled" group —
    // the user wanted to see logged refunds alongside their other rows.
    // Nothing auto-flips pending→overdue (overdue is only ever set by the
    // AI at processing time) and no reminder cron keys on pending, so this
    // won't false-alarm. The user can mark it Paid to archive it.
    const inserted = await pool.query<InsertedRow>(
      `INSERT INTO processed_items (
         client_id, vendor, amount, due_date, category,
         source, channel, event_id, status, notes,
         invoice_number, confidence, summary, processed_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5,
         'manual', $6, $7, 'pending', $8,
         '', 100, $9, NOW(), NOW()
       )
       RETURNING id, vendor, amount, due_date, category, source,
                 channel, event_id, status, notes, processed_at`,
      [
        client.id,
        vendorLabel,
        creditAmount,
        today,
        original.category,
        original.channel,
        original.event_id,
        note,
        summary,
      ]
    );

    const row = inserted.rows[0];
    return NextResponse.json({
      credit: {
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
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Couldn't log that refund.",
      },
      { status: 500 }
    );
  }
}
