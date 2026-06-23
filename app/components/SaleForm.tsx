// app/components/SaleForm.tsx
//
// Modal to log a single manual SALE (income) — the counterpart to
// ExpenseForm. For direct / word-of-mouth / cash sales that aren't a
// market event, wholesale invoice, or synced platform order.
//
// Slimmer than ExpenseForm: customer is optional (cash sales often have
// no named buyer), no receipt attachments, income categories only.
// Parent supplies the income-category list + events and handles the
// POST in onSave.

"use client";

import { useEffect, useState } from "react";
import Spinner from "./Spinner";
import { CANONICAL_CHANNELS, type ChannelMeta } from "@/lib/profitability/channels";

export interface SaleFormEvent {
  id: number;
  name: string;
  startDate: string;
}

export interface SaleFormSubmit {
  customer: string;
  amount: number;
  dueDate: string;
  category: string;
  channel: string | null;
  eventId: number | null;
  notes: string | null;
  /** Optional product this sale is for. When set, the sale draws the
   *  product's stock down by `quantity` and feeds COGS/margin. */
  skuId: number | null;
  quantity: number;
}

interface SaleSkuOption {
  id: number;
  code: string;
  name: string;
}

export interface SaleFormProps {
  open: boolean;
  /** Income categories for the current user's industry + customs. */
  categories: string[];
  events: SaleFormEvent[];
  onSave: (data: SaleFormSubmit) => Promise<void>;
  onClose: () => void;
}

// Channels a manual sale could plausibly be tagged to. Excludes
// coming-soon channels, the Gmail channel (off), and "uploads"
// (Uncategorized — that's the blank default).
const SALE_CHANNELS: readonly ChannelMeta[] = CANONICAL_CHANNELS.filter(
  (c) => !c.comingSoon && c.id !== "gmail" && c.id !== "uploads"
);

