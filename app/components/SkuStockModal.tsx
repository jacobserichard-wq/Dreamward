// app/components/SkuStockModal.tsx
//
// Inventory simplification (June 2026). A focused stock modal opened
// from the Stock line on a SKU card in the /skus list. Shows the
// on-hand badge, an inline "Receive stock" form, and the history of
// stock movements — without the full /skus/[id] detail page.
//
// Mirrors the Stock section that lives on the detail page, but
// self-contained so a maker can adjust + review stock from the list.
//
// Data:
//   POST   /api/skus/[id]/inventory          -> receive (returns quantityOnHand)
//   GET    /api/skus/[id]/inventory/history  -> { adjustments, totalCount }
//   DELETE /api/skus/[id]/inventory/[adjId]  -> reverse a manual adjustment

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import Spinner from "./Spinner";

interface InventoryHistoryRow {
  id: number;
  delta: number;
  reason: "sale" | "receive" | "manual" | "recount" | "correction";
  notes: string | null;
  sourceLineItemId: number | null;
  runningBalance: number;
  createdAt: string;
}

export interface SkuStockModalProps {
  open: boolean;
  skuId: number;
  skuCode: string;
  skuName: string;
  currentQuantity: number;
  unit?: string;
  onClose: () => void;
  /** Called after stock changes so the parent list can refresh the
   *  card's on-hand figure. */
  onChanged?: (newQuantityOnHand: number) => void;
}

const REASON_LABELS: Record<InventoryHistoryRow["reason"], string> = {
  sale: "Sale",
  receive: "Received",
  manual: "Manual adjustment",
  recount: "Recount",
  correction: "Correction",
};

// Only manual adjustments can be reversed here; sale + production
// rows are undone via their own flows.
const REVERSIBLE_REASONS = new Set(["receive", "manual", "recount", "correction"]);

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

function badgeColor(qty: number): string {
  if (qty < 0) return "text-red-600";
  if (qty === 0) return "text-slate-400";
  if (qty <= 10) return "text-amber-600";
  return "text-emerald-600";
}

