// app/components/ReceiveStockModal.tsx
//
// Sub-session 33 Tier 1 commit 3 of 4. Simple modal for recording
// received stock against a SKU. Wired from the Stock section on
// /skus/[id].
//
// Single-purpose for v1 — always submits reason="receive" with a
// positive quantity. Recount + correction surfaces are deferred to
// a future commit; the underlying endpoint already accepts those
// reasons.
//
// Submit semantics:
//   POST /api/skus/[id]/inventory  { delta: <qty>, reason: "receive", notes }
//   Success: onSaved(newQuantityOnHand) → parent re-renders without
//            a second round trip.

"use client";

import { useEffect, useState } from "react";
import Spinner from "./Spinner";

export interface ReceiveStockModalProps {
  /** Unit of measure for the SKU (each, oz, ...). Shown next to
   *  quantities. */
  unit?: string;
  open: boolean;
  skuId: number;
  skuCode: string;
  skuName: string;
  currentQuantity: number;
  onClose: () => void;
  onSaved: (newQuantityOnHand: number) => void;
}

export default function ReceiveStockModal({
  open,
  skuId,
  skuCode,
  skuName,
  currentQuantity,
  unit,
  onClose,
  onSaved,
}: ReceiveStockModalProps) {
  // "each" reads naturally as unit/units; a real measure (oz, g)
  // shows verbatim.
  const unitLabel = (n: number) =>
    unit && unit !== "each" ? unit : n === 1 ? "unit" : "units";
  const [quantity, setQuantity] = useState<string>("");
  const [unitCost, setUnitCost] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset state every time the modal opens with a new SKU.
  useEffect(() => {
    if (!open) return;
    setQuantity("");
    setUnitCost("");
    setNotes("");
    setError(null);
  }, [open, skuId]);

  // Esc to close (matches ReclassifyModal convention).
  useEffect(() => {
    if (!open || saving) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, saving, onClose]);

  if (!open) return null;

  // Tier 2: fractional quantities allowed (e.g. 4.5 oz wax). Any
  // positive finite number is valid.
  const parsed = Number(quantity);
  const isValidQuantity =
    quantity.length > 0 && Number.isFinite(parsed) && parsed > 0;
  const projectedTotal = isValidQuantity
    ? currentQuantity + parsed
    : currentQuantity;

  const handleSave = async () => {
    if (!isValidQuantity) {
      setError("Enter a positive number.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const parsedCost = Number(unitCost);
      const hasCost =
        unitCost.trim().length > 0 && Number.isFinite(parsedCost) && parsedCost >= 0;
      const res = await fetch(`/api/skus/${skuId}/inventory`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          delta: parsed,
          reason: "receive",
          notes: notes.trim() || null,
          ...(hasCost ? { unitCost: parsedCost } : {}),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || `HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as { quantityOnHand: number };
      onSaved(data.quantityOnHand);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="receive-stock-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={() => {
        if (!saving) onClose();
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6"
      >
        <h2
          id="receive-stock-title"
          className="text-lg font-bold text-slate-900 m-0 mb-1"
        >
          Receive stock
        </h2>
        <p className="text-xs text-slate-500 m-0 mb-4">
          Add inventory you just received — a wholesale shipment, a finished
          production run, or your starting count when first setting up.
        </p>

        {/* SKU preview */}
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 mb-4">
          <p className="text-sm font-medium text-slate-900 m-0 truncate">
            {skuCode} · {skuName}
          </p>
          <p className="text-xs text-slate-500 m-0 mt-0.5">
            Currently on hand:{" "}
            <span className="font-semibold text-slate-700">
              {currentQuantity.toLocaleString()}
            </span>{" "}
            {unitLabel(currentQuantity)}
          </p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-800 px-3 py-2 rounded-lg mb-3 text-sm">
            {error}
          </div>
        )}

        <label
          htmlFor="receive-qty"
          className="block text-xs font-medium text-slate-700 mb-1"
        >
          Quantity received
        </label>
        <input
          id="receive-qty"
          type="text"
          inputMode="decimal"
          autoFocus
          value={quantity}
          onChange={(e) => {
            setQuantity(e.target.value);
            setError(null);
          }}
          disabled={saving}
          placeholder="e.g. 50"
          className="w-full py-2 px-3 text-sm border border-slate-200 rounded-lg outline-none box-border focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 disabled:bg-slate-50 bg-white"
        />
        {isValidQuantity && (
          <p className="text-xs text-slate-500 mt-1 mb-0">
            New total will be{" "}
            <span className="font-semibold text-slate-700">
              {projectedTotal.toLocaleString()}
            </span>{" "}
            {unitLabel(projectedTotal)}.
          </p>
        )}

        <label
          htmlFor="receive-cost"
          className="block text-xs font-medium text-slate-700 mb-1 mt-4"
        >
          Unit cost{" "}
          <span className="text-slate-400 font-normal">(optional)</span>
        </label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">
            $
          </span>
          <input
            id="receive-cost"
            type="text"
            inputMode="decimal"
            value={unitCost}
            onChange={(e) => setUnitCost(e.target.value)}
            disabled={saving}
            placeholder="what you paid per unit"
            className="w-full py-2 pl-7 pr-3 text-sm border border-slate-200 rounded-lg outline-none box-border focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 disabled:bg-slate-50 bg-white"
          />
        </div>
        <p className="text-xs text-slate-500 mt-1 mb-0">
          Sets the cost basis for this batch (FIFO). Leave blank to reuse the
          last known cost.
        </p>

        <label
          htmlFor="receive-notes"
          className="block text-xs font-medium text-slate-700 mb-1 mt-4"
        >
          Notes <span className="text-slate-400 font-normal">(optional)</span>
        </label>
        <input
          id="receive-notes"
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={saving}
          placeholder="e.g. PO #1234 from Acme Supplies"
          className="w-full py-2 px-3 text-sm border border-slate-200 rounded-lg outline-none box-border focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 disabled:bg-slate-50 bg-white"
        />

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
            disabled={saving || !isValidQuantity}
            className="py-2 px-4 text-sm font-semibold text-white bg-blue-500 hover:bg-blue-600 rounded-lg border-0 cursor-pointer disabled:opacity-60 inline-flex items-center gap-2"
          >
            {saving && <Spinner size={12} color="white" />}
            {saving ? "Saving..." : "Add to stock"}
          </button>
        </div>
      </div>
    </div>
  );
}
