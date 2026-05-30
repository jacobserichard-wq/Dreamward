// app/components/SkuBulkCostModal.tsx
//
// Phase 12d commit 4 of 5. The bulk-cost-update modal opened from
// the /skus list when N rows are selected. Lets the merchant push
// a percentage or dollar adjustment (or a fixed value) across the
// whole selection in one shot, with a live preview of old → new
// before they commit.
//
// Crafty Base counter: their users have to click into every
// material to update one cost. Even their bulk spreadsheet
// import "is highly prone to formatting errors." This modal is
// the explicit answer.
//
// Effective-date emphasis: the modal includes inline copy
// reminding the merchant that historical sales keep their prior
// cost — only sales on/after the effective date get the new
// number. That's the architectural killer feature; we promote it
// every time it's relevant.

"use client";

import { useEffect, useMemo, useState } from "react";
import Spinner from "./Spinner";

export interface SelectedSkuForCost {
  id: number;
  code: string;
  name: string;
  currentCost: number | null;
}

export interface SkuBulkCostModalProps {
  open: boolean;
  items: SelectedSkuForCost[];
  onClose: () => void;
  onSaved: (info: {
    updated: number;
    skipped: number;
    errored: number;
    results: BulkResult[];
  }) => Promise<void> | void;
}

type AdjustmentType = "percentDelta" | "dollarDelta" | "setValue";

interface BulkResult {
  skuId: number;
  status: "updated" | "skipped" | "not_found" | "error";
  oldCost: number | null;
  newCost: number | null;
  error?: string;
}

