import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { sendEmail, trialExpiringEmail } from "@/lib/email";

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

    return NextResponse.json({ success: true, emailsSent: sent, emailsFailed: failed });
  } catch (error) {
    console.error("Cron error:", error);
    return NextResponse.json({ error: "Cron failed" }, { status: 500 });
  }
}