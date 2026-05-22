import { NextRequest, NextResponse } from "next/server";
import { getSessionClient } from "@/lib/getClient";
import { annualSummary } from "@/lib/reports";
import type { Industry } from "@/lib/categories";

// Phase 7a (Tax Reports + CSV + CPA Handoff) commit 2 of 9, per
// session-notes/phase-7a-tax-reports-design.md §5.
//
// GET /api/reports/annual?year=YYYY — JSON aggregate response.
//
// Thin HTTP adapter over lib/reports.annualSummary. All aggregation
// logic lives in the helper; this route is auth + plan-gate + query
// param validation only.
//
// Plan gating: STRICT Pro-only. This is a deliberate deviation from
// /api/events, /api/invoices, and /api/profitability, all of which
// allow trial as a courtesy preview. Tax reports are the Pro headline
// feature per design §1 #7 — trial/growth/starter see 403 here, and
// the /reports UI page renders the upgrade prompt instead.

function isPlanAllowed(plan: string | null | undefined): boolean {
  return plan === "pro";
}

// Year validation: integer, 2020 ≤ year ≤ currentYear. The 2020 floor
// is the audit-§6.3 sanity floor (FlowWork didn't exist before that);
// the ceiling is "no future years" (reports are retrospective).
function parseYear(raw: string | null, defaultYear: number): number | null {
  if (raw == null || raw === "") return defaultYear;
  const n = Number(raw);
  if (!Number.isInteger(n)) return null;
  if (n < 2020) return null;
  if (n > defaultYear) return null;
  return n;
}

export async function GET(req: NextRequest) {
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

    const industry = (client.industry ?? "other") as Industry;

    const result = await annualSummary({
      clientId: client.id,
      year,
      industry,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("Annual report GET error:", error);
    return NextResponse.json(
      { error: "Failed to load annual report" },
      { status: 500 }
    );
  }
}
