// lib/csv.ts
//
// Phase 7a (Tax Reports + CSV + CPA Handoff) commit 3 of 9, per
// session-notes/phase-7a-tax-reports-design.md §4.
//
// Tiny RFC 4180 CSV writer. Two primitives:
//   escapeCsvField(v) — quote + escape one cell value if needed
//   csvRow(fields)    — join a row's fields, terminate with CRLF
//
// Why not papaparse / csv-stringify: the escape rules are bounded
// (3 characters), we only generate CSV (never parse), and zero deps
// means no supply-chain risk. The adversarial test case the audit
// flagged — `Smith, "Bob" \n LLC` — round-trips cleanly through these
// primitives.
//
// CRLF terminator is the RFC-correct line ending. Excel and Google
// Sheets both honor CRLF; modern tools accept LF too but CRLF is the
// safest default for "this file will be opened in Excel."

/**
 * Escapes one field for CSV output per RFC 4180:
 *   - null / undefined → empty string
 *   - any other value → coerced to string via String()
 *   - if the string contains a quote, comma, CR, or LF: wrap in quotes
 *     and double every embedded quote
 *
 * Numbers and dates pass through their default String() representation
 * (e.g., 1234.56 → "1234.56"). Callers that want specific formatting
 * (e.g., toFixed(2) for money) should format BEFORE passing in.
 */
export function escapeCsvField(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  if (
    s.includes('"') ||
    s.includes(",") ||
    s.includes("\n") ||
    s.includes("\r")
  ) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Assembles one CSV row from a fields array. Each field is escaped via
 * escapeCsvField. The row is terminated with CRLF.
 *
 * Caller concatenates rows to build the full CSV body:
 *   const body = csvRow(headers) + rows.map((r) => csvRow(r)).join("");
 */
export function csvRow(fields: unknown[]): string {
  return fields.map(escapeCsvField).join(",") + "\r\n";
}
