// app/api/wix/backfill/route.ts
//
// Phase 10c (Wix backfill). POST endpoint that pulls historical
// Wix orders into processed_items. Mirrors Shopify Phase 8c's
// chunked + resumable design — runs inside a 50s time budget,
// frontend polls and re-POSTs until done=true.
//
// Differences from Shopify backfill:
//   - Cursor pagination (Wix eCommerce v3) instead of since_id
//     numeric cursor → persisted in wix_connections.backfill_cursor
//     (migration 0015) since Wix order IDs are UUIDs (non-monotonic
//     so MAX(source_ref_id) doesn't work as a resume key).
//   - Client Credentials token (minted per-request from
//     lib/wix.mintAccessToken) instead of stored encrypted access
//     token. The cache inside mintAccessToken keeps this cheap.
//   - No free cap / paid extension. Wix stores are smaller on
//     average than Shopify; we'll add a cap later if usage demands.
//
// Idempotency: the unique index on processed_items(client_id,
// source, source_ref_id) means re-runs safely skip already-inserted
// orders via ON CONFLICT DO NOTHING.
//
// Frontend (WixConnectionCard, next commit) polls every 5 seconds
// while backfill is in-progress; re-POSTs whenever done=false comes
// back, until done=true.

import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { getSessionClient } from "@/lib/getClient";
import {
  fetchOrdersPage,
  mapWixOrderToProcessedItem,
  extractWixLineItems,
  mintAccessToken,
  type WixOrder,
} from "@/lib/wix";
import { bulkInsertLineItemsAcrossParents } from "@/lib/cogs/lineItems";
import { isPayingTier } from "@/lib/plans";

// Vercel Pro = 60s hard limit; leaving 10s headroom for final
// UPDATE + response serialization. Same as Shopify backfill.
const TIME_BUDGET_MS = 50_000;

