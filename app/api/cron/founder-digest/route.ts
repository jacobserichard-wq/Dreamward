// app/api/cron/founder-digest/route.ts
//
// Weekly founder operations digest. A Vercel Cron Job hits this once a
// week (see vercel.json: "0 14 * * 1" = Monday 14:00 UTC) with the
// Authorization: Bearer ${CRON_SECRET} header. It gathers the
// "something quietly broke" signals from the ops runbook
// (session-notes/founder-ops-runbook.md) and emails them to the
// founder so they don't have to run the queries by hand:
//   - Failed channel syncs (Shopify/Square/Wix — Etsy has no status flag)
//   - Plaid items needing re-auth (status='error' / failed sync)
//   - DB connection count (the "too many clients" early warning)
//   - New signups this week + trial/paid totals
//
// Read-only + sends one email to the founder's own inbox; safe to run
// repeatedly. Recipient defaults to the monitored founder inbox; set
// FOUNDER_DIGEST_EMAIL to override.

import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import pool from "@/lib/db";
import { sendEmail } from "@/lib/email";
import { AI_MODEL } from "@/lib/aiModel";

const FOUNDER_EMAIL =
  process.env.FOUNDER_DIGEST_EMAIL || "dreamwardsystems@gmail.com";

interface FailedSync {
  source: string;
  business: string | null;
  email: string;
  error: string | null;
}
interface PlaidIssue {
  institution: string | null;
  business: string | null;
  email: string;
  status: string;
  error: string | null;
}
interface Signup {
  business: string | null;
  email: string;
  plan: string;
  created_at: string;
}

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    console.error("[founder-digest] query failed:", err);
    return fallback;
  }
}

