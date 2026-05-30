import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getSessionClient } from "@/lib/getClient";
import { renderAnnualCsvBody, renderAnnualPdf, annualSummary } from "@/lib/reports";
import { sendEmail, cpaAnnualSummaryEmail } from "@/lib/email";
import type { Industry } from "@/lib/categories";

// Phase 7a (Tax Reports + CSV + CPA Handoff) commit 8 of 9, per
// session-notes/phase-7a-tax-reports-design.md §5.
//
// POST /api/reports/annual/send?year=YYYY — email the CSV to the
// user's saved CPA address.
//
// Pipeline:
//   1. Auth + Pro-only plan-gate + year validation
//   2. Load CPA email from client_settings.preferences.cpa.email; 400
//      if not set or malformed
//   3. Generate the annual CSV via renderAnnualCsvBody (the same
//      helper /api/reports/annual/csv uses) + summary for headline
//      figures
//   4. base64-encode the CSV, attach to a cpaAnnualSummaryEmail
//   5. sendEmail with Reply-To = client.email so the CPA's reply
//      threads back to the user, not to FlowWork support
//
// No DB writes (no "last sent" tracking in v1 — reports are
// idempotent; the user can re-send any time).

interface SettingsPrefRow {
  preferences: {
    cpa?: { email?: string };
  } | null;
}

function isPlanAllowed(plan: string | null | undefined): boolean {
  return plan === "pro";
}

function parseYear(raw: string | null, defaultYear: number): number | null {
  if (raw == null || raw === "") return defaultYear;
  const n = Number(raw);
  if (!Number.isInteger(n)) return null;
  if (n < 2020) return null;
  if (n > defaultYear) return null;
  return n;
}

function isValidEmail(v: unknown): v is string {
  if (typeof v !== "string") return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim());
}

export async function POST(req: NextRequest) {
  try {
    const client = await getSessionClient();
    if (!client) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    if (!isPlanAllowed(client.plan)) {
      return NextResponse.json(
        { error: "Tax reports are a Pro feature" },
        { status: 403 }
      );
    }

    const currentYear = new Date().getUTCFullYear();
    const url = new URL(req.url);
    const year = parseYear(url.searchParams.get("year"), currentYear);
    if (year === null) {
      return NextResponse.json(
        {
          error: `year must be an integer between 2020 and ${currentYear}`,
        },
        { status: 400 }
      );
    }

    // Load CPA email from preferences.
    const settingsResult = await pool.query<SettingsPrefRow>(
      `SELECT preferences FROM client_settings WHERE client_id = $1`,
      [client.id]
    );
    const prefs = settingsResult.rows[0]?.preferences ?? null;
    const rawCpa = prefs?.cpa;
    const cpaEmail =
      rawCpa && typeof rawCpa === "object" && typeof rawCpa.email === "string"
        ? rawCpa.email.trim()
        : "";

    if (!cpaEmail) {
      return NextResponse.json(
        {
          error:
            "Add your CPA's email in Settings first (CPA Handoff section).",
        },
        { status: 400 }
      );
    }
    if (!isValidEmail(cpaEmail)) {
      return NextResponse.json(
        {
          error:
            "The CPA email saved in Settings is malformed. Fix it before sending.",
        },
        { status: 400 }
      );
    }

    const industry = (client.industry ?? "other") as Industry;

    // Phase 7b dedupe-summary refactor: compute annualSummary ONCE,
    // then parallel-render CSV + PDF using it. PDF render uses the
    // optional `summary` param to avoid the duplicate annualSummary
    // call it would otherwise make. Net: 1 summary query + CSV
    // queries + PDF render in parallel after the summary returns.
    const summary = await annualSummary({
      clientId: client.id,
      year,
      industry,
    });

    const [{ body: csvBody, filename: csvFilename }, { buffer: pdfBuffer, filename: pdfFilename }] =
      await Promise.all([
        renderAnnualCsvBody({
          clientId: client.id,
          year,
          industry,
          businessName: client.business_name ?? null,
        }),
        renderAnnualPdf({
          clientId: client.id,
          year,
          industry,
          businessName: client.business_name ?? null,
          summary, // dedupe — skips the internal annualSummary call
        }),
      ]);

    const csvBase64 = Buffer.from(csvBody, "utf8").toString("base64");
    const pdfBase64 = pdfBuffer.toString("base64");

    const businessName =
      typeof client.business_name === "string" &&
      client.business_name.trim().length > 0
        ? client.business_name.trim()
        : "FlowWork user";
    // Best-effort first-name extraction from the user's email local-part
    // for the signoff. The clients table has email + business_name; no
    // separate first/last name fields in v1, so we make do.
    const userEmail =
      typeof client.email === "string" ? client.email : "";
    const localPart = userEmail.split("@")[0] ?? "";
    const userFirstName =
      localPart.length > 0 && /^[a-zA-Z]/.test(localPart)
        ? localPart.charAt(0).toUpperCase() +
          localPart.slice(1).split(/[._-]/)[0]
        : "";

    const email = cpaAnnualSummaryEmail({
      businessName,
      userFirstName,
      year,
      netProfit: summary.summary.netProfit,
      grossProfit: summary.summary.grossProfit,
      cogs: summary.summary.cogs,
    });

    try {
      await sendEmail({
        to: cpaEmail,
        subject: email.subject,
        html: email.html,
        replyTo: userEmail || undefined,
        attachments: [
          {
            filename: csvFilename,
            content: csvBase64,
            contentType: "text/csv",
          },
          {
            filename: pdfFilename,
            content: pdfBase64,
            contentType: "application/pdf",
          },
        ],
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : "unknown send error";
      console.error("Annual CPA send failed:", detail);
      return NextResponse.json(
        { error: `Couldn't send to CPA: ${detail}` },
        { status: 502 }
      );
    }

    return NextResponse.json({
      sentTo: cpaEmail,
      year,
      // Both filenames so future UI surfaces can display "sent X.csv +
      // Y.pdf" if it ever wants that detail. Current page just shows
      // "Sent YYYY summary to <email>" via sentTo + year.
      csvFilename,
      pdfFilename,
    });
  } catch (error) {
    console.error("Annual send POST error:", error);
    return NextResponse.json(
      { error: "Failed to send annual report" },
      { status: 500 }
    );
  }
}
