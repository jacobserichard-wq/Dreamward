import { NextRequest, NextResponse } from "next/server";
import pool, { saveProcessedItem } from "@/lib/db";
import { getSessionClient } from "@/lib/getClient";

// Phase 5 §3: manual per-event expense. Inserts a processed_items row
// with source='manual' + event_id set. The `manual` source value has
// been defined since Phase 1 but never written to until this Phase —
// this route finally wires it. Reusing processed_items (vs. a new
// event_expenses table) means the per-event expense total is one query
// over the unified row set, and manual rows flow into the dashboard's
// category breakdown for free (Phase 5 design §8.1 default).

interface CreateExpenseBody {
  amount?: unknown;
  category?: unknown;
  vendor?: unknown;
  description?: unknown;
  date?: unknown;
}

function parseMoney(v: unknown): number | null {
  if (v == null || v === "") return null;
  const cleaned =
    typeof v === "number" ? String(v) : String(v).replace(/[$,\s]/g, "");
  const num = Number(cleaned);
  if (!Number.isFinite(num) || num <= 0) return null;
  return num;
}

function isValidISODate(v: unknown): v is string {
  if (typeof v !== "string") return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime());
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function isPlanAllowed(plan: string | null | undefined): boolean {
  return plan === "growth" || plan === "pro" || plan === "trial";
}

function parseEventId(rawId: string): number | null {
  const n = Number(rawId);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: rawId } = await params;
    const eventId = parseEventId(rawId);
    if (eventId === null) {
      return NextResponse.json({ error: "Invalid event id" }, { status: 400 });
    }

    const client = await getSessionClient();
    if (!client) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    if (!isPlanAllowed(client.plan)) {
      return NextResponse.json(
        { error: "Events is a Growth or Pro feature" },
        { status: 403 }
      );
    }

    let body: CreateExpenseBody;
    try {
      body = (await req.json()) as CreateExpenseBody;
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const amount = parseMoney(body.amount);
    if (amount === null) {
      return NextResponse.json(
        { error: "amount must be a positive number" },
        { status: 400 }
      );
    }

    if (!isNonEmptyString(body.category)) {
      return NextResponse.json(
        { error: "category is required" },
        { status: 400 }
      );
    }
    const category = body.category.trim();

    // Look up the event to verify ownership AND fetch start_date for the
    // due_date default. Tenant safety: WHERE id = $1 AND client_id = $2.
    const eventResult = await pool.query<{ start_date: string }>(
      `SELECT start_date FROM events WHERE id = $1 AND client_id = $2`,
      [eventId, client.id]
    );
    if (eventResult.rows.length === 0) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    let dueDate: string;
    if (body.date == null || body.date === "") {
      dueDate = eventResult.rows[0].start_date;
    } else if (isValidISODate(body.date)) {
      dueDate = body.date;
    } else {
      return NextResponse.json(
        { error: "date must be a YYYY-MM-DD string" },
        { status: 400 }
      );
    }

    const vendor =
      typeof body.vendor === "string" && body.vendor.trim().length > 0
        ? body.vendor.trim()
        : "Manual expense";
    const description =
      typeof body.description === "string" && body.description.trim().length > 0
        ? body.description.trim()
        : null;

    // Reuse saveProcessedItem — it already handles the snake/camel
    // fallback pattern + the INSERT column list with all the Phase 1-5
    // additions (ai_classified_at, event_id, etc.). Manual rows fill
    // status="paid" (the user entered the expense, so it's already
    // paid in their world), confidence=100 (entered by hand), and
    // source="manual" (the new value finally getting used).
    const saved = await saveProcessedItem(
      {
        vendor,
        invoice_number: null,
        amount,
        due_date: dueDate,
        status: "paid",
        category,
        confidence: 100,
        summary: description,
        raw_email_id: null,
        extracted_data: null,
        source: "manual",
        event_id: eventId,
      },
      client.id
    );

    const row = saved.rows?.[0];
    if (!row) {
      return NextResponse.json(
        { error: "Failed to create expense" },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        expense: {
          id: row.id,
          eventId: row.event_id,
          amount: Number(row.amount),
          category: row.category,
          vendor: row.vendor,
          description: row.summary,
          date: row.due_date,
          source: row.source,
        },
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Manual expense POST error:", error);
    return NextResponse.json(
      { error: "Failed to create expense" },
      { status: 500 }
    );
  }
}
