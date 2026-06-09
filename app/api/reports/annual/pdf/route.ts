import { NextRequest, NextResponse } from "next/server";
import { getSessionClient } from "@/lib/getClient";
import { renderAnnualPdf } from "@/lib/reports";
import type { Industry } from "@/lib/categories";
import { isPayingTier } from "@/lib/plans";

// Phase 7b (PDF Export for Annual Tax Reports) commit 4 of 7, per
// session-notes/phase-7b-pdf-export-design.md §5.
//
// GET /api/reports/annual/pdf?year=YYYY — PDF download.
//
// Mirror of the CSV route (app/api/reports/annual/csv/route.ts). Same
// auth + plan-gate + year-validation shape; delegates the actual
// render to lib/reports.renderAnnualPdf (commit 3), which delegates
// to lib/pdf/annual.renderAnnualPdfBuffer (commit 2 + 3) for the
// JSX render.
//
// Plan gating: strict Pro-only — matches the rest of the
// /api/reports/* routes from Phase 7a.

function isPlanAllowed(plan: string | null | undefined): boolean {
  return isPayingTier(plan);
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
    const { buffer, filename } = await renderAnnualPdf({
      clientId: client.id,
      year,
      industry,
      businessName: client.business_name ?? null,
    });

    // NextResponse accepts Buffer directly. Content-Disposition tells
    // the browser to save instead of inline-render (matches the CSV
    // route's convention). Cache-Control: no-store because each render
    // is per-tenant + per-render-time; intermediate caches would serve
    // stale PDFs.
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("Annual PDF GET error:", error);
    return NextResponse.json(
      { error: "Failed to render annual PDF" },
      { status: 500 }
    );
  }
}
