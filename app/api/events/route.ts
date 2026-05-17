import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getSessionClient } from "@/lib/getClient";

// Events row shape as returned by Postgres.
// NUMERIC columns come back as strings from pg by default — serialize to
// number on the way out so the API contract is plain JSON numbers.
interface EventRow {
  id: number;
  client_id: number;
  name: string;
  start_date: string;
  end_date: string;
  venue: string | null;
  revenue: string | null;
  booth_fee: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface CreateEventBody {
  name?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  venue?: unknown;
  revenue?: unknown;
  boothFee?: unknown;
  notes?: unknown;
}

function serializeEvent(row: EventRow) {
  return {
    id: row.id,
    clientId: row.client_id,
    name: row.name,
    startDate: row.start_date,
    endDate: row.end_date,
    venue: row.venue,
    revenue: row.revenue == null ? null : Number(row.revenue),
    boothFee: Number(row.booth_fee),
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Defense-in-depth at the API: accept "$340", "340", "340.00", and numbers.
// UI does the same parsing before submit; this catches malformed direct
// API calls without rejecting reasonable forgiving inputs.
function parseMoney(v: unknown): number | null {
  if (v == null || v === "") return null;
  const cleaned =
    typeof v === "number" ? String(v) : String(v).replace(/[$,\s]/g, "");
  const num = Number(cleaned);
  if (!Number.isFinite(num) || num < 0) return null;
  return num;
}

function isValidISODate(v: unknown): v is string {
  if (typeof v !== "string") return false;
  // YYYY-MM-DD only — matches the DB DATE column shape.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime());
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

// Growth-and-Pro feature per the pricing table. Starter clients hit 403
// here regardless of UI gating — never rely on the UI alone.
function isPlanAllowed(plan: string | null | undefined): boolean {
  return plan === "growth" || plan === "pro" || plan === "trial";
}

export async function GET() {
  try {
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

    const result = await pool.query<EventRow>(
      `SELECT id, client_id, name, start_date, end_date, venue,
              revenue, booth_fee, notes, created_at, updated_at
         FROM events
        WHERE client_id = $1
        ORDER BY start_date DESC, id DESC`,
      [client.id]
    );

    return NextResponse.json({ events: result.rows.map(serializeEvent) });
  } catch (error) {
    console.error("Events GET error:", error);
    return NextResponse.json(
      { error: "Failed to load events" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
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

    let body: CreateEventBody;
    try {
      body = (await req.json()) as CreateEventBody;
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    if (!isNonEmptyString(body.name)) {
      return NextResponse.json(
        { error: "name is required" },
        { status: 400 }
      );
    }
    const name = body.name.trim();

    if (!isValidISODate(body.startDate)) {
      return NextResponse.json(
        { error: "startDate must be a YYYY-MM-DD string" },
        { status: 400 }
      );
    }
    const startDate = body.startDate;

    // endDate defaults to startDate (single-day events).
    let endDate: string;
    if (body.endDate == null || body.endDate === "") {
      endDate = startDate;
    } else if (isValidISODate(body.endDate)) {
      endDate = body.endDate;
    } else {
      return NextResponse.json(
        { error: "endDate must be a YYYY-MM-DD string" },
        { status: 400 }
      );
    }
    if (endDate < startDate) {
      return NextResponse.json(
        { error: "endDate must be on or after startDate" },
        { status: 400 }
      );
    }

    const venue =
      typeof body.venue === "string" && body.venue.trim().length > 0
        ? body.venue.trim()
        : null;

    // boothFee defaults to 0 when omitted. Invalid input → 400.
    const boothFeeProvided =
      body.boothFee !== undefined && body.boothFee !== null && body.boothFee !== "";
    const boothFee = boothFeeProvided ? parseMoney(body.boothFee) : 0;
    if (boothFee === null) {
      return NextResponse.json(
        { error: "boothFee must be a non-negative number" },
        { status: 400 }
      );
    }

    // revenue is fully optional. Omitted → null. Invalid input → 400.
    const revenueProvided =
      body.revenue !== undefined && body.revenue !== null && body.revenue !== "";
    const revenue = revenueProvided ? parseMoney(body.revenue) : null;
    if (revenueProvided && revenue === null) {
      return NextResponse.json(
        { error: "revenue must be a non-negative number" },
        { status: 400 }
      );
    }

    const notes =
      typeof body.notes === "string" && body.notes.trim().length > 0
        ? body.notes.trim()
        : null;

    const result = await pool.query<EventRow>(
      `INSERT INTO events
         (client_id, name, start_date, end_date, venue, revenue, booth_fee, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, client_id, name, start_date, end_date, venue,
                 revenue, booth_fee, notes, created_at, updated_at`,
      [client.id, name, startDate, endDate, venue, revenue, boothFee, notes]
    );

    return NextResponse.json(
      { event: serializeEvent(result.rows[0]) },
      { status: 201 }
    );
  } catch (error) {
    console.error("Events POST error:", error);
    return NextResponse.json(
      { error: "Failed to create event" },
      { status: 500 }
    );
  }
}
