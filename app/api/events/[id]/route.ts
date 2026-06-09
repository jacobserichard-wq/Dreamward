import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getSessionClient } from "@/lib/getClient";
import { computeRoundTripMiles } from "@/lib/distance";
import { isPayingTier } from "@/lib/plans";

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

interface EventItemRow {
  id: number;
  event_id: number;
  client_id: number;
  product_name: string;
  quantity: number;
  unit_price: string;
  created_at: string;
}

interface LinkedSummaryRow {
  count: string;
  total_amount: string | null;
}

interface PatchBody {
  name?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  venue?: unknown;
  revenue?: unknown;
  boothFee?: unknown;
  notes?: unknown;
  items?: unknown;
  // Phase 4: when `address` is present, mileage recomputes (handles both
  // address changes and the "Recalculate" affordance). `returnsHomeNightly`
  // updates the column but doesn't trigger a maps API call — per-trip
  // distance is unchanged; only the displayed total derives differently.
  address?: unknown;
  returnsHomeNightly?: unknown;
}

interface PatchItemInput {
  productName?: unknown;
  quantity?: unknown;
  unitPrice?: unknown;
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

// Phase 4 §8.2: total event mileage derived from round_trip_miles +
// returns_home_nightly + day_count. Mirrors the SQL CASE in the GET
// list query — used here for the single-event GET response so the
// detail page doesn't need to recompute it client-side.
function computeTotalMiles(row: EventRow): number | null {
  if (row.round_trip_miles == null) return null;
  const rtm = Number(row.round_trip_miles);
  if (!row.returns_home_nightly) return rtm;
  // DATE columns come back as YYYY-MM-DD strings; parse as UTC to avoid
  // tz drift on date-only values, then compute inclusive day count.
  const start = new Date(`${row.start_date}T00:00:00Z`).getTime();
  const end = new Date(`${row.end_date}T00:00:00Z`).getTime();
  const days = Math.round((end - start) / 86400000) + 1;
  return Math.round(rtm * days * 10) / 10;
}

function serializeItem(row: EventItemRow) {
  return {
    id: row.id,
    eventId: row.event_id,
    productName: row.product_name,
    quantity: row.quantity,
    unitPrice: Number(row.unit_price),
    createdAt: row.created_at,
  };
}

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
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  const d = new Date(`${v}T00:00:00Z`);
  return !Number.isNaN(d.getTime());
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function isPlanAllowed(plan: string | null | undefined): boolean {
  return isPayingTier(plan);
}

function parseEventId(rawId: string): number | null {
  const n = Number(rawId);
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

export async function GET(
  _req: NextRequest,
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

    const eventResult = await pool.query<EventRow>(
      `SELECT id, client_id, name, start_date, end_date, venue,
              revenue, booth_fee, notes, created_at, updated_at,
              address, returns_home_nightly, round_trip_miles,
              mileage_computed_at
         FROM events
        WHERE id = $1 AND client_id = $2`,
      [eventId, client.id]
    );
    if (eventResult.rows.length === 0) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    const itemsResult = await pool.query<EventItemRow>(
      `SELECT id, event_id, client_id, product_name, quantity, unit_price, created_at
         FROM event_items
        WHERE event_id = $1 AND client_id = $2
        ORDER BY id ASC`,
      [eventId, client.id]
    );

    // Linked-transaction summary — drives the "Sales from linked uploads:
    // $X across N transactions" headline on the detail page (design §5.4).
    const linkedResult = await pool.query<LinkedSummaryRow>(
      `SELECT COUNT(*)::text AS count,
              COALESCE(SUM(amount), 0)::text AS total_amount
         FROM processed_items
        WHERE event_id = $1 AND client_id = $2`,
      [eventId, client.id]
    );
    const linked = linkedResult.rows[0];
    const linkedCount = Number(linked?.count ?? 0);
    const linkedTotal = Number(linked?.total_amount ?? 0);

    return NextResponse.json({
      event: serializeEvent(eventResult.rows[0]),
      items: itemsResult.rows.map(serializeItem),
      linkedTransactions: {
        count: linkedCount,
        totalAmount: linkedTotal,
      },
      totalMiles: computeTotalMiles(eventResult.rows[0]),
    });
  } catch (error) {
    console.error("Event GET error:", error);
    return NextResponse.json(
      { error: "Failed to load event" },
      { status: 500 }
    );
  }
}

export async function PATCH(
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

    let body: PatchBody;
    try {
      body = (await req.json()) as PatchBody;
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    // Build the dynamic UPDATE — only include fields the caller sent.
    // The PATCH semantic is "merge non-undefined fields onto the row".
    const setClauses: string[] = [];
    const values: unknown[] = [];
    let i = 1;

    let startDateForRangeCheck: string | undefined;
    let endDateForRangeCheck: string | undefined;

    if (body.name !== undefined) {
      if (!isNonEmptyString(body.name)) {
        return NextResponse.json(
          { error: "name must be a non-empty string" },
          { status: 400 }
        );
      }
      setClauses.push(`name = $${i++}`);
      values.push(body.name.trim());
    }

    if (body.startDate !== undefined) {
      if (!isValidISODate(body.startDate)) {
        return NextResponse.json(
          { error: "startDate must be a YYYY-MM-DD string" },
          { status: 400 }
        );
      }
      setClauses.push(`start_date = $${i++}`);
      values.push(body.startDate);
      startDateForRangeCheck = body.startDate;
    }

    if (body.endDate !== undefined) {
      if (!isValidISODate(body.endDate)) {
        return NextResponse.json(
          { error: "endDate must be a YYYY-MM-DD string" },
          { status: 400 }
        );
      }
      setClauses.push(`end_date = $${i++}`);
      values.push(body.endDate);
      endDateForRangeCheck = body.endDate;
    }

    if (body.venue !== undefined) {
      const venue =
        typeof body.venue === "string" && body.venue.trim().length > 0
          ? body.venue.trim()
          : null;
      setClauses.push(`venue = $${i++}`);
      values.push(venue);
    }

    if (body.boothFee !== undefined) {
      const fee = parseMoney(body.boothFee);
      if (fee === null && body.boothFee !== null && body.boothFee !== "") {
        return NextResponse.json(
          { error: "boothFee must be a non-negative number" },
          { status: 400 }
        );
      }
      setClauses.push(`booth_fee = $${i++}`);
      values.push(fee ?? 0);
    }

    if (body.revenue !== undefined) {
      const provided = body.revenue !== null && body.revenue !== "";
      const rev = provided ? parseMoney(body.revenue) : null;
      if (provided && rev === null) {
        return NextResponse.json(
          { error: "revenue must be a non-negative number" },
          { status: 400 }
        );
      }
      setClauses.push(`revenue = $${i++}`);
      values.push(rev);
    }

    if (body.notes !== undefined) {
      const notes =
        typeof body.notes === "string" && body.notes.trim().length > 0
          ? body.notes.trim()
          : null;
      setClauses.push(`notes = $${i++}`);
      values.push(notes);
    }

    // Phase 4: address presence (regardless of whether it actually changed)
    // triggers a mileage recompute. Handles both genuine address edits AND
    // the "Recalculate mileage" affordance (commit 6) which PATCHes the
    // unchanged address. When the new address is null OR the client has no
    // home_address, miles get nulled out (can't compute → previous value
    // is stale and should clear).
    if (body.address !== undefined) {
      const newAddress =
        typeof body.address === "string" && body.address.trim().length > 0
          ? body.address.trim()
          : null;
      setClauses.push(`address = $${i++}`);
      values.push(newAddress);

      const homeAddress =
        typeof client.home_address === "string" &&
        client.home_address.trim().length > 0
          ? client.home_address.trim()
          : null;
      let newMiles: number | null = null;
      if (homeAddress && newAddress) {
        newMiles = await computeRoundTripMiles(homeAddress, newAddress);
      }
      setClauses.push(`round_trip_miles = $${i++}`);
      values.push(newMiles);
      setClauses.push(`mileage_computed_at = $${i++}`);
      values.push(newMiles !== null ? new Date() : null);
    }

    // returnsHomeNightly updates the column but doesn't trigger a maps
    // API call — per-trip distance is unchanged, only the displayed
    // total derives differently (§8.2).
    if (body.returnsHomeNightly !== undefined) {
      if (typeof body.returnsHomeNightly !== "boolean") {
        return NextResponse.json(
          { error: "returnsHomeNightly must be a boolean" },
          { status: 400 }
        );
      }
      setClauses.push(`returns_home_nightly = $${i++}`);
      values.push(body.returnsHomeNightly);
    }

    // Validate items payload up front (before opening a transaction).
    let parsedItems:
      | { productName: string; quantity: number; unitPrice: number }[]
      | null = null;
    if (body.items !== undefined) {
      if (!Array.isArray(body.items)) {
        return NextResponse.json(
          { error: "items must be an array" },
          { status: 400 }
        );
      }
      parsedItems = [];
      for (let idx = 0; idx < body.items.length; idx++) {
        const raw = body.items[idx] as PatchItemInput;
        if (!isNonEmptyString(raw?.productName)) {
          return NextResponse.json(
            { error: `items[${idx}].productName is required` },
            { status: 400 }
          );
        }
        const qtyNum =
          typeof raw.quantity === "number" ? raw.quantity : Number(raw.quantity);
        if (!Number.isInteger(qtyNum) || qtyNum < 1) {
          return NextResponse.json(
            { error: `items[${idx}].quantity must be a positive integer` },
            { status: 400 }
          );
        }
        const unitPrice = parseMoney(raw.unitPrice);
        if (
          unitPrice === null &&
          raw.unitPrice !== undefined &&
          raw.unitPrice !== null &&
          raw.unitPrice !== ""
        ) {
          return NextResponse.json(
            { error: `items[${idx}].unitPrice must be a non-negative number` },
            { status: 400 }
          );
        }
        parsedItems.push({
          productName: raw.productName.trim(),
          quantity: qtyNum,
          unitPrice: unitPrice ?? 0,
        });
      }
    }

    // If date range is being modified, validate the resulting range
    // against the row's current values for the side not being updated.
    if (startDateForRangeCheck !== undefined || endDateForRangeCheck !== undefined) {
      const currentResult = await pool.query<EventRow>(
        `SELECT start_date, end_date FROM events WHERE id = $1 AND client_id = $2`,
        [eventId, client.id]
      );
      if (currentResult.rows.length === 0) {
        return NextResponse.json({ error: "Event not found" }, { status: 404 });
      }
      const finalStart =
        startDateForRangeCheck ?? currentResult.rows[0].start_date;
      const finalEnd = endDateForRangeCheck ?? currentResult.rows[0].end_date;
      if (finalEnd < finalStart) {
        return NextResponse.json(
          { error: "endDate must be on or after startDate" },
          { status: 400 }
        );
      }
    }

    // Always bump updated_at, even if only items changed (no event-row fields).
    setClauses.push(`updated_at = NOW()`);

    // Open a transaction if items are being replaced, otherwise a simple
    // UPDATE is enough. Either way, return the latest event + items.
    const dbClient = await pool.connect();
    try {
      await dbClient.query("BEGIN");

      // Update the event row. WHERE includes client_id for tenant safety.
      const updateResult = await dbClient.query<EventRow>(
        `UPDATE events
            SET ${setClauses.join(", ")}
          WHERE id = $${i++} AND client_id = $${i++}
        RETURNING id, client_id, name, start_date, end_date, venue,
                  revenue, booth_fee, notes, created_at, updated_at,
                  address, returns_home_nightly, round_trip_miles,
                  mileage_computed_at`,
        [...values, eventId, client.id]
      );
      if (updateResult.rows.length === 0) {
        await dbClient.query("ROLLBACK");
        return NextResponse.json(
          { error: "Event not found" },
          { status: 404 }
        );
      }

      // Replace event_items atomically when items[] is present.
      // Delete-then-insert keeps the editor's "save the whole list" UX
      // simple — no per-row diff logic at the API.
      if (parsedItems !== null) {
        await dbClient.query(
          `DELETE FROM event_items WHERE event_id = $1 AND client_id = $2`,
          [eventId, client.id]
        );
        for (const item of parsedItems) {
          await dbClient.query(
            `INSERT INTO event_items
               (event_id, client_id, product_name, quantity, unit_price)
             VALUES ($1, $2, $3, $4, $5)`,
            [eventId, client.id, item.productName, item.quantity, item.unitPrice]
          );
        }
      }

      const itemsResult = await dbClient.query<EventItemRow>(
        `SELECT id, event_id, client_id, product_name, quantity, unit_price, created_at
           FROM event_items
          WHERE event_id = $1 AND client_id = $2
          ORDER BY id ASC`,
        [eventId, client.id]
      );

      await dbClient.query("COMMIT");

      return NextResponse.json({
        event: serializeEvent(updateResult.rows[0]),
        items: itemsResult.rows.map(serializeItem),
      });
    } catch (txErr) {
      await dbClient.query("ROLLBACK");
      throw txErr;
    } finally {
      dbClient.release();
    }
  } catch (error) {
    console.error("Event PATCH error:", error);
    return NextResponse.json(
      { error: "Failed to update event" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _req: NextRequest,
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

    // Two-step in a transaction:
    //   1. Null out event_id on any linked processed_items rows. The FK is
    //      non-cascade by design (§8.5) — transactions survive event delete.
    //   2. Delete the event. event_items cascade via ON DELETE CASCADE.
    const dbClient = await pool.connect();
    try {
      await dbClient.query("BEGIN");

      await dbClient.query(
        `UPDATE processed_items
            SET event_id = NULL
          WHERE event_id = $1 AND client_id = $2`,
        [eventId, client.id]
      );

      const deleteResult = await dbClient.query(
        `DELETE FROM events WHERE id = $1 AND client_id = $2`,
        [eventId, client.id]
      );
      if ((deleteResult.rowCount ?? 0) === 0) {
        await dbClient.query("ROLLBACK");
        return NextResponse.json(
          { error: "Event not found" },
          { status: 404 }
        );
      }

      await dbClient.query("COMMIT");
      return NextResponse.json({ success: true });
    } catch (txErr) {
      await dbClient.query("ROLLBACK");
      throw txErr;
    } finally {
      dbClient.release();
    }
  } catch (error) {
    console.error("Event DELETE error:", error);
    return NextResponse.json(
      { error: "Failed to delete event" },
      { status: 500 }
    );
  }
}
