// app/components/SkuMatchModal.tsx
//
// Phase 12d commit 3 of 5. The bulk-match modal opened from the
// /skus/unmatched page. Two tabs:
//
//   1. Create new SKU — mints a new SKU + (optional) initial cost
//      row, then maps every selected item to it. One transaction
//      end-to-end. Returns total resolvedCount.
//
//   2. Map to existing SKU — picks a SKU from a dropdown of the
//      caller-provided list, then maps every selected item to it.
//      Does N POST calls in parallel (one per selected group);
//      sums the resolvedCount on the way back.
//
// Items with externalItemId === null (Square Custom Amount) get
// mapped via /api/skus/[id]/resolve-by-name. Items with non-null
// externalItemId use POST /api/sku-aliases (which retroactively
// resolves matching historical line items in the same transaction).
//
// The modal doesn't know HOW many of each kind it has — it just
// dispatches per-item based on shape, sums resolvedCount, returns
// the total to the parent via onSaved.

"use client";

import { useEffect, useMemo, useState } from "react";
import Spinner from "./Spinner";

export interface SelectedUnmatchedItem {
  platform: string;
  externalItemId: string | null;
  externalSku: string | null;
  name: string;
  lineItemCount: number;
  totalRevenue: number;
  groupKey: string;
}

/** Caller-provided list of existing SKUs for the "map to existing"
 *  dropdown. Kept thin (id + code + name) — typeahead-like filter
 *  is client-side string-includes. */
export interface ExistingSkuOption {
  id: number;
  code: string;
  name: string;
}

export interface SkuMatchModalProps {
  open: boolean;
  items: SelectedUnmatchedItem[];
  existingSkus: ExistingSkuOption[];
  onClose: () => void;
  /** Called when the map finishes (success). resolvedCount is the
   *  total number of historical processed_item_line_items rows that
   *  got their matched_sku_id filled in by this operation. */
  onSaved: (info: {
    skuId: number;
    skuCode: string;
    resolvedCount: number;
  }) => Promise<void> | void;
}

type Mode = "create" | "existing";

