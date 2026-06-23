// app/components/reports/ReportExportButtons.tsx
//
// CSV + PDF download buttons for a report. Each report passes a builder
// that returns its current ReportExportSpec (so the export always
// matches what's on screen). PDF goes through the server route, so it
// shows a brief loading state.

"use client";

import { useState } from "react";
import { downloadCsv, downloadPdf, type ReportExportSpec } from "./reportExport";

export default function ReportExportButtons({
  buildSpec,
  disabled,
}: {
  buildSpec: () => ReportExportSpec;
  disabled?: boolean;
}) {
  const [pdfBusy, setPdfBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Soft, palette-tinted to match the Transactions toolbar / Tax pack
  // actions (CSV → sage, PDF → eucalyptus). Compact size since these sit
  // inline next to each report title.
  const base =
    "py-1.5 px-3 rounded-lg border text-sm font-semibold inline-flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed";
  const csvBtn = `${base} border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-700`;
  const pdfBtn = `${base} border-blue-200 bg-blue-50 hover:bg-blue-100 text-blue-700`;

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {err && <span className="text-xs text-red-600">{err}</span>}
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          setErr(null);
          downloadCsv(buildSpec());
        }}
        className={csvBtn}
      >
        <span aria-hidden="true">{"\u{1F4E5}"}</span> CSV
      </button>
      <button
        type="button"
        disabled={disabled || pdfBusy}
        onClick={async () => {
          setErr(null);
          setPdfBusy(true);
          try {
            await downloadPdf(buildSpec());
          } catch (e) {
            setErr(e instanceof Error ? e.message : "PDF failed");
          } finally {
            setPdfBusy(false);
          }
        }}
        className={pdfBtn}
      >
        <span aria-hidden="true">{"\u{1F4C4}"}</span>{" "}
        {pdfBusy ? "Building…" : "PDF"}
      </button>
    </div>
  );
}
