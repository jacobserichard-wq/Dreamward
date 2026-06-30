// app/api/unsubscribe/route.ts
//
// One-click unsubscribe from Dreamward recurring/update emails (daily
// digest, trial-expiry, welcome). Public by design — the link is clicked
// from an email with no session — but authorized by an HMAC token tied to
// the client id (verifyUnsubToken), so only the holder of the emailed link
// can opt that client out. Sets preferences.email_opt_out = true, which the
// cron email queries honor. Transactional mail (invoices, billing) is
// unaffected. Handles GET (link) + POST (List-Unsubscribe one-click).

import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { verifyUnsubToken } from "@/lib/email";

const APP_URL = process.env.NEXTAUTH_URL ?? "https://godreamward.com";

function page(message: string, ok: boolean, status: number): NextResponse {
  const html = `<!doctype html><html><head><meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Dreamward</title></head>
  <body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f8fafc;margin:0;padding:48px 16px;color:#0f172a;">
    <div style="max-width:480px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:32px;text-align:center;">
      <div style="font-size:34px;margin-bottom:8px;">${ok ? "✓" : "⚠️"}</div>
      <p style="font-size:15px;line-height:1.6;color:#334155;margin:0 0 16px;">${message}</p>
      <a href="${APP_URL}/settings" style="color:#3b82f6;text-decoration:none;font-size:14px;">Manage email preferences →</a>
    </div>
  </body></html>`;
  return new NextResponse(html, {
    status,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

async function handle(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const c = Number(url.searchParams.get("c"));
  const t = url.searchParams.get("t") ?? "";
  if (!Number.isInteger(c) || c <= 0 || !t || !verifyUnsubToken(c, t)) {
    return page("This unsubscribe link is invalid or expired.", false, 400);
  }
  try {
    await pool.query(
      `INSERT INTO client_settings (client_id, preferences)
         VALUES ($1, '{"email_opt_out": true}'::jsonb)
       ON CONFLICT (client_id) DO UPDATE
         SET preferences = jsonb_set(
               COALESCE(client_settings.preferences, '{}'::jsonb),
               '{email_opt_out}', 'true'::jsonb)`,
      [c]
    );
  } catch (err) {
    console.error("Unsubscribe failed:", err);
    return page(
      "Something went wrong. Reply to any Dreamward email and we'll remove you.",
      false,
      500
    );
  }
  return page(
    "You're unsubscribed from Dreamward update emails. You'll still receive essential billing and invoice messages.",
    true,
    200
  );
}

export async function GET(req: NextRequest) {
  return handle(req);
}
export async function POST(req: NextRequest) {
  return handle(req);
}
