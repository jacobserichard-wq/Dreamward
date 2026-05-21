// Manual invoice entry form. Used on /invoices/new (commit 7). Pure
// presentational + form-local state — parent owns the submit fetch.
//
// Defaults per phase-6-ar-design.md §1 #4:
//   - invoiceDate = today
//   - dueDate     = today + 30 (Net 30)
//
// Validation is best-effort client-side; server is the source of truth
// (POST /api/invoices enforces customerName non-empty, amountTotal > 0,
// dueDate >= invoiceDate, etc. — see commit 3).

import { useState } from "react";

export interface InvoiceSubmitPayload {
  customerName: string;
  customerEmail: string | null;
  invoiceNumber: string | null;
  invoiceDate: string;
  dueDate: string;
  amountTotal: number;
  notes: string | null;
}

interface InvoiceCreateFormProps {
  /** Names from prior invoices for the customer-name datalist. */
  existingCustomerNames?: string[];
  /** Submit handler — parent does the fetch + redirect. */
  onSubmit: (p: InvoiceSubmitPayload) => Promise<void>;
  /** Cancel handler — parent does the redirect back. */
  onCancel: () => void;
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

// Compute today + 30 days as a YYYY-MM-DD string (UTC, to match the
// pg DATE-parser-override convention from sub-session 19).
function todayPlus30Iso(): string {
  const now = new Date();
  const plus30 = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 30)
  );
  const yyyy = plus30.getUTCFullYear();
  const mm = String(plus30.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(plus30.getUTCDate()).padStart(2, "0");
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

export default function InvoiceCreateForm({
  existingCustomerNames = [],
  onSubmit,
  onCancel,
  saving,
}: InvoiceCreateFormProps) {
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(todayIso());
  const [dueDate, setDueDate] = useState(todayPlus30Iso());
  const [amountTotal, setAmountTotal] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (customerName.trim().length === 0) {
      setError("Customer name is required");
      return;
    }
    if (
      customerEmail.trim().length > 0 &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail.trim())
    ) {
      setError("Customer email is not valid");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(invoiceDate)) {
      setError("Invoice date must be YYYY-MM-DD");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
      setError("Due date must be YYYY-MM-DD");
      return;
    }
    if (dueDate < invoiceDate) {
      setError("Due date must be on or after invoice date");
      return;
    }
    const parsedAmount = parseMoneyOrNull(amountTotal);
    if (parsedAmount === null || parsedAmount <= 0) {
      setError("Amount must be a positive number");
      return;
    }

    try {
      await onSubmit({
        customerName: customerName.trim(),
        customerEmail: customerEmail.trim() || null,
        invoiceNumber: invoiceNumber.trim() || null,
        invoiceDate,
        dueDate,
        amountTotal: parsedAmount,
        notes: notes.trim() || null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create invoice");
    }
  };

  // Datalist needs a stable id we control.
  const customerListId = "invoice-customer-names";

  return (
    <form
      onSubmit={handleSubmit}
      className="bg-white border border-slate-200 rounded-xl p-5"
    >
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded px-3 py-2 mb-4">
          {error}
        </div>
      )}

      <label className="block mb-3">
        <span className="block text-sm font-medium text-slate-700 mb-1">
          Customer name *
        </span>
        <input
          type="text"
          list={customerListId}
          value={customerName}
          onChange={(e) => setCustomerName(e.target.value)}
          required
          disabled={saving}
          autoFocus
          placeholder="Acme Co."
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/20 focus:outline-none focus:border-blue-500"
        />
        {existingCustomerNames.length > 0 && (
          <datalist id={customerListId}>
            {existingCustomerNames.map((name) => (
              <option key={name} value={name} />
            ))}
          </datalist>
        )}
      </label>

      <label className="block mb-3">
        <span className="block text-sm font-medium text-slate-700 mb-1">
          Customer email
        </span>
        <input
          type="email"
          value={customerEmail}
          onChange={(e) => setCustomerEmail(e.target.value)}
          disabled={saving}
          placeholder="billing@acme.com"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/20 focus:outline-none focus:border-blue-500"
        />
        <span className="block text-xs text-slate-500 mt-1">
          Required only if you want to send reminders.
        </span>
      </label>

      <label className="block mb-3">
        <span className="block text-sm font-medium text-slate-700 mb-1">
          Invoice number
        </span>
        <input
          type="text"
          value={invoiceNumber}
          onChange={(e) => setInvoiceNumber(e.target.value)}
          disabled={saving}
          placeholder="042"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/20 focus:outline-none focus:border-blue-500"
        />
      </label>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <label className="block">
          <span className="block text-sm font-medium text-slate-700 mb-1">
            Invoice date *
          </span>
          <input
            type="date"
            value={invoiceDate}
            onChange={(e) => setInvoiceDate(e.target.value)}
            required
            disabled={saving}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/20 focus:outline-none focus:border-blue-500"
          />
        </label>

        <label className="block">
          <span className="block text-sm font-medium text-slate-700 mb-1">
            Due date *
          </span>
          <input
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            required
            disabled={saving}
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/20 focus:outline-none focus:border-blue-500"
          />
        </label>
      </div>

      <label className="block mb-3">
        <span className="block text-sm font-medium text-slate-700 mb-1">
          Amount *
        </span>
        <input
          type="text"
          inputMode="decimal"
          value={amountTotal}
          onChange={(e) => setAmountTotal(e.target.value)}
          required
          disabled={saving}
          placeholder="$0.00"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/20 focus:outline-none focus:border-blue-500"
        />
      </label>

      <label className="block mb-4">
        <span className="block text-sm font-medium text-slate-700 mb-1">
          Notes
        </span>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={saving}
          rows={2}
          placeholder="e.g. consignment delivery #3"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500/20 focus:outline-none focus:border-blue-500"
        />
      </label>

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="py-2 px-5 rounded-lg border border-slate-300 bg-white text-slate-700 text-sm font-medium cursor-pointer disabled:opacity-60"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={saving}
          className="py-2 px-6 rounded-lg border-0 bg-blue-500 text-white text-sm font-semibold cursor-pointer disabled:opacity-60"
        >
          {saving ? "Creating..." : "Create invoice"}
        </button>
      </div>
    </form>
  );
}
