// lib/reports/pdf.ts
//
// PDF dispatcher. Thin wrapper over lib/pdf/annual:renderAnnualPdfBuffer
// (the actual renderToBuffer + JSX render lives there so type inference
// through react-pdf's ReactElement<DocumentProps> signature works
// without forcing this file to import JSX runtime).
//
// Why optional `summary` parameter: the POST /api/reports/annual/send
// route computes annualSummary once + passes it to BOTH renderAnnualCsvBody
// and renderAnnualPdf, avoiding double queries on the same request.
// Direct GET /api/reports/annual/pdf omits the param and lets this helper
// fetch it.
//
// Sub-session 23 hygiene step 5 split this file out of lib/reports.ts.

import type { Industry } from "../categories";
import { renderAnnualPdfBuffer } from "../pdf/annual";
import {
  annualSummary,
  csvBusinessSlug,
  type AnnualSummary,
} from "./aggregate";

export async function renderAnnualPdf(opts: {
  clientId: number;
  year: number;
  industry: Industry;
  businessName: string | null;
  /** Optional pre-computed summary. When omitted, fetched via
   *  annualSummary. The send route passes its already-computed summary
   *  to dedupe the query work. */
  summary?: AnnualSummary;
}): Promise<{ buffer: Buffer; filename: string }> {
  const summary =
    opts.summary ??
    (await annualSummary({
      clientId: opts.clientId,
      year: opts.year,
      industry: opts.industry,
    }));

  const businessName = opts.businessName?.trim() || "Dreamward user";
  const buffer = await renderAnnualPdfBuffer(summary, businessName);
  const filename = `dreamward-${csvBusinessSlug(opts.businessName)}-${opts.year}.pdf`;
  return { buffer, filename };
}