export async function GET(req: NextRequest) {
  // Vercel attaches Authorization: Bearer ${CRON_SECRET} to cron calls.
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Gather signals (each isolated so one failure can't sink the rest) ──
  const failedSyncs = await safe<FailedSync[]>(async () => {
    const res = await pool.query<FailedSync>(
      `SELECT s.source, c.business_name AS business, c.email, s.error
         FROM (
           SELECT 'Shopify' AS source, client_id, last_sync_error AS error
             FROM shopify_connections WHERE last_sync_status = 'failed'
           UNION ALL
           SELECT 'Square', client_id, last_sync_error
             FROM square_connections WHERE last_sync_status = 'failed'
           UNION ALL
           SELECT 'Wix', client_id, last_sync_error
             FROM wix_connections WHERE last_sync_status = 'failed'
         ) s
         JOIN clients c ON c.id = s.client_id`
    );
    return res.rows;
  }, []);

  const plaidIssues = await safe<PlaidIssue[]>(async () => {
    const res = await pool.query<PlaidIssue>(
      `SELECT p.institution_name AS institution, c.business_name AS business,
              c.email, p.status, p.last_sync_error AS error
         FROM plaid_items p
         JOIN clients c ON c.id = p.client_id
        WHERE p.status = 'error' OR p.last_sync_status = 'failed'`
    );
    return res.rows;
  }, []);

  const dbConnections = await safe<number>(async () => {
    const res = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_stat_activity`
    );
    return res.rows[0]?.n ?? 0;
  }, 0);

  const signups = await safe<Signup[]>(async () => {
    const res = await pool.query<Signup>(
      `SELECT business_name AS business, email, plan, created_at
         FROM clients
        WHERE created_at >= NOW() - INTERVAL '7 days'
        ORDER BY created_at DESC`
    );
    return res.rows;
  }, []);

  const totals = await safe<{ total: number; trials: number; paid: number }>(
    async () => {
      const res = await pool.query<{
        total: number;
        trials: number;
        paid: number;
      }>(
        `SELECT count(*)::int AS total,
                count(*) FILTER (WHERE plan = 'trial')::int AS trials,
                count(*) FILTER (WHERE plan NOT IN ('trial','canceled'))::int AS paid
           FROM clients`
      );
      return res.rows[0] ?? { total: 0, trials: 0, paid: 0 };
    },
    { total: 0, trials: 0, paid: 0 }
  );

  // AI model health: a 1-token ping to the pinned model. If it 404s, the
  // model was retired and EVERY AI feature (PDF/receipt parse, categorize)
  // is down until AI_MODEL is updated. Inline try/catch so we keep the
  // actual error message for the digest.
  let aiHealth: { ok: boolean; error: string | null };
  try {
    const anthropic = new Anthropic();
    await anthropic.messages.create({
      model: AI_MODEL,
      max_tokens: 1,
      messages: [{ role: "user", content: "ping" }],
    });
    aiHealth = { ok: true, error: null };
  } catch (err) {
    aiHealth = {
      ok: false,
      error: err instanceof Error ? err.message : "unknown error",
    };
  }

  const alertCount =
    failedSyncs.length + plaidIssues.length + (aiHealth.ok ? 0 : 1);
  const html = renderDigest({
    failedSyncs,
    plaidIssues,
    dbConnections,
    signups,
    totals,
    aiHealth,
    alertCount,
  });
  const subject =
    alertCount > 0
      ? `⚠ Dreamward weekly digest — ${alertCount} thing${alertCount === 1 ? "" : "s"} need attention`
      : `✅ Dreamward weekly digest — all healthy`;

  try {
    await sendEmail({ to: FOUNDER_EMAIL, subject, html });
  } catch (err) {
    console.error("[founder-digest] send failed:", err);
    return NextResponse.json(
      { ok: false, error: "send failed", alertCount },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true, sentTo: FOUNDER_EMAIL, alertCount });
}

// ── HTML (email-safe inline styles) ──────────────────────────────────
function esc(s: string | null | undefined): string {
  return String(s ?? "").replace(
    /[&<>"]/g,
    (ch) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch] || ch
  );
}

function renderDigest(d: {
  failedSyncs: FailedSync[];
  plaidIssues: PlaidIssue[];
  dbConnections: number;
  signups: Signup[];
  totals: { total: number; trials: number; paid: number };
  aiHealth: { ok: boolean; error: string | null };
  alertCount: number;
}): string {
  const sections: string[] = [];

  // Alerts
  if (d.failedSyncs.length > 0) {
    const rows = d.failedSyncs
      .map(
        (s) =>
          `<li><b>${esc(s.source)}</b> — ${esc(s.business || s.email)}${
            s.error ? `: <span style="color:#991b1b">${esc(s.error.slice(0, 140))}</span>` : ""
          }</li>`
      )
      .join("");
    sections.push(
      box(
        "#fef2f2",
        "#fecaca",
        `🔴 Failed channel syncs (${d.failedSyncs.length})`,
        `<ul style="margin:8px 0 0;padding-left:18px">${rows}</ul>
         <p style="margin:8px 0 0;font-size:12px;color:#6b7280">Their sales/refunds stopped importing — usually the customer must reconnect that channel.</p>`
      )
    );
  }
  if (d.plaidIssues.length > 0) {
    const rows = d.plaidIssues
      .map(
        (p) =>
          `<li>${esc(p.business || p.email)} — ${esc(p.institution || "bank")} (${esc(p.status)})</li>`
      )
      .join("");
    sections.push(
      box(
        "#fef2f2",
        "#fecaca",
        `🔴 Plaid items need re-auth (${d.plaidIssues.length})`,
        `<ul style="margin:8px 0 0;padding-left:18px">${rows}</ul>
         <p style="margin:8px 0 0;font-size:12px;color:#6b7280">Customer must re-link their bank (ITEM_LOGIN_REQUIRED).</p>`
      )
    );
  }
  if (d.alertCount === 0) {
    sections.push(
      box(
        "#f0fdf4",
        "#bbf7d0",
        "✅ No failed syncs or Plaid issues",
        `<p style="margin:6px 0 0;font-size:13px;color:#166534">All channel + bank connections are healthy this week.</p>`
      )
    );
  }

  // DB health
  const dbColor = d.dbConnections >= 80 ? "#991b1b" : "#374151";
  sections.push(
    box(
      "#f8fafc",
      "#e2e8f0",
      "Database",
      `<p style="margin:6px 0 0;font-size:13px;color:${dbColor}">Active connections: <b>${d.dbConnections}</b> / 100${
        d.dbConnections >= 80 ? " — approaching the cap, investigate" : ""
      }</p>`
    )
  );

  // AI model health (always shown, like DB health)
  if (d.aiHealth.ok) {
    sections.push(
      box(
        "#f8fafc",
        "#e2e8f0",
        "AI model",
        `<p style="margin:6px 0 0;font-size:13px;color:#166534">${esc(AI_MODEL)} — responding ✓</p>`
      )
    );
  } else {
    sections.push(
      box(
        "#fef2f2",
        "#fecaca",
        "🔴 AI model not responding",
        `<p style="margin:6px 0 0;font-size:13px;color:#991b1b">The pinned model <b>${esc(AI_MODEL)}</b> failed a health check${
          d.aiHealth.error ? `: ${esc(d.aiHealth.error.slice(0, 140))}` : ""
        }.</p>
         <p style="margin:8px 0 0;font-size:12px;color:#6b7280">Likely retired by Anthropic → all AI features (PDF/receipt parsing, categorize) are down. Fix: update <b>AI_MODEL</b> in lib/aiModel.ts to a current model id and redeploy.</p>`
      )
    );
  }

  // This week
  const signupRows =
    d.signups.length > 0
      ? `<ul style="margin:8px 0 0;padding-left:18px">${d.signups
          .map(
            (s) =>
              `<li>${esc(s.business || s.email)} — <span style="color:#6b7280">${esc(s.plan)}, ${new Date(
                s.created_at
              ).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span></li>`
          )
          .join("")}</ul>`
      : `<p style="margin:6px 0 0;font-size:13px;color:#6b7280">No new signups this week.</p>`;
  sections.push(
    box(
      "#f8fafc",
      "#e2e8f0",
      `This week — ${d.signups.length} signup${d.signups.length === 1 ? "" : "s"}`,
      `${signupRows}
       <p style="margin:10px 0 0;font-size:13px;color:#374151">Accounts: <b>${d.totals.total}</b> · Trials: <b>${d.totals.trials}</b> · Paying: <b>${d.totals.paid}</b></p>`
    )
  );

  return `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:0 auto;color:#0f172a">
    <h2 style="margin:0 0 4px">Dreamward — weekly ops digest</h2>
    <p style="margin:0 0 16px;font-size:13px;color:#6b7280">Your Monday founder check-in. Full runbook: session-notes/founder-ops-runbook.md</p>
    ${sections.join("")}
    <p style="margin:18px 0 0;font-size:12px;color:#9ca3af">Automated from /api/cron/founder-digest. To stop or reschedule, edit vercel.json.</p>
  </div>`;
}

function box(bg: string, border: string, title: string, body: string): string {
  return `<div style="background:${bg};border:1px solid ${border};border-radius:10px;padding:12px 14px;margin:0 0 12px">
    <div style="font-size:14px;font-weight:700">${title}</div>
    ${body}
  </div>`;
}
