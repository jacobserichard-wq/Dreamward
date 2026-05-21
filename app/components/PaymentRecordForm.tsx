// Inline form on /invoices/[id] for recording a payment against the
// invoice. Pure presentational + form-local state; parent receives the
// validated payload via onSubmit.
//
// Validation:
//   - amount: required, > 0, ≤ outstanding (the page-level overpayment
//     guard reinforces the lib OverpaymentError, but server-side is
//     still the source of truth).
//   - paidAt: required, valid YYYY-MM-DD (default = today).
//   - method, reference, notes: optional.

import { useState } from "react";

export interface PaymentSubmitPayload {
  amount: number;
  paidAt: string;
  method: string | null;
  reference: string | null;
  notes: string | null;
}

interface PaymentRecordFormProps {
  /** Max amount the user can record (current outstanding balance). */
  outstanding: number;
  /** Submit handler — parent does the fetch + state update. */
  onSubmit: (p: PaymentSubmitPayload) => Promise<void>;
  /** Disabled during async submission. */
  saving: boolean;
}

function todayIso(): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(now.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function stripMoneySymbols(v: string): string {
  return v.replace(/[$,\s]/g, "");
}

function parseMoneyOrNull(v: string): number | null {
  if (v.trim() === "") return null;
  const num = Number(stripMoneySymbols(v));
  if (!Number.isFinite(num) || num < 0) return null;
  return num;
}

function formatUsd(n: number): string {
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default function PaymentRecordForm({
  outstanding,
  onSubmit,
  saving,
}: PaymentRecordFormProps) {
  const [amount, setAmount] = useState("");
  const [paidAt, setPaidAt] = useState(todayIso());
  const [method, setMethod] = useState("");
  const [reference, setReference] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const parsedAmount = parseMoneyOrNull(amount);
    if (parsedAmount === null || parsedAmount <= 0) {
      setError("Amount must be a positive number");
      return;
    }
    if (parsedAmount > outstanding + 1e-9) {
      setError(
        `Amount exceeds outstanding balance of ${formatUsd(outstanding)}.`
      );
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(paidAt)) {
      setError("Date must be YYYY-MM-DD");
      return;
    }

    try {
      await onSubmit({
        amount: parsedAmount,
        paidAt,
        method: method.trim() || null,
        reference: reference.trim() || null,
        notes: notes.trim() || null,
      });
      // Reset form on success — parent re-fetches.
      setAmount("");
      setPaidAt(todayIso());
      setMethod("");
      setReference("");
      setNotes("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to record payment");
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-slate-50 border border-slate-200 rounded-lg p-4 mt-3"
    >
      <h3 className="text-sm font-semibold text-slate-700 m-0 mb-3">
        Record a payment
      </h3>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded px-3 py-2 mb-3">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <label className="block">
          <span className="block text-xs font-medium text-slate-600 mb-1">
            Amount * <span className="text-slate-400 font-normal">(max {formatUsd(outstanding)})</span>
          </span>
          <input
            type="text"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="$0.00"
            disabled={saving}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/20 focus:outline-none focus:border-blue-500 disabled:bg-slate-100"
          />
        </label>

        <label className="block">
          <span className="block text-xs font-medium text-slate-600 mb-1">
            Date *
          </span>
          <input
            type="date"
            value={paidAt}
            onChange={(e) => setPaidAt(e.target.value)}
            disabled={saving}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/20 focus:outline-none focus:border-blue-500 disabled:bg-slate-100"
          />
        </label>

        <label className="block">
          <span className="block text-xs font-medium text-slate-600 mb-1">
            Method
          </span>
          <input
            type="text"
            value={method}
            onChange={(e) => setMethod(e.target.value)}
            placeholder="cash, check, transfer..."
            disabled={saving}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/20 focus:outline-none focus:border-blue-500 disabled:bg-slate-100"
          />
        </label>

        <label className="block">
          <span className="block text-xs font-medium text-slate-600 mb-1">
            Reference
          </span>
          <input
            type="text"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="check #, txn id..."
            disabled={saving}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/20 focus:outline-none focus:border-blue-500 disabled:bg-slate-100"
          />
        </label>
      </div>

      <label className="block mb-3">
        <span className="block text-xs font-medium text-slate-600 mb-1">
          Notes
        </span>
        <input
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={saving}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/20 focus:outline-none focus:border-blue-500 disabled:bg-slate-100"
        />
      </label>

      <div className="flex justify-end">
        <button
          type="submit"
          disabled={saving}
          className="py-2 px-5 rounded-lg border-0 bg-blue-500 text-white text-sm font-semibold cursor-pointer disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {saving ? "Recording..." : "Record payment"}
        </button>
      </div>
    </form>
  );
}
