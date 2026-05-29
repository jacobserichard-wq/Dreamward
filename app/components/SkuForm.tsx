// app/components/SkuForm.tsx
//
// Phase 12b commit 2 of 4. Modal form for creating a new SKU
// in the FlowWork catalog. Mirrors the ExpenseForm scaffolding
// (overlay, Esc handler, Field helper, Spinner-in-button) but
// trimmed to a tighter field set:
//
//   - code        the merchant's short identifier ("CB1")
//   - name        the human label ("Coffee Beans 1lb")
//   - description optional longer explanation
//   - cost        per-unit cost (NUMERIC up to 4 decimals on the
//                 server). Currency defaults to USD; multi-currency
//                 UX deferred per Phase 12 design Section 9.
//   - effective_date  when this initial cost begins applying.
//                     Defaults to today; merchant can backdate.
//
// The parent's onSave handler does the POST and is responsible for
// closing the modal on success. Errors thrown by onSave (server
// validation, duplicate code, network) surface inline.

"use client";

import { useEffect, useState } from "react";
import Spinner from "./Spinner";

export interface SkuFormSubmit {
  code: string;
  name: string;
  description: string | null;
  cost: number;
  effectiveDate: string;
}

export interface SkuFormProps {
  open: boolean;
  onSave: (data: SkuFormSubmit) => Promise<void>;
  onClose: () => void;
}

function todayIso(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

export default function SkuForm({ open, onSave, onClose }: SkuFormProps) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [cost, setCost] = useState("");
  const [effectiveDate, setEffectiveDate] = useState(todayIso());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset state every time the modal re-opens. Commit 3 will
  // extend this with an `editing` prop branch that pre-fills from
  // an existing SKU; for commit 2, opening is always "create."
  useEffect(() => {
    if (!open) return;
    setCode("");
    setName("");
    setDescription("");
    setCost("");
    setEffectiveDate(todayIso());
    setError(null);
  }, [open]);

  // Esc to close (when not saving)
  useEffect(() => {
    if (!open || saving) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, saving, onClose]);

  if (!open) return null;

  const handleSave = async () => {
    setError(null);
    const trimmedCode = code.trim();
    if (!trimmedCode) {
      setError("SKU code is required.");
      return;
    }
    if (trimmedCode.length > 64) {
      setError("SKU code is too long (max 64 characters).");
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
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) {
      setError("Effective date must be a valid date.");
      return;
    }

    setSaving(true);
    try {
      await onSave({
        code: trimmedCode,
        name: trimmedName,
        description: description.trim() || null,
        cost: costNum,
        effectiveDate,
      });
      // Parent closes the modal on success.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save SKU");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="sku-form-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={() => {
        if (!saving) onClose();
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-xl shadow-2xl max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto"
      >
        <h2
          id="sku-form-title"
          className="text-lg font-bold text-slate-900 m-0 mb-1"
        >
          Add a SKU
        </h2>
        <p className="text-xs text-slate-500 m-0 mb-5">
          Pick a short code that's easy to remember + matches what
          you put on platform listings. The initial cost is dated so
          historical sales keep their historical margin.
        </p>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-800 px-3 py-2 rounded-lg mb-3 text-sm">
            {error}
          </div>
        )}

        <div className="space-y-3">
          {/* Code + Name on one row */}
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_2fr] gap-3">
            <Field label="Code" htmlFor="sku-code">
              <input
                id="sku-code"
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

            <Field label="Name" htmlFor="sku-name">
              <input
                id="sku-name"
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

          {/* Description */}
          <Field label="Description (optional)" htmlFor="sku-description">
            <textarea
              id="sku-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Any notes about this SKU"
              rows={2}
              disabled={saving}
              className="w-full py-2 px-3 text-sm border border-slate-200 rounded-lg outline-none box-border focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 disabled:bg-slate-50 resize-y"
            />
          </Field>

          {/* Cost + Effective date on one row */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Per-unit cost" htmlFor="sku-cost">
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">
                  {"$"}
                </span>
                <input
                  id="sku-cost"
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

            <Field label="Effective date" htmlFor="sku-effective-date">
              <input
                id="sku-effective-date"
                type="date"
                value={effectiveDate}
                onChange={(e) => setEffectiveDate(e.target.value)}
                disabled={saving}
                className="w-full py-2 px-3 text-sm border border-slate-200 rounded-lg outline-none box-border focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 disabled:bg-slate-50"
              />
            </Field>
          </div>
          <p className="text-xs text-slate-500 m-0">
            Backdate the effective date if you want this cost to apply
            to historical sales already in FlowWork.
          </p>
        </div>

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
            onClick={handleSave}
            disabled={saving}
            className="py-2 px-4 text-sm font-semibold text-white bg-blue-500 hover:bg-blue-600 rounded-lg border-0 cursor-pointer disabled:opacity-60 inline-flex items-center gap-2"
          >
            {saving && <Spinner size={12} color="white" />}
            {saving ? "Saving..." : "Save SKU"}
          </button>
        </div>
      </div>
    </div>
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