function todayIso(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

export default function SaleForm({
  open,
  categories,
  events,
  onSave,
  onClose,
}: SaleFormProps) {
  const [customer, setCustomer] = useState("");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState(todayIso());
  const [category, setCategory] = useState("");
  // Default to the Direct channel — a manually-added sale is almost
  // always a direct/word-of-mouth one. User can change it.
  const [channel, setChannel] = useState("direct");
  const [eventId, setEventId] = useState("");
  const [notes, setNotes] = useState("");
  const [skus, setSkus] = useState<SaleSkuOption[]>([]);
  const [skuId, setSkuId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setCustomer("");
    setAmount("");
    setDueDate(todayIso());
    setCategory("");
    setChannel("direct");
    setEventId("");
    setNotes("");
    setSkuId("");
    setQuantity("1");
    setError(null);
  }, [open]);

  // Load sellable products (finished goods) for the optional product link.
  useEffect(() => {
    if (!open || skus.length > 0) return;
    (async () => {
      try {
        const res = await fetch("/api/skus");
        if (!res.ok) return;
        const data = (await res.json()) as {
          skus: {
            id: number;
            code: string;
            name: string;
            active: boolean;
            kind: string;
          }[];
        };
        setSkus(
          (data.skus || [])
            .filter((s) => s.active && s.kind === "product")
            .map((s) => ({ id: s.id, code: s.code, name: s.name }))
        );
      } catch {
        // non-fatal — the product picker just stays hidden
      }
    })();
  }, [open, skus.length]);

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
      setError("Amount must be a positive number.");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
      setError("Date must be valid.");
      return;
    }
    if (!category) {
      setError("Pick a category.");
      return;
    }
    const qtyNum = Number(quantity);
    if (skuId && (!Number.isFinite(qtyNum) || qtyNum <= 0)) {
      setError("Quantity must be a positive number.");
      return;
    }
    setSaving(true);
    try {
      await onSave({
        customer: customer.trim(),
        amount: amt,
        dueDate,
        category,
        channel: channel || null,
        eventId: showEventPicker && eventId ? Number(eventId) : null,
        notes: notes.trim() || null,
        skuId: skuId ? Number(skuId) : null,
        quantity: skuId ? qtyNum : 1,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="sale-form-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={() => {
        if (!saving) onClose();
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-xl shadow-2xl max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto"
      >
        <h2 id="sale-form-title" className="text-lg font-bold text-slate-900 m-0 mb-1">
          Add a sale
        </h2>
        <p className="text-xs text-slate-500 m-0 mb-5">
          Log a direct, cash, or word-of-mouth sale. Tag a channel so it lands
          in the right profit breakdown — leave it blank for a one-off.
        </p>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-800 px-3 py-2 rounded-lg mb-3 text-sm">
            {error}
          </div>
        )}

        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Customer (optional)" htmlFor="sale-customer">
              <input
                id="sale-customer"
                type="text"
                value={customer}
                onChange={(e) => {
                  setCustomer(e.target.value);
                  setError(null);
                }}
                placeholder="e.g., Jane (Venmo), or leave blank"
                disabled={saving}
                className="w-full py-2 px-3 text-sm border border-slate-200 rounded-lg outline-none box-border focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 disabled:bg-slate-50"
              />
            </Field>

            <Field label="Amount" htmlFor="sale-amount">
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">
                  {"$"}
                </span>
                <input
                  id="sale-amount"
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

          <Field label="Date" htmlFor="sale-date">
            <input
              id="sale-date"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              disabled={saving}
              className="w-full py-2 px-3 text-sm border border-slate-200 rounded-lg outline-none box-border focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 disabled:bg-slate-50"
            />
          </Field>

          <Field label="Category" htmlFor="sale-category">
            <select
              id="sale-category"
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                setError(null);
              }}
              disabled={saving}
              className="w-full py-2 px-3 text-sm border border-slate-200 rounded-lg outline-none box-border focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 disabled:bg-slate-50 bg-white"
            >
              <option value="">— pick an income category —</option>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            {categories.length === 0 && (
              <p className="text-xs text-slate-500 mt-1 m-0">
                No income categories yet — add one in Settings → Categories.
              </p>
            )}
          </Field>

          {/* Optional product link — draws stock down + feeds COGS/margin.
              Hidden when the maker has no finished-good SKUs yet. */}
          {skus.length > 0 && (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-[2fr_1fr] gap-3">
                <Field label="Product (optional)" htmlFor="sale-sku">
                  <select
                    id="sale-sku"
                    value={skuId}
                    onChange={(e) => {
                      setSkuId(e.target.value);
                      setError(null);
                    }}
                    disabled={saving}
                    className="w-full py-2 px-3 text-sm border border-slate-200 rounded-lg outline-none box-border focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 disabled:bg-slate-50 bg-white"
                  >
                    <option value="">— none —</option>
                    {skus.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.code} · {s.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Qty" htmlFor="sale-qty">
                  <input
                    id="sale-qty"
                    type="text"
                    inputMode="decimal"
                    value={quantity}
                    onChange={(e) => {
                      setQuantity(e.target.value);
                      setError(null);
                    }}
                    disabled={saving || !skuId}
                    className="w-full py-2 px-3 text-sm border border-slate-200 rounded-lg outline-none box-border focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 disabled:bg-slate-50"
                  />
                </Field>
              </div>
              {skuId && (
                <p className="text-[11px] text-slate-400 m-0">
                  Links this sale to the product — draws {quantity || "1"} from
                  its stock and counts toward its cost &amp; margin.
                </p>
              )}
            </>
          )}

          <Field label="Channel" htmlFor="sale-channel">
            <select
              id="sale-channel"
              value={channel}
              onChange={(e) => {
                setChannel(e.target.value);
                if (e.target.value !== "markets") setEventId("");
              }}
              disabled={saving}
              className="w-full py-2 px-3 text-sm border border-slate-200 rounded-lg outline-none box-border focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 disabled:bg-slate-50 bg-white"
            >
              <option value="">Uncategorized (not tied to a channel)</option>
              {SALE_CHANNELS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.icon} {c.label}
                </option>
              ))}
            </select>
          </Field>

          {showEventPicker && (
            <Field label="Event" htmlFor="sale-event">
              <select
                id="sale-event"
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
            </Field>
          )}

          <Field label="Notes (optional)" htmlFor="sale-notes">
            <textarea
              id="sale-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="What was sold?"
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
            className="py-2 px-4 text-sm font-semibold text-white bg-green-600 hover:bg-green-700 rounded-lg border-0 cursor-pointer disabled:opacity-60 inline-flex items-center gap-2"
          >
            {saving && <Spinner size={12} color="white" />}
            {saving ? "Saving..." : "Save sale"}
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
