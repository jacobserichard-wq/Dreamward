// lib/reports.ts — barrel re-exporting the public surface of the
// lib/reports/ module split. Existing consumers keep importing from
// "@/lib/reports" without change; the actual implementation lives in
// the three sibling files:
//
//   - lib/reports/aggregate.ts — annualSummary + types + classifier
//   - lib/reports/csv.ts       — renderAnnualCsvBody (CSV ledger)
//   - lib/reports/pdf.ts       — renderAnnualPdf (PDF dispatcher)
//
// Split landed in sub-session 23 hygiene step 5. lib/reports.ts had
// grown to ~890 lines after Phases 7a + 7b; the split reduces each
// file to <500 lines and isolates the @react-pdf/renderer import to
// pdf.ts → lib/pdf/annual.tsx only.

export {
  annualSummary,
  buildClassifier,
  csvBusinessSlug,
  isoYearBounds,
  type AnnualSummary,
  type AppSettingRow,
  type CategoryKind,
  type RateSource,
  type SettingsRow,
} from "./reports/aggregate";

export { renderAnnualCsvBody } from "./reports/csv";

export { renderAnnualPdf } from "./reports/pdf";