function todayIso(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export default function SkuMatchModal({
  open,
  items,
  existingSkus,
  onClose,
  onSaved,
}: SkuMatchModalProps) {
  const [mode, setMode] = useState<Mode>("create");

  // create-new tab state
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [cost, setCost] = useState("");
  const [effectiveDate, setEffectiveDate] = useState(todayIso());

  // map-to-existing tab state
  const [pickedSkuId, setPickedSkuId] = useState<number | null>(null);
  const [filter, setFilter] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset state each time modal opens. Default the "create" name
  // field to the first selected item's name so single-item
  // mappings are 1-click after entering a code + cost.
  useEffect(() => {
    if (!open) return;
    setMode("create");
    setCode("");
    setName(items[0]?.name ?? "");
    setCost("");
    setEffectiveDate(todayIso());
    setPickedSkuId(null);
    setFilter("");
    setError(null);
  }, [open, items]);

  // Esc to close
  useEffect(() => {
    if (!open || saving) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, saving, onClose]);

  const filteredSkus = useMemo(() => {
    const f = filter.trim().toLowerCase();
    if (!f) return existingSkus.slice(0, 50);
    return existingSkus
      .filter(
        (s) =>
          s.code.toLowerCase().includes(f) ||
          s.name.toLowerCase().includes(f)
      )
      .slice(0, 50);
  }, [existingSkus, filter]);

  if (!open) return null;
  if (items.length === 0) return null;

  /**
   * Map a list of items to a SKU id. Each item dispatches to the
   * right endpoint based on shape. Returns total resolvedCount.
   */
  const mapItemsToSku = async (skuId: number): Promise<number> => {
    let totalResolved = 0;
    for (const it of items) {
      if (it.externalItemId === null) {
        // Square Custom Amount path — resolve by name on
        // processed_item_line_items directly.
        const res = await fetch(
          `/api/skus/${skuId}/resolve-by-name`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ platform: it.platform, name: it.name }),
          }
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(
            body.error || `Resolve-by-name failed (HTTP ${res.status})`
          );
        }
        const data = (await res.json()) as { resolvedCount: number };
        totalResolved += data.resolvedCount;
      } else {
        // Standard alias path. Includes retroactive resolve of
        // historical line items in the same SQL transaction.
        const res = await fetch("/api/sku-aliases", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            skuId,
            platform: it.platform,
            externalId: it.externalItemId,
            externalSku: it.externalSku,
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(
            body.error ||
              `Alias create failed for ${it.platform} ${it.externalItemId} (HTTP ${res.status})`
          );
        }
        const data = (await res.json()) as { resolvedCount: number };
        totalResolved += data.resolvedCount;
      }
    }
    return totalResolved;
  };

  const handleCreateAndMap = async () => {
    setError(null);
    const trimmedCode = code.trim();
    if (!trimmedCode) {
      setError("SKU code is required.");
      return;
    }
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Name is required.");
      return;
    }
    const cleaned = cost.replace(/[$,\s]/g, "");
    const costNum = Number(cleaned);
    if (!Number.isFinite(costNum) || costNum < 0) {
      setError("Cost must be a non-negative number.");
      return;
    }

    setSaving(true);
    try {
      // 1. Create the SKU + initial cost row.
      const createRes = await fetch("/api/skus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: trimmedCode,
          name: trimmedName,
          cost: costNum,
          effectiveDate,
        }),
      });
      if (!createRes.ok) {
        const body = await createRes.json().catch(() => ({}));
        throw new Error(body.error || `Couldn't create SKU (HTTP ${createRes.status})`);
      }
      const created = (await createRes.json()) as {
        sku: { id: number; code: string };
      };

      // 2. Map every selected item to it.
      const resolvedCount = await mapItemsToSku(created.sku.id);

      await onSaved({
        skuId: created.sku.id,
        skuCode: created.sku.code,
        resolvedCount,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  const handleMapToExisting = async () => {
    setError(null);
    if (pickedSkuId == null) {
      setError("Pick an existing SKU.");
      return;
    }
    const picked = existingSkus.find((s) => s.id === pickedSkuId);
    if (!picked) {
      setError("Selected SKU not found.");
      return;
    }

    setSaving(true);
    try {
      const resolvedCount = await mapItemsToSku(picked.id);
      await onSaved({
        skuId: picked.id,
        skuCode: picked.code,
        resolvedCount,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="sku-match-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={() => {
        if (!saving) onClose();
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-xl shadow-2xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto"
      >
        <h2
          id="sku-match-title"
          className="text-lg font-bold text-slate-900 m-0 mb-1"
        >
          Map {items.length} item{items.length === 1 ? "" : "s"} to a SKU
        </h2>
        <p className="text-xs text-slate-500 m-0 mb-4">
          Every historical sale of these items will get its COGS
          recalculated as soon as you save — no re-import needed.
        </p>

        {/* Selected items preview */}
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 mb-4 max-h-32 overflow-y-auto">
          <ul className="m-0 p-0 list-none space-y-1">
            {items.map((it) => (
              <li
                key={it.groupKey}
                className="text-xs text-slate-700 flex justify-between gap-2"
              >
                <span className="truncate">
                  <span className="font-mono text-slate-400 mr-1">
                    {it.platform}
                  </span>
                  {it.name}
                  {it.externalItemId === null && (
                    <span className="ml-1 text-amber-700 italic">
                      (custom amount)
                    </span>
                  )}
                </span>
                <span className="text-slate-500 tabular-nums whitespace-nowrap">
                  {it.lineItemCount} sale{it.lineItemCount === 1 ? "" : "s"}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* Tab toggle */}
        <div className="flex gap-2 border-b border-slate-200 mb-4">
          <TabButton
            label="Create new SKU"
            active={mode === "create"}
            onClick={() => setMode("create")}
          />
          <TabButton
            label="Map to existing SKU"
            active={mode === "existing"}
            disabled={existingSkus.length === 0}
            onClick={() => setMode("existing")}
          />
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-800 px-3 py-2 rounded-lg mb-3 text-sm">
            {error}
          </div>
        )}

        {/* CREATE tab */}
        {mode === "create" && (
          <div className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_2fr] gap-3">
              <Field label="Code" htmlFor="match-code">
                <input
                  id="match-code"
                  type="text"
                  value={code}
                  onChange={(e) => {
                    setCode(e.target.value);
                    setError(null);
                  }}
                  placeholder="CB1"
                  disabled={saving}
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  className="w-full py-2 px-3 text-sm font-mono border border-slate-200 rounded-lg outline-none box-border focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 disabled:bg-slate-50"
                />
              </Field>

              <Field label="Name" htmlFor="match-name">
                <input
                  id="match-name"
                  type="text"
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setError(null);
                  }}
                  placeholder="Coffee Beans 1lb"
                  disabled={saving}
                  className="w-full py-2 px-3 text-sm border border-slate-200 rounded-lg outline-none box-border focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 disabled:bg-slate-50"
                />
              </Field>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Per-unit cost" htmlFor="match-cost">
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">
                    {"$"}
                  </span>
                  <input
                    id="match-cost"
                    type="text"
                    inputMode="decimal"
                    value={cost}
                    onChange={(e) => {
                      setCost(e.target.value);
                      setError(null);
                    }}
                    placeholder="0.00"
                    disabled={saving}
                    className="w-full py-2 pl-7 pr-3 text-sm border border-slate-200 rounded-lg outline-none box-border focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 disabled:bg-slate-50"
                  />
                </div>
              </Field>

              <Field label="Cost effective from" htmlFor="match-date">
                <input
                  id="match-date"
                  type="date"
                  value={effectiveDate}
                  onChange={(e) => setEffectiveDate(e.target.value)}
                  disabled={saving}
                  className="w-full py-2 px-3 text-sm border border-slate-200 rounded-lg outline-none box-border focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 disabled:bg-slate-50"
                />
              </Field>
            </div>

            <p className="text-xs text-slate-500 m-0">
              Back-date if you want this cost to apply to historical sales of
              the item. Otherwise leave today — historical sales keep their
              prior cost.
            </p>
            <div className="flex items-start gap-2 mt-1 px-3 py-2 rounded-lg bg-blue-50 border border-blue-200 text-xs text-slate-700">
              <span aria-hidden="true" className="flex-shrink-0">
                {"\u{2139}\u{FE0F}"}
              </span>
              <span>
                <strong>Make this product from materials you track?</strong> Add
                a simple cost now — you can set up its <strong>recipe</strong>{" "}
                later on the product&apos;s page (under{" "}
                <strong>SKUs &amp; Components</strong>) to cost it from its
                components automatically.
              </span>
            </div>
          </div>
        )}

        {/* EXISTING tab */}
        {mode === "existing" && (
          <div className="space-y-3">
            {existingSkus.length === 0 ? (
              <p className="text-sm text-slate-500 italic m-0">
                No existing SKUs in your catalog yet. Use the Create tab.
              </p>
            ) : (
              <>
                <Field label="Filter SKUs" htmlFor="match-filter">
                  <input
                    id="match-filter"
                    type="text"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder="Search by code or name"
                    disabled={saving}
                    className="w-full py-2 px-3 text-sm border border-slate-200 rounded-lg outline-none box-border focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 disabled:bg-slate-50"
                  />
                </Field>

                <div className="border border-slate-200 rounded-lg max-h-64 overflow-y-auto">
                  {filteredSkus.length === 0 ? (
                    <p className="text-sm text-slate-500 italic m-0 p-3 text-center">
                      No matches.
                    </p>
                  ) : (
                    <ul className="m-0 p-0 list-none">
                      {filteredSkus.map((s) => (
                        <li key={s.id}>
                          <button
                            type="button"
                            onClick={() => setPickedSkuId(s.id)}
                            disabled={saving}
                            className={`w-full text-left px-3 py-2 text-sm cursor-pointer border-0 bg-transparent ${
                              pickedSkuId === s.id
                                ? "bg-blue-50 text-blue-900"
                                : "hover:bg-slate-50 text-slate-700"
                            }`}
                          >
                            <span className="font-mono font-semibold mr-2">
                              {s.code}
                            </span>
                            <span>{s.name}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 mt-5">
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
            onClick={mode === "create" ? handleCreateAndMap : handleMapToExisting}
            disabled={saving}
            className="py-2 px-4 text-sm font-semibold text-white bg-blue-500 hover:bg-blue-600 rounded-lg border-0 cursor-pointer disabled:opacity-60 inline-flex items-center gap-2"
          >
            {saving && <Spinner size={12} color="white" />}
            {saving
              ? "Saving..."
              : mode === "create"
                ? "Create + map"
                : "Map to selected"}
          </button>
        </div>
      </div>
    </div>
  );
}

function TabButton({
  label,
  active,
  disabled,
  onClick,
}: {
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`py-2 px-3 text-sm font-medium border-0 bg-transparent border-b-2 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${
        active
          ? "border-blue-500 text-blue-700"
          : "border-transparent text-slate-500 hover:text-slate-700"
      }`}
    >
      {label}
    </button>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="block text-xs font-medium text-slate-700 mb-1"
      >
        {label}
      </label>
      {children}
    </div>
  );
}
