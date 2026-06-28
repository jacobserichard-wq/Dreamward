// app/components/RefundForm.tsx
//
// Modal to log a refund. A refund is stored as a "Returns & Refunds"
// expense (Schedule C line 27a) — the revenue/band calc and the tax
// report both subtract that category, so logging one here automatically
// nets it out of revenue AND reduces the tagged channel's profit.
//
// Purpose-built and slimmer than ExpenseForm: the category is FIXED
// (no dropdown to hunt through — the discoverability fix), no receipt
// attachments, customer optional. Channels come from the canonical list
// (no fetch); events are supplied by the parent (already loaded).
//
// Two entry points share this form:
//   - "Log a refund" button → opens blank.
//   - "Refund this" on a sale card → opens pre-filled with that sale's
//     customer, amount, channel, and event (via the `prefill` prop).

"use client";

import { useEffect, useState } from "react";
import Spinner from "./Spinner";
import { CANONICAL_CHANNELS, type ChannelMeta } from "@/lib/profitability/channels";

export interface RefundFormEvent {
  id: number;
  name: string;
  startDate: string;
}

export interface RefundFormSubmit {
  customer: string;
  amount: number;
  dueDate: string;
  channel: string | null;
  eventId: number | null;
  notes: string | null;
  /** True = the customer returned the goods → put them back in stock +
   *  reverse their COGS. Only meaningful when the refund is tied to a
   *  sale that had products (originalItemId set). */
  restock: boolean;
  /** The original sale's processed_items.id, when refunding a specific
   *  sale ("Refund this"). Null for a standalone "Log a refund". */
  originalItemId: number | null;
}

/** Pre-fill values when launched from a specific sale ("Refund this"). */
export interface RefundPrefill {
  customer?: string;
  amount?: number;
  channel?: string | null;
  eventId?: number | null;
  /** The sale's row id — lets the refund optionally restock it. */
  originalItemId?: number;
  /** Whether that sale had products (drives the "put back in stock?"
   *  checkbox; hidden when the sale had no products to restock). */
  hasProducts?: boolean;
}

export interface RefundFormProps {
  open: boolean;
  events: RefundFormEvent[];
  /** When set, the form opens pre-filled (the "Refund this" path). */
  prefill?: RefundPrefill | null;
  onSave: (data: RefundFormSubmit) => Promise<void>;
  onClose: () => void;
}

// Channels a refund could be tagged to — mirror SaleForm: a refund maps
// to wherever the original sale lived. Excludes coming-soon channels,
// the Gmail channel (off), and "uploads" (the blank default).
const REFUND_CHANNELS: readonly ChannelMeta[] = CANONICAL_CHANNELS.filter(
  (c) => !c.comingSoon && c.id !== "gmail" && c.id !== "uploads"
);

