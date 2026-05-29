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

/** Subset of SkuFormSubmit that the edit path actually mutates.
 *  Cost + effectiveDate are NOT edited here — those flow through
 *  a dedicated "Add new cost" form on the SKU detail page (commit
 *  4) so historical sales keep their historical cost. Editing the
 *  current cost in place would be lossy. */
export interface SkuFormEditSubmit {
  name: string;
  description: string | null;
}

export interface SkuFormEditing {
  id: number;
  code: string;
  name: string;
  description: string | null;
  active: boolean;
}

export interface SkuFormProps {
  open: boolean;
  /** When set, the modal runs in EDIT mode: code is read-only,
   *  cost + effective_date fields are hidden, and Archive/Restore
   *  buttons appear. The parent's onSaveEdit handler is called
   *  on Save (instead of onSave). */
  editing?: SkuFormEditing | null;
  onSave: (data: SkuFormSubmit) => Promise<void>;
  /** Required when editing is set. Receives just the editable
   *  subset (name + description). Cost edits go through the
   *  SKU detail page in commit 4. */
  onSaveEdit?: (data: SkuFormEditSubmit) => Promise<void>;
  /** Toggle the SKU's active state. Called when the user clicks
   *  Archive (currently active) or Restore (currently archived).
   *  Required when editing is set. */
  onToggleActive?: (active: boolean) => Promise<void>;
  onClose: () => void;
}

function todayIso(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

export default function SkuForm({
  open,
  editing = null,
  onSave,
  onSaveEdit,
  onToggleActive,
  onClose,
}: SkuFormProps) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [cost, setCost] = useState("");
  const [effectiveDate, setEffectiveDate] = useState(todayIso());
  const [saving, setSaving] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset state every time the modal re-opens. Two paths:
  //   - editing=null → fresh "Add SKU" form (empty fields,
  //     today's date)
  //   - editing!=null → pre-fill code/name/description from the
  //     existing SKU; cost + effective_date inputs are not shown
  //     in edit mode, so their state is irrelevant.
  useEffect(() => {
    if (!open) return;
    if (editing) {
      setCode(editing.code);
      setName(editing.name);
      setDescription(editing.description ?? "");
      setCost("");
      setEffectiveDate(todayIso());
    } else {
      setCode("");
      setName("");
      setDescription("");
      setCost("");
      setEffectiveDate(todayIso());
    }
    setError(null);
  }, [open, editing]);

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

  const isEdit = editing !== null;

  const handleSave = async () => {
    setError(null);
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Name is required.");
      return;
    }

    if (isEdit) {
      // Edit path — only name + description are mutable.
      if (!onSaveEdit) {
        setError("Edit handler missing (internal bug).");
        return;
      }
      setSaving(true);
      try {
        await onSaveEdit({
          name: trimmedName,
          description: description.trim() || null,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't save SKU");
      } finally {
        setSaving(false);
      }
      return;
    }

    // Create path — validate everything including code + cost.
    const trimmedCode = code.trim();
    if (!trimmedCode) {
      setError("SKU code is required.");
      return;
    }
    if (trimmedCode.length > 64) {
      setError("SKU code is too long (max 64 characters).");
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

  const handleToggleActive = async () => {
    if (!editing || !onToggleActive) return;
    setError(null);
    setToggling(true);
    try {
      await onToggleActive(!editing.active);
      // Parent closes the modal on success.
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't update SKU");
    } finally {
      setToggling(false);
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
          {isEdit
            ? editing!.active
              ? "Edit SKU"
              : "Restore SKU"
            : "Add a SKU"}
        </h2>
        <p className="text-xs text-slate-500 m-0 mb-5">
          {isEdit
            ? "Change the name or description. Cost edits live on the SKU detail page so historical sales keep their historical cost."
            : "Pick a short code that's easy to remember + matches what you put on platform listings. The initial cost is dated so historical sales keep their historical margin."}
        </p>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-800 px-3 py-2 rounded-lg mb-3 text-sm">
            {error}
          </div>
        )}

        <div className="space-y-3">
          {/* Code + Name on one row. In edit mode, code is
              rendered read-only (greyed) because identity is
              immutable — see route.ts header comment. */}
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_2fr] gap-3">
            <Field label={isEdit ? "Code (read-only)" : "Code"} htmlFor="sku-code">
              <input
                id="sku-code"
                type="text"
                value={code}
                onChange={(e) => {
                  if (isEdit) return;
                  setCode(e.target.value);
                  setError(null);
                }}
                readOnly={isEdit}
                placeholder="CB1"
                disabled={saving || isEdit}
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

          {/* Cost + Effective date — create mode only. Edit mode
              hides these to enforce "add a new cost row" via the
              SKU detail page (Phase 12b commit 4). */}
          {!isEdit && (
            <>
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
                Backdate the effective date if you want this cost to
                apply to historical sales already in FlowWork.
              </p>
            </>
          )}
        </div>

        <div className="flex justify-between gap-2 mt-5 flex-wrap">
          {/* Left side: Archive / Restore (edit mode only) */}
          <div>
            {isEdit && onToggleActive && (
              <button
                type="button"
                onClick={handleToggleActive}
                disabled={saving || toggling}
                className={`py-2 px-4 text-sm font-medium rounded-lg cursor-pointer disabled:opacity-40 inline-flex items-center gap-2 border ${
                  editing!.active
                    ? "text-amber-700 border-amber-200 hover:bg-amber-50"
                    : "text-emerald-700 border-emerald-200 hover:bg-emerald-50"
                }`}
              >
                {toggling && <Spinner size={12} color="currentColor" />}
                {editing!.active
                  ? toggling
                    ? "Archiving..."
                    : "Archive"
                  : toggling
                  ? "Restoring..."
                  : "Restore"}
              </button>
            )}
          </div>

          {/* Right side: Cancel + Save */}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving || toggling}
              className="py-2 px-4 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg cursor-pointer disabled:opacity-40 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || toggling}
              className="py-2 px-4 text-sm font-semibold text-white bg-blue-500 hover:bg-blue-600 rounded-lg border-0 cursor-pointer disabled:opacity-60 inline-flex items-center gap-2"
            >
              {saving && <Spinner size={12} color="white" />}
              {saving
                ? "Saving..."
                : isEdit
                ? "Save changes"
                : "Save SKU"}
            </button>
          </div>
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
