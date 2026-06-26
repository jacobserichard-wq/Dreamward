// app/api/stripe-connect/backfill/route.ts
//
// Pull a connected Stripe account's historical charges in as income
// (channel 'stripe'). Mirrors the Square backfill but simpler: each charge
// is one income transaction + one (SKU-less) line item — no order fetch,
// no tax/tip breakdown.
//
// POST — chunked + resumable. Reads charges newest-first via cursor
// pagination, persists backfill_cursor, and processes up to MAX_PAGES per
// call. Returns { imported, totalImported, hasMore } so the caller can
// re-invoke until hasMore is false. Idempotent: ON CONFLICT
// (client_id, source, source_ref_id) DO NOTHING dedups re-runs.

import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getSessionClient } from "@/lib/getClient";
import { isPayingTier } from "@/lib/plans";
import {
  listConnectedCharges,
  isIngestibleCharge,
  chargeToProcessedItem,
  chargeToLineItem,
  chargeSoldAtIso,
} from "@/lib/stripeConnect";
import { bulkInsertLineItemsAcrossParents } from "@/lib/cogs/lineItems";

const MAX_PAGES = 20; // up to 2000 charges per invocation

export async function POST() {
  try {
    const client = await getSessionClient();
    if (!client) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    if (!isPayingTier(client.plan)) {
      return NextResponse.json(
        { error: "Stripe integration is a Pro feature." },
        { status: 403 }
      );
    }

    const conn = await pool.query<{
      stripe_account_id: string;
      backfill_cursor: string | null;
      backfill_charges_imported: number;
      backfill_started_at: string | null;
    }>(
      `SELECT stripe_account_id, backfill_cursor, backfill_charges_imported,
              backfill_started_at
         FROM stripe_connections
        WHERE client_id = $1`,
      [client.id]
    );
    if (conn.rowCount === 0) {
      return NextResponse.json(
        { error: "No Stripe account connected. Connect one first." },
        { status: 404 }
      );
    }
    const accountId = conn.rows[0].stripe_account_id;

    let cursor = conn.rows[0].backfill_cursor;
    let importedThisRun = 0;
    let hasMore = true;
    let pages = 0;

    try {
      while (hasMore && pages < MAX_PAGES) {
        pages++;
        const page = await listConnectedCharges({
          accountId,
          startingAfter: cursor,
          limit: 100,
        });
        if (page.charges.length === 0) {
          hasMore = page.hasMore;
          break;
        }
        // Advance the cursor by ALL charges so pagination never stalls on a
        // page where nothing was ingestible.
        cursor = page.charges[page.charges.length - 1].id;

        const ingestible = page.charges.filter(isIngestibleCharge);
        if (ingestible.length > 0) {
          const rows = ingestible.map(chargeToProcessedItem);
          const values: unknown[] = [];
          const placeholders = rows
            .map((r) => {
              const b = values.length;
              values.push(
                r.vendor,
                r.invoice_number,
                r.amount,
                r.due_date,
                r.status,
                r.category,
                r.source,
                r.source_ref_id,
                r.channel,
                r.confidence,
                r.summary,
                JSON.stringify(r.extracted_data),
                client.id
              );
              return (
                `($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, ` +
                `$${b + 6}, $${b + 7}, $${b + 8}, $${b + 9}, $${b + 10}, ` +
                `$${b + 11}, $${b + 12}::jsonb, $${b + 13})`
              );
            })
            .join(",");

          const insertRes = await pool.query<{
            id: number;
            source_ref_id: string;
          }>(
            `INSERT INTO processed_items (
               vendor, invoice_number, amount, due_date, status,
               category, source, source_ref_id, channel, confidence,
               summary, extracted_data, client_id
             ) VALUES ${placeholders}
             ON CONFLICT (client_id, source, source_ref_id)
               WHERE source_ref_id IS NOT NULL
             DO NOTHING
             RETURNING id, source_ref_id`,
            values
          );

          if (insertRes.rowCount && insertRes.rowCount > 0) {
            const chargeById = new Map(ingestible.map((c) => [c.id, c]));
            const parents = insertRes.rows
              .map((row) => {
                const charge = chargeById.get(row.source_ref_id);
                if (!charge) return null;
                return {
                  parentId: row.id,
                  soldAt: chargeSoldAtIso(charge),
                  items: [chargeToLineItem(charge)],
                };
              })
              .filter((p): p is NonNullable<typeof p> => p !== null);

            if (parents.length > 0) {
              await bulkInsertLineItemsAcrossParents({
                clientId: client.id,
                platform: "stripe",
                parents,
              });
            }
            importedThisRun += insertRes.rowCount;
          }
        }

        hasMore = page.hasMore;
      }
    } catch (syncErr) {
      console.error("Stripe backfill page error:", syncErr);
      await pool.query(
        `UPDATE stripe_connections
            SET last_sync_status = 'failed',
                last_sync_error = $2,
                backfill_cursor = $3,
                updated_at = NOW()
          WHERE client_id = $1`,
        [
          client.id,
          syncErr instanceof Error ? syncErr.message : String(syncErr),
          cursor,
        ]
      );
      return NextResponse.json(
        { error: "Stripe sync hit an error; progress saved. Try again." },
        { status: 502 }
      );
    }

    const totalImported =
      conn.rows[0].backfill_charges_imported + importedThisRun;

    await pool.query(
      `UPDATE stripe_connections
          SET backfill_cursor = $2,
              backfill_charges_imported = $3,
              backfill_started_at = COALESCE(backfill_started_at, NOW()),
              backfill_completed_at = CASE WHEN $4 THEN backfill_completed_at ELSE NOW() END,
              last_sync_at = NOW(),
              last_sync_status = CASE WHEN $4 THEN 'partial' ELSE 'success' END,
              last_sync_error = NULL,
              updated_at = NOW()
        WHERE client_id = $1`,
      [client.id, cursor, totalImported, hasMore]
    );

    return NextResponse.json({
      imported: importedThisRun,
      totalImported,
      hasMore,
    });
  } catch (err) {
    console.error("Stripe Connect backfill error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Backfill failed" },
      { status: 500 }
    );
  }
}
