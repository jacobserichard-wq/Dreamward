// app/api/shopify/backfill/route.ts
//
// Phase 8c commit 2 of 5.
//
// POST endpoint that pulls Shopify orders into processed_items.
// Designed to be CHUNKED + RESUMABLE so it works inside Vercel's
// serverless function time budget without external job queues.
//
// Mechanics:
//   1. Load the client's shopify_connection row + decrypt token
//   2. Start a time budget (50s — Vercel Pro plan has 60s limit;
//      leaves headroom for the final UPDATE + response)
//   3. Loop: fetch a page of 250 orders, INSERT bulk into
//      processed_items (with ON CONFLICT DO NOTHING so re-runs
//      don't duplicate), advance since_id, update progress counter
//   4. Stop conditions (any one of):
//      - Reached the 30k free cap AND no extended_paid_at marker
//      - Reached end of order history (page returned <250)
//      - Time budget exhausted (next request resumes)
//   5. On end-of-history: set backfill_completed_at = NOW()
//   6. Return { done, ordersImported, totalImported, cappedAt30k }
//
// Frontend (ShopifyConnectionCard, next commit) polls this endpoint
// every 5 seconds while backfill is in-progress; re-POSTs whenever
// done=false comes back, until done=true.
//
// Idempotency: the partial unique index on
// processed_items(client_id, source, source_ref_id) means re-runs
// safely skip orders we already inserted. ON CONFLICT DO NOTHING
// makes the bulk INSERT a no-op for duplicates rather than erroring.

import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getSessionClient } from "@/lib/getClient";
import { decryptFromDb } from "@/lib/crypto";
import {
  listOrders,
  mapOrderToProcessedItem,
  extractShopifyLineItems,
  type ShopifyOrder,
} from "@/lib/shopify";
import { bulkInsertLineItemsAcrossParents } from "@/lib/cogs/lineItems";
import { isPayingTier } from "@/lib/plans";

// Free-tier cap (locked design decision 4.7). Configurable via env
// var so we can A/B-test without a deploy. Default 30,000.
const DEFAULT_FREE_LIMIT = 30000;

// Per-request time budget. Vercel Pro = 60s hard limit; leaving 10s
// headroom for the final state UPDATE + response serialization.
const TIME_BUDGET_MS = 50_000;

interface ConnectionRow {
  id: number;
  shop_domain: string;
  access_token_ciphertext: Buffer;
  access_token_iv: Buffer;
  access_token_auth_tag: Buffer;
  backfill_orders_imported: number;
  backfill_capped_at_30k: boolean;
  backfill_extended_paid_at: string | null;
  backfill_completed_at: string | null;
  import_start_date: string | null;
}

