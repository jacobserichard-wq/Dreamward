// app/components/reports/reportExport.ts
//
// Shared export for the business reports. Every report builds a
// ReportExportSpec (title + meta lines + one or more tables) from the
// data it already rendered on screen, then:
//   - downloadCsv(spec)  → client-side CSV (no server round trip)
//   - downloadPdf(spec)  → POSTs the spec to /api/reports/export/pdf,
//                          which renders a generic PDF server-side so
//                          @react-pdf stays out of the client bundle.
//
// Because the export reuses the on-screen data, there's no separate
// aggregation path to keep in sync — the CSV/PDF always match what the
// report shows.

"use client";

export interface ReportTable {
  heading?: string;
  columns: string[];
  rows: (string | number)[][];
}

export interface ReportExportSpec {
  /** Base filename (no extension). */
  filename: string;
  title: string;
  /** Context lines under the title (period, channel, generated-at). */
  meta: string[];
  tables: ReportTable[];
}

function csvCell(v: string | number): string {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function downloadCsv(spec: ReportExportSpec): void {
  const lines: string[] = [csvCell(spec.title)];
  for (const m of spec.meta) lines.push(csvCell(m));
  lines.push("");
  for (const t of spec.tables) {
    if (t.heading) lines.push(csvCell(t.heading));
    lines.push(t.columns.map(csvCell).join(","));
    for (const r of t.rows) lines.push(r.map(csvCell).join(","));
    lines.push("");
  }
  triggerDownload(
    new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" }),
    `${spec.filename}.csv`
  );
}

export async function downloadPdf(spec: ReportExportSpec): Promise<void> {
  const res = await fetch("/api/reports/export/pdf", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(spec),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `PDF export failed (${res.status})`);
  }
  triggerDownload(await res.blob(), `${spec.filename}.pdf`);
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
