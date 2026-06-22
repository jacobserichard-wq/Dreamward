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

  const btn =
    "py-1.5 px-3 rounded-lg border border-slate-300 bg-white text-slate-700 text-sm font-medium cursor-pointer hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1.5";

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
        className={btn}
      >
        {"\u{1F4E5}"} CSV
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
        className={btn}
      >
        {"\u{1F4C4}"} {pdfBusy ? "Building…" : "PDF"}
      </button>
    </div>
  );
}
