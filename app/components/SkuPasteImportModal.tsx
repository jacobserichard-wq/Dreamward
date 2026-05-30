// app/components/SkuPasteImportModal.tsx
//
// Phase 12d commit 5 of 5. The paste-from-spreadsheet modal —
// the second answer (alongside bulk cost update) to Crafty Base's
// onboarding complaints. Users paste TSV or CSV data straight
// from Excel/Google Sheets/Numbers/Airtable into a textarea; we
// auto-detect columns and preview before any DB write.
//
// Three-pane flow:
//
//   1. Paste pane: textarea with placeholder example. User
//      pastes, we auto-parse on every keystroke (cheap).
//
//   2. Preview pane: shows the parsed rows in a table with
//      column-header chips ("Detected: code · name · cost").
//      Manual column reassignment via header dropdowns if the
//      smart detection got it wrong. Rows with validation
//      errors are highlighted red.
//
//   3. Result pane: after POST, shows per-row status
//      (imported / skipped / errored) with the actual error
//      string from the server. Closing the modal goes back to
//      paste pane on next open.
//
// Crafty Base context: their import "is highly prone to
// formatting errors, often corrupting existing data." Ours is
// strict INSERT-only — never updates existing SKUs. Duplicate
// codes get 'skipped' with an explicit reason, leaving the
// existing SKU untouched.

"use client";

import { useEffect, useMemo, useState } from "react";
import Spinner from "./Spinner";

export interface SkuPasteImportModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: (info: {
    imported: number;
    skipped: number;
    errored: number;
  }) => Promise<void> | void;
}

type ColumnRole = "code" | "name" | "cost" | "description" | "ignore";

interface ParsedRow {
  cells: string[];
}

interface RowForApi {
  code: string;
  name: string;
  cost?: number;
  description?: string;
}

interface PerRowResult {
  index: number;
  status: "imported" | "skipped" | "errored";
  code: string;
  skuId?: number;
  error?: string;
}

/** Detect comma vs tab vs semicolon as the row separator on
 *  the first non-empty line. */
function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/).find((l) => l.trim().length > 0) ?? "";
  const tab = (firstLine.match(/\t/g) ?? []).length;
  const comma = (firstLine.match(/,/g) ?? []).length;
  const semi = (firstLine.match(/;/g) ?? []).length;
  if (tab >= comma && tab >= semi) return "\t";
  if (semi > comma) return ";";
  return ",";
}

/** Quick CSV split — doesn't handle quoted commas inside cells.
 *  For TSV (the default Excel/Google Sheets paste format) this is
 *  unambiguous. For CSV with quoted strings, edge cases will
 *  surface as a mis-split row that the user can spot in the
 *  preview and re-paste a cleaner version. Acceptable v1.
 */
function splitRows(text: string, delim: string): ParsedRow[] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => ({ cells: line.split(delim).map((c) => c.trim()) }));
}

/** Smart column detection by header name. */
function detectColumnRoles(headerCells: string[]): ColumnRole[] {
  return headerCells.map((raw) => {
    const h = raw.toLowerCase().trim();
    if (
      /\b(code|sku|item.*code|item.*number|item.*id)\b/.test(h) ||
      h === "code" ||
      h === "sku"
    )
      return "code";
    if (
      /\b(cost|unit.*cost|wholesale|wholesale.*price|landed|per.?unit)\b/.test(h)
    )
      return "cost";
    if (
      /\b(name|item.*name|product.*name|title|description|material.*name)\b/.test(h) &&
      !/\b(description|notes?|details?)\b/.test(h)
    )
      return "name";
    if (/\b(description|notes?|details?)\b/.test(h)) return "description";
    return "ignore";
  });
}

/** When the first row clearly looks like a header (has letters,
 *  no numbers in cells that "look like" code/cost), treat it as
 *  one. Otherwise assume first row is data and apply default
 *  positional roles: [code, name, cost, description]. */
