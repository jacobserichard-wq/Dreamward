import pool from "@/lib/db";

/**
 * Match a date to a client's event by start_date/end_date range.
 *
 * Returns the event id only when the date falls inside exactly one event's
 * range. Zero matches → null (no event for that date). Two or more matches
 * (overlapping events) → null (let the user resolve in the review modal —
 * design §8.8).
 *
 * Used in two places:
 *   - /api/upload's per-row auto-coding when the request doesn't carry a
 *     batch event id (commit 7).
 *   - Reusable for /api/process auto-linking if/when Gmail-ingested items
 *     should also auto-link (optional fast-follow noted in design §4).
 *
 * @param clientId  The tenant scope — every query filters by client_id.
 * @param date      YYYY-MM-DD ISO date string. Invalid formats return null.
 */
export async function matchEventByDate(
  clientId: number,
  date: string
): Promise<number | null> {
  // Reject invalid date strings up front — saves a DB round-trip and
  // matches the DATE column's accepted shape.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  // LIMIT 2 is the cheapest way to distinguish "exactly one" from
  // "zero or two-plus" — Postgres can early-exit after finding a second
  // overlapping event without scanning further.
  const result = await pool.query<{ id: number }>(
    `SELECT id
       FROM events
      WHERE client_id = $1
        AND $2::date BETWEEN start_date AND end_date
      LIMIT 2`,
    [clientId, date]
  );
  if (result.rowCount !== 1) return null;
  return result.rows[0].id;
}
