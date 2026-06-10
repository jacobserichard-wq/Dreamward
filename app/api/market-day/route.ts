// app/api/market-day/route.ts
//
// Market-day mode (design: session-notes/design-market-day-mode.md).
// GET — everything the /market-day page needs in one round trip:
//
//   GET /api/market-day?day=YYYY-MM-DD[&eventId=N]
//   →  {
//        events,   // events whose date range covers `day` (picker)
//        event,    // the chosen one (eventId param, or the single
//                  // candidate) — null when none/ambiguous
//        parent,   // today's running "Market sales" row, or null
//        sales,    // its line items, newest first
//        total,    // parent.amount as a number
//        skus,     // active SKUs for the tap grid
//      }
//
// `day` comes from the CLIENT's local clock — the vendor's "today"
// at a Saturday market is their timezone's date, not the server's
// UTC date. The server treats it as an opaque YYYY-MM-DD key.
//
// Paying tiers (feature-flat pricing).

import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getSessionClient } from "@/lib/getClient";
import { isPayingTier } from "@/lib/plans";

function isValidISODate(v: unknown): v is string {
  if (typeof v !== "string") return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  return !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime());
}

export async function GET(req: NextRequest) {
  try {
    const client = await getSessionClient();
    if (!client) {
      return NextResponse.json(
        { error: "Not authenticated" },
        { status: 401 }
      );
    }
    if (!isPayingTier(client.plan)) {
      return NextResponse.json(
        { error: "This feature requires an active subscription." },
        { status: 403 }
      );
    }

    const params = req.nextUrl.searchParams;
    const day = params.get("day");
    if (!isValidISODate(day)) {
      return NextResponse.json(
        { error: "day must be YYYY-MM-DD" },
        { status: 400 }
      );
    }
    const eventIdParam = params.get("eventId");
    const eventId = eventIdParam !== null ? Number(eventIdParam) : null;
    if (
      eventIdParam !== null &&
      (!Number.isInteger(eventId) || (eventId as number) <= 0)
    ) {
      return NextResponse.json({ error: "Invalid eventId" }, { status: 400 });
    }

    // ── Candidate events: date range covers `day`. Single-day
    // events have end_date NULL → treat as start_date. ─────────────
    const eventsRes = await pool.query<{
      id: number;
      name: string;
      start_date: string;
      end_date: string | null;
      venue: string | null;
    }>(
      `SELECT id, name, start_date, end_date, venue
         FROM events
        WHERE client_id = $1
          AND start_date <= $2::date
          AND COALESCE(end_date, start_date) >= $2::date
        ORDER BY start_date DESC, id DESC`,
      [client.id, day]
    );
    const candidates = eventsRes.rows.map((e) => ({
      id: e.id,
      name: e.name,
      startDate: e.start_date,
      endDate: e.end_date,
      venue: e.venue,
    }));

    // Chosen event: explicit param wins (validated against the
    // tenant, NOT against the candidate list — logging yesterday's
    // market after the fact is legitimate); else the single
    // candidate; else null and the UI shows the picker/empty state.
    let event: (typeof candidates)[number] | null = null;
    if (eventId !== null) {
      const found = await pool.query<{
        id: number;
        name: string;
        start_date: string;
        end_date: string | null;
        venue: string | null;
      }>(
        `SELECT id, name, start_date, end_date, venue
           FROM events
          WHERE id = $1 AND client_id = $2`,
        [eventId, client.id]
      );
      if (found.rowCount === 0) {
        return NextResponse.json(
          { error: "Event not found" },
          { status: 404 }
        );
      }
      const e = found.rows[0];
      event = {
        id: e.id,
        name: e.name,
        startDate: e.start_date,
        endDate: e.end_date,
        venue: e.venue,
      };
    } else if (candidates.length === 1) {
      event = candidates[0];
    }

    // ── Running parent row + its sales for (event, day) ──────────
    let parent: { id: number; amount: number } | null = null;
    let sales: Array<{
      id: number;
      name: string;
      unitPrice: number;
      quantity: number;
      matchedSkuId: number | null;
      createdAt: string;
    }> = [];
    if (event) {
      const parentRes = await pool.query<{ id: number; amount: string }>(
        `SELECT id, amount
           FROM processed_items
          WHERE client_id = $1 AND source = 'market_day'
            AND event_id = $2 AND due_date = $3::date`,
        [client.id, event.id, day]
      );
      if ((parentRes.rowCount ?? 0) > 0) {
        parent = {
          id: parentRes.rows[0].id,
          amount: Number(parentRes.rows[0].amount),
        };
        const salesRes = await pool.query<{
          id: number;
          name: string;
          unit_price: string;
          quantity: string;
          matched_sku_id: number | null;
          created_at: string;
        }>(
          `SELECT id, name, unit_price, quantity, matched_sku_id, created_at
             FROM processed_item_line_items
            WHERE processed_item_id = $1
            ORDER BY id DESC`,
          [parent.id]
        );
        sales = salesRes.rows.map((r) => ({
          id: r.id,
          name: r.name,
          unitPrice: Number(r.unit_price),
          quantity: Number(r.quantity),
          matchedSkuId: r.matched_sku_id,
          createdAt: r.created_at,
        }));
      }
    }

    // ── Tap-grid SKUs ─────────────────────────────────────────────
    const skusRes = await pool.query<{
      id: number;
      code: string;
      name: string;
      default_sell_price: string | null;
      quantity_on_hand: string;
      unit: string;
    }>(
      `SELECT id, code, name, default_sell_price, quantity_on_hand, unit
         FROM skus
        WHERE client_id = $1 AND active = TRUE
        ORDER BY name ASC`,
      [client.id]
    );

    return NextResponse.json({
      events: candidates,
      event,
      parent,
      sales,
      total: parent?.amount ?? 0,
      skus: skusRes.rows.map((s) => ({
        id: s.id,
        code: s.code,
        name: s.name,
        defaultSellPrice:
          s.default_sell_price != null ? Number(s.default_sell_price) : null,
        quantityOnHand: Number(s.quantity_on_hand),
        unit: s.unit,
      })),
    });
  } catch (err) {
    console.error("Market-day GET error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load" },
      { status: 500 }
    );
  }
}
