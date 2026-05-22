import { NextRequest, NextResponse } from "next/server";
import { getSessionClient } from "@/lib/getClient";
import { renderAnnualCsvBody } from "@/lib/reports";
import type { Industry } from "@/lib/categories";

// Phase 7a (Tax Reports + CSV + CPA Handoff) commit 4, refactored in
// commit 8 to delegate CSV body assembly to lib/reports.renderAnnualCsvBody
// (which is now also consumed by POST /api/reports/annual/send). The
// route itself is now just auth + plan-gate + year validation + response
// headers.

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
    const { body, filename } = await renderAnnualCsvBody({
      clientId: client.id,
      year,
      industry,
      businessName: client.business_name ?? null,
    });

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        // Per-tenant + per-render-time content; intermediate caches
        // would serve stale CSVs.
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Annual CSV GET error:", error);
    return NextResponse.json(
      { error: "Failed to render annual CSV" },
      { status: 500 }
    );
  }
}
