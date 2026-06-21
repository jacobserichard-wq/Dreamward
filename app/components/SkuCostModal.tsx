// app/components/SkuCostModal.tsx
//
// Inventory simplification (June 2026). A focused "pull up the cost
// history" modal, opened from the Cost line on a SKU card in the
// /skus list. Lets a maker see every cost they've entered and add a
// new one WITHOUT landing on the full /skus/[id] detail page (with
// its Recipe / Production / aliases sections that most people don't
// need just to tweak a cost).
//
// Adding a new effective-dated cost is the canonical "change the
// cost" path — same POST the detail page uses. Inline edit/delete of
// past rows (with the historical-COGS impact warnings) intentionally
// stays on the full detail page; a small "Open full details" link
// here routes there for that.
//
// Data:
//   GET  /api/skus/[id]            -> { sku, costHistory, aliases }
//   POST /api/skus/[id]/costs      -> add a cost row

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Spinner from "./Spinner";

interface CostHistoryRow {
  id: number;
  cost: number;
  currency: string;
  effectiveDate: string;
  notes: string | null;
  createdAt: string;
  affectedLineItemCount: number;
}

export interface SkuCostModalProps {
  open: boolean;
  skuId: number;
  skuCode: string;
  skuName: string;
  onClose: () => void;
  /** Called after a cost is added so the parent list can refresh the
   *  card's current-cost figure. */
  onChanged?: () => void;
}

