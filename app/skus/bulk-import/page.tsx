// app/skus/bulk-import/page.tsx
//
// Phase 12e commit 2 of 2. The catalog bulk-import surface.
// Four tabs (Square / Shopify / Wix / Etsy) → pull the connected
// platform's catalog → edit codes/costs in preview → import.
//
// Anti-Crafty: Crafty Base requires per-row data entry through
// multiple tabs/screens. We let the merchant populate their
// entire Dreamward catalog from an existing platform catalog in
// one click + a preview pass.

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import PageHeader from "../../components/PageHeader";
import AppHeader from "../../components/AppHeader";
import ErrorBanner from "../../components/ErrorBanner";
import Spinner from "../../components/Spinner";

type Platform = "square" | "shopify" | "wix" | "etsy";

interface CatalogRow {
  externalId: string;
  productId?: string;
  displayName: string;
  sku: string | null;
  cost: number | null;
  currency: string | null;
}

interface EditableRow extends CatalogRow {
  /** Stable client-side row key. */
  rowKey: string;
  /** User-editable Dreamward SKU code. Suggested from sku ?? externalId. */
  code: string;
  /** User-editable cost. Pre-filled from platform when available. */
  costEdit: string;
  selected: boolean;
}

interface PerRowResult {
  index: number;
  externalId: string;
  code: string;
  status: "imported" | "skipped" | "errored";
  resolvedCount?: number;
  error?: string;
}

