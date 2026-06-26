// app/components/ExpenseRefundModal.tsx
//
// "Got money back" — log a vendor refund/credit against an expense.
// A vendor refunding you isn't income; it's money back on something
// you bought. We record it as a contra-expense (a negative row in the
// same category), so it nets that category's spend down and never
// touches revenue. Distinct from "Refund this" on a sale, which
// reduces revenue.

"use client";

import { useEffect, useState } from "react";
import Spinner from "./Spinner";

export interface ExpenseRefundTxn {
  id: number;
  vendor: string;
  amount: number;
  category: string | null;
}

export interface ExpenseRefundModalProps {
  open: boolean;
  transaction: ExpenseRefundTxn | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}

export default function ExpenseRefundModal({
  open,
  transaction,
  onClose,
  onSaved,
}: ExpenseRefundModalProps) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Prefill with the full original amount — a full refund is the
  // common case; the user edits down for a partial.
  useEffect(() => {
    if (!open || !transaction) return;
    setAmount(transaction.amount > 0 ? transaction.amount.toFixed(2) : "");
    setNote("");
    setError(null);
  }, [open, transaction]);

  useEffect(() => {
    if (!open || saving) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, saving, onClose]);

  if (!open || !transaction) return null;

  const refundNum = Number(amount);
  const validAmount =
    Number.isFinite(refundNum) &&
    refundNum > 0 &&
    refundNum <= transaction.amount + 0.001;
  const remaining = transaction.amount - (Number.isFinite(refundNum) ? refundNum : 0);

  const handleSave = async () => {
    setError(null);
    if (!Number.isFinite(refundNum) || refundNum <= 0) {
      setError("Enter how much the vendor refunded.");
      return;
    }
    if (refundNum > transaction.amount + 0.001) {
      setError(
        `The refund can't be more than the original $${transaction.amount.toFixed(
          2
        )}.`
      );
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(
        `/api/expenses/${transaction.id}/refund-credit`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            amount: refundNum,
            note: note.trim() || undefined,
          }),
        }
      );
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setError(b.error || `HTTP ${res.status}`);
        return;
      }
      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't log that refund.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="expense-refund-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={() => {
        if (!saving) onClose();
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-xl shadow-2xl max-w-md w-full p-6 max-h-[90vh] overflow-y-auto"
      >
        <h2
          id="expense-refund-title"
          className="text-lg font-bold text-slate-900 m-0 mb-1"
        >
          Got money back
        </h2>
        <p className="text-xs text-slate-500 m-0 mb-4">
          Logs a vendor refund as a credit in the same category
          {transaction.category ? (
            <>
              {" "}
              (<strong>{transaction.category}</strong>)
            </>
          ) : null}
          . It lowers what you spent there — it&apos;s <strong>not</strong>{" "}
          counted as income and doesn&apos;t touch your sales.
        </p>

        <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 mb-4 text-sm text-slate-700">
          <span className="font-medium">{transaction.vendor}</span>
          <span className="float-right tabular-nums font-semibold">
            ${transaction.amount.toFixed(2)}
          </span>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-800 px-3 py-2 rounded-lg mb-3 text-sm">
            {error}
          </div>
        )}

        <div className="space-y-3">
          <div>
            <label
              htmlFor="expense-refund-amount"
              className="block text-xs font-medium text-slate-700 mb-1"
            >
              Amount refunded
            </label>
            <div className="flex items-center gap-1.5">
              <span className="text-sm text-slate-500">$</span>
              <input
                id="expense-refund-amount"
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(e) => {
                  setAmount(e.target.value);
                  setError(null);
                }}
                placeholder="0.00"
                disabled={saving}
                autoFocus
                className="w-full py-2 px-3 text-sm border border-slate-200 rounded-lg outline-none box-border focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 disabled:bg-slate-50"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="expense-refund-note"
              className="block text-xs font-medium text-slate-700 mb-1"
            >
              Note <span className="text-slate-400 font-normal">(optional)</span>
            </label>
            <input
              id="expense-refund-note"
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. returned 2 damaged spools"
              disabled={saving}
              className="w-full py-2 px-3 text-sm border border-slate-200 rounded-lg outline-none box-border focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 disabled:bg-slate-50"
            />
          </div>

          {validAmount && (
            <p className="text-[11px] text-slate-600 m-0 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
              {remaining <= 0.001 ? (
                <>Fully refunds this expense — its net cost becomes $0.00.</>
              ) : (
                <>
                  Reduces this expense to a net{" "}
                  <strong>${remaining.toFixed(2)}</strong> in{" "}
                  {transaction.category ?? "its category"}.
                </>
              )}
            </p>
          )}
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
            disabled={saving || !validAmount}
            className="py-2 px-4 text-sm font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded-lg border-0 cursor-pointer disabled:opacity-60 inline-flex items-center gap-2"
          >
            {saving && <Spinner size={12} color="white" />}
            {saving ? "Saving…" : "Log refund"}
          </button>
        </div>
      </div>
    </div>
  );
}