function todayIso(): string {
  // LOCAL date — see SaleForm.todayIso. Avoids stamping tomorrow's UTC
  // date for evening users in UTC-negative timezones.
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

export default function RefundForm({
  open,
  events,
  prefill = null,
  onSave,
  onClose,
}: RefundFormProps) {
  const [customer, setCustomer] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState(todayIso());
  const [channel, setChannel] = useState("");
  const [eventId, setEventId] = useState("");
  const [notes, setNotes] = useState("");
  // Return → restock. Defaults on (most refunds are returns); only shown
  // when the refunded sale had products.
  const [restock, setRestock] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset / pre-fill on open. "Refund this" supplies `prefill` with the
  // original sale's fields; the standalone "Log a refund" opens blank.
  useEffect(() => {
    if (!open) return;
    setCustomer(prefill?.customer ?? "");
    setAmount(
      prefill?.amount != null && prefill.amount > 0
        ? String(prefill.amount)
        : ""
    );
    setDueDate(todayIso());
    setChannel(prefill?.channel ?? "");
    setEventId(prefill?.eventId != null ? String(prefill.eventId) : "");
    setNotes("");
    setRestock(true);
    setError(null);
  }, [open, prefill]);

  useEffect(() => {
    if (!open || saving) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, saving, onClose]);

  if (!open) return null;

  const showEventPicker = channel === "markets";

  const handleSave = async () => {
    setError(null);
    const cleaned = amount.replace(/[$,\s]/g, "");
    const amt = Number(cleaned);
    if (!Number.isFinite(amt) || amt <= 0) {
      setError("Refund amount must be a positive number.");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
      setError("Date must be valid.");
      return;
    }
    setSaving(true);
    try {
      await onSave({
        customer: customer.trim(),
        amount: amt,
        dueDate,
        channel: channel || null,
        eventId: showEventPicker && eventId ? Number(eventId) : null,
        notes: notes.trim() || null,
        restock: prefill?.hasProducts ? restock : false,
        originalItemId: prefill?.originalItemId ?? null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save refund");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="refund-form-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={() => {
        if (!saving) onClose();
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-xl shadow-2xl max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto"
      >
        <h2 id="refund-form-title" className="text-lg font-bold text-slate-900 m-0 mb-1">
          Log a refund
        </h2>
        <p className="text-xs text-slate-500 m-0 mb-4">
          Record money you returned to a customer. Tag the channel the
          original sale came from so it nets out of the right profit
          breakdown.
        </p>

        {/* Fixed-category explainer — the whole reason this form exists:
            no dropdown hunting. Spells out what logging a refund does. */}
        <div className="bg-rose-50 border border-rose-200 text-rose-900 px-3 py-2 rounded-lg mb-4 text-xs">
          Saved as a <strong>Returns &amp; Refunds</strong> expense
          (Schedule C 27a) — automatically subtracted from your revenue.
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-800 px-3 py-2 rounded-lg mb-3 text-sm">
            {error}
          </div>
        )}

        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Customer (optional)" htmlFor="refund-customer">
              <input
                id="refund-customer"
                type="text"
                value={customer}
                onChange={(e) => {
                  setCustomer(e.target.value);
                  setError(null);
                }}
                placeholder="e.g., Jane, or leave blank"
                disabled={saving}
                className="w-full py-2 px-3 text-sm border border-slate-200 rounded-lg outline-none box-border focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 disabled:bg-slate-50"
              />
            </Field>

            <Field label="Refund amount" htmlFor="refund-amount">
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">
                  {"$"}
                </span>
                <input
                  id="refund-amount"
                  type="text"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => {
                    setAmount(e.target.value);
                    setError(null);
                  }}
                  placeholder="0.00"
                  disabled={saving}
                  className="w-full py-2 pl-7 pr-3 text-sm border border-slate-200 rounded-lg outline-none box-border focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 disabled:bg-slate-50"
                />
              </div>
            </Field>
          </div>

          <Field label="Date" htmlFor="refund-date">
            <input
              id="refund-date"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              disabled={saving}
              className="w-full py-2 px-3 text-sm border border-slate-200 rounded-lg outline-none box-border focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 disabled:bg-slate-50"
            />
          </Field>

          <Field label="Original sale channel" htmlFor="refund-channel">
            <select
              id="refund-channel"
              value={channel}
              onChange={(e) => {
                setChannel(e.target.value);
                if (e.target.value !== "markets") setEventId("");
              }}
              disabled={saving}
              className="w-full py-2 px-3 text-sm border border-slate-200 rounded-lg outline-none box-border focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 disabled:bg-slate-50 bg-white"
            >
              <option value="">Not tied to a channel</option>
              {REFUND_CHANNELS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.icon} {c.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-slate-500 mt-1 m-0">
              Pick the channel the original sale came from so this channel&apos;s
              profit reflects the refund.
            </p>
          </Field>

          {showEventPicker && (
            <Field label="Event" htmlFor="refund-event">
              <select
                id="refund-event"
                value={eventId}
                onChange={(e) => setEventId(e.target.value)}
                disabled={saving}
                className="w-full py-2 px-3 text-sm border border-slate-200 rounded-lg outline-none box-border focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 disabled:bg-slate-50 bg-white"
              >
                <option value="">— pick a market event —</option>
                {events.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name} ({e.startDate})
                  </option>
                ))}
              </select>
              <p className="text-xs text-slate-500 mt-1 m-0">
                Optional — linking lets the event&apos;s profit math include
                this refund.
              </p>
            </Field>
          )}

          {prefill?.hasProducts && (
            <label className="flex items-start gap-2 text-sm text-slate-700 cursor-pointer select-none bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
              <input
                type="checkbox"
                checked={restock}
                onChange={(e) => setRestock(e.target.checked)}
                disabled={saving}
                className="mt-0.5 accent-rose-600 cursor-pointer flex-shrink-0"
              />
              <span>
                Put the items back in stock
                <span className="block text-xs text-slate-400 mt-0.5">
                  Check if the customer returned the products — restocks them
                  and reverses their cost. Uncheck for a refund without a
                  return (kept or defective).
                </span>
              </span>
            </label>
          )}

          <Field label="Notes (optional)" htmlFor="refund-notes">
            <textarea
              id="refund-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Reason for the refund?"
              rows={2}
              disabled={saving}
              className="w-full py-2 px-3 text-sm border border-slate-200 rounded-lg outline-none box-border focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 disabled:bg-slate-50 resize-y"
            />
          </Field>
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
            className="py-2 px-4 text-sm font-semibold text-white bg-rose-600 hover:bg-rose-700 rounded-lg border-0 cursor-pointer disabled:opacity-60 inline-flex items-center gap-2"
          >
            {saving && <Spinner size={12} color="white" />}
            {saving ? "Saving..." : "Log refund"}
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
      <label htmlFor={htmlFor} className="block text-xs font-medium text-slate-700 mb-1">
        {label}
      </label>
      {children}
    </div>
  );
}
