import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { sendEmail, trialExpiringEmail } from "@/lib/email";
import { reclassifyClientItems } from "@/lib/reclassify";
import { type Industry } from "@/lib/categories";

const UMBRELLA_VALUES = ["invoice", "expense", "ar_followup"];

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
      reclassifyClientsProcessed,
      reclassifyItemsTotal,
      reclassifyErrors,
    });
  } catch (error) {
    console.error("Cron error:", error);
    return NextResponse.json({ error: "Cron failed" }, { status: 500 });
  }
}