import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import {
  sendEmail,
  trialExpiringEmail,
  proCallReminderEmail,
} from "@/lib/email";
import { reclassifyClientItems } from "@/lib/reclassify";
import { type Industry } from "@/lib/categories";

const UMBRELLA_VALUES = ["invoice", "expense", "ar_followup"];
const PRO_CALL_REMINDER_DELAY_DAYS = 3;

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

    return NextResponse.json({
      success: true,
      emailsSent: sent,
      emailsFailed: failed,
      proRemindersSent,
      proReminderErrors,
      reclassifyClientsProcessed,
      reclassifyItemsTotal,
      reclassifyErrors,
    });
  } catch (error) {
    console.error("Cron error:", error);
    return NextResponse.json({ error: "Cron failed" }, { status: 500 });
  }
}