// app/api/sales/route.ts
//
// Manual single-sale entry — the income counterpart to the manual
// "+ New expense" path (/api/expenses POST). Fills the gap where a
// direct / word-of-mouth retail sale isn't a market event, a wholesale
// invoice, or a synced platform order.
//
//   GET  /api/sales  → { categories: string[] }  (income categories for
//                       the dropdown: seeded income + custom income)
//   POST /api/sales  → create one manual income processed_item
//
// Mirrors the expense POST: source='manual', status='paid' (a logged
// sale is money received), confidence=100. The row is income because
// its CATEGORY is income-typed — same model as everywhere else.

import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getSessionClient } from "@/lib/getClient";
import { getClientSettings } from "@/lib/db";
import { getCategoriesForIndustry, type Industry } from "@/lib/categories";
import { CANONICAL_CHANNELS } from "@/lib/profitability/channels";

const VALID_CHANNEL_IDS = new Set(CANONICAL_CHANNELS.map((c) => c.id));

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

// ---------------------------------------------------------------------
// GET — income categories for the sale form's dropdown
// ---------------------------------------------------------------------

export async function GET() {
  try {
    const client = await getSessionClient();
    if (!client) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const industry = (client.industry ?? "other") as Industry;
    const seededIncome = getCategoriesForIndustry(industry)
      .filter((c) => c.type === "income")
      .map((c) => c.name);
    const settings = await getClientSettings(client.id);
    const customIncome: string[] = Array.isArray(
      settings?.preferences?.custom_income_categories
    )
      ? settings.preferences.custom_income_categories
      : [];
    const categories = Array.from(new Set([...seededIncome, ...customIncome]));
    return NextResponse.json({ categories });
  } catch (err) {
    console.error("Sales GET error:", err);
    return NextResponse.json(
      { error: "Failed to load income categories" },
      { status: 500 }
    );
  }
}

// ---------------------------------------------------------------------
// POST — create a manual sale (income)
// ---------------------------------------------------------------------

interface CreateSaleBody {
  customer?: unknown;
  amount?: unknown;
  dueDate?: unknown;
  category?: unknown;
  channel?: unknown;
  eventId?: unknown;
  notes?: unknown;
}

export async function POST(req: NextRequest) {
  try {
    const client = await getSessionClient();
    if (!client) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = (await req.json().catch(() => null)) as CreateSaleBody | null;
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    // Customer is optional for a quick sale — default to a placeholder so
    // the row still reads sensibly. (Expenses require a vendor; a cash
    // sale often has no named buyer.)
    const customer = isNonEmptyString(body.customer)
      ? body.customer.trim()
      : "Cash sale";

    const amount = parseAmount(body.amount);
    if (amount == null) {
      return NextResponse.json(
        { error: "Amount must be a positive number" },
        { status: 400 }
      );
    }
    if (!isNonEmptyString(body.dueDate) || !/^\d{4}-\d{2}-\d{2}$/.test(body.dueDate)) {
      return NextResponse.json({ error: "Date must be YYYY-MM-DD" }, { status: 400 });
    }
    if (!isNonEmptyString(body.category)) {
      return NextResponse.json({ error: "Category is required" }, { status: 400 });
    }

    // Reject an expense-typed category (symmetric to the expense POST,
    // which rejects income categories). Custom income categories aren't
    // in the seeded map → allowed.
    const industry = (client.industry ?? "other") as Industry;
    const seeded = new Map<string, "income" | "expense">();
    for (const c of getCategoriesForIndustry(industry)) {
      seeded.set(c.name, c.type);
    }
    if (seeded.get(body.category) === "expense") {
      return NextResponse.json(
        {
          error: `"${body.category}" is an expense category, not a sale. Pick an income category.`,
        },
        { status: 400 }
      );
    }

    // Optional channel.
    let channel: string | null = null;
    if (body.channel != null && body.channel !== "") {
      if (!isNonEmptyString(body.channel) || !VALID_CHANNEL_IDS.has(body.channel as never)) {
        return NextResponse.json({ error: "Invalid channel" }, { status: 400 });
      }
      channel = body.channel;
    }

    // Optional event (tenant-scoped). A market sale → Markets channel.
    let eventId: number | null = null;
    if (body.eventId != null && body.eventId !== "") {
      const parsed = Number(body.eventId);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        return NextResponse.json({ error: "Invalid eventId" }, { status: 400 });
      }
      const eventCheck = await pool.query<{ id: number }>(
        `SELECT id FROM events WHERE id = $1 AND client_id = $2`,
        [parsed, client.id]
      );
      if (eventCheck.rowCount === 0) {
        return NextResponse.json({ error: "Event not found" }, { status: 400 });
      }
      eventId = parsed;
    }
    if (!channel && eventId !== null) {
      channel = "markets";
    }

    const result = await pool.query(
      `INSERT INTO processed_items (
         client_id, vendor, amount, due_date, category,
         source, channel, event_id, status, notes,
         invoice_number, confidence, summary, processed_at, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5,
         'manual', $6, $7, 'paid', $8,
         '', 100, $9, NOW(), NOW()
       )
       RETURNING id, vendor, amount, due_date, category, channel, status`,
      [
        client.id,
        customer,
        amount,
        body.dueDate,
        body.category,
        channel,
        eventId,
        typeof body.notes === "string" ? body.notes.trim() : null,
        `Manual sale: ${customer} — $${amount.toFixed(2)}`,
      ]
    );

    return NextResponse.json({ sale: result.rows[0] });
  } catch (err) {
    console.error("Sales POST error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to record sale" },
      { status: 500 }
    );
  }
}
