// app/api/reports/export/pdf/route.ts
//
// Generic PDF export for the business reports. The report builds a spec
// (title + meta + tables) from what it shows on screen and POSTs it
// here; we render it with the shared @react-pdf doc and stream it back
// as a download. Keeps @react-pdf out of the client bundle and gives
// every report a consistent PDF with no per-report PDF code.
//
// POST /api/reports/export/pdf   body: ReportPdfSpec (title, meta, tables)
//
// Pro-gated. The PDF only contains data the caller sent (which they
// already fetched + are authorized to see), but we still gate so
// non-Pro can't render via this route.

import { NextRequest, NextResponse } from "next/server";
import { getSessionClient } from "@/lib/getClient";
import { isPayingTier } from "@/lib/plans";
import {
  renderGenericReportPdf,
  type ReportPdfSpec,
  type PdfTable,
} from "@/lib/pdf/genericReport";

export async function POST(req: NextRequest) {
  try {
    const client = await getSessionClient();
    if (!client) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    if (!isPayingTier(client.plan)) {
      return NextResponse.json(
        { error: "This feature requires an active subscription." },
        { status: 403 }
      );
    }

    const body = (await req.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }

    // Sanitize the client-supplied structure into the PDF spec shape.
    const rawTables = Array.isArray(body.tables) ? body.tables : [];
    const tables: PdfTable[] = rawTables.slice(0, 50).map((t) => {
      const tt = (t ?? {}) as Record<string, unknown>;
      return {
        heading: typeof tt.heading === "string" ? tt.heading : undefined,
        columns: Array.isArray(tt.columns) ? tt.columns.map(String) : [],
        rows: Array.isArray(tt.rows)
          ? tt.rows.slice(0, 2000).map((r) =>
              Array.isArray(r)
                ? r.map((c) => (typeof c === "number" ? c : String(c)))
                : []
            )
          : [],
      };
    });

    const spec: ReportPdfSpec = {
      title: typeof body.title === "string" ? body.title.slice(0, 200) : "Report",
      meta: Array.isArray(body.meta) ? body.meta.slice(0, 12).map(String) : [],
      tables,
      businessName:
        typeof (client as { business_name?: unknown }).business_name === "string"
          ? ((client as { business_name?: string }).business_name as string)
          : undefined,
    };

    const buffer = await renderGenericReportPdf(spec);
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="report.pdf"`,
      },
    });
  } catch (err) {
    console.error("Report PDF export error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to render PDF" },
      { status: 500 }
    );
  }
}
