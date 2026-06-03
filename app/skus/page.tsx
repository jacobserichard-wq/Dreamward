// app/skus/page.tsx
//
// Phase 12b commit 1 of 4. The /skus surface — list view of every
// SKU in the merchant's catalog with current cost + sales rollup.
//
// This commit ships the read path only. Create + edit + cost
// history come in commits 2-4. The page already handles:
//   - Pro-plan gate (renders an upgrade nudge for non-Pro users)
//   - Empty state when the catalog has no SKUs
//   - Active vs archived toggle
//   - Sortable list (defaults to code ASC, mirrors the API)
//
// Sister pages once shipped:
//   - /skus/[id]            detail + cost history          (commit 4)
//   - /skus/unmatched       bulk-match the unmatched UI    (Phase 12d)
//   - /skus/bulk-import     pull catalogs from platforms   (Phase 12e)

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import PageHeader from "../components/PageHeader";
import ErrorBanner from "../components/ErrorBanner";
import SkuForm, { type SkuFormSubmit } from "../components/SkuForm";
import SkuBulkCostModal, {
  type SelectedSkuForCost,
} from "../components/SkuBulkCostModal";
import SkuPasteImportModal from "../components/SkuPasteImportModal";

interface SkuRow {
  id: number;
  code: string;
  name: string;
  description: string | null;
  active: boolean;
  currentCost: number | null;
  costCurrency: string | null;
  costEffectiveDate: string | null;
  salesCount: number;
  lastSaleDate: string | null;
  // Sub-session 33 Tier 1 commit 4: stock badge in the list view.
  quantityOnHand: number;
  createdAt: string;
  updatedAt: string;
}

// Sub-session 33 Tier 1 commit 4: color-coded stock badge. Same
// thresholds as the detail page so the visual cue stays consistent:
//   < 0  : red    — data-quality flag (sold without recorded receive)
//   = 0  : slate  — neutral out-of-stock
//   1-10 : amber  — low; consider reordering
//   > 10 : green  — healthy
function stockBadgeClasses(qty: number): string {
  if (qty < 0) return "text-red-600";
  if (qty === 0) return "text-slate-400";
  if (qty <= 10) return "text-amber-600";
  return "text-emerald-600";
}

interface SkusResponse {
  skus: SkuRow[];
  summary: { totalActive: number; totalArchived: number };
}