function todayIso(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function platformMeta(p: Platform): {
  label: string;
  icon: string;
  color: string;
  notes: string;
} {
  switch (p) {
    case "square":
      return {
        label: "Square",
        icon: "\u{25A0}",
        color: "text-slate-700 bg-slate-100 border-slate-300",
        notes:
          "Costs auto-fill from Square's Item Library when you've set Default Unit Cost.",
      };
    case "shopify":
      return {
        label: "Shopify",
        icon: "\u{1F6CD}",
        color: "text-emerald-700 bg-emerald-50 border-emerald-200",
        notes:
          'Costs auto-fill from "Cost per item" when inventory cost tracking is enabled.',
      };
    case "wix":
      return {
        label: "Wix",
        icon: "\u{1F310}",
        color: "text-blue-700 bg-blue-50 border-blue-200",
        notes:
          "Wix doesn't expose cost via the public Catalog API — fill costs in below.",
      };
    case "etsy":
      return {
        label: "Etsy",
        icon: "\u{1F3F7}\u{FE0F}",
        color: "text-orange-700 bg-orange-50 border-orange-200",
        notes:
          "Etsy doesn't expose your costs — fill them in below. Listings import as one SKU each; variations within a listing share it.",
      };
  }
}

/** Suggest a Dreamward SKU code from the platform-side data. Uses
 *  the platform SKU when present, else last 12 chars of the
 *  external id (UUIDs/numeric ids look ugly but unique). */
function suggestCode(row: CatalogRow): string {
  if (row.sku && row.sku.trim().length > 0) return row.sku.trim();
  const id = row.externalId ?? "";
  return id.length > 12 ? id.slice(-12) : id;
}

export default function BulkImportPage() {
  const router = useRouter();

  const [platform, setPlatform] = useState<Platform>("square");
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);
  const [rows, setRows] = useState<EditableRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);

  const [effectiveDate, setEffectiveDate] = useState(todayIso());
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState<{
    imported: number;
    skipped: number;
    errored: number;
    totalResolved: number;
    rows: PerRowResult[];
  } | null>(null);

  // Reset state when platform changes (a switch implies starting over)
  useEffect(() => {
    setFetched(false);
    setRows([]);
    setResults(null);
    setError(null);
  }, [platform]);

  const fetchCatalog = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResults(null);
    try {
      const res = await fetch(`/api/${platform}/catalog`);
      if (!res.ok) {
        if (res.status === 401) {
          router.replace("/signin?callbackUrl=/skus/bulk-import");
          return;
        }
        if (res.status === 403) {
          setForbidden(true);
          return;
        }
        if (res.status === 404) {
          setError(
            `No ${platformMeta(platform).label} connection. Connect first from /integrations.`
          );
          return;
        }
        const body = await res.json().catch(() => ({}));
        setError(body.error || `HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as {
        rows: CatalogRow[];
        warning?: string;
      };
      // Non-blocking caveat from the catalog endpoint (e.g., the
      // Etsy route's page cap tripped on an enormous shop). Reuses
      // the dismissable error banner — the rows below it are real.
      if (data.warning) setError(data.warning);
      const editable: EditableRow[] = data.rows.map((r, idx) => ({
        ...r,
        rowKey: `${platform}-${r.externalId}-${idx}`,
        code: suggestCode(r),
        costEdit: r.cost != null ? String(r.cost) : "",
        selected: true,
      }));
      setRows(editable);
      setFetched(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't fetch catalog");
    } finally {
      setLoading(false);
    }
  }, [platform, router]);

  const updateRow = useCallback(
    (rowKey: string, updates: Partial<EditableRow>) => {
      setRows((prev) =>
        prev.map((r) => (r.rowKey === rowKey ? { ...r, ...updates } : r))
      );
    },
    []
  );

  const toggleAll = useCallback(() => {
    setRows((prev) => {
      const allSelected = prev.every((r) => r.selected);
      return prev.map((r) => ({ ...r, selected: !allSelected }));
    });
  }, []);

  const selectedRows = useMemo(() => rows.filter((r) => r.selected), [rows]);

  const handleImport = useCallback(async () => {
    if (selectedRows.length === 0) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) {
      setError("Effective date must be a valid date.");
      return;
    }
    setImporting(true);
    setError(null);
    try {
      const payload = {
        platform,
        effectiveDate,
        rows: selectedRows.map((r) => ({
          externalId: r.externalId,
          code: r.code,
          name: r.displayName,
          cost: r.costEdit ? Number(r.costEdit.replace(/[$,\s]/g, "")) : 0,
          externalSku: r.sku ?? undefined,
        })),
      };
      const res = await fetch("/api/skus/bulk-import-catalog", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as {
        imported: number;
        skipped: number;
        errored: number;
        totalResolved: number;
        results: PerRowResult[];
      };
      setResults({
        imported: data.imported,
        skipped: data.skipped,
        errored: data.errored,
        totalResolved: data.totalResolved,
        rows: data.results,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }, [platform, effectiveDate, selectedRows]);

  // ── Pro-gate fallback ────────────────────────────────────────
  if (forbidden) {
    return (
      <div className="min-h-screen bg-slate-50 font-sans">
        <AppHeader />
        <div className="max-w-[1100px] mx-auto py-8 px-4 sm:px-6">
          <PageHeader
            backHref="/skus"
            backLabel="SKUs"
            title="Bulk import"
            subtitle="Pro feature"
          />
          <div className="bg-white rounded-xl border border-slate-200 py-12 px-6 text-center">
            <p className="text-base font-medium text-slate-700 m-0 mb-4">
              Catalog bulk-import is part of Dreamward Pro.
            </p>
            <Link
              href="/upgrade"
              className="inline-block py-2 px-4 rounded-lg bg-blue-500 text-white text-sm font-semibold no-underline hover:bg-blue-600"
            >
              See Pro plans
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const meta = platformMeta(platform);

  return (
    <div className="min-h-screen bg-slate-50 font-sans">
      <AppHeader />
      <div className="max-w-[1100px] mx-auto py-8 px-4 sm:px-6">
        <PageHeader
          backHref="/skus"
          backLabel="SKUs"
          title="Bulk import from a connected store"
          subtitle="Pull every product from Square, Shopify, Wix, or Etsy in one click — edit codes and costs in the preview, then commit. Already-mapped items skip cleanly."
        />

        {error && (
          <ErrorBanner message={error} onDismiss={() => setError(null)} />
        )}

        {/* Platform tabs */}
        <div className="flex gap-2 mb-4 flex-wrap">
          {(["square", "shopify", "wix", "etsy"] as const).map((p) => {
            const m = platformMeta(p);
            return (
              <button
                key={p}
                type="button"
                onClick={() => setPlatform(p)}
                disabled={loading || importing}
                className={`py-2 px-4 rounded-lg text-sm font-medium border cursor-pointer disabled:opacity-40 ${
                  platform === p
                    ? "bg-slate-800 text-white border-slate-800"
                    : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                }`}
              >
                <span className="mr-1.5">{m.icon}</span>
                {m.label}
              </button>
            );
          })}
        </div>

        {/* Platform-specific notes */}
        <p className="text-xs text-slate-500 mb-4 m-0">{meta.notes}</p>

        {/* Fetch button (when not yet fetched) */}
        {!fetched && !results && (
          <div className="bg-white rounded-xl border border-slate-200 p-8 text-center">
            <p className="text-base font-medium text-slate-700 m-0 mb-1">
              Pull your {meta.label} catalog
            </p>
            <p className="text-sm text-slate-500 m-0 mb-4 max-w-md mx-auto">
              We&apos;ll fetch every product variant from your connected
              {" "}{meta.label} store. Nothing is written to your Dreamward
              catalog until you click Import.
            </p>
            <button
              type="button"
              onClick={fetchCatalog}
              disabled={loading}
              className="inline-flex items-center gap-2 py-2 px-4 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-sm font-semibold border-0 cursor-pointer disabled:opacity-60"
            >
              {loading && <Spinner size={12} color="white" />}
              {loading ? `Fetching ${meta.label}…` : `Fetch ${meta.label} catalog`}
            </button>
          </div>
        )}

        {/* Preview + edit pane */}
        {fetched && !results && (
          <>
            <div className="bg-white rounded-xl border border-slate-200 p-4 mb-3">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <p className="text-sm font-semibold text-slate-900 m-0">
                    {rows.length} item{rows.length === 1 ? "" : "s"} fetched
                    {" · "}
                    {selectedRows.length} selected for import
                  </p>
                  <p className="text-xs text-slate-500 m-0 mt-0.5">
                    Click the Code or Cost cell to edit. Uncheck items you
                    don&apos;t want.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-slate-700 font-medium">
                    Effective from
                    <input
                      type="date"
                      value={effectiveDate}
                      onChange={(e) => setEffectiveDate(e.target.value)}
                      disabled={importing}
                      className="ml-2 py-1 px-2 text-xs border border-slate-200 rounded outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500"
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setFetched(false);
                      setRows([]);
                    }}
                    disabled={importing}
                    className="py-1.5 px-3 text-xs font-medium text-slate-700 border border-slate-300 rounded-lg cursor-pointer hover:bg-slate-50"
                  >
                    Discard
                  </button>
                  <button
                    type="button"
                    onClick={handleImport}
                    disabled={importing || selectedRows.length === 0}
                    className="py-1.5 px-3 text-sm font-semibold text-white bg-blue-500 hover:bg-blue-600 rounded-lg border-0 cursor-pointer disabled:opacity-60 inline-flex items-center gap-1.5"
                  >
                    {importing && <Spinner size={12} color="white" />}
                    {importing
                      ? "Importing..."
                      : `Import ${selectedRows.length} →`}
                  </button>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
                    <th className="w-10 text-center py-2.5 px-2">
                      <input
                        type="checkbox"
                        aria-label="Select all"
                        checked={
                          rows.length > 0 &&
                          rows.every((r) => r.selected)
                        }
                        ref={(el) => {
                          if (el)
                            el.indeterminate =
                              selectedRows.length > 0 &&
                              selectedRows.length < rows.length;
                        }}
                        onChange={toggleAll}
                        className="cursor-pointer"
                      />
                    </th>
                    <th className="text-left py-2.5 px-3 font-medium">Code</th>
                    <th className="text-left py-2.5 px-3 font-medium">
                      Name (from {meta.label})
                    </th>
                    <th className="text-left py-2.5 px-3 font-medium">
                      Platform SKU
                    </th>
                    <th className="text-right py-2.5 px-3 font-medium">
                      Cost ($)
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr
                      key={r.rowKey}
                      className={`border-b border-slate-100 last:border-b-0 ${
                        r.selected ? "" : "opacity-50"
                      }`}
                    >
                      <td className="py-2 px-2 text-center">
                        <input
                          type="checkbox"
                          checked={r.selected}
                          onChange={() =>
                            updateRow(r.rowKey, { selected: !r.selected })
                          }
                          className="cursor-pointer"
                          aria-label={`Select ${r.displayName}`}
                        />
                      </td>
                      <td className="py-2 px-3">
                        <input
                          type="text"
                          value={r.code}
                          onChange={(e) =>
                            updateRow(r.rowKey, { code: e.target.value })
                          }
                          disabled={!r.selected || importing}
                          autoCapitalize="characters"
                          autoCorrect="off"
                          spellCheck={false}
                          className="w-full py-1 px-2 text-xs font-mono border border-slate-200 rounded outline-none focus:ring-1 focus:ring-blue-500/30 focus:border-blue-500 disabled:bg-slate-50 disabled:text-slate-400"
                        />
                      </td>
                      <td className="py-2 px-3 text-slate-700 truncate max-w-[300px]">
                        {r.displayName}
                      </td>
                      <td className="py-2 px-3 text-slate-500 text-xs font-mono">
                        {r.sku ?? "—"}
                      </td>
                      <td className="py-2 px-3 text-right">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={r.costEdit}
                          onChange={(e) =>
                            updateRow(r.rowKey, { costEdit: e.target.value })
                          }
                          disabled={!r.selected || importing}
                          placeholder="0.00"
                          className="w-20 py-1 px-2 text-xs text-right border border-slate-200 rounded outline-none focus:ring-1 focus:ring-blue-500/30 focus:border-blue-500 disabled:bg-slate-50 disabled:text-slate-400 tabular-nums"
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* Results pane */}
        {results && (
          <>
            <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-xl px-4 py-3 mb-4">
              <p className="text-sm font-semibold m-0 mb-1">
                {"\u{2728}"} Imported {results.imported} SKU
                {results.imported === 1 ? "" : "s"}
                {results.totalResolved > 0 && (
                  <>
                    {" "}— and lit up{" "}
                    <strong>{results.totalResolved}</strong> historical sale
                    {results.totalResolved === 1 ? "" : "s"} via retroactive
                    SKU mapping.
                  </>
                )}
              </p>
              <p className="text-xs m-0 text-emerald-800">
                {results.skipped > 0 &&
                  `${results.skipped} skipped (already in your catalog or platform mapping exists). `}
                {results.errored > 0 && `${results.errored} errored.`}
              </p>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto mb-4">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
                    <th className="text-left py-2.5 px-4 font-medium">Code</th>
                    <th className="text-left py-2.5 px-4 font-medium">
                      Status
                    </th>
                    <th className="text-left py-2.5 px-4 font-medium">
                      Detail
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {results.rows.map((r) => (
                    <tr
                      key={r.index}
                      className="border-b border-slate-100 last:border-b-0"
                    >
                      <td className="py-2 px-4 font-mono text-slate-700">
                        {r.code}
                      </td>
                      <td className="py-2 px-4">
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
                      <td className="py-2 px-4 text-slate-500 text-xs">
                        {r.error
                          ? r.error
                          : r.status === "imported"
                            ? r.resolvedCount && r.resolvedCount > 0
                              ? `${r.resolvedCount} historical sales mapped`
                              : "—"
                            : ""}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setResults(null);
                  setFetched(false);
                  setRows([]);
                }}
                className="py-2 px-4 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg cursor-pointer hover:bg-slate-50"
              >
                Import another platform
              </button>
              <Link
                href="/skus"
                className="py-2 px-4 text-sm font-semibold text-white bg-blue-500 hover:bg-blue-600 rounded-lg no-underline inline-block"
              >
                Done → back to SKUs
              </Link>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