function fmtMoney(n: number, currency: string): string {
  const sym = currency === "USD" || !currency ? "$" : `${currency} `;
  return `${sym}${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  })}`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso ?? "—";
  const monthNames = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${monthNames[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

function todayIso(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

export default function SkuCostModal({
  open,
  skuId,
  skuCode,
  skuName,
  onClose,
  onChanged,
}: SkuCostModalProps) {
  const [loading, setLoading] = useState(true);
  const [history, setHistory] = useState<CostHistoryRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Add-cost form
  const [newCost, setNewCost] = useState("");
  const [newDate, setNewDate] = useState(todayIso());
  const [newNotes, setNewNotes] = useState("");
  const [adding, setAdding] = useState(false);

  const loadHistory = useCallback(async () => {
    try {
      const res = await fetch(`/api/skus/${skuId}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || `HTTP ${res.status}`);
        return;
      }
      const payload = (await res.json()) as { costHistory: CostHistoryRow[] };
      setHistory(payload.costHistory ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load cost history");
    }
  }, [skuId]);

  // (Re)load every time the modal opens for a SKU.
  useEffect(() => {
    if (!open) return;
    setLoading(true);
    setError(null);
    setNewCost("");
    setNewDate(todayIso());
    setNewNotes("");
    (async () => {
      await loadHistory();
      setLoading(false);
    })();
  }, [open, skuId, loadHistory]);

  // Esc to close (matches ReceiveStockModal convention).
  useEffect(() => {
    if (!open || adding) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, adding, onClose]);

  const handleAddCost = useCallback(async () => {
    setError(null);
    const cleaned = newCost.replace(/[$,\s]/g, "");
    const costNum = Number(cleaned);
    if (!Number.isFinite(costNum) || costNum < 0) {
      setError("Cost must be a non-negative number.");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) {
      setError("Effective date must be a valid date.");
      return;
    }
    setAdding(true);
    try {
      const res = await fetch(`/api/skus/${skuId}/costs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cost: costNum,
          effectiveDate: newDate,
          notes: newNotes.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || `HTTP ${res.status}`);
        return;
      }
      setNewCost("");
      setNewDate(todayIso());
      setNewNotes("");
      await loadHistory();
      onChanged?.();
    } finally {
      setAdding(false);
    }
  }, [newCost, newDate, newNotes, skuId, loadHistory, onChanged]);

  if (!open) return null;

  const today = todayIso();
  // Newest row with effective_date <= today is the "current" cost.
  const currentRowId = (() => {
    const active = history
      .filter((r) => r.effectiveDate <= today)
      .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate));
    return active[0]?.id ?? null;
  })();

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="sku-cost-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={() => {
        if (!adding) onClose();
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-xl shadow-2xl max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto"
      >
        <h2
          id="sku-cost-title"
          className="text-lg font-bold text-slate-900 m-0 mb-1"
        >
          Cost history
        </h2>
        <p className="text-xs text-slate-500 m-0 mb-4">
          Every per-unit cost you&rsquo;ve entered for this item. Add a new one
          to change the cost going forward — or backdate it to fix past sales.
        </p>

        {/* SKU preview */}
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 mb-4">
          <p className="text-sm font-medium text-slate-900 m-0 truncate">
            <span className="font-mono">{skuCode}</span> · {skuName}
          </p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-800 px-3 py-2 rounded-lg mb-3 text-sm">
            {error}
          </div>
        )}

        {/* History list */}
        {loading ? (
          <p className="text-center py-6 text-slate-400 text-sm">Loading…</p>
        ) : history.length === 0 ? (
          <p className="text-center py-6 text-slate-400 text-sm border border-slate-100 rounded-lg">
            No cost history yet. Add the first one below.
          </p>
        ) : (
          <ul className="m-0 p-0 border border-slate-100 rounded-lg divide-y divide-slate-100">
            {history.map((c) => {
              const isCurrent = c.id === currentRowId;
              const isFuture = c.effectiveDate > today;
              return (
                <li
                  key={c.id}
                  className="flex items-center justify-between gap-3 px-3 py-2.5 list-none"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-slate-900 tabular-nums">
                        {fmtMoney(c.cost, c.currency)}
                      </span>
                      {isCurrent && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-semibold uppercase tracking-wide">
                          Current
                        </span>
                      )}
                      {isFuture && (
                        <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 text-[10px] font-semibold uppercase tracking-wide">
                          Scheduled
                        </span>
                      )}
                    </div>
                    {c.notes && (
                      <p className="text-xs text-slate-500 m-0 mt-0.5 truncate">
                        {c.notes}
                      </p>
                    )}
                  </div>
                  <span className="text-xs text-slate-500 whitespace-nowrap">
                    {fmtDate(c.effectiveDate)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}

        {/* Add new cost */}
        <div className="mt-5 pt-4 border-t border-slate-100">
          <h3 className="text-sm font-semibold text-slate-700 m-0 mb-2">
            Add a cost
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="cost-modal-amount"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Per-unit cost
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">
                  {"$"}
                </span>
                <input
                  id="cost-modal-amount"
                  type="text"
                  inputMode="decimal"
                  value={newCost}
                  onChange={(e) => {
                    setNewCost(e.target.value);
                    setError(null);
                  }}
                  placeholder="0.00"
                  disabled={adding}
                  className="w-full py-2 pl-7 pr-3 text-sm border border-slate-200 rounded-lg outline-none box-border focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 disabled:bg-slate-50 bg-white"
                />
              </div>
            </div>
            <div>
              <label
                htmlFor="cost-modal-date"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Effective date
              </label>
              <input
                id="cost-modal-date"
                type="date"
                value={newDate}
                onChange={(e) => setNewDate(e.target.value)}
                disabled={adding}
                className="w-full py-2 px-3 text-sm border border-slate-200 rounded-lg outline-none box-border focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 disabled:bg-slate-50 bg-white"
              />
            </div>
          </div>
          <label
            htmlFor="cost-modal-notes"
            className="block text-xs font-medium text-slate-700 mb-1 mt-3"
          >
            Notes <span className="text-slate-400 font-normal">(optional)</span>
          </label>
          <input
            id="cost-modal-notes"
            type="text"
            value={newNotes}
            onChange={(e) => setNewNotes(e.target.value)}
            placeholder="Why did the cost change?"
            disabled={adding}
            className="w-full py-2 px-3 text-sm border border-slate-200 rounded-lg outline-none box-border focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 disabled:bg-slate-50 bg-white"
          />
        </div>

        <div className="flex items-center justify-between gap-2 mt-5">
          <Link
            href={`/skus/${skuId}`}
            className="text-xs text-slate-400 hover:text-slate-600 hover:underline"
          >
            Open full details →
          </Link>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={adding}
              className="py-2 px-4 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg cursor-pointer disabled:opacity-40 hover:bg-slate-50"
            >
              Close
            </button>
            <button
              type="button"
              onClick={handleAddCost}
              disabled={adding}
              className="py-2 px-4 text-sm font-semibold text-white bg-blue-500 hover:bg-blue-600 rounded-lg border-0 cursor-pointer disabled:opacity-60 inline-flex items-center gap-2"
            >
              {adding && <Spinner size={12} color="white" />}
              {adding ? "Adding…" : "Add cost"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
