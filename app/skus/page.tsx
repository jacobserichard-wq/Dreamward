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
import AppHeader from "../components/AppHeader";
import ErrorBanner from "../components/ErrorBanner";
import SectionTip from "../components/SectionTip";
import SkuForm, { type SkuFormSubmit } from "../components/SkuForm";
import SkuBulkCostModal, {
  type SelectedSkuForCost,
} from "../components/SkuBulkCostModal";
import SkuPasteImportModal from "../components/SkuPasteImportModal";
import SkuCostModal from "../components/SkuCostModal";
import SkuStockModal from "../components/SkuStockModal";
import SkuSalesModal from "../components/SkuSalesModal";

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
  // Tier 2: has a recipe (bill of materials) → shows a 🧪 chip.
  hasRecipe: boolean;
  // 'product' (finished good) | 'component' (material).
  kind: string;
  // Tier 2: unit of measure (each, oz, ...) shown next to stock.
  unit: string;
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

interface LastImport {
  batchId: string;
  count: number;
  importedAt: string;
}
interface SkusResponse {
  skus: SkuRow[];
  summary: { totalActive: number; totalArchived: number };
  lastImport: LastImport | null;
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
  // Catalog split: which kind the list shows + which kind the create form
  // is adding.
  const [kindFilter, setKindFilter] = useState<"product" | "component">(
    "product"
  );
  const [formKind, setFormKind] = useState<"product" | "component">("product");

  // Bulk-select state (Phase 12d commit 4)
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkCostOpen, setBulkCostOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [successToast, setSuccessToast] = useState<string | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [undoingImport, setUndoingImport] = useState(false);
  const [lastImport, setLastImport] = useState<LastImport | null>(null);