function todayIso(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function fmtMoney(n: number | null): string {
  if (n == null) return "—";
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  })}`;
}

function computePreview(
  current: number | null,
  type: AdjustmentType,
  rawValue: string
): number | null {
  const value = Number(rawValue);
  if (!Number.isFinite(value)) return null;
  const base = current ?? 0;
  let next: number;
  if (type === "percentDelta") next = base * (1 + value / 100);
  else if (type === "dollarDelta") next = base + value;
  else next = value;
  return Math.max(0, next);
}

export default function SkuBulkCostModal({
  open,
  items,
  onClose,
  onSaved,
}: SkuBulkCostModalProps) {
  const [type, setType] = useState<AdjustmentType>("percentDelta");
  const [value, setValue] = useState("");
  const [effectiveDate, setEffectiveDate] = useState(todayIso());
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setType("percentDelta");
    setValue("");
    setEffectiveDate(todayIso());
    setNotes("");
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

  const previews = useMemo(() => {
    if (!value.trim()) return null;
    const cleaned = value.replace(/[$,\s]/g, "");
    return items.map((it) => ({
      ...it,
      preview: computePreview(it.currentCost, type, cleaned),
    }));
  }, [items, type, value]);

  // Total preview reach: helps the merchant gauge magnitude.
  // "Adjusting 47 SKUs by 10% — average current cost $X → $Y"
  const previewSummary = useMemo(() => {
    if (!previews) return null;
    const withCurrent = previews.filter((p) => p.currentCost != null);
    if (withCurrent.length === 0) return null;
    const sumOld = withCurrent.reduce((s, p) => s + (p.currentCost ?? 0), 0);
    const sumNew = withCurrent.reduce((s, p) => s + (p.preview ?? 0), 0);
    return {
      avgOld: sumOld / withCurrent.length,
      avgNew: sumNew / withCurrent.length,
      count: withCurrent.length,
    };
  }, [previews]);

  if (!open) return null;
  if (items.length === 0) return null;

  const handleSave = async () => {
    setError(null);
    const cleaned = value.replace(/[$,\s]/g, "");
    const valueNum = Number(cleaned);
    if (!Number.isFinite(valueNum)) {
      setError("Adjustment value must be a number.");
      return;
    }
    if (type === "setValue" && valueNum < 0) {
      setError("Set-value cannot be negative.");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) {
      setError("Effective date must be a valid date.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/skus/bulk-update-costs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          skuIds: items.map((i) => i.id),
          adjustment: { type, value: valueNum },
          effectiveDate,
          notes: notes.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const data = (await res.json()) as {
        updated: number;
        results: BulkResult[];
      };
      const skipped = data.results.filter((r) => r.status === "skipped").length;
      const errored = data.results.filter(
        (r) => r.status === "error" || r.status === "not_found"
      ).length;
      await onSaved({
        updated: data.updated,
        skipped,
        errored,
        results: data.results,
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
      aria-labelledby="bulk-cost-title"
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
          id="bulk-cost-title"
          className="text-lg font-bold text-slate-900 m-0 mb-1"
        >
          Update cost on {items.length} SKU{items.length === 1 ? "" : "s"}
        </h2>
        <p className="text-xs text-slate-500 m-0 mb-4">
          A new cost-history row is added on the effective date.{" "}
          <strong>Historical sales keep their prior cost</strong> — only sales
          on or after the effective date will use the new number.
        </p>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-800 px-3 py-2 rounded-lg mb-3 text-sm">
            {error}
          </div>
        )}

        {/* Adjustment type segmented control */}
        <div className="mb-3">
          <label className="block text-xs font-medium text-slate-700 mb-1">
            Adjustment type
          </label>
          <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden">
            {(["percentDelta", "dollarDelta", "setValue"] as const).map(
              (t, idx) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  disabled={saving}
                  className={`py-1.5 px-3 text-xs font-medium cursor-pointer border-0 ${
                    idx > 0 ? "border-l border-slate-200" : ""
                  } ${
                    type === t
                      ? "bg-blue-500 text-white"
                      : "bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {t === "percentDelta"
                    ? "% change"
                    : t === "dollarDelta"
                      ? "$ change"
                      : "Set to value"}
                </button>
              )
            )}
          </div>
        </div>

        {/* Value + effective date row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
          <div>
            <label
              htmlFor="bulk-cost-value"
              className="block text-xs font-medium text-slate-700 mb-1"
            >
              {type === "percentDelta"
                ? "Percent (use - for decrease)"
                : type === "dollarDelta"
                  ? "Dollars (use - for decrease)"
                  : "New cost"}
            </label>
            <div className="relative">
              {type !== "percentDelta" && (
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">
                  {"$"}
                </span>
              )}
              {type === "percentDelta" && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">
                  %
                </span>
              )}
              <input
                id="bulk-cost-value"
                type="text"
                inputMode="decimal"
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                  setError(null);
                }}
                placeholder={
                  type === "percentDelta"
                    ? "10"
                    : type === "dollarDelta"
                      ? "0.50"
                      : "5.00"
                }
                disabled={saving}
                className={`w-full py-2 text-sm border border-slate-200 rounded-lg outline-none box-border focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 disabled:bg-slate-50 ${
                  type === "percentDelta" ? "pl-3 pr-8" : "pl-7 pr-3"
                }`}
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="bulk-cost-date"
              className="block text-xs font-medium text-slate-700 mb-1"
            >
              Effective from
            </label>
            <input
              id="bulk-cost-date"
              type="date"
              value={effectiveDate}
              onChange={(e) => setEffectiveDate(e.target.value)}
              disabled={saving}
              className="w-full py-2 px-3 text-sm border border-slate-200 rounded-lg outline-none box-border focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 disabled:bg-slate-50"
            />
          </div>
        </div>

        {/* Optional notes */}
        <div className="mb-4">
          <label
            htmlFor="bulk-cost-notes"
            className="block text-xs font-medium text-slate-700 mb-1"
          >
            Notes (optional)
          </label>
          <input
            id="bulk-cost-notes"
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Supplier raised wholesale prices Q3 2026"
            disabled={saving}
            className="w-full py-2 px-3 text-sm border border-slate-200 rounded-lg outline-none box-border focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 disabled:bg-slate-50"
          />
        </div>

        {/* Summary chip */}
        {previewSummary && (
          <div className="bg-blue-50 border border-blue-200 text-blue-900 rounded-lg px-3 py-2 text-xs mb-3">
            Across {previewSummary.count} SKU{previewSummary.count === 1 ? "" : "s"}: avg
            cost moves from {fmtMoney(previewSummary.avgOld)} to{" "}
            <strong>{fmtMoney(previewSummary.avgNew)}</strong>.
          </div>
        )}

        {/* Preview table */}
        <div className="border border-slate-200 rounded-lg max-h-64 overflow-y-auto mb-1">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] uppercase tracking-wide text-slate-500 border-b border-slate-200">
                <th className="text-left py-2 px-3 font-medium">Code</th>
                <th className="text-left py-2 px-3 font-medium">Name</th>
                <th className="text-right py-2 px-3 font-medium">Old</th>
                <th className="text-right py-2 px-3 font-medium">New</th>
              </tr>
            </thead>
            <tbody>
              {(previews ?? items.map((it) => ({ ...it, preview: null }))).map(
                (p) => (
                  <tr
                    key={p.id}
                    className="border-b border-slate-100 last:border-b-0"
                  >
                    <td className="py-1.5 px-3 font-mono text-slate-700">
                      {p.code}
                    </td>
                    <td className="py-1.5 px-3 text-slate-700 truncate max-w-[200px]">
                      {p.name}
                    </td>
                    <td className="py-1.5 px-3 text-right text-slate-500 tabular-nums">
                      {fmtMoney(p.currentCost)}
                    </td>
                    <td className="py-1.5 px-3 text-right text-slate-900 font-semibold tabular-nums">
                      {p.preview != null ? (
                        <span
                          className={
                            p.currentCost != null &&
                            p.preview < p.currentCost
                              ? "text-emerald-700"
                              : p.currentCost != null &&
                                  p.preview > p.currentCost
                                ? "text-amber-700"
                                : "text-slate-900"
                          }
                        >
                          {fmtMoney(p.preview)}
                        </span>
                      ) : (
                        <span className="text-slate-300">—</span>
                      )}
                    </td>
                  </tr>
                )
              )}
            </tbody>
          </table>
        </div>
        <p className="text-[10px] text-slate-400 m-0 mb-4">
          Preview only — nothing is saved until you click Apply.
        </p>

        <div className="flex justify-end gap-2">
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
            onClick={handleSave}
            disabled={saving || !value.trim()}
            className="py-2 px-4 text-sm font-semibold text-white bg-blue-500 hover:bg-blue-600 rounded-lg border-0 cursor-pointer disabled:opacity-60 inline-flex items-center gap-2"
          >
            {saving && <Spinner size={12} color="white" />}
            {saving
              ? "Applying..."
              : `Apply to ${items.length} SKU${items.length === 1 ? "" : "s"}`}
          </button>
        </div>
      </div>
    </div>
  );
}
