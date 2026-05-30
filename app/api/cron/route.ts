import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  sendEmail,
  trialExpiringEmail,
  proCallReminderEmail,
  cogsDailyDigestEmail,
} from "@/lib/email";
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

const UMBRELLA_VALUES = ["invoice", "expense", "ar_followup"];
const PRO_CALL_REMINDER_DELAY_DAYS = 3;

// Phase 10e: how far back the Wix reconciliation pass looks. 25 hours
// gives a 1-hour overlap with the previous run so we don't miss
// orders created during the cron itself running. Idempotent upserts
// make the overlap safe.
const WIX_RECONCILE_LOOKBACK_HOURS = 25;

// Phase 11e: same lookback semantics for Square.
const SQUARE_RECONCILE_LOOKBACK_HOURS = 25;
const SQUARE_TOKEN_REFRESH_THRESHOLD_MS = 24 * 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
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

    let sent = 0;
    let failed = 0;
    for (const client of result.rows) {
      const daysLeft = Math.ceil(
        (new Date(client.trial_ends_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
      );
      const email = trialExpiringEmail(client.business_name, daysLeft);
      try {
        await sendEmail({ to: client.email, ...email });
        sent++;
      } catch (err) {
        console.error(`Trial-expiring email failed for ${client.email}:`, err);
        failed++;
      }
    }

    // Daily Pro onboarding-call reminder — nudges Pro customers who became
    // Pro at least PRO_CALL_REMINDER_DELAY_DAYS ago, haven't booked their
    // call, and haven't already been reminded. Stamps
    // pro_call_reminder_sent_at AFTER a successful send so a Resend failure
    // leaves the row eligible for retry on the next run.
    //
    // Anchor: clients.created_at (no Pro-upgrade timestamp exists). A
    // customer who upgraded long after signup has an old created_at and
    // won't be reminded — accepted MVP behavior.
    let proRemindersSent = 0;
    let proReminderErrors = 0;
    try {
      const reminderResult = await pool.query<{
        id: number;
        email: string;
        business_name: string | null;
      }>(
        `SELECT id, email, business_name
         FROM clients
         WHERE plan = 'pro'
           AND pro_call_booked_at IS NULL
           AND pro_call_reminder_sent_at IS NULL
           AND created_at <= NOW() - INTERVAL '${PRO_CALL_REMINDER_DELAY_DAYS} days'`
      );

      for (const client of reminderResult.rows) {
        try {
          const email = proCallReminderEmail(client.business_name ?? "");
          await sendEmail({ to: client.email, ...email });
          // Stamp AFTER successful send. A failed send leaves
          // pro_call_reminder_sent_at NULL → eligible for retry tomorrow.
          await pool.query(
            `UPDATE clients
             SET pro_call_reminder_sent_at = NOW(),
                 updated_at = NOW()
             WHERE id = $1`,
            [client.id]
          );
          proRemindersSent++;
        } catch (err) {
          proReminderErrors++;
          console.error(
            `[cron] pro-call reminder failed for client ${client.id} (${client.email}):`,
            err
          );
        }
      }
      console.log(
        `[cron] pro-call reminders: ${proRemindersSent} sent, ${proReminderErrors} errors`
      );
    } catch (err) {
      console.error("[cron] pro-reminder pass aggregate failure:", err);
    }

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

    return NextResponse.json({
      success: true,
      emailsSent: sent,
      emailsFailed: failed,
      proRemindersSent,
      proReminderErrors,
      reclassifyClientsProcessed,
      reclassifyItemsTotal,
      reclassifyErrors,
      wixConnectionsScanned,
      wixOrdersUpserted,
      wixReconcileErrors,
      squareConnectionsScanned,
      squarePaymentsUpserted,
      squareReconcileErrors,
      cogsDigestsSent,
      cogsDigestsSkipped,
      cogsDigestErrors,
    });
  } catch (error) {
    console.error("Cron error:", error);
    return NextResponse.json({ error: "Cron failed" }, { status: 500 });
  }
}