function fmtMoney(n: number | null, currency: string | null): string {
  if (n == null) return "—";
  const sym = currency === "USD" || !currency ? "$" : `${currency} `;
  return `${sym}${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  })}`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const monthNames = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${monthNames[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

export default function SkusPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [skus, setSkus] = useState<SkuRow[]>([]);
  const [summary, setSummary] = useState<{
    totalActive: number;
    totalArchived: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  // Bulk-select state (Phase 12d commit 4)
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkCostOpen, setBulkCostOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [successToast, setSuccessToast] = useState<string | null>(null);

  const loadSkus = useCallback(
    async (includeInactive: boolean) => {
      try {
        const url = new URL("/api/skus", window.location.origin);
        if (includeInactive) url.searchParams.set("include_inactive", "1");
        const res = await fetch(url.toString());
        if (!res.ok) {
          if (res.status === 401) {
            router.replace("/signin?callbackUrl=/skus");
            return;
          }
          if (res.status === 403) {
            setForbidden(true);
            return;
          }
          const body = await res.json().catch(() => ({}));
          setError(body.error || `HTTP ${res.status}`);
          return;
        }
        const data = (await res.json()) as SkusResponse;
        setSkus(data.skus);
        setSummary(data.summary);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't load SKUs");
      }
    },
    [router]
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await loadSkus(showArchived);
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentional — re-fetch on toggle handled below

  useEffect(() => {
    if (loading) return;
    loadSkus(showArchived);
  }, [showArchived, loadSkus, loading]);

  // ── "+ New SKU" → open the create modal ──────────────────────
  // The list page only handles creation now that /skus/[id] exists.
  // Row clicks navigate to the detail page where edits happen
  // contextually alongside cost history + aliases.
  const handleNewSku = useCallback(() => {
    setError(null);
    setFormOpen(true);
  }, []);

  const handleCloseForm = useCallback(() => {
    setFormOpen(false);
  }, []);

  // ── Click a row → drill to the detail page ───────────────────
  const handleRowClick = useCallback(
    (id: number) => {
      router.push(`/skus/${id}`);
    },
    [router]
  );

  // ── Selection handlers (Phase 12d) ────────────────────────────
  const toggleOne = useCallback((id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleAll = useCallback(() => {
    setSelected((prev) => {
      if (prev.size === skus.length) return new Set();
      return new Set(skus.map((s) => s.id));
    });
  }, [skus]);

  // Build the items array the modal needs from the current
  // selection. Filters out any selected IDs that aren't in the
  // currently-loaded skus (rare race, but defensive).
  const selectedForCost: SelectedSkuForCost[] = useMemo(() => {
    return skus
      .filter((s) => selected.has(s.id))
      .map((s) => ({
        id: s.id,
        code: s.code,
        name: s.name,
        currentCost: s.currentCost,
      }));
  }, [skus, selected]);

  const handlePasteSaved = useCallback(
    async (info: {
      imported: number;
      skipped: number;
      errored: number;
    }) => {
      // Don't auto-close — the modal shows the per-row results
      // pane and the user closes it manually via "Done". Just
      // re-fetch so the new SKUs show in the table behind the
      // modal.
      await loadSkus(showArchived);
      const parts: string[] = [
        `${info.imported} SKU${info.imported === 1 ? "" : "s"} imported`,
      ];
      if (info.skipped > 0)
        parts.push(`${info.skipped} skipped (duplicate code)`);
      if (info.errored > 0) parts.push(`${info.errored} errored`);
      setSuccessToast(parts.join(" · "));
      window.setTimeout(() => setSuccessToast(null), 6000);
    },
    [loadSkus, showArchived]
  );

  const handleBulkCostSaved = useCallback(
    async (info: {
      updated: number;
      skipped: number;
      errored: number;
    }) => {
      setBulkCostOpen(false);
      setSelected(new Set());
      // Re-fetch so the table reflects the new "current cost"
      // for every successfully-updated row.
      await loadSkus(showArchived);
      const parts: string[] = [
        `${info.updated} cost${info.updated === 1 ? "" : "s"} updated`,
      ];
      if (info.skipped > 0) {
        parts.push(
          `${info.skipped} skipped (existing cost on that date)`
        );
      }
      if (info.errored > 0) {
        parts.push(`${info.errored} errored`);
      }
      setSuccessToast(parts.join(" · "));
      window.setTimeout(() => setSuccessToast(null), 6000);
    },
    [loadSkus, showArchived]
  );

  // ── SkuForm submit handler — POST + optimistic list update ───
  const handleSaveSku = useCallback(
    async (data: SkuFormSubmit) => {
      const res = await fetch("/api/skus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const payload = (await res.json()) as { sku: SkuRow };
      // Prepend the new row to keep the user's most recent add at
      // the top of the table, then re-sort on next fetch. Updating
      // local state instead of re-fetching avoids a layout flash.
      setSkus((prev) =>
        [payload.sku, ...prev].sort((a, b) => a.code.localeCompare(b.code))
      );
      setSummary((prev) =>
        prev
          ? { ...prev, totalActive: prev.totalActive + 1 }
          : { totalActive: 1, totalArchived: 0 }
      );
      setFormOpen(false);
    },
    []
  );

  // ── Derived display ──────────────────────────────────────────
  const visibleCount = useMemo(() => skus.length, [skus]);

  // ── Pro-gate fallback ────────────────────────────────────────
  if (forbidden) {
    return (
      <div className="min-h-screen bg-slate-50 font-sans">
        <div className="max-w-[1100px] mx-auto py-8 px-4 sm:px-6">
          <PageHeader
            backHref="/dashboard"
            backLabel="FlowWork"
            title="SKUs"
            subtitle="Product cost tracking — Pro feature"
          />
          <div className="bg-white rounded-xl border border-slate-200 py-12 px-6 text-center">
            <p className="text-5xl mb-3">{"\u{1F50F}"}</p>
            <p className="text-base font-medium text-slate-700 m-0 mb-1">
              SKU catalog is part of FlowWork Pro
            </p>
            <p className="text-sm text-slate-500 m-0 mb-4 max-w-md mx-auto">
              SKUs power per-product gross-margin reporting across your
              connected stores. Upgrade to start tracking costs.
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

  return (
    <div className="min-h-screen bg-slate-50 font-sans">
      <div className="max-w-[1100px] mx-auto py-8 px-4 sm:px-6">
        <PageHeader
          backHref="/dashboard"
          backLabel="FlowWork"
          title="SKUs"
          subtitle="Product cost catalog — powers your COGS + per-channel gross margin reports"
        />

        {error && (
          <ErrorBanner message={error} onDismiss={() => setError(null)} />
        )}

        {successToast && (
          <div className="bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-xl px-4 py-3 mb-4 text-sm flex justify-between items-start gap-3">
            <span>{"\u{2705}"} {successToast}</span>
            <button
              type="button"
              onClick={() => setSuccessToast(null)}
              className="text-emerald-700 hover:text-emerald-900 bg-transparent border-0 cursor-pointer text-base leading-none"
              aria-label="Dismiss"
            >
              {"\u{00D7}"}
            </button>
          </div>
        )}

        {/* Bulk action bar (appears when SKUs are selected) */}
        {selected.size > 0 && (
          <div className="bg-slate-900 text-white rounded-xl px-4 py-3 mb-4 flex items-center justify-between gap-3 shadow-lg">
            <span className="text-sm font-medium">
              {selected.size} SKU{selected.size === 1 ? "" : "s"} selected
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSelected(new Set())}
                className="text-xs text-slate-300 hover:text-white bg-transparent border-0 cursor-pointer px-2"
              >
                Clear
              </button>
              <button
                type="button"
                onClick={() => setBulkCostOpen(true)}
                className="py-1.5 px-3 rounded-lg bg-white text-slate-900 text-sm font-semibold border-0 cursor-pointer hover:bg-slate-100"
              >
                Update costs →
              </button>
            </div>
          </div>
        )}

        {/* Action bar */}
        <div className="flex justify-between items-center gap-3 mb-5 flex-wrap">
          <div className="flex items-baseline gap-3">
            <span className="text-2xl font-bold text-slate-900 tabular-nums">
              {summary ? summary.totalActive : "—"}
            </span>
            <span className="text-sm text-slate-500">
              {summary
                ? `active SKU${summary.totalActive === 1 ? "" : "s"}${
                    summary.totalArchived > 0
                      ? ` · ${summary.totalArchived} archived`
                      : ""
                  }`
                : "loading..."}
            </span>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <Link
              href="/skus/bulk-import"
              className="py-2 px-3 rounded-lg border border-slate-300 hover:bg-slate-100 text-slate-700 text-sm font-medium cursor-pointer inline-flex items-center gap-1.5 no-underline"
              title="Pull SKUs from a connected store (Square, Shopify, Wix)"
            >
              <span>{"\u{1F4E5}"}</span> Pull from a store
            </Link>
            <button
              type="button"
              onClick={() => setPasteOpen(true)}
              className="py-2 px-3 rounded-lg border border-slate-300 hover:bg-slate-100 text-slate-700 text-sm font-medium cursor-pointer inline-flex items-center gap-1.5"
              title="Paste from Excel, Google Sheets, Numbers, or Airtable"
            >
              <span>{"\u{1F4CB}"}</span> Paste from spreadsheet
            </button>
            <button
              type="button"
              onClick={handleNewSku}
              className="py-2 px-4 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-sm font-semibold cursor-pointer border-0 inline-flex items-center gap-2"
            >
              <span>+</span> New SKU
            </button>
          </div>
        </div>

        {/* Archived toggle — only shown if there's anything archived */}
        {summary && summary.totalArchived > 0 && (
          <div className="flex items-center gap-2 mb-5">
            <span className="text-xs font-medium uppercase tracking-wide text-slate-500 mr-1">
              View:
            </span>
            <button
              type="button"
              onClick={() => setShowArchived(false)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium cursor-pointer border transition-colors ${
                !showArchived
                  ? "bg-slate-800 text-white border-slate-800"
                  : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
              }`}
            >
              Active only
            </button>
            <button
              type="button"
              onClick={() => setShowArchived(true)}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium cursor-pointer border transition-colors ${
                showArchived
                  ? "bg-slate-800 text-white border-slate-800"
                  : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
              }`}
            >
              Include archived ({summary.totalArchived})
            </button>
          </div>
        )}

        {/* Table or empty state */}
        {loading ? (
          <p className="text-center p-[60px] text-slate-500">Loading SKUs…</p>
        ) : visibleCount === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 py-12 px-6 text-center">
            <p className="text-5xl mb-3">{"\u{1F4E6}"}</p>
            <p className="text-base font-medium text-slate-700 m-0 mb-1">
              No SKUs yet
            </p>
            <p className="text-sm text-slate-500 m-0 mb-4 max-w-md mx-auto">
              Add a SKU to track its cost across all your connected stores.
              The line items on every Shopify, Wix, and Square sale will
              automatically tie back to it for gross-margin reports.
            </p>
            <button
              type="button"
              onClick={handleNewSku}
              className="inline-block py-2 px-4 rounded-lg bg-blue-500 text-white text-sm font-semibold border-0 cursor-pointer hover:bg-blue-600"
            >
              Add your first SKU
            </button>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
                  <th className="w-10 text-center py-2.5 px-2">
                    <input
                      type="checkbox"
                      aria-label="Select all"
                      checked={
                        selected.size > 0 && selected.size === skus.length
                      }
                      ref={(el) => {
                        if (el)
                          el.indeterminate =
                            selected.size > 0 && selected.size < skus.length;
                      }}
                      onChange={toggleAll}
                      className="cursor-pointer"
                    />
                  </th>
                  <th className="text-left py-2.5 px-4 font-medium">Code</th>
                  <th className="text-left py-2.5 px-4 font-medium">Name</th>
                  <th className="text-right py-2.5 px-4 font-medium">
                    Current cost
                  </th>
                  <th className="text-right py-2.5 px-4 font-medium">Stock</th>
                  <th className="text-right py-2.5 px-4 font-medium">Sales</th>
                  <th className="text-left py-2.5 px-4 font-medium">
                    Last sale
                  </th>
                  <th className="w-10" aria-label="Status" />
                </tr>
              </thead>
              <tbody>
                {skus.map((s) => {
                  const isSelected = selected.has(s.id);
                  return (
                    <tr
                      key={s.id}
                      onClick={() => handleRowClick(s.id)}
                      className={`border-b border-slate-100 last:border-b-0 cursor-pointer group ${
                        isSelected ? "bg-blue-50/50" : "hover:bg-slate-50"
                      }`}
                      title="Click for details"
                    >
                      <td
                        className="py-3 px-2 text-center"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <input
                          type="checkbox"
                          aria-label={`Select ${s.code}`}
                          checked={isSelected}
                          onChange={() => toggleOne(s.id)}
                          className="cursor-pointer"
                        />
                      </td>
                      <td className="py-3 px-4 text-slate-900 font-mono font-semibold whitespace-nowrap">
                        {s.code}
                      </td>
                      <td className="py-3 px-4 text-slate-900">
                        {s.name}
                        {s.description && (
                          <p className="text-xs text-slate-500 m-0 mt-0.5">
                            {s.description}
                          </p>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right text-slate-900 font-semibold tabular-nums whitespace-nowrap">
                        {fmtMoney(s.currentCost, s.costCurrency)}
                      </td>
                      <td
                        className={`py-3 px-4 text-right font-semibold tabular-nums whitespace-nowrap ${stockBadgeClasses(s.quantityOnHand)}`}
                        title={
                          s.quantityOnHand < 0
                            ? "Negative — likely missing a starting count"
                            : s.quantityOnHand === 0
                              ? "Out of stock"
                              : s.quantityOnHand <= 10
                                ? "Low stock"
                                : "Healthy stock"
                        }
                      >
                        {s.quantityOnHand.toLocaleString()}
                      </td>
                      <td className="py-3 px-4 text-right text-slate-600 tabular-nums whitespace-nowrap">
                        {s.salesCount > 0 ? s.salesCount : "—"}
                      </td>
                      <td className="py-3 px-4 text-slate-600 text-xs whitespace-nowrap">
                        {fmtDate(s.lastSaleDate)}
                      </td>
                      <td className="py-3 pr-3 text-xs">
                        {!s.active && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 text-[10px] font-medium uppercase tracking-wide">
                            Archived
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Sister-page links */}
        <p className="text-xs text-slate-400 text-center mt-6">
          Need to map items from your stores?{" "}
          <Link href="/skus/unmatched" className="text-blue-600 hover:underline">
            Unmatched items →
          </Link>
        </p>
      </div>

      <SkuForm
        open={formOpen}
        onSave={handleSaveSku}
        onClose={handleCloseForm}
      />

      <SkuBulkCostModal
        open={bulkCostOpen}
        items={selectedForCost}
        onClose={() => setBulkCostOpen(false)}
        onSaved={handleBulkCostSaved}
      />

      <SkuPasteImportModal
        open={pasteOpen}
        onClose={() => setPasteOpen(false)}
        onSaved={handlePasteSaved}
      />
    </div>
  );
}