export async function POST() {
  const startMs = Date.now();
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
        { error: "Shopify integration is a Pro feature." },
        { status: 403 }
      );
    }

    // ── Load connection state ──────────────────────────────────
    const found = await pool.query<ConnectionRow>(
      `SELECT id, shop_domain,
              access_token_ciphertext, access_token_iv, access_token_auth_tag,
              backfill_orders_imported, backfill_capped_at_30k,
              backfill_extended_paid_at, backfill_completed_at,
              import_start_date::text AS import_start_date
         FROM shopify_connections
        WHERE client_id = $1`,
      [client.id]
    );
    if (found.rows.length === 0) {
      return NextResponse.json(
        { error: "No Shopify connection. Connect a store first." },
        { status: 404 }
      );
    }
    const conn = found.rows[0];

    // Already done — return done=true without re-fetching anything.
    if (conn.backfill_completed_at) {
      return NextResponse.json({
        done: true,
        ordersImported: 0,
        totalImported: conn.backfill_orders_imported,
        cappedAt30k: conn.backfill_capped_at_30k,
      });
    }

    // ── Decrypt token + mark backfill as started (idempotent) ──
    const accessToken = decryptFromDb({
      ciphertext: conn.access_token_ciphertext,
      iv: conn.access_token_iv,
      authTag: conn.access_token_auth_tag,
    });

    await pool.query(
      `UPDATE shopify_connections
          SET backfill_started_at = COALESCE(backfill_started_at, NOW()),
              last_sync_status = 'in_progress',
              updated_at = NOW()
        WHERE id = $1`,
      [conn.id]
    );

    // ── Determine the cap for this run ─────────────────────────
    const freeLimit = Number(
      process.env.SHOPIFY_BACKFILL_FREE_LIMIT ?? DEFAULT_FREE_LIMIT
    );
    const extendedPaid = conn.backfill_extended_paid_at !== null;
    const hardCap = extendedPaid ? Infinity : freeLimit;

    // ── Resume sinceId from last successful insert ─────────────
    // We track the highest source_ref_id we've inserted as the
    // since_id cursor. Querying MAX is cheap (indexed column).
    const cursorRes = await pool.query<{ max: string | null }>(
      `SELECT MAX(source_ref_id::bigint)::text AS max
         FROM processed_items
        WHERE client_id = $1 AND source = 'shopify'`,
      [client.id]
    );
    let sinceId = cursorRes.rows[0]?.max ? Number(cursorRes.rows[0].max) : 0;
    // "Import from" cutoff → Shopify created_at_min (ISO). undefined = all.
    const createdAtMin = conn.import_start_date
      ? new Date(`${conn.import_start_date}T00:00:00Z`).toISOString()
      : undefined;
    let totalImported = conn.backfill_orders_imported;
    let ordersThisRun = 0;
    let done = false;
    let cappedAt30k = conn.backfill_capped_at_30k;

    // ── Main loop ──────────────────────────────────────────────
    while (true) {
      // Time budget check
      if (Date.now() - startMs > TIME_BUDGET_MS) {
        // Out of time — next POST will resume from where we left off
        break;
      }

      // Hard-cap check
      if (totalImported >= hardCap) {
        cappedAt30k = true;
        break;
      }

      // Fetch a page
      let page: { orders: ShopifyOrder[]; nextSinceId: number | null };
      try {
        page = await listOrders({
          shopDomain: conn.shop_domain,
          accessToken,
          sinceId,
          limit: 250,
          createdAtMin,
        });
      } catch (err) {
        // Shopify error — record it, stop. Frontend retries via the
        // next POST (which will get a fresh API call).
        await pool.query(
          `UPDATE shopify_connections
              SET last_sync_status = 'failed',
                  last_sync_error = $1,
                  updated_at = NOW()
            WHERE id = $2`,
          [err instanceof Error ? err.message.slice(0, 500) : "unknown", conn.id]
        );
        throw err;
      }

      if (page.orders.length === 0) {
        // End of history. Mark backfill complete.
        done = true;
        break;
      }

      // ── Bulk INSERT with ON CONFLICT DO NOTHING ──────────────
      // Build a multi-row VALUES list. Safer than INSERT-per-row
      // for backfill perf (1 query per 250 orders vs 250 queries).
      //
      // Phase 12c: now RETURNING (id, source_ref_id) so we can
      // map each freshly-inserted parent row back to its source
      // ShopifyOrder + fan its line items out into
      // processed_item_line_items. Duplicates skipped by
      // ON CONFLICT don't appear in the returning set, so we
      // skip line-item fan-out for them (already-imported orders
      // don't double up — re-importing historical line items
      // requires the separate "Re-import line items" path that
      // ships in Phase 12g polish).
      const ordersThisPage = page.orders.slice(
        0,
        Math.max(0, hardCap - totalImported)
      );
      const rows = ordersThisPage.map(mapOrderToProcessedItem);

      if (rows.length > 0) {
        // Build parameterized VALUES. Each row needs 13 params
        // (vendor, invoice_number, amount, tax_amount, due_date, status,
        // category, source, source_ref_id, confidence, summary,
        // extracted_data, client_id).
        const values: unknown[] = [];
        const placeholders = rows
          .map((r) => {
            const base = values.length;
            values.push(
              r.vendor,
              r.invoice_number,
              r.amount,
              r.tax_amount,
              r.due_date,
              r.status,
              r.category,
              r.source,
              r.source_ref_id,
              r.confidence,
              r.summary,
              JSON.stringify(r.extracted_data),
              client.id
            );
            return (
              "(" +
              Array.from({ length: 13 }, (_, j) => `$${base + j + 1}`).join(",") +
              ")"
            );
          })
          .join(",");

        // ON CONFLICT must include the partial index's WHERE predicate
        // (source_ref_id IS NOT NULL) to match. Otherwise PostgreSQL
        // throws "no unique or exclusion constraint matching the
        // ON CONFLICT specification" on the first duplicate. The unique
        // index spec lives in migration 0010_add_shopify_connections.sql:
        //   CREATE UNIQUE INDEX idx_processed_items_source_ref
        //     ON processed_items (client_id, source, source_ref_id)
        //     WHERE source_ref_id IS NOT NULL;
        const insertRes = await pool.query<{
          id: number;
          source_ref_id: string;
        }>(
          `INSERT INTO processed_items (
             vendor, invoice_number, amount, tax_amount, due_date, status,
             category, source, source_ref_id, confidence, summary,
             extracted_data, client_id
           ) VALUES ${placeholders}
           ON CONFLICT (client_id, source, source_ref_id)
             WHERE source_ref_id IS NOT NULL
           DO NOTHING
           RETURNING id, source_ref_id`,
          values
        );

        // ── Phase 12c: fan line items into processed_item_line_items
        // for every parent row we just freshly inserted. ON CONFLICT
        // skips already-imported parents, so this only runs for new
        // ones — matches "don't re-fan historical line items on
        // backfill re-runs" semantics.
        if (insertRes.rowCount && insertRes.rowCount > 0) {
          const orderById = new Map<string, ShopifyOrder>();
          for (const o of ordersThisPage) orderById.set(String(o.id), o);
          const parents = insertRes.rows
            .map((r) => {
              const order = orderById.get(r.source_ref_id);
              if (!order) return null;
              const mapped = mapOrderToProcessedItem(order);
              return {
                parentId: r.id,
                soldAt: mapped.due_date,
                items: extractShopifyLineItems(order),
              };
            })
            .filter((p): p is NonNullable<typeof p> => p !== null);
          if (parents.length > 0) {
            await bulkInsertLineItemsAcrossParents({
              clientId: client.id,
              platform: "shopify",
              parents,
            });
          }
        }

        totalImported += rows.length;
        ordersThisRun += rows.length;
      }

      // Update progress counter so the frontend poll sees movement.
      await pool.query(
        `UPDATE shopify_connections
            SET backfill_orders_imported = $1,
                last_sync_at = NOW(),
                updated_at = NOW()
          WHERE id = $2`,
        [totalImported, conn.id]
      );

      // Advance the cursor. If we got a full page and there's a
      // nextSinceId, continue. Otherwise, we're done with history.
      if (page.nextSinceId === null) {
        done = true;
        break;
      }
      sinceId = page.nextSinceId;
    }

    // ── Final state update ─────────────────────────────────────
    if (done) {
      await pool.query(
        `UPDATE shopify_connections
            SET backfill_completed_at = NOW(),
                last_sync_status = 'success',
                last_sync_error = NULL,
                backfill_capped_at_30k = $1,
                updated_at = NOW()
          WHERE id = $2`,
        [cappedAt30k, conn.id]
      );
    } else if (cappedAt30k) {
      // Hit the cap but didn't finish history. Mark capped but NOT
      // completed — the upgrade prompt UI uses this state.
      await pool.query(
        `UPDATE shopify_connections
            SET backfill_capped_at_30k = true,
                last_sync_status = 'partial',
                updated_at = NOW()
          WHERE id = $1`,
        [conn.id]
      );
      done = true; // tell the frontend to stop polling — user must pay to continue
    }

    return NextResponse.json({
      done,
      ordersImported: ordersThisRun,
      totalImported,
      cappedAt30k,
    });
  } catch (err) {
    console.error("Shopify backfill error:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Backfill failed",
      },
      { status: 500 }
    );
  }
}
