import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getSessionClient } from "@/lib/getClient";
import { computeRoundTripMiles } from "@/lib/distance";
import { isPayingTier } from "@/lib/plans";

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
  // Phase 4 mileage columns (migration 0005).
  address: string | null;
  returns_home_nightly: boolean;
  round_trip_miles: string | null;
  mileage_computed_at: string | null;
}

// GET list row shape — adds the linked-transactions aggregate from the
// LEFT JOIN on processed_items (sub-session 17 commit 10) and the Phase 4
// total_miles SQL expression (returns_home_nightly conditional applied at
// the query level — design §8.2). Used only by GET; POST returns a bare
// EventRow.
interface EventListRow extends EventRow {
  linked_count: number;
  linked_total: string | null;
  total_miles: string | null;
}

interface CreateEventBody {
  name?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  venue?: unknown;
  revenue?: unknown;
  boothFee?: unknown;
  notes?: unknown;
  // Phase 4 mileage fields. address triggers a maps-API call at POST
  // time when both event.address and client.home_address are present.
  address?: unknown;
  returnsHomeNightly?: unknown;
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
    address: row.address,
    returnsHomeNightly: row.returns_home_nightly,
    roundTripMiles: row.round_trip_miles == null ? null : Number(row.round_trip_miles),
    mileageComputedAt: row.mileage_computed_at,
  };
}

// GET response per-event shape — adds linkedTransactions aggregate and
// totalMiles (the §8.2 conditional product, computed in SQL).
function serializeEventListEntry(row: EventListRow) {
  return {
    ...serializeEvent(row),
    linkedTransactions: {
      count: row.linked_count,
      totalAmount: row.linked_total == null ? 0 : Number(row.linked_total),
    },
    totalMiles: row.total_miles == null ? null : Number(row.total_miles),
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
  return isPayingTier(plan);
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

    // LEFT JOIN aggregate so each event row carries its linked-transaction
    // count + sum (sub-session 17 commit 10). GROUP BY events.id is
    // sufficient in Postgres because events.id is the PK (functional
    // dependency covers the other selected columns). COALESCE protects
    // against the LEFT JOIN's nulls when zero linked rows exist.
    //
    // Phase 4: total_miles is the §8.2 conditional product computed in
    // SQL. (end_date - start_date) on DATE columns returns INTEGER days;
    // + 1 for inclusive count. When returns_home_nightly is true, the
    // vendor drives home each night → round_trip_miles × day_count.
    // When false, one trip covers the whole event → round_trip_miles × 1.
    // Null round_trip_miles propagates to null total_miles.
    const result = await pool.query<EventListRow>(
      `SELECT e.id, e.client_id, e.name, e.start_date, e.end_date, e.venue,
              e.revenue, e.booth_fee, e.notes, e.created_at, e.updated_at,
              e.address, e.returns_home_nightly, e.round_trip_miles,
              e.mileage_computed_at,
              COALESCE(COUNT(pi.id), 0)::int AS linked_count,
              COALESCE(SUM(pi.amount), 0) AS linked_total,
              CASE
                WHEN e.round_trip_miles IS NULL THEN NULL
                WHEN e.returns_home_nightly THEN
                  e.round_trip_miles * ((e.end_date - e.start_date) + 1)
                ELSE e.round_trip_miles
              END AS total_miles
         FROM events e
         LEFT JOIN processed_items pi ON pi.event_id = e.id AND pi.client_id = $1
        WHERE e.client_id = $1
        GROUP BY e.id
        ORDER BY e.start_date DESC, e.id DESC`,
      [client.id]
    );

    return NextResponse.json({ events: result.rows.map(serializeEventListEntry) });
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

    // Phase 4 mileage fields. address is optional; trim + null-empty
    // matches the venue/notes pattern. returnsHomeNightly is optional
    // boolean, defaults to true (matches the DB column default) when
    // omitted or non-boolean.
    const address =
      typeof body.address === "string" && body.address.trim().length > 0
        ? body.address.trim()
        : null;
    const returnsHomeNightly =
      typeof body.returnsHomeNightly === "boolean"
        ? body.returnsHomeNightly
        : true;

    // Compute round-trip mileage when both addresses are present. The
    // helper returns null on any failure (missing API key, unresolvable
    // address, HTTP error) — events save normally either way (§5).
    const homeAddress =
      typeof client.home_address === "string" && client.home_address.trim().length > 0
        ? client.home_address.trim()
        : null;
    let roundTripMiles: number | null = null;
    let mileageComputedAt: Date | null = null;
    if (homeAddress && address) {
      roundTripMiles = await computeRoundTripMiles(homeAddress, address);
      if (roundTripMiles !== null) {
        mileageComputedAt = new Date();
      }
    }

    const result = await pool.query<EventRow>(
      `INSERT INTO events
         (client_id, name, start_date, end_date, venue, revenue, booth_fee, notes,
          address, returns_home_nightly, round_trip_miles, mileage_computed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id, client_id, name, start_date, end_date, venue,
                 revenue, booth_fee, notes, created_at, updated_at,
                 address, returns_home_nightly, round_trip_miles, mileage_computed_at`,
      [
        client.id,
        name,
        startDate,
        endDate,
        venue,
        revenue,
        boothFee,
        notes,
        address,
        returnsHomeNightly,
        roundTripMiles,
        mileageComputedAt,
      ]
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
