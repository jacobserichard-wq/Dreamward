import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  sendEmail,
  trialExpiringEmail,
  cogsDailyDigestEmail,
  paymentPastDueEmail,
} from "@/lib/email";
import { SUPPORT_EMAIL } from "@/lib/support";
import {
  computeMargin,
  computeMarginBySku,
} from "@/lib/cogs/compute";
import { reclassifyClientItems } from "@/lib/reclassify";
import { type Industry } from "@/lib/categories";
import {
  fetchOrdersPage,
  mapWixOrderToProcessedItem,
  mintAccessToken,
} from "@/lib/wix";
import {
  fetchPaymentsPage,
  mapPaymentToProcessedItem,
  refreshAccessToken as squareRefreshAccessToken,
} from "@/lib/square";
import { decryptFromDb, encryptForDb } from "@/lib/crypto";
import {
  reconcileAllTiers,
  isFirstOfMonthUtc,
  cacheAllRevenue,
} from "@/lib/revenueTier";
import { recordInventorySnapshot } from "@/lib/inventory/valuation";
import {
  ensureFreshToken as etsyEnsureFreshToken,
  fetchReceiptsPage as etsyFetchReceiptsPage,
  mapReceiptToProcessedItem as etsyMapReceipt,
  mapReceiptRefundsToRows as etsyMapRefunds,
  mapTransactionsToLineItems as etsyMapLineItems,
} from "@/lib/etsy";
import { bulkInsertLineItemsAcrossParents } from "@/lib/cogs/lineItems";
import { syncTransactions } from "@/lib/plaid";

const UMBRELLA_VALUES = ["invoice", "expense", "ar_followup"];

// Phase 10e: how far back the Wix reconciliation pass looks. 25 hours
// gives a 1-hour overlap with the previous run so we don't miss
// orders created during the cron itself running. Idempotent upserts
// make the overlap safe.
const WIX_RECONCILE_LOOKBACK_HOURS = 25;

// Phase 11e: same lookback semantics for Square.
const SQUARE_RECONCILE_LOOKBACK_HOURS = 25;
const SQUARE_TOKEN_REFRESH_THRESHOLD_MS = 24 * 60 * 60 * 1000;