  // Focused per-card modals (inventory simplification). Clicking a
  // card's Cost or Stock line opens a targeted modal instead of
  // dropping the user on the full /skus/[id] detail page.
  const [costModalSku, setCostModalSku] = useState<SkuRow | null>(null);
  const [stockModalSku, setStockModalSku] = useState<SkuRow | null>(null);
  const [salesModalSku, setSalesModalSku] = useState<SkuRow | null>(null);

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
        setLastImport(data.lastImport ?? null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't load SKUs");
      }
    },
    [router]
  );

  // Bulk-delete the selected SKUs. Clean ones (no sales/recipe/production)
  // are removed; any with history are archived instead. Reuses the
  // existing multi-select.
  const handleBulkDelete = useCallback(async () => {
    const ids = [...selected];
    if (ids.length === 0) return;
    if (
      !window.confirm(
        `Delete ${ids.length} selected SKU${ids.length === 1 ? "" : "s"}? ` +
          `Ones with no sales are permanently removed; any already used in ` +
          `sales or recipes are archived instead.`
      )
    ) {
      return;
    }
    setBulkDeleting(true);
    setError(null);
    try {
      const res = await fetch("/api/skus/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { deleted: number; archived: number };
      setSelected(new Set());
      setSuccessToast(
        `Removed ${data.deleted} SKU${data.deleted === 1 ? "" : "s"}` +
          (data.archived > 0
            ? ` · archived ${data.archived} that had sales/recipes`
            : "")
      );
      await loadSkus(showArchived);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete SKUs");
    } finally {
      setBulkDeleting(false);
    }
  }, [selected, loadSkus, showArchived]);

  // Undo the most recent bulk import — remove every SKU stamped with its
  // batch id (clean ones deleted, history ones archived).
  const handleUndoImport = useCallback(async () => {
    if (!lastImport) return;
    if (
      !window.confirm(
        `Undo the last import — remove its ${lastImport.count} SKU${
          lastImport.count === 1 ? "" : "s"
        }? Ones with no sales are deleted; any with sales or recipes are ` +
          `archived instead.`
      )
    ) {
      return;
    }
    setUndoingImport(true);
    setError(null);
    try {
      const res = await fetch("/api/skus/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ batchId: lastImport.batchId }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b.error || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as { deleted: number; archived: number };
      setSelected(new Set());
      setSuccessToast(
        `Undid last import — removed ${data.deleted}` +
          (data.archived > 0
            ? ` · archived ${data.archived} that had sales/recipes`
            : "")
      );
      await loadSkus(showArchived);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to undo import");
    } finally {
      setUndoingImport(false);
    }
  }, [lastImport, loadSkus, showArchived]);

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
  const handleNewSku = useCallback((k: "product" | "component") => {
    setError(null);
    setFormKind(k);
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
            title="SKUs"
            subtitle="Product cost tracking — Pro feature"
          />
          <div className="bg-white rounded-xl border border-slate-200 py-12 px-6 text-center">
            <p className="text-5xl mb-3">{"\u{1F50F}"}</p>
            <p className="text-base font-medium text-slate-700 m-0 mb-1">
              SKU catalog is part of Dreamward Pro
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
      <AppHeader />
      <div className="max-w-[1100px] mx-auto py-8 px-4 sm:px-6">
        <PageHeader
          title="SKUs"
          subtitle="Product cost catalog — powers your COGS + per-channel gross margin reports"
        />

        <SectionTip id="skus" title="Costs, stock, and recipes live here">
          Build your catalog with <strong>Bulk import</strong> (one click
          pulls products from a connected store), <strong>Paste from
          spreadsheet</strong>, by mapping unmatched items as they sell, or by
          hand. Set a SKU&apos;s{" "}
          <strong>cost</strong> by receiving a purchase into inventory (it
          records what you paid as a cost layer); sales then draw down your
          oldest stock first (<strong>FIFO</strong>), so margins follow what
          you actually paid. Each SKU also tracks <strong>stock</strong>, and
          for makers, a <strong>recipe</strong>: define what a product is made
          of, then log a production run to draw down materials automatically.
          The {"\u{1F9EA}"} icon marks products that have a recipe.
        </SectionTip>

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
              <button
                type="button"
                onClick={handleBulkDelete}
                disabled={bulkDeleting}
                className="py-1.5 px-3 rounded-lg bg-red-600 text-white text-sm font-semibold border-0 cursor-pointer hover:bg-red-700 disabled:opacity-60"
              >
                {bulkDeleting ? "Deleting…" : "Delete selected"}
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
              title="Pull SKUs from a connected store (Square, Shopify, Wix, Etsy)"
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
            {lastImport && (
              <button
                type="button"
                onClick={handleUndoImport}
                disabled={undoingImport}
                title={`Remove the ${lastImport.count} SKUs from your most recent import`}
                className="py-2 px-3 rounded-lg border border-amber-300 bg-amber-50 hover:bg-amber-100 text-amber-800 text-sm font-medium cursor-pointer inline-flex items-center gap-1.5 disabled:opacity-60"
              >
                <span>{"\u{21A9}"}</span>
                {undoingImport
                  ? "Undoing…"
                  : `Undo last import (${lastImport.count})`}
              </button>
            )}
            <button
              type="button"
              onClick={() => handleNewSku(kindFilter)}
              className="py-2 px-4 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-sm font-semibold cursor-pointer border-0 inline-flex items-center gap-2"
            >
              <span>+</span> New {kindFilter === "component" ? "component" : "product"}
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

        {/* Finished Goods vs Components split */}
        <div className="flex items-center gap-2 mb-4">
          {(["product", "component"] as const).map((k) => {
            const count = skus.filter(
              (s) => (s.kind ?? "product") === k
            ).length;
            const label = k === "product" ? "Finished Goods" : "Components";
            return (
              <button
                key={k}
                type="button"
                onClick={() => setKindFilter(k)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium cursor-pointer border transition-colors ${
                  kindFilter === k
                    ? "bg-slate-800 text-white border-slate-800"
                    : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                }`}
              >
                {label} ({count})
              </button>
            );
          })}
        </div>

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
              The line items on every Shopify, Wix, Square, and Etsy sale
              will automatically tie back to it for gross-margin reports.
            </p>
            <button
              type="button"
              onClick={() => handleNewSku("product")}
              className="inline-block py-2 px-4 rounded-lg bg-blue-500 text-white text-sm font-semibold border-0 cursor-pointer hover:bg-blue-600"
            >
              Add your first product
            </button>
          </div>
        ) : (
          <div>
            <label className="flex items-center gap-2 mb-3 text-xs text-slate-500 w-fit cursor-pointer">
              <input
                type="checkbox"
                aria-label="Select all"
                checked={selected.size > 0 && selected.size === skus.length}
                ref={(el) => {
                  if (el)
                    el.indeterminate =
                      selected.size > 0 && selected.size < skus.length;
                }}
                onChange={toggleAll}
                className="cursor-pointer"
              />
              Select all
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4">
                {(() => {
                const shown = skus.filter(
                  (s) => (s.kind ?? "product") === kindFilter
                );
                if (shown.length === 0) {
                  return (
                    <div className="col-span-full bg-white rounded-xl border border-slate-200 py-8 text-center text-sm text-slate-400">
                      No{" "}
                      {kindFilter === "component"
                        ? "components"
                        : "finished goods"}{" "}
                      in this view yet.
                    </div>
                  );
                }
                return shown.map((s) => {
                  const isSelected = selected.has(s.id);
                  return (
                    <div
                      key={s.id}
                      onClick={() => handleRowClick(s.id)}
                      title="Click for details"
                      className={`bg-white rounded-xl border cursor-pointer transition-colors ${
                        isSelected
                          ? "border-blue-300 bg-blue-50/40"
                          : "border-slate-200 hover:border-slate-300"
                      }`}
                    >
                      {/* Header: select + name + code + archived badge */}
                      <div className="flex items-start justify-between gap-2 pt-4 px-5 pb-3 border-b border-slate-100">
                        <div className="flex items-start gap-2 min-w-0">
                          <input
                            type="checkbox"
                            aria-label={`Select ${s.code}`}
                            checked={isSelected}
                            onClick={(e) => e.stopPropagation()}
                            onChange={() => toggleOne(s.id)}
                            className="mt-1 cursor-pointer flex-shrink-0"
                          />
                          <div className="min-w-0">
                            <div className="text-base font-bold text-slate-900 flex items-center gap-1.5 flex-wrap">
                              <span className="truncate">{s.name}</span>
                              {s.hasRecipe && (
                                <span
                                  title="Has a recipe (bill of materials)"
                                  className="text-[11px]"
                                  aria-label="Has a recipe"
                                >
                                  {"\u{1F9EA}"}
                                </span>
                              )}
                            </div>
                            <div className="text-xs font-mono text-slate-500 mt-0.5">
                              {s.code}
                            </div>
                          </div>
                        </div>
                        {!s.active && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 text-[10px] font-medium uppercase tracking-wide flex-shrink-0">
                            Archived
                          </span>
                        )}
                      </div>

                      {/* Detail rows (expense-card style) */}
                      <div className="px-5 py-3">
                        {s.description && (
                          <p className="text-xs text-slate-500 m-0 mb-2">
                            {s.description}
                          </p>
                        )}
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation();
                            setCostModalSku(s);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              e.stopPropagation();
                              setCostModalSku(s);
                            }
                          }}
                          title="View cost history / add a cost"
                          className="group/row flex justify-between items-center py-1.5 border-b border-slate-50 cursor-pointer hover:bg-slate-50/70 transition-colors"
                        >
                          <span className="text-[13px] text-slate-500">Cost</span>
                          <span className="inline-flex items-center gap-1 text-[13px] font-semibold text-slate-900 tabular-nums">
                            {fmtMoney(s.currentCost, s.costCurrency)}
                            <span
                              aria-hidden="true"
                              className="text-[11px] text-slate-300 group-hover/row:text-blue-600 transition-colors"
                            >
                              {"›"}
                            </span>
                          </span>
                        </div>
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation();
                            setStockModalSku(s);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              e.stopPropagation();
                              setStockModalSku(s);
                            }
                          }}
                          title="Receive stock / view stock history"
                          className="group/row flex justify-between items-center py-1.5 border-b border-slate-50 cursor-pointer hover:bg-slate-50/70 transition-colors"
                        >
                          <span className="text-[13px] text-slate-500">Stock</span>
                          <span className="inline-flex items-center gap-1">
                            <span
                              className={`text-[13px] font-semibold tabular-nums ${stockBadgeClasses(s.quantityOnHand)}`}
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
                              {s.unit && s.unit !== "each" && (
                                <span className="text-[11px] font-normal text-slate-400 ml-1">
                                  {s.unit}
                                </span>
                              )}
                            </span>
                            <span
                              aria-hidden="true"
                              className="text-[11px] text-slate-300 group-hover/row:text-blue-600 transition-colors"
                            >
                              {"›"}
                            </span>
                          </span>
                        </div>
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSalesModalSku(s);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              e.stopPropagation();
                              setSalesModalSku(s);
                            }
                          }}
                          title="See where and when this sold"
                          className="group/row flex justify-between items-center py-1.5 border-b border-slate-50 cursor-pointer hover:bg-slate-50/70 transition-colors"
                        >
                          <span className="text-[13px] text-slate-500">Sales</span>
                          <span className="inline-flex items-center gap-1 text-[13px] text-slate-700 tabular-nums">
                            {s.salesCount > 0 ? s.salesCount : "—"}
                            <span
                              aria-hidden="true"
                              className="text-[11px] text-slate-300 group-hover/row:text-blue-600 transition-colors"
                            >
                              {"›"}
                            </span>
                          </span>
                        </div>
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSalesModalSku(s);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              e.stopPropagation();
                              setSalesModalSku(s);
                            }
                          }}
                          title="See where and when this sold"
                          className="group/row flex justify-between items-center py-1.5 cursor-pointer hover:bg-slate-50/70 transition-colors"
                        >
                          <span className="text-[13px] text-slate-500">
                            Last sale
                          </span>
                          <span className="inline-flex items-center gap-1 text-[13px] text-slate-600">
                            {fmtDate(s.lastSaleDate)}
                            <span
                              aria-hidden="true"
                              className="text-[11px] text-slate-300 group-hover/row:text-blue-600 transition-colors"
                            >
                              {"›"}
                            </span>
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                });
                })()}
            </div>
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
        kind={formKind}
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

      {costModalSku && (
        <SkuCostModal
          open={costModalSku !== null}
          skuId={costModalSku.id}
          skuCode={costModalSku.code}
          skuName={costModalSku.name}
          onClose={() => setCostModalSku(null)}
          onChanged={() => loadSkus(showArchived)}
        />
      )}

      {stockModalSku && (
        <SkuStockModal
          open={stockModalSku !== null}
          skuId={stockModalSku.id}
          skuCode={stockModalSku.code}
          skuName={stockModalSku.name}
          currentQuantity={stockModalSku.quantityOnHand}
          unit={stockModalSku.unit}
          onClose={() => setStockModalSku(null)}
          onChanged={() => loadSkus(showArchived)}
        />
      )}

      {salesModalSku && (
        <SkuSalesModal
          open={salesModalSku !== null}
          skuId={salesModalSku.id}
          skuCode={salesModalSku.code}
          skuName={salesModalSku.name}
          onClose={() => setSalesModalSku(null)}
        />
      )}
    </div>
  );
}