export default function SkuStockModal({
  open,
  skuId,
  skuCode,
  skuName,
  currentQuantity,
  unit,
  onClose,
  onChanged,
}: SkuStockModalProps) {
  const unitLabel = (n: number) =>
    unit && unit !== "each" ? unit : n === 1 ? "unit" : "units";

  const [localQty, setLocalQty] = useState(currentQuantity);
  const [history, setHistory] = useState<InventoryHistoryRow[]>([]);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(true);

  const [qty, setQty] = useState("");
  const [notes, setNotes] = useState("");
  const [receiving, setReceiving] = useState(false);
  const [reversingId, setReversingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch(`/api/skus/${skuId}/inventory/history?limit=50`);
      if (!res.ok) {
        console.error("Stock history load failed:", res.status);
        return;
      }
      const payload = (await res.json()) as {
        adjustments: InventoryHistoryRow[];
        totalCount: number;
      };
      setHistory(payload.adjustments);
      setHistoryTotal(payload.totalCount);
      // Newest row's running balance is the authoritative on-hand.
      if (payload.adjustments.length > 0) {
        setLocalQty(payload.adjustments[0].runningBalance);
      }
    } catch (err) {
      console.error("Stock history load failed:", err);
    } finally {
      setHistoryLoading(false);
    }
  }, [skuId]);

  useEffect(() => {
    if (!open) return;
    setLocalQty(currentQuantity);
    setQty("");
    setNotes("");
    setError(null);
    void loadHistory();
  }, [open, skuId, currentQuantity, loadHistory]);

  useEffect(() => {
    if (!open || receiving || reversingId != null) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, receiving, reversingId, onClose]);

  const parsed = Number(qty);
  const isValidQty = qty.length > 0 && Number.isFinite(parsed) && parsed > 0;
  const projectedTotal = isValidQty ? localQty + parsed : localQty;

  const handleReceive = useCallback(async () => {
    if (!isValidQty) {
      setError("Enter a positive number.");
      return;
    }
    setReceiving(true);
    setError(null);
    try {
      const res = await fetch(`/api/skus/${skuId}/inventory`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          delta: parsed,
          reason: "receive",
          notes: notes.trim() || null,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || `HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as { quantityOnHand: number };
      setLocalQty(data.quantityOnHand);
      setQty("");
      setNotes("");
      await loadHistory();
      onChanged?.(data.quantityOnHand);
    } finally {
      setReceiving(false);
    }
  }, [isValidQty, parsed, notes, skuId, loadHistory, onChanged]);

  const handleReverse = useCallback(
    async (adjId: number) => {
      if (
        !window.confirm(
          "Reverse this stock adjustment? It removes the change from your on-hand count."
        )
      ) {
        return;
      }
      setReversingId(adjId);
      setError(null);
      try {
        const res = await fetch(`/api/skus/${skuId}/inventory/${adjId}`, {
          method: "DELETE",
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError(body.error || `HTTP ${res.status}`);
          return;
        }
        await loadHistory();
        // loadHistory updates localQty from the new top running
        // balance; mirror that out to the parent.
        onChanged?.(localQty);
      } finally {
        setReversingId(null);
      }
    },
    [skuId, loadHistory, onChanged, localQty]
  );

  if (!open) return null;

  const busy = receiving || reversingId != null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="sku-stock-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={() => {
        if (!busy) onClose();
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-xl shadow-2xl max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto"
      >
        <h2
          id="sku-stock-title"
          className="text-lg font-bold text-slate-900 m-0 mb-1"
        >
          Stock on hand
        </h2>
        <p className="text-xs text-slate-500 m-0 mb-4">
          What you have right now, plus every receive and adjustment.
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

        {/* On-hand badge */}
        <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-baseline gap-3 mb-4">
          <span className={`text-3xl font-bold tabular-nums ${badgeColor(localQty)}`}>
            {localQty.toLocaleString()}
          </span>
          <span className="text-sm text-slate-500">{unitLabel(localQty)}</span>
          {localQty < 0 && (
            <span className="text-xs text-red-600 ml-2">
              Negative — likely missing a starting count. Receive stock below to
              set it.
            </span>
          )}
          {localQty === 0 && (
            <span className="text-xs text-slate-500 ml-2">Out of stock.</span>
          )}
        </div>

        {/* Inline receive */}
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 mb-5">
          <h3 className="text-sm font-semibold text-slate-700 m-0 mb-2">
            Receive stock
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="stock-modal-qty"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Quantity received
              </label>
              <input
                id="stock-modal-qty"
                type="text"
                inputMode="decimal"
                value={qty}
                onChange={(e) => {
                  setQty(e.target.value);
                  setError(null);
                }}
                placeholder="e.g. 50"
                disabled={receiving}
                className="w-full py-2 px-3 text-sm border border-slate-200 rounded-lg outline-none box-border focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 disabled:bg-slate-100 bg-white"
              />
            </div>
            <div>
              <label
                htmlFor="stock-modal-notes"
                className="block text-xs font-medium text-slate-700 mb-1"
              >
                Notes{" "}
                <span className="text-slate-400 font-normal">(optional)</span>
              </label>
              <input
                id="stock-modal-notes"
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. PO #1234"
                disabled={receiving}
                className="w-full py-2 px-3 text-sm border border-slate-200 rounded-lg outline-none box-border focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 disabled:bg-slate-100 bg-white"
              />
            </div>
          </div>
          <div className="flex items-center justify-between gap-2 mt-2">
            <span className="text-xs text-slate-500">
              {isValidQty ? (
                <>
                  New total:{" "}
                  <span className="font-semibold text-slate-700">
                    {projectedTotal.toLocaleString()}
                  </span>{" "}
                  {unitLabel(projectedTotal)}
                </>
              ) : (
                ""
              )}
            </span>
            <button
              type="button"
              onClick={handleReceive}
              disabled={receiving || !isValidQty}
              className="py-1.5 px-3 text-xs font-semibold text-white bg-blue-500 hover:bg-blue-600 rounded-lg border-0 cursor-pointer disabled:opacity-60 inline-flex items-center gap-2"
            >
              {receiving && <Spinner size={12} color="white" />}
              {receiving ? "Adding…" : "+ Receive"}
            </button>
          </div>
        </div>

        {/* Stock history */}
        <h3 className="text-xs uppercase tracking-wide text-slate-500 font-semibold m-0 mb-2 flex items-center justify-between">
          <span>Stock history</span>
          {historyTotal > history.length && (
            <span className="text-[11px] normal-case font-normal text-slate-400">
              Showing {history.length} of {historyTotal}
            </span>
          )}
        </h3>
        {historyLoading && history.length === 0 ? (
          <p className="text-center py-6 text-slate-400 text-sm">Loading…</p>
        ) : history.length === 0 ? (
          <p className="text-center py-6 text-slate-400 text-sm border border-slate-100 rounded-lg">
            No stock movements yet.
          </p>
        ) : (
          <ul className="m-0 p-0 border border-slate-100 rounded-lg divide-y divide-slate-100">
            {history.map((adj) => (
              <li
                key={adj.id}
                className="flex items-center justify-between gap-3 px-3 py-2.5 list-none"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-sm font-semibold tabular-nums ${
                        adj.delta > 0 ? "text-emerald-600" : "text-slate-700"
                      }`}
                    >
                      {adj.delta > 0 ? "+" : ""}
                      {adj.delta.toLocaleString()}
                    </span>
                    <span className="text-xs text-slate-500">
                      {REASON_LABELS[adj.reason] ?? adj.reason}
                    </span>
                  </div>
                  {adj.notes && (
                    <p className="text-xs text-slate-400 m-0 mt-0.5 truncate">
                      {adj.notes}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-3 whitespace-nowrap">
                  <span className="text-xs text-slate-500 tabular-nums">
                    bal {adj.runningBalance.toLocaleString()}
                  </span>
                  <span className="text-xs text-slate-400">
                    {fmtDate(adj.createdAt)}
                  </span>
                  {REVERSIBLE_REASONS.has(adj.reason) && (
                    <button
                      type="button"
                      onClick={() => handleReverse(adj.id)}
                      disabled={reversingId === adj.id}
                      title="Reverse this adjustment"
                      className="text-[11px] text-slate-400 hover:text-red-600 cursor-pointer bg-transparent border-0 disabled:cursor-wait"
                    >
                      {reversingId === adj.id ? "…" : "Reverse"}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center justify-between gap-2 mt-5">
          <Link
            href={`/skus/${skuId}`}
            className="text-xs text-slate-400 hover:text-slate-600 hover:underline"
          >
            Open full details →
          </Link>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="py-2 px-4 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg cursor-pointer disabled:opacity-40 hover:bg-slate-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