interface ConnectionRow {
  id: number;
  instance_id: string;
  backfill_orders_imported: number;
  backfill_cursor: string | null;
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
        { error: "Wix integration is a Pro feature." },
        { status: 403 }
      );
    }

    // ── Load connection state ──────────────────────────────────
    const found = await pool.query<ConnectionRow>(
      `SELECT id,
              instance_id,
              backfill_orders_imported,
              backfill_cursor,
              backfill_completed_at,
              import_start_date::text AS import_start_date
         FROM wix_connections
        WHERE client_id = $1`,
      [client.id]
    );
    if (found.rows.length === 0) {
      return NextResponse.json(
        { error: "No Wix connection. Connect a site first." },
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
      });
    }

    // ── Mint token + mark backfill as started (idempotent) ─────
    const { accessToken } = await mintAccessToken({
      instanceId: conn.instance_id,
    });

    await pool.query(
      `UPDATE wix_connections
          SET backfill_started_at = COALESCE(backfill_started_at, NOW()),
              last_sync_status = 'in_progress',
              updated_at = NOW()
        WHERE id = $1`,
      [conn.id]
    );

    let cursor: string | null = conn.backfill_cursor;
    let totalImported = conn.backfill_orders_imported;
    // "Import from" cutoff → ISO timestamp; orders created before it are
    // skipped (client-side, mirrors the cron). null = all history.
    const cutoffIso = conn.import_start_date
      ? new Date(`${conn.import_start_date}T00:00:00Z`).toISOString()
      : null;
    let ordersThisRun = 0;
    let done = false;

    // ── Main loop ──────────────────────────────────────────────
    while (true) {
      // Time budget check
      if (Date.now() - startMs > TIME_BUDGET_MS) {
        // Out of time — next POST will resume from where we left off
        break;
      }

      // Fetch a page
      let page: Awaited<ReturnType<typeof fetchOrdersPage>>;
      try {
        page = await fetchOrdersPage({
          accessToken,
          cursor,
          limit: 100, // Wix max
        });
      } catch (err) {
        // Wix API error — record + stop. Frontend retries via the
        // next POST (which will re-mint the token).
        await pool.query(
          `UPDATE wix_connections
              SET last_sync_status = 'failed',
                  last_sync_error = $1,
                  updated_at = NOW()
            WHERE id = $2`,
          [
            err instanceof Error ? err.message.slice(0, 500) : "unknown",
            conn.id,
          ]
        );
        throw err;
      }

      if (page.orders.length === 0) {
        // End of history. Mark backfill complete.
        done = true;
        break;
      }

      // ── Bulk INSERT with ON CONFLICT DO NOTHING ──────────────
      // 13 fields per row (12 from MappedWixOrderRow + client_id).
      // Build a single multi-row INSERT for the whole page.
      // Apply the import cutoff (client-side, like the cron). A page with
      // no orders after the cutoff still advances the cursor below.
      const eligibleOrders = cutoffIso
        ? page.orders.filter(
            (o) => !o.createdDate || o.createdDate >= cutoffIso
          )
        : page.orders;
      const rows = eligibleOrders.map(mapWixOrderToProcessedItem);
      if (rows.length === 0) {
        cursor = page.nextCursor;
        await pool.query(
          `UPDATE wix_connections
              SET backfill_cursor = $1, last_sync_at = NOW(), updated_at = NOW()
            WHERE id = $2`,
          [cursor, conn.id]
        );
        if (cursor === null) {
          done = true;
          break;
        }
        continue;
      }
      const fieldsPerRow = 13;
      const values: unknown[] = [];
      const placeholders = rows
        .map((r) => {
          const base = values.length;
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
            "(" +
            Array.from(
              { length: fieldsPerRow },
              (_, j) => `$${base + j + 1}`
            ).join(",") +
            ")"
          );
        })
        .join(",");

      // ON CONFLICT must include the partial index's WHERE predicate
      // (source_ref_id IS NOT NULL) to match. Otherwise PostgreSQL
      // throws "no unique or exclusion constraint matching the
      // ON CONFLICT specification". The unique index spec lives in
      // migration 0010_add_shopify_connections.sql:
      //   CREATE UNIQUE INDEX idx_processed_items_source_ref
      //     ON processed_items (client_id, source, source_ref_id)
      //     WHERE source_ref_id IS NOT NULL;
      // Phase 12c: RETURNING (id, source_ref_id) so we can fan
      // line items out into processed_item_line_items for every
      // freshly-inserted parent. ON CONFLICT skips on duplicate
      // parents — we don't re-fan line items for already-imported
      // orders (re-importing historical line items needs the
      // explicit "Re-import line items" button queued for 12g).
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
        const orderById = new Map<string, WixOrder>();
        for (const o of page.orders) orderById.set(o.id, o);
        const parents = insertRes.rows
          .map((r) => {
            const order = orderById.get(r.source_ref_id);
            if (!order) return null;
            const mapped = mapWixOrderToProcessedItem(order);
            return {
              parentId: r.id,
              soldAt: mapped.due_date,
              items: extractWixLineItems(order),
            };
          })
          .filter((p): p is NonNullable<typeof p> => p !== null);
        if (parents.length > 0) {
          await bulkInsertLineItemsAcrossParents({
            clientId: client.id,
            platform: "wix",
            parents,
          });
        }
      }

      totalImported += rows.length;
      ordersThisRun += rows.length;
      cursor = page.nextCursor;

      // Update progress + cursor in one round-trip so the frontend
      // poll sees movement + a refresh resumes from this cursor.
      await pool.query(
        `UPDATE wix_connections
            SET backfill_orders_imported = $1,
                backfill_cursor = $2,
                last_sync_at = NOW(),
                updated_at = NOW()
          WHERE id = $3`,
        [totalImported, cursor, conn.id]
      );

      if (cursor === null) {
        // Wix says no more pages — done with history.
        done = true;
        break;
      }
    }

    // ── Final state update ─────────────────────────────────────
    if (done) {
      await pool.query(
        `UPDATE wix_connections
            SET backfill_completed_at = NOW(),
                backfill_cursor = NULL,
                last_sync_status = 'success',
                last_sync_error = NULL,
                updated_at = NOW()
          WHERE id = $1`,
        [conn.id]
      );
    }

    return NextResponse.json({
      done,
      ordersImported: ordersThisRun,
      totalImported,
    });
  } catch (err) {
    console.error("Wix backfill error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Backfill failed" },
      { status: 500 }
    );
  }
}
