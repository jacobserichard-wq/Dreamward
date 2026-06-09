// app/components/LogProductionModal.tsx
//
// Tier 2 commit 5. Modal for logging a production run — "I made a
// batch." Collects quantity + date + notes, POSTs to
// /api/production-runs, and surfaces the result (what got
// consumed, or the no-recipe nudge) before closing.

"use client";

import { useEffect, useState } from "react";
import Spinner from "./Spinner";

interface ProductionResult {
  runId: number;
  quantityProduced: number;
  hadRecipe: boolean;
  componentsConsumed: Array<{
    componentSkuId: number;
    code: string;
    name: string;
    unit: string;
    consumed: number;
  }>;
}

export interface LogProductionModalProps {
  open: boolean;
  skuId: number;
  skuCode: string;
  skuName: string;
  onClose: () => void;
  /** Fired after a successful run so the parent can refresh stock. */
  onLogged: () => void;
}

function todayIso(): string {
  // Avoid TZ drift — build from UTC parts.
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

export default function LogProductionModal({
  open,
  skuId,
  skuCode,
  skuName,
  onClose,
  onLogged,
}: LogProductionModalProps) {
  const [qty, setQty] = useState("");
  const [date, setDate] = useState(todayIso());
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ProductionResult | null>(null);

  useEffect(() => {
    if (!open) return;
    setQty("");
    setDate(todayIso());
    setNotes("");
    setError(null);
    setResult(null);
  }, [open, skuId]);

  if (!open) return null;

  const parsedQty = Number(qty);
  const validQty = qty.length > 0 && Number.isFinite(parsedQty) && parsedQty > 0;

  const handleSubmit = async () => {
    if (!validQty) {
      setError("Enter a positive quantity.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/production-runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          finishedSkuId: skuId,
          quantityProduced: parsedQty,
          runDate: date,
          notes: notes.trim() || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || `HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as ProductionResult;
      setResult(data);
      onLogged(); // parent refreshes stock immediately
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={() => {
        if (!saving) onClose();
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6"
      >
        <h2 className="text-lg font-bold text-slate-900 m-0 mb-1">
          Log production run
        </h2>
        <p className="text-xs text-slate-500 m-0 mb-4">
          Records a batch of <strong>{skuCode} · {skuName}</strong> and draws
          down the materials in its recipe.
        </p>

        {result ? (
          // ── Success summary ──────────────────────────────────
          <div>
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 mb-3 text-sm text-emerald-900">
              {"\u{2705}"} Added{" "}
              <strong>{result.quantityProduced.toLocaleString()}</strong> to
              stock.
            </div>
            {result.hadRecipe ? (
              result.componentsConsumed.length > 0 && (
                <div className="mb-3">
                  <p className="text-xs uppercase tracking-wide text-slate-500 m-0 mb-1.5">
                    Materials consumed
                  </p>
                  <ul className="m-0 p-0 list-none space-y-1 text-sm text-slate-700">
                    {result.componentsConsumed.map((c) => (
                      <li key={c.componentSkuId} className="flex justify-between">
                        <span>
                          <span className="font-mono text-xs text-slate-500">
                            {c.code}
                          </span>{" "}
                          {c.name}
                        </span>
                        <span className="tabular-nums text-slate-600">
                          −{c.consumed.toLocaleString()} {c.unit}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )
            ) : (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-3 text-xs text-amber-900">
                No recipe defined, so no materials were deducted. Add a recipe
                above to track materials on future runs.
              </div>
            )}
            <div className="flex justify-end">
              <button
                type="button"
                onClick={onClose}
                className="py-2 px-4 text-sm font-semibold text-white bg-blue-500 hover:bg-blue-600 rounded-lg border-0 cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          // ── Input form ───────────────────────────────────────
          <div>
            {error && (
              <div className="bg-red-50 border border-red-200 text-red-800 px-3 py-2 rounded-lg mb-3 text-sm">
                {error}
              </div>
            )}
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Quantity produced
            </label>
            <input
              type="text"
              inputMode="decimal"
              autoFocus
              value={qty}
              onChange={(e) => {
                setQty(e.target.value);
                setError(null);
              }}
              disabled={saving}
              placeholder="e.g. 24"
              className="w-full py-2 px-3 text-sm border border-slate-200 rounded-lg outline-none box-border focus:border-blue-500 bg-white mb-3"
            />
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Date
            </label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              disabled={saving}
              className="w-full py-2 px-3 text-sm border border-slate-200 rounded-lg outline-none box-border focus:border-blue-500 bg-white mb-3"
            />
            <label className="block text-xs font-medium text-slate-700 mb-1">
              Notes <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              disabled={saving}
              placeholder="e.g. Lavender batch #3"
              className="w-full py-2 px-3 text-sm border border-slate-200 rounded-lg outline-none box-border focus:border-blue-500 bg-white"
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
                onClick={handleSubmit}
                disabled={saving || !validQty}
                className="py-2 px-4 text-sm font-semibold text-white bg-blue-500 hover:bg-blue-600 rounded-lg border-0 cursor-pointer disabled:opacity-60 inline-flex items-center gap-2"
              >
                {saving && <Spinner size={12} color="white" />}
                {saving ? "Logging..." : "Log run"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
