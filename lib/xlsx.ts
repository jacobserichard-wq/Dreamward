// lib/xlsx.ts
//
// XLSX → string[][] parser. Same shape as the parseCSV helper in
// app/api/upload/route.ts so /api/upload can fork on file extension
// and feed either result to the same downstream pipeline (Claude
// column-mapping + categorization).
//
// Uses exceljs rather than the more-popular `xlsx` (SheetJS) package
// because SheetJS's npm release at 0.18.5 has open CVEs (prototype
// pollution + ReDoS in parsing paths). exceljs at 4.4.0 has no
// critical advisories — its transitive uuid<11.1.1 advisory is only
// reachable when calling v3/v5/v6 with an explicit `buf` arg, which
// exceljs doesn't do.
//
// Read-only. We never write workbooks; if that ever changes, switch
// to ExcelJS.Workbook().xlsx.writeBuffer() rather than rolling our
// own.

import ExcelJS from "exceljs";

/**
 * Parse a .xlsx buffer to a 2D string array using the first worksheet.
 *
 * - Empty workbook → returns [].
 * - Cells with formula values → returns the cached result string
 *   (the workbook author's last-evaluated value). We never re-evaluate.
 * - Cells with rich text → joins the runs with no separator.
 * - Date cells → ISO YYYY-MM-DD (matches the CSV path's convention
 *   for due_date columns).
 * - Numbers + booleans → stringified.
 * - null / undefined / "" cells → empty string.
 *
 * Rows are not trimmed of trailing empty cells — the header row's
 * length dictates downstream column count, and exceljs gives us a
 * stable row.cellCount aligned to that.
 */
export async function parseXlsx(buffer: ArrayBuffer): Promise<string[][]> {
  const workbook = new ExcelJS.Workbook();
  // Convert ArrayBuffer to Node Buffer — exceljs accepts both but the
  // Node path is faster and matches our serverless-runtime contract.
  // Cast through `unknown` because exceljs's bundled types ship the
  // pre-Node-22 un-parameterized `Buffer` shape; Node 20's `Buffer`
  // is now generic and the assignability check fails despite runtime
  // compatibility.
  await workbook.xlsx.load(
    Buffer.from(buffer) as unknown as Parameters<typeof workbook.xlsx.load>[0]
  );

  const sheet = workbook.worksheets[0];
  if (!sheet) return [];

  const rows: string[][] = [];
  // rowCount includes blank trailing rows; we filter those at the call
  // site (same as parseCSV does with .some((c) => c.trim())).
  const maxCols = sheet.columnCount;

  sheet.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = [];
    for (let c = 1; c <= maxCols; c++) {
      cells.push(cellToString(row.getCell(c).value));
    }
    rows.push(cells);
  });

  return rows;
}

// exceljs CellValue is a tagged union — handle each variant we care
// about. Anything we don't recognize falls through to String() with a
// JSON-stringify fallback so we never throw on an unknown shape.
function cellToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (value instanceof Date) {
    // YYYY-MM-DD in UTC. Aligns with the pg DATE type-parser override
    // applied elsewhere in lib/db.ts (Phase 5 follow-ups, sub-session 20).
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, "0");
    const d = String(value.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  // Formula cell: { formula, result } — surface the cached result.
  if (typeof value === "object" && value !== null) {
    const v = value as Record<string, unknown>;
    if ("result" in v && v.result !== undefined && v.result !== null) {
      return cellToString(v.result);
    }
    // Rich text: { richText: [{ text }, ...] }
    if ("richText" in v && Array.isArray(v.richText)) {
      return (v.richText as Array<{ text?: string }>)
        .map((r) => r.text ?? "")
        .join("")
        .trim();
    }
    // Hyperlink: { text, hyperlink } — text is what humans see.
    if ("text" in v && typeof v.text === "string") {
      return v.text.trim();
    }
    // Error cell: { error: "#DIV/0!" } etc — surface the error code so
    // the AI mapper can see something rather than silently dropping it.
    if ("error" in v && typeof v.error === "string") {
      return v.error;
    }
  }
  try {
    return String(value);
  } catch {
    return "";
  }
}
