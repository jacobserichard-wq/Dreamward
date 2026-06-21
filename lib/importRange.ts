// lib/importRange.ts
//
// Shared "import from" cutoff logic for outside-source connections
// (Plaid, Shopify, Square, Etsy, Wix) and uploads. A connection stores an
// import_start_date (DATE, nullable): NULL = all history, a date = only
// import transactions dated on or after it. This module resolves the
// connect-time preset to that date and validates it. Pure — safe on the
// client (the picker) and the server (route validation).

export type ImportRangePreset =
  | "all"
  | "this_year"
  | "last_12_months"
  | "custom";

export const IMPORT_RANGE_LABELS: Record<ImportRangePreset, string> = {
  all: "Everything",
  this_year: "This year",
  last_12_months: "Last 12 months",
  custom: "Custom date…",
};

function toYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

/**
 * Resolve a preset (+ optional custom date) to a YYYY-MM-DD start date, or
 * null for "all history". `now` is injectable for testing; defaults to the
 * current date (only called client-side in the picker, so that's fine).
 */
export function resolveImportStartDate(
  preset: ImportRangePreset,
  customDate?: string | null,
  now: Date = new Date()
): string | null {
  switch (preset) {
    case "all":
      return null;
    case "this_year":
      return `${now.getFullYear()}-01-01`;
    case "last_12_months": {
      const d = new Date(now);
      d.setFullYear(d.getFullYear() - 1);
      return toYmd(d);
    }
    case "custom":
      return isValidYmd(customDate) ? (customDate as string) : null;
  }
}

/** True for a well-formed YYYY-MM-DD string. */
export function isValidYmd(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

/**
 * Server-side normalizer for an incoming importStartDate field: returns a
 * valid YYYY-MM-DD string, or null (all history) for anything missing or
 * malformed. Routes use this so a bad client value degrades to "all"
 * rather than erroring.
 */
export function normalizeImportStartDate(v: unknown): string | null {
  return isValidYmd(v) ? v : null;
}