// Etsy integration: same 25h lookback. Unlike Shopify/Wix/Square,
// Etsy v1 has NO webhooks — this cron pass IS the ongoing sync, so
// (also unlike the Square pass) it fans line items for fresh rows.
// A side benefit of running daily: each pass refreshes the token
// pair, keeping the 90-day refresh token alive for idle shops.
const ETSY_RECONCILE_LOOKBACK_HOURS = 25;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    // Trial-expiry emails are PAUSED pre-launch: every account is still a
    // tester/internal, and a salesy "upgrade now" nag shouldn't go to them.
    // Flip to true at launch — and add a test-account exclusion to the query
    // first, so internal accounts never receive it.
    const TRIAL_EXPIRY_EMAILS_ENABLED = false;

    let sent = 0;
    let failed = 0;
    if (TRIAL_EXPIRY_EMAILS_ENABLED) {
      // Find clients whose trial expires in 3 days or 1 day
      const result = await pool.query(
        `SELECT id, email, business_name, trial_ends_at
         FROM clients
         WHERE plan = 'trial'
         AND trial_ends_at IS NOT NULL
         AND (
           DATE(trial_ends_at) = CURRENT_DATE + INTERVAL '3 days'
           OR DATE(trial_ends_at) = CURRENT_DATE + INTERVAL '1 day'
         )`
      );

      for (const client of result.rows) {
        const daysLeft = Math.ceil(
          (new Date(client.trial_ends_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
        );
        const email = trialExpiringEmail(client.business_name, daysLeft);
        try {
          // reply_to = monitored inbox, so "just reply to this email" works
          // (the From is hello@godreamward.com, not yet wired for inbound).
          await sendEmail({ to: client.email, replyTo: SUPPORT_EMAIL, ...email });
          sent++;
        } catch (err) {
          console.error(`Trial-expiring email failed for ${client.email}:`, err);
          failed++;
        }
      }
    }

    // ── Past-due grace: daily reminders + read-only cutoff after 7 days ──
    // A subscription whose payment failed keeps full access for GRACE_DAYS
    // (the Stripe webhook stamps past_due_since + leaves the band intact).
    // Here we send the daily countdown and flip to read-only ('canceled')
    // once the window closes. These go ONLY to customers with a real failed
    // payment (past_due_since set) — not a broad blast — so it's safe to run
    // pre-launch without a test-account exclusion.
    const GRACE_DAYS = 7;
    let pastDueReminders = 0;
    let pastDueCutoffs = 0;
    try {
      const pastDue = await pool.query<{
        id: number;
        email: string;
        business_name: string | null;
        days_elapsed: number;
      }>(
        `SELECT id, email, business_name,
                FLOOR(EXTRACT(EPOCH FROM (NOW() - past_due_since)) / 86400)::int
                  AS days_elapsed
           FROM clients
          WHERE past_due_since IS NOT NULL
            AND email IS NOT NULL`
      );
      for (const c of pastDue.rows) {
        try {
          if (c.days_elapsed >= GRACE_DAYS) {
            // Grace window closed → read-only, clear the clock, final notice.
            await pool.query(
              `UPDATE clients SET plan = 'canceled', past_due_since = NULL,
                      updated_at = NOW() WHERE id = $1`,
              [c.id]
            );
            await sendEmail({
              to: c.email,
              ...paymentPastDueEmail({
                businessName: c.business_name,
                daysRemaining: 0,
              }),
            });
            pastDueCutoffs++;
          } else if (c.days_elapsed >= 1) {
            // Daily countdown. Day 0 is the webhook's immediate notice, so
            // the cron reminders start from day 1.
            await sendEmail({
              to: c.email,
              ...paymentPastDueEmail({
                businessName: c.business_name,
                daysRemaining: GRACE_DAYS - c.days_elapsed,
              }),
            });
            pastDueReminders++;
          }
        } catch (err) {
          console.error(
            `[cron] past-due handling failed for client ${c.id}:`,
            err
          );
        }
      }
    } catch (err) {
      console.error("[cron] past-due pass failed:", err);
    }

    // Daily: refresh the owner-dashboard revenue cache for every account
    // (trailing-12-month revenue + would-be band) so /admin reads stored
    // values instead of recomputing per account on every page load.
    let revenueCached = 0;
    try {
      ({ cached: revenueCached } = await cacheAllRevenue());
    } catch (err) {
      console.error("Revenue cache pass failed:", err);
    }

    // Sub-session 33: the Pro onboarding-call offering was removed,
    // so the daily "haven't booked your call yet" reminder pass is
    // retired. The pro_call_* columns + proCallReminderEmail template
    // remain in place (harmless) but nothing sends them anymore.

    // Weekly reclassify pass — only runs on Sundays (UTC). Closes the
    // "mixed-state dashboard" finding fully: customers who never click the
    // dashboard reclassify button still get their legacy umbrella items
    // migrated, ~50 per client per week.
    let reclassifyClientsProcessed = 0;
    let reclassifyItemsTotal = 0;
    let reclassifyErrors = 0;
    if (new Date().getUTCDay() === 0) {
      try {
        const candidatesResult = await pool.query<{
          client_id: number;
          industry: string | null;
        }>(
          `SELECT DISTINCT pi.client_id, c.industry
           FROM processed_items pi
           JOIN clients c ON c.id = pi.client_id
           WHERE pi.category = ANY($1)
             AND pi.original_ai_category IS NULL`,
          [UMBRELLA_VALUES]
        );

        for (const candidate of candidatesResult.rows) {
          try {
            const result = await reclassifyClientItems(
              candidate.client_id,
              (candidate.industry ?? "other") as Industry
            );
            reclassifyClientsProcessed++;
            reclassifyItemsTotal += result.reclassified;
          } catch (err) {
            reclassifyErrors++;
            console.error(
              `[cron] reclassify failed for client ${candidate.client_id}:`,
              err
            );
          }
        }

        console.log(
          `[cron] reclassify pass: ${reclassifyItemsTotal} items across ${reclassifyClientsProcessed} clients, ${reclassifyErrors} errors`
        );
      } catch (err) {
        console.error("[cron] reclassify pass aggregate failure:", err);
      }
    }

    // Phase 10e: Wix reconciliation pass — catches any orders that
    // webhooks missed (delivery failures, brief outage, merchant
    // installed app mid-day before subscribing, etc.). Fetches
    // recent orders per connection + upserts into processed_items.
    //
    // Per-merchant errors are caught so one bad connection doesn't
    // break the others. The ON CONFLICT DO NOTHING in the upsert
    // makes this fully idempotent with what webhooks already
    // delivered.
    //
    // Resource use: O(num_wix_connections × ~100 orders/last 25h).
    // For a single Wix store with <100 orders/day this is 1 API call.
    // Pagination only kicks in for very high-volume merchants, who
    // we'd probably want a different sync strategy for anyway.
    let wixConnectionsScanned = 0;
    let wixOrdersUpserted = 0;
    let wixReconcileErrors = 0;
    try {
      const cutoffMs = Date.now() - WIX_RECONCILE_LOOKBACK_HOURS * 3600_000;
      const cutoffIso = new Date(cutoffMs).toISOString();

      const wixConnsResult = await pool.query<{
        id: number;
        client_id: number;
        instance_id: string;
      }>(
        `SELECT id, client_id, instance_id
           FROM wix_connections
          WHERE backfill_completed_at IS NOT NULL`
      );

      for (const conn of wixConnsResult.rows) {
        wixConnectionsScanned++;
        try {
          const { accessToken } = await mintAccessToken({
            instanceId: conn.instance_id,
          });

          // Single-page fetch is enough for the lookback window in
          // most cases. If a merchant has >100 orders in 25h we'd
          // need pagination — that's a future enhancement.
          const page = await fetchOrdersPage({
            accessToken,
            limit: 100,
          });

          // Filter client-side to the lookback window (Wix's
          // orders/search filter API is complex enough that
          // we'd rather take the small over-fetch + filter).
          const recent = page.orders.filter((o) => {
            if (!o.createdDate) return false;
            return o.createdDate >= cutoffIso;
          });

          if (recent.length === 0) continue;

          const rows = recent.map(mapWixOrderToProcessedItem);
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
                conn.client_id
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

          await pool.query(
            `INSERT INTO processed_items (
               vendor, invoice_number, amount, due_date, status,
               category, source, source_ref_id, channel, confidence,
               summary, extracted_data, client_id
             ) VALUES ${placeholders}
             ON CONFLICT (client_id, source, source_ref_id)
               WHERE source_ref_id IS NOT NULL
             DO NOTHING`,
            values
          );

          await pool.query(
            `UPDATE wix_connections
                SET last_sync_at = NOW(),
                    last_sync_status = 'success',
                    last_sync_error = NULL,
                    updated_at = NOW()
              WHERE id = $1`,
            [conn.id]
          );

          wixOrdersUpserted += rows.length;
        } catch (err) {
          wixReconcileErrors++;
          console.error(
            `[cron] Wix reconcile failed for connection ${conn.id} ` +
              `(client_id=${conn.client_id}, instance=${conn.instance_id}):`,
            err
          );
          // Record on the row so the card can surface staleness.
          try {
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
          } catch {
            // ignore — secondary failure
          }
        }
      }

      console.log(
        `[cron] Wix reconcile: ${wixOrdersUpserted} orders upserted ` +
          `across ${wixConnectionsScanned} connections, ${wixReconcileErrors} errors`
      );
    } catch (err) {
      console.error("[cron] Wix reconcile pass aggregate failure:", err);
    }

    // Phase 11e: Square reconciliation pass — mirrors the Wix block
    // above. Same purpose: catch payments that webhooks missed.
    // Differences:
    //   - Token decryption + pre-emptive refresh (Square tokens
    //     expire; we re-encrypt rotated refresh tokens back)
    //   - Filter on begin_time= via Square's Payments API param
    //     (Square supports this natively, unlike Wix where we
    //     filtered client-side)
    let squareConnectionsScanned = 0;
    let squarePaymentsUpserted = 0;
    let squareReconcileErrors = 0;
    try {
      const cutoffMs =
        Date.now() - SQUARE_RECONCILE_LOOKBACK_HOURS * 3600_000;
      const cutoffIso = new Date(cutoffMs).toISOString();

      const squareConnsResult = await pool.query<{
        id: number;
        client_id: number;
        access_token_ciphertext: Buffer;
        access_token_iv: Buffer;
        access_token_auth_tag: Buffer;
        access_token_expires_at: string;
        refresh_token_ciphertext: Buffer;
        refresh_token_iv: Buffer;
        refresh_token_auth_tag: Buffer;
      }>(
        `SELECT id, client_id,
                access_token_ciphertext, access_token_iv, access_token_auth_tag,
                access_token_expires_at,
                refresh_token_ciphertext, refresh_token_iv, refresh_token_auth_tag
           FROM square_connections
          WHERE backfill_completed_at IS NOT NULL`
      );

      for (const conn of squareConnsResult.rows) {
        squareConnectionsScanned++;
        try {
          // Decrypt + maybe refresh.
          let accessToken = decryptFromDb({
            ciphertext: conn.access_token_ciphertext,
            iv: conn.access_token_iv,
            authTag: conn.access_token_auth_tag,
          });
          const refreshToken = decryptFromDb({
            ciphertext: conn.refresh_token_ciphertext,
            iv: conn.refresh_token_iv,
            authTag: conn.refresh_token_auth_tag,
          });
          const expiresAtMs = new Date(conn.access_token_expires_at).getTime();
          if (
            expiresAtMs - Date.now() <
            SQUARE_TOKEN_REFRESH_THRESHOLD_MS
          ) {
            const refreshed = await squareRefreshAccessToken({ refreshToken });
            accessToken = refreshed.access_token;
            const newAccessBlob = encryptForDb(refreshed.access_token);
            const newRefreshBlob = encryptForDb(refreshed.refresh_token);
            await pool.query(
              `UPDATE square_connections
                  SET access_token_ciphertext = $1,
                      access_token_iv = $2,
                      access_token_auth_tag = $3,
                      access_token_expires_at = $4,
                      refresh_token_ciphertext = $5,
                      refresh_token_iv = $6,
                      refresh_token_auth_tag = $7,
                      updated_at = NOW()
                WHERE id = $8`,
              [
                newAccessBlob.ciphertext,
                newAccessBlob.iv,
                newAccessBlob.authTag,
                refreshed.expires_at,
                newRefreshBlob.ciphertext,
                newRefreshBlob.iv,
                newRefreshBlob.authTag,
                conn.id,
              ]
            );
          }

          // Fetch the last 25h of payments. Square supports
          // begin_time= as a native filter so we don't need
          // client-side filtering like Wix.
          const page = await fetchPaymentsPage({
            accessToken,
            limit: 100,
            sortOrder: "DESC", // newest first for incremental
            beginTime: cutoffIso,
          });

          if (page.payments.length === 0) continue;

          const rows = page.payments.map(mapPaymentToProcessedItem);
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
                conn.client_id
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

          await pool.query(
            `INSERT INTO processed_items (
               vendor, invoice_number, amount, due_date, status,
               category, source, source_ref_id, channel, confidence,
               summary, extracted_data, client_id
             ) VALUES ${placeholders}
             ON CONFLICT (client_id, source, source_ref_id)
               WHERE source_ref_id IS NOT NULL
             DO NOTHING`,
            values
          );

          await pool.query(
            `UPDATE square_connections
                SET last_sync_at = NOW(),
                    last_sync_status = 'success',
                    last_sync_error = NULL,
                    updated_at = NOW()
              WHERE id = $1`,
            [conn.id]
          );

          squarePaymentsUpserted += rows.length;
        } catch (err) {
          squareReconcileErrors++;
          console.error(
            `[cron] Square reconcile failed for connection ${conn.id} ` +
              `(client_id=${conn.client_id}):`,
            err
          );
          try {
            await pool.query(
              `UPDATE square_connections
                  SET last_sync_status = 'failed',
                      last_sync_error = $1,
                      updated_at = NOW()
                WHERE id = $2`,
              [
                err instanceof Error ? err.message.slice(0, 500) : "unknown",
                conn.id,
              ]
            );
          } catch {
            // ignore — secondary failure
          }
        }
      }

      console.log(
        `[cron] Square reconcile: ${squarePaymentsUpserted} payments upserted ` +
          `across ${squareConnectionsScanned} connections, ${squareReconcileErrors} errors`
      );
    } catch (err) {
      console.error("[cron] Square reconcile pass aggregate failure:", err);
    }

    // ── Etsy reconciliation pass ─────────────────────────────────
    // Etsy v1 has NO webhooks — this daily pass IS the ongoing sync.
    // Two deltas from the Square pass above:
    //   1. Line items are fanned for fresh rows (RETURNING + fanout)
    //      since no webhook will ever do it.
    //   2. ensureFreshToken effectively refreshes every run (access
    //      tokens live 1 hour) — which doubles as the keep-alive for
    //      the 90-day rotating refresh token.
    let etsyConnectionsScanned = 0;
    let etsyReceiptsUpserted = 0;
    let etsyReconcileErrors = 0;
    try {
      const minCreated = Math.floor(
        (Date.now() - ETSY_RECONCILE_LOOKBACK_HOURS * 3600_000) / 1000
      );

      const etsyConnsResult = await pool.query<{
        id: number;
        client_id: number;
        shop_id: string;
        access_token_ciphertext: Buffer;
        access_token_iv: Buffer;
        access_token_auth_tag: Buffer;
        access_token_expires_at: string;
        refresh_token_ciphertext: Buffer;
        refresh_token_iv: Buffer;
        refresh_token_auth_tag: Buffer;
      }>(
        `SELECT id, client_id, shop_id,
                access_token_ciphertext, access_token_iv, access_token_auth_tag,
                access_token_expires_at,
                refresh_token_ciphertext, refresh_token_iv, refresh_token_auth_tag
           FROM etsy_connections
          WHERE backfill_done = TRUE`
      );

      for (const conn of etsyConnsResult.rows) {
        etsyConnectionsScanned++;
        try {
          const fresh = await etsyEnsureFreshToken({
            accessToken: decryptFromDb({
              ciphertext: conn.access_token_ciphertext,
              iv: conn.access_token_iv,
              authTag: conn.access_token_auth_tag,
            }),
            refreshToken: decryptFromDb({
              ciphertext: conn.refresh_token_ciphertext,
              iv: conn.refresh_token_iv,
              authTag: conn.refresh_token_auth_tag,
            }),
            expiresAt: new Date(conn.access_token_expires_at),
          });
          const accessToken = fresh.accessToken;
          if (fresh.rotated) {
            const a = encryptForDb(fresh.rotated.access_token);
            const r = encryptForDb(fresh.rotated.refresh_token);
            await pool.query(
              `UPDATE etsy_connections
                  SET access_token_ciphertext = $1, access_token_iv = $2,
                      access_token_auth_tag = $3,
                      access_token_expires_at = NOW() + ($4 || ' seconds')::interval,
                      refresh_token_ciphertext = $5, refresh_token_iv = $6,
                      refresh_token_auth_tag = $7,
                      refresh_token_obtained_at = NOW(),
                      updated_at = NOW()
                WHERE id = $8`,
              [
                a.ciphertext,
                a.iv,
                a.authTag,
                String(fresh.rotated.expires_in),
                r.ciphertext,
                r.iv,
                r.authTag,
                conn.id,
              ]
            );
          }

          // Last 25h of receipts, newest first. min_created is a
          // native Etsy filter — one page (100) covers any realistic
          // daily volume for a maker shop.
          const page = await etsyFetchReceiptsPage({
            accessToken,
            shopId: conn.shop_id,
            minCreated,
            sortOrder: "desc",
          });
          if (page.receipts.length === 0) continue;

          // Receipts + their refunds (negative rows) share one insert —
          // same 13-col shape, deduped by 'etsy-refund-...' source_ref_id.
          const rows = [
            ...page.receipts.map(etsyMapReceipt),
            ...page.receipts.flatMap(etsyMapRefunds),
          ];
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
                conn.client_id
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
            const receiptByRef = new Map(
              page.receipts.map((r) => [String(r.receipt_id), r])
            );
            const parents = insertRes.rows.flatMap((row) => {
              const receipt = receiptByRef.get(row.source_ref_id);
              if (!receipt) return [];
              const items = etsyMapLineItems(receipt);
              if (items.length === 0) return [];
              return [
                {
                  parentId: row.id,
                  soldAt: new Date(receipt.create_timestamp * 1000)
                    .toISOString()
                    .slice(0, 10),
                  items,
                },
              ];
            });
            if (parents.length > 0) {
              await bulkInsertLineItemsAcrossParents({
                clientId: conn.client_id,
                platform: "etsy",
                parents,
              });
            }
            // Count receipts only (exclude refund rows).
            etsyReceiptsUpserted += insertRes.rows.filter(
              (r) => !r.source_ref_id.startsWith("etsy-refund-")
            ).length;
          }
        } catch (err) {
          etsyReconcileErrors++;
          console.error(
            `[cron] Etsy reconcile failed for connection ${conn.id} ` +
              `(client_id=${conn.client_id}):`,
            err
          );
        }
      }

      console.log(
        `[cron] Etsy reconcile: ${etsyReceiptsUpserted} receipts upserted ` +
          `across ${etsyConnectionsScanned} connections, ${etsyReconcileErrors} errors`
      );
    } catch (err) {
      console.error("[cron] Etsy reconcile pass aggregate failure:", err);
    }

    // ── Plaid bank-feed sync pass ────────────────────────────────
    // Daily pull of new bank transactions (debits only) for every active
    // connection. syncTransactions advances each item's cursor and records
    // its own last_sync_* status; per-item errors are caught so one bad
    // connection doesn't stop the rest. New umbrella rows get AI-suggested
    // categories per client (the user confirms in Transactions).
    let plaidItemsScanned = 0;
    let plaidExpensesImported = 0;
    let plaidSyncErrors = 0;
    try {
      const plaidItemsRes = await pool.query<{
        client_id: number;
        item_id: string;
        industry: string | null;
      }>(
        `SELECT pi.client_id, pi.item_id, c.industry
           FROM plaid_items pi
           JOIN clients c ON c.id = pi.client_id
          WHERE pi.status = 'active'`
      );
      for (const item of plaidItemsRes.rows) {
        plaidItemsScanned++;
        try {
          const r = await syncTransactions({
            clientId: item.client_id,
            itemId: item.item_id,
          });
          plaidExpensesImported += r.added;
          if (r.importedNew) {
            try {
              await reclassifyClientItems(
                item.client_id,
                (item.industry ?? "other") as Industry
              );
            } catch (e) {
              console.error(
                `[cron] Plaid reclassify failed for client ${item.client_id}:`,
                e
              );
            }
          }
        } catch (err) {
          plaidSyncErrors++;
          console.error(
            `[cron] Plaid sync failed for item ${item.item_id} ` +
              `(client_id=${item.client_id}):`,
            err
          );
        }
      }
      console.log(
        `[cron] Plaid sync: ${plaidExpensesImported} expenses imported ` +
          `across ${plaidItemsScanned} items, ${plaidSyncErrors} errors`
      );
    } catch (err) {
      console.error("[cron] Plaid sync pass aggregate failure:", err);
    }

    // ── Phase 12g: COGS daily digest emails ────────────────────
    //
    // For every Pro client, compute yesterday's revenue / COGS /
    // margin via the same engine that powers /cogs. Email a brief
    // digest only when yesterday had at least one mapped line-item
    // sale — silent days don't generate inbox noise.
    //
    // Sent at cron firing time. The cron schedule (vercel.json)
    // runs daily; this assumes the schedule is morning-ish in the
    // user's local time. v1 doesn't personalize timezone — that's
    // a follow-up.
    let cogsDigestsSent = 0;
    let cogsDigestsSkipped = 0;
    let cogsDigestErrors = 0;
    try {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const yIso = `${yesterday.getUTCFullYear()}-${String(yesterday.getUTCMonth() + 1).padStart(2, "0")}-${String(yesterday.getUTCDate()).padStart(2, "0")}`;

      const proClientsRes = await pool.query<{
        id: number;
        email: string;
        business_name: string | null;
      }>(
        `SELECT id, email, business_name
           FROM clients
          WHERE plan = 'pro' AND email IS NOT NULL`
      );

      for (const c of proClientsRes.rows) {
        try {
          const totals = await computeMargin({
            clientId: c.id,
            periodStart: yIso,
            periodEnd: yIso,
          });
          if (totals.totalLineItemCount === 0) {
            cogsDigestsSkipped++;
            continue;
          }
          // Pull top SKU + underwater count via the SKU breakdown.
          // limit=20 is enough to find both signals cheaply.
          const skuRows = await computeMarginBySku({
            clientId: c.id,
            periodStart: yIso,
            periodEnd: yIso,
            limit: 20,
          });
          const topSkuRow = skuRows.find(
            (s) => s.skuId != null && s.revenue > 0
          );
          const underwaterCount = skuRows.filter(
            (s) => s.underwater
          ).length;

          const email = cogsDailyDigestEmail({
            businessName: c.business_name ?? "Your business",
            date: yIso,
            revenue: totals.revenue,
            cogs: totals.cogs,
            margin: totals.margin,
            marginPercent: totals.marginPercent,
            lineItemCount: totals.totalLineItemCount,
            unmatchedLineItemCount: totals.unmatchedLineItemCount,
            underwaterSkuCount: underwaterCount,
            topSku: topSkuRow
              ? {
                  code: topSkuRow.skuCode ?? "—",
                  name: topSkuRow.skuName ?? "",
                  revenue: topSkuRow.revenue,
                }
              : null,
          });
          await sendEmail({ to: c.email, ...email });
          cogsDigestsSent++;
        } catch (err) {
          console.error(
            `[cron] COGS digest send failed for client ${c.id}:`,
            err
          );
          cogsDigestErrors++;
        }
      }

      console.log(
        `[cron] COGS digests: ${cogsDigestsSent} sent, ` +
          `${cogsDigestsSkipped} skipped (no sales), ${cogsDigestErrors} errors`
      );
    } catch (err) {
      console.error("[cron] COGS digest pass aggregate failure:", err);
    }

    // ── Tier reconciliation pass (Sub-session 33 commit 8) ───────
    // Revenue-based auto-tier-switching. Only fires on the 1st of
    // the month (the calendar-month boundary the marketing copy
    // promises). The cron runs daily, so the guard keeps this to
    // once per month. Each client is reconciled independently; the
    // engine no-ops for clients with no active Stripe subscription
    // (the common case today — sandbox, no real subs), so this is
    // safe to ship before there's a live subscription to test.
    let tierScanned = 0;
    let tierSwitched = 0;
    let tierSkipped = 0;
    let tierErrors = 0;
    try {
      if (isFirstOfMonthUtc(new Date())) {
        const summary = await reconcileAllTiers();
        tierScanned = summary.scanned;
        tierSwitched = summary.switched;
        tierSkipped = summary.skipped;
        tierErrors = summary.errors;
        // Log the would-switch cases (skipped-no-subscription) so we
        // can see the engine working before real subs exist.
        for (const r of summary.results) {
          if (r.action === "switched") {
            console.log(
              `[cron] tier switch: client ${r.clientId} ${r.previousPlan} -> ${r.targetPlan} ($${r.trailingRevenue.toFixed(0)} trailing revenue)`
            );
          } else if (r.action === "skipped-no-subscription") {
            console.log(
              `[cron] tier would-switch (no sub): client ${r.clientId} ${r.detail}`
            );
          } else if (r.action === "error") {
            console.error(
              `[cron] tier reconcile error: client ${r.clientId} ${r.detail}`
            );
          }
        }
      }
    } catch (err) {
      console.error("[cron] tier reconciliation pass failure:", err);
    }

    // ── Inventory valuation snapshot pass ────────────────────────
    // On the 1st of the month, record each paying client's total
    // inventory value into inventory_snapshots. Builds the history
    // that Schedule-C beginning/ending inventory reads from.
    // Idempotent per (client, date) — safe to re-run.
    let snapshotsRecorded = 0;
    let snapshotErrors = 0;
    try {
      if (isFirstOfMonthUtc(new Date())) {
        const today = new Date().toISOString().slice(0, 10);
        // Every non-canceled client (trial + band1–7 + legacy tiers). The
        // old explicit list pre-dated migration 0027's band rename, so it
        // silently skipped every band1–7 client → no Schedule-C inventory
        // history for paying customers. Match isPayingTier (false only for
        // canceled/null) instead of hard-coding tier names.
        const payingClients = await pool.query<{ id: number }>(
          `SELECT id FROM clients
            WHERE plan IS NOT NULL AND plan <> 'canceled'`
        );
        for (const c of payingClients.rows) {
          try {
            await recordInventorySnapshot(c.id, today);
            snapshotsRecorded++;
          } catch (err) {
            snapshotErrors++;
            console.error(
              `[cron] inventory snapshot failed for client ${c.id}:`,
              err
            );
          }
        }
        console.log(
          `[cron] inventory snapshots: ${snapshotsRecorded} recorded, ${snapshotErrors} errors`
        );
      }
    } catch (err) {
      console.error("[cron] inventory snapshot pass failure:", err);
    }

    return NextResponse.json({
      success: true,
      emailsSent: sent,
      emailsFailed: failed,
      pastDueReminders,
      pastDueCutoffs,
      revenueCached,
      reclassifyClientsProcessed,
      reclassifyItemsTotal,
      reclassifyErrors,
      wixConnectionsScanned,
      wixOrdersUpserted,
      wixReconcileErrors,
      squareConnectionsScanned,
      squarePaymentsUpserted,
      squareReconcileErrors,
      etsyConnectionsScanned,
      etsyReceiptsUpserted,
      etsyReconcileErrors,
      plaidItemsScanned,
      plaidExpensesImported,
      plaidSyncErrors,
      cogsDigestsSent,
      cogsDigestsSkipped,
      cogsDigestErrors,
      tierScanned,
      tierSwitched,
      tierSkipped,
      tierErrors,
      snapshotsRecorded,
      snapshotErrors,
    });
  } catch (error) {
    console.error("Cron error:", error);
    return NextResponse.json({ error: "Cron failed" }, { status: 500 });
  }
}