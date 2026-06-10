// app/api/market-day/sale/route.ts
//
// Market-day mode: log one sale (one tap at the booth).
//
//   POST /api/market-day/sale
//   Body: { eventId, day, skuId? , customName?, price }
//   →    { sale, total }
//
// Storage design (D1, session-notes/design-market-day-mode.md):
// ONE running processed_items parent per (event, day) — vendor
// "Market sales — {event}", source='market_day', channel='markets',
// status='paid' — whose amount accumulates; each tap appends one
// processed_item_line_items row. SKU taps set matched_sku_id
// DIRECTLY (no alias join — we know the SKU) and record a sale
// adjustment, so stock, COGS, event P&L, and the Markets channel
// all light up through the exact pipeline platform sales use.
//
// Concurrency: rapid double-taps could both miss the parent SELECT
// and double-insert it. pg_advisory_xact_lock(client_id, event_id)
// serializes parent creation per event without needing a unique
// index migration; the lock releases at COMMIT/ROLLBACK.

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import pool from "@/lib/db";
import { getSessionClient } from "@/lib/getClient";
import { isPayingTier } from "@/lib/plans";
import { recordSaleAdjustments } from "@/lib/inventory/adjustments";

interface SaleBody {
  eventId?: unknown;
  day?: unknown;
  skuId?: unknown;
  customName?: unknown;
  price?: unknown;
}

function isValidISODate(v: unknown): v is string {
  if (typeof v !== "string") return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
  return !Number.isNaN(new Date(`${v}T00:00:00Z`).getTime());
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
    if (!isPayingTier(client.plan)) {
      return NextResponse.json(
        { error: "This feature requires an active subscription." },
        { status: 403 }
      );
    }

    const body = (await req.json().catch(() => null)) as SaleBody | null;
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const eventId = Number(body.eventId);
    if (!Number.isInteger(eventId) || eventId <= 0) {
      return NextResponse.json({ error: "Invalid eventId" }, { status: 400 });
    }
    if (!isValidISODate(body.day)) {
      return NextResponse.json(
        { error: "day must be YYYY-MM-DD" },
        { status: 400 }
      );
    }
    const day = body.day;
    const price = Number(body.price);
    if (!Number.isFinite(price) || price <= 0) {
      return NextResponse.json(
        { error: "price must be a positive number" },
        { status: 400 }
      );
    }

    const skuId = body.skuId !== undefined ? Number(body.skuId) : null;
    if (skuId !== null && (!Number.isInteger(skuId) || skuId <= 0)) {
      return NextResponse.json({ error: "Invalid skuId" }, { status: 400 });
    }
    const customName =
      typeof body.customName === "string" && body.customName.trim().length > 0
        ? body.customName.trim()
        : null;
    if (skuId === null && customName === null) {
      return NextResponse.json(
        { error: "Provide a skuId or a customName" },
        { status: 400 }
      );
    }

    // ── Tenant checks outside the transaction ────────────────────
    const eventRes = await pool.query<{ name: string }>(
      `SELECT name FROM events WHERE id = $1 AND client_id = $2`,
      [eventId, client.id]
    );
    if (eventRes.rowCount === 0) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }
    const eventName = eventRes.rows[0].name;

    let saleName = customName ?? "";
    let skuCode: string | null = null;
    if (skuId !== null) {
      const skuRes = await pool.query<{ code: string; name: string }>(
        `SELECT code, name FROM skus
          WHERE id = $1 AND client_id = $2 AND active = TRUE`,
        [skuId, client.id]
      );
      if (skuRes.rowCount === 0) {
        return NextResponse.json({ error: "SKU not found" }, { status: 404 });
      }
      saleName = skuRes.rows[0].name;
      skuCode = skuRes.rows[0].code;
    }

    // ── Transaction: parent upsert → line item → stock → total ──
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      await db.query(`SELECT pg_advisory_xact_lock($1, $2)`, [
        client.id,
        eventId,
      ]);

      let parentId: number;
      const parentRes = await db.query<{ id: number }>(
        `SELECT id FROM processed_items
          WHERE client_id = $1 AND source = 'market_day'
            AND event_id = $2 AND due_date = $3::date
          FOR UPDATE`,
        [client.id, eventId, day]
      );
      if ((parentRes.rowCount ?? 0) > 0) {
        parentId = parentRes.rows[0].id;
      } else {
        const inserted = await db.query<{ id: number }>(
          `INSERT INTO processed_items (
             vendor, invoice_number, amount, due_date, status,
             category, confidence, summary, extracted_data,
             client_id, source, event_id, channel
           ) VALUES ($1, NULL, 0, $2::date, 'paid',
                     'Sales', 100, $3, $4,
                     $5, 'market_day', $6, 'markets')
           RETURNING id`,
          [
            `Market sales — ${eventName}`,
            day,
            "Logged live at the booth with Market Day mode",
            JSON.stringify({ logged_via: "market_day" }),
            client.id,
            eventId,
          ]
        );
        parentId = inserted.rows[0].id;
      }

      const lineRes = await db.query<{ id: number; created_at: string }>(
        `INSERT INTO processed_item_line_items (
           processed_item_id, client_id, platform, external_id,
           external_item_id, external_sku, name, quantity,
           unit_price, currency, sold_at, matched_sku_id
         ) VALUES ($1, $2, 'market', $3, NULL, $4, $5, 1, $6, 'USD',
                   $7::date, $8)
         RETURNING id, created_at`,
        [
          parentId,
          client.id,
          randomUUID(),
          skuCode,
          saleName,
          price,
          day,
          skuId,
        ]
      );
      const lineItemId = lineRes.rows[0].id;

      if (skuId !== null) {
        await recordSaleAdjustments({
          dbClient: db,
          items: [{ lineItemId, skuId, quantity: 1 }],
        });
      }

      const totalRes = await db.query<{ amount: string }>(
        `UPDATE processed_items
            SET amount = amount + $1, updated_at = NOW()
          WHERE id = $2
          RETURNING amount`,
        [price, parentId]
      );

      await db.query("COMMIT");
      return NextResponse.json({
        sale: {
          id: lineItemId,
          name: saleName,
          unitPrice: price,
          quantity: 1,
          matchedSkuId: skuId,
          createdAt: lineRes.rows[0].created_at,
        },
        total: Number(totalRes.rows[0].amount),
      });
    } catch (err) {
      await db.query("ROLLBACK");
      throw err;
    } finally {
      db.release();
    }
  } catch (err) {
    console.error("Market-day sale POST error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Couldn't log the sale" },
      { status: 500 }
    );
  }
}