function looksLikeHeader(cells: string[]): boolean {
  if (cells.length === 0) return false;
  // Heuristic: if any cell matches a known header keyword, it's a
  // header. Otherwise treat as data.
  const knownHeaders = /\b(code|sku|name|cost|description|notes?|product|item|material|title|wholesale|price)\b/i;
  return cells.some((c) => knownHeaders.test(c));
}

export default function SkuPasteImportModal({
  open,
  onClose,
  onSaved,
}: SkuPasteImportModalProps) {
  const [pasted, setPasted] = useState("");
  const [columnRoles, setColumnRoles] = useState<ColumnRole[]>([]);
  const [columnRolesManuallyChanged, setColumnRolesManuallyChanged] =
    useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<PerRowResult[] | null>(null);

  useEffect(() => {
    if (!open) return;
    setPasted("");
    setColumnRoles([]);
    setColumnRolesManuallyChanged(false);
    setResults(null);
    setError(null);
  }, [open]);

  // Esc to close
  useEffect(() => {
    if (!open || saving) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, saving, onClose]);

  // Parse on every keystroke
  const parsed = useMemo(() => {
    if (!pasted.trim()) return null;
    const delim = detectDelimiter(pasted);
    const rows = splitRows(pasted, delim);
    if (rows.length === 0) return null;
    const headerRow = rows[0];
    const hasHeader = looksLikeHeader(headerRow.cells);
    const dataRows = hasHeader ? rows.slice(1) : rows;

    // Determine column roles (smart detect; fall back to positional)
    let detected: ColumnRole[];
    if (hasHeader) {
      detected = detectColumnRoles(headerRow.cells);
    } else {
      // Positional defaults: code, name, cost, description, ignore...
      const defaults: ColumnRole[] = ["code", "name", "cost", "description"];
      detected = headerRow.cells.map((_, idx) => defaults[idx] ?? "ignore");
    }

    return {
      delim,
      hasHeader,
      headerCells: headerRow.cells,
      dataRows,
      detected,
    };
  }, [pasted]);

  // When the parse changes shape (different column count), re-init
  // columnRoles from the detected values — but only if the user
  // hasn't manually overridden.
  useEffect(() => {
    if (!parsed) return;
    if (
      columnRolesManuallyChanged &&
      columnRoles.length === parsed.detected.length
    )
      return;
    setColumnRoles(parsed.detected);
    setColumnRolesManuallyChanged(false);
  }, [parsed, columnRolesManuallyChanged, columnRoles.length]);

  // Build the rows-for-API + per-row validation errors using the
  // current column roles.
  const validation = useMemo(() => {
    if (!parsed) return null;
    const codeIdx = columnRoles.indexOf("code");
    const nameIdx = columnRoles.indexOf("name");
    const costIdx = columnRoles.indexOf("cost");
    const descIdx = columnRoles.indexOf("description");

    if (codeIdx === -1) {
      return {
        rows: [] as RowForApi[],
        errors: ['Pick a "code" column.'],
        rowErrors: new Map<number, string>(),
      };
    }
    if (nameIdx === -1) {
      return {
        rows: [] as RowForApi[],
        errors: ['Pick a "name" column.'],
        rowErrors: new Map<number, string>(),
      };
    }

    const rowErrors = new Map<number, string>();
    const apiRows: RowForApi[] = [];
    const seenCodes = new Set<string>();

    parsed.dataRows.forEach((r, idx) => {
      const code = (r.cells[codeIdx] ?? "").trim();
      const name = (r.cells[nameIdx] ?? "").trim();
      const costRaw = costIdx === -1 ? "" : (r.cells[costIdx] ?? "");
      const desc = descIdx === -1 ? "" : (r.cells[descIdx] ?? "").trim();

      if (!code) {
        rowErrors.set(idx, "Empty code");
        return;
      }
      if (!name) {
        rowErrors.set(idx, "Empty name");
        return;
      }
      if (seenCodes.has(code)) {
        rowErrors.set(idx, "Duplicate code in pasted data");
        return;
      }
      seenCodes.add(code);

      const cleanedCost = String(costRaw).replace(/[$,\s]/g, "");
      const costNum = cleanedCost === "" ? 0 : Number(cleanedCost);
      if (costRaw && (!Number.isFinite(costNum) || costNum < 0)) {
        rowErrors.set(idx, "Cost must be a non-negative number");
        return;
      }

      apiRows.push({
        code,
        name,
        cost: costNum,
        description: desc || undefined,
      });
    });

    return { rows: apiRows, errors: [] as string[], rowErrors };
  }, [parsed, columnRoles]);

  const handleColumnRoleChange = (idx: number, role: ColumnRole) => {
    setColumnRolesManuallyChanged(true);
    setColumnRoles((prev) => {
      const next = [...prev];
      next[idx] = role;
      return next;
    });
  };

  const handleImport = async () => {
    if (!validation || validation.rows.length === 0) {
      setError("Nothing valid to import.");
      return;
    }
    setError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/skus/bulk-import-paste", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows: validation.rows }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as {
        imported: number;
        skipped: number;
        errored: number;
        results: PerRowResult[];
      };
      setResults(data.results);
      await onSaved({
        imported: data.imported,
        skipped: data.skipped,
        errored: data.errored,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't import");
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="paste-import-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={() => {
        if (!saving) onClose();
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-xl shadow-2xl max-w-3xl w-full p-6 max-h-[90vh] overflow-y-auto"
      >
        <h2
          id="paste-import-title"
          className="text-lg font-bold text-slate-900 m-0 mb-1"
        >
          Paste from spreadsheet
        </h2>
        <p className="text-xs text-slate-500 m-0 mb-4">
          Copy from Excel, Google Sheets, Numbers, or Airtable — we&rsquo;ll
          detect the columns. Strict insert-only:{" "}
          <strong>existing SKUs are never overwritten</strong>; duplicates by
          code are skipped with a clear reason.
        </p>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-800 px-3 py-2 rounded-lg mb-3 text-sm">
            {error}
          </div>
        )}

        {/* PASTE pane */}
        {results === null && (
          <>
            <textarea
              value={pasted}
              onChange={(e) => setPasted(e.target.value)}
              disabled={saving}
              placeholder={`Paste here. Example:\n\ncode\tname\tcost\nCB1\tCoffee Beans 1lb\t4.50\nCB2\tCoffee Beans 5lb\t20.00`}
              rows={8}
              className="w-full py-2 px-3 text-xs font-mono border border-slate-200 rounded-lg outline-none box-border focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 disabled:bg-slate-50 resize-y mb-3"
            />

            {parsed && (
              <>
                {/* Detected delimiter + header chip */}
                <div className="flex items-center gap-2 mb-2 flex-wrap text-[10px]">
                  <span className="text-slate-500 uppercase tracking-wide font-medium">
                    Detected:
                  </span>
                  <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                    {parsed.delim === "\t"
                      ? "Tab-separated"
                      : parsed.delim === ";"
                        ? "Semicolon-separated"
                        : "Comma-separated"}
                  </span>
                  <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                    {parsed.hasHeader ? "Header row found" : "No header row"}
                  </span>
                  <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700">
                    {parsed.dataRows.length} data row
                    {parsed.dataRows.length === 1 ? "" : "s"}
                  </span>
                </div>

                {/* Preview table */}
                <div className="border border-slate-200 rounded-lg max-h-72 overflow-auto mb-3">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        {parsed.headerCells.map((h, idx) => (
                          <th
                            key={idx}
                            className="text-left py-1.5 px-3 font-medium"
                          >
                            <div className="flex flex-col gap-1">
                              <span className="text-slate-500 text-[10px]">
                                {parsed.hasHeader ? h : `Column ${idx + 1}`}
                              </span>
                              <select
                                value={columnRoles[idx] ?? "ignore"}
                                onChange={(e) =>
                                  handleColumnRoleChange(
                                    idx,
                                    e.target.value as ColumnRole
                                  )
                                }
                                disabled={saving}
                                className="text-xs border border-slate-300 rounded px-1.5 py-0.5 bg-white cursor-pointer font-normal"
                              >
                                <option value="ignore">— ignore —</option>
                                <option value="code">Code (SKU)</option>
                                <option value="name">Name</option>
                                <option value="cost">Cost</option>
                                <option value="description">Description</option>
                              </select>
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {parsed.dataRows.map((row, idx) => {
                        const rowErr = validation?.rowErrors.get(idx);
                        return (
                          <tr
                            key={idx}
                            className={`border-b border-slate-100 last:border-b-0 ${
                              rowErr ? "bg-red-50/40" : ""
                            }`}
                            title={rowErr ?? undefined}
                          >
                            {row.cells.map((cell, cidx) => (
                              <td
                                key={cidx}
                                className="py-1.5 px-3 text-slate-700 truncate max-w-[200px]"
                              >
                                {cell}
                              </td>
                            ))}
                            {rowErr && (
                              <td className="py-1.5 px-3 text-red-700 text-[10px] font-medium">
                                {rowErr}
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {validation && validation.errors.length > 0 && (
                  <ul className="text-xs text-red-700 list-disc list-inside m-0 mb-3 space-y-0.5">
                    {validation.errors.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                )}

                {validation && validation.rows.length > 0 && (
                  <p className="text-xs text-slate-500 m-0 mb-3">
                    Ready to import <strong>{validation.rows.length}</strong>{" "}
                    SKU{validation.rows.length === 1 ? "" : "s"}.
                    {validation.rowErrors.size > 0 && (
                      <>
                        {" "}
                        {validation.rowErrors.size} row
                        {validation.rowErrors.size === 1 ? "" : "s"} will be
                        skipped.
                      </>
                    )}
                  </p>
                )}
              </>
            )}
          </>
        )}

        {/* RESULTS pane */}
        {results !== null && (
          <div className="border border-slate-200 rounded-lg overflow-hidden mb-4">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="text-left py-2 px-3 font-medium">Code</th>
                  <th className="text-left py-2 px-3 font-medium">Status</th>
                  <th className="text-left py-2 px-3 font-medium">Detail</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <tr
                    key={r.index}
                    className="border-b border-slate-100 last:border-b-0"
                  >
                    <td className="py-1.5 px-3 font-mono text-slate-700">
                      {r.code}
                    </td>
                    <td className="py-1.5 px-3">
                      <span
                        className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase ${
                          r.status === "imported"
                            ? "bg-emerald-50 text-emerald-700"
                            : r.status === "skipped"
                              ? "bg-amber-50 text-amber-700"
                              : "bg-red-50 text-red-700"
                        }`}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="py-1.5 px-3 text-slate-500">
                      {r.error ?? (r.status === "imported" ? "—" : "")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex justify-end gap-2">
          {results === null ? (
            <>
              <button
                type="button"
                onClick={onClose}
                disabled={saving}
                className="py-2 px-4 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg cursor-pointer disabled:opacity-40 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleImport}
                disabled={
                  saving ||
                  !validation ||
                  validation.rows.length === 0 ||
                  validation.errors.length > 0
                }
                className="py-2 px-4 text-sm font-semibold text-white bg-blue-500 hover:bg-blue-600 rounded-lg border-0 cursor-pointer disabled:opacity-60 inline-flex items-center gap-2"
              >
                {saving && <Spinner size={12} color="white" />}
                {saving
                  ? "Importing..."
                  : `Import ${validation?.rows.length ?? 0} SKU${(validation?.rows.length ?? 0) === 1 ? "" : "s"}`}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="py-2 px-4 text-sm font-semibold text-white bg-blue-500 hover:bg-blue-600 rounded-lg border-0 cursor-pointer"
            >
              Done
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
