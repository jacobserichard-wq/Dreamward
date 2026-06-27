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

export interface SaleLineItem {
  skuId: number;
  quantity: number;
  unitPrice: number;
}

export interface SaleFormSubmit {
  customer: string;
  amount: number;
  dueDate: string;
  category: string;
  channel: string | null;
  eventId: number | null;
  notes: string | null;
  /** Products on this sale (cart-style). Empty for a product-less cash
   *  sale. Each line draws its SKU's stock down + feeds COGS/margin; the
   *  amount is the sum of the lines when any are present. */
  items: SaleLineItem[];
}

interface SaleSkuOption {
  id: number;
  code: string;
  name: string;
  sellPrice: number | null;
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
  // Cart-style product lines. Empty = a product-less cash sale (amount is
  // entered manually). Each line: product + qty + per-unit price.
  const [lines, setLines] = useState<
    { skuId: string; quantity: string; unitPrice: string }[]
  >([]);
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
    setLines([]);
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
            defaultSellPrice: number | null;
          }[];
        };
        setSkus(
          (data.skus || [])
            .filter((s) => s.active && s.kind === "product")
            .map((s) => ({
              id: s.id,
              code: s.code,
              name: s.name,
              sellPrice: s.defaultSellPrice ?? null,
            }))
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

  // ── Cart math ────────────────────────────────────────────────────
  const productLines = lines.filter((l) => l.skuId);
  const hasProducts = productLines.length > 0;
  const lineTotal = (l: { quantity: string; unitPrice: string }) =>
    (Number(l.quantity) || 0) * (Number(l.unitPrice) || 0);
  const productsSubtotal = productLines.reduce((s, l) => s + lineTotal(l), 0);

  const addLine = () =>
    setLines((ls) => [...ls, { skuId: "", quantity: "1", unitPrice: "" }]);
  const removeLine = (idx: number) =>
    setLines((ls) => ls.filter((_, i) => i !== idx));
  const updateLine = (
    idx: number,
    patch: Partial<{ skuId: string; quantity: string; unitPrice: string }>
  ) => {
    setLines((ls) => ls.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
    setError(null);
  };
  // Picking a product pre-fills its price from the SKU's sell price when
  // the price field is still blank (the user can override).
  const pickProduct = (idx: number, picked: string) => {
    const sku = skus.find((s) => String(s.id) === picked);
    setLines((ls) =>
      ls.map((l, i) =>
        i === idx
          ? {
              ...l,
              skuId: picked,
              unitPrice:
                l.unitPrice ||
                (sku?.sellPrice != null ? String(sku.sellPrice) : ""),
            }
          : l
      )
    );
    setError(null);
  };

  const handleSave = async () => {
    setError(null);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
      setError("Date must be valid.");
      return;
    }
    if (!category) {
      setError("Pick a category.");
      return;
    }

    // Validate the product lines (if any) + build items[].
    const items: SaleLineItem[] = [];
    for (const l of productLines) {
      const qty = Number(l.quantity);
      const price = Number(l.unitPrice);
      if (!Number.isFinite(qty) || qty <= 0) {
        setError("Each product needs a quantity greater than 0.");
        return;
      }
      if (!Number.isFinite(price) || price < 0) {
        setError("Each product needs a valid price.");
        return;
      }
      items.push({ skuId: Number(l.skuId), quantity: qty, unitPrice: price });
    }

    // Amount: the cart subtotal when products are present; otherwise the
    // manually-entered total (a quick cash sale with no products).
    const amt = hasProducts
      ? Math.round(productsSubtotal * 100) / 100
      : Number(amount.replace(/[$,\s]/g, ""));
    if (!Number.isFinite(amt) || amt <= 0) {
      setError(
        hasProducts
          ? "Add a qty and price so the total is greater than 0."
          : "Amount must be a positive number."
      );
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
        items,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save");
    } finally {
      setSaving(false);
    }
  };

  const money = (n: number) =>
    n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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
              {hasProducts ? (
                <>
                  <div className="w-full py-2 px-3 text-sm border border-slate-200 rounded-lg bg-slate-50 text-slate-900 tabular-nums">
                    ${money(productsSubtotal)}
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1 m-0">
                    from products below
                  </p>
                </>
              ) : (
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
              )}
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

          {/* Cart-style product lines — each draws stock down + feeds
              COGS/margin, and the lines drive the Amount above. Hidden when
              the maker has no finished-good SKUs yet. */}
          {skus.length > 0 && (
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Products (optional)
              </label>
              {lines.length === 0 && (
                <p className="text-[11px] text-slate-400 m-0 mb-2">
                  Add the products on this sale to draw down stock + track cost
                  &amp; margin. Leave empty for a quick cash sale.
                </p>
              )}
              {lines.length > 0 && (
                <div className="space-y-2">
                  {lines.map((l, idx) => (
                    <div
                      key={idx}
                      className="grid grid-cols-[1fr_56px_76px_24px] gap-1.5 items-center"
                    >
                      <select
                        value={l.skuId}
                        onChange={(e) => pickProduct(idx, e.target.value)}
                        disabled={saving}
                        aria-label="Product"
                        className="w-full py-2 px-2 text-sm border border-slate-200 rounded-lg outline-none box-border focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 disabled:bg-slate-50 bg-white"
                      >
                        <option value="">— pick a product —</option>
                        {skus.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.code} · {s.name}
                          </option>
                        ))}
                      </select>
                      <input
                        value={l.quantity}
                        onChange={(e) =>
                          updateLine(idx, { quantity: e.target.value })
                        }
                        inputMode="decimal"
                        aria-label="Quantity"
                        placeholder="Qty"
                        disabled={saving}
                        className="w-full py-2 px-2 text-sm text-center border border-slate-200 rounded-lg outline-none box-border focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 disabled:bg-slate-50"
                      />
                      <div className="relative">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-xs">
                          {"$"}
                        </span>
                        <input
                          value={l.unitPrice}
                          onChange={(e) =>
                            updateLine(idx, { unitPrice: e.target.value })
                          }
                          inputMode="decimal"
                          aria-label="Price each"
                          placeholder="Price"
                          disabled={saving}
                          className="w-full py-2 pl-5 pr-1 text-sm border border-slate-200 rounded-lg outline-none box-border focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 disabled:bg-slate-50"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => removeLine(idx)}
                        disabled={saving}
                        aria-label="Remove product"
                        className="text-slate-400 hover:text-red-600 bg-transparent border-0 cursor-pointer text-lg leading-none"
                      >
                        {"×"}
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <button
                type="button"
                onClick={addLine}
                disabled={saving}
                className="mt-2 text-xs font-medium text-blue-600 hover:text-blue-700 hover:underline bg-transparent border-0 cursor-pointer"
              >
                + Add {lines.length > 0 ? "another " : ""}product
              </button>
              {hasProducts && (
                <p className="text-[11px] text-slate-400 m-0 mt-2">
                  Each line draws its product&apos;s stock down + counts toward
                  cost &amp; margin. Total:{" "}
                  <strong className="text-slate-600">
                    ${money(productsSubtotal)}
                  </strong>
                </p>
              )}
            </div>
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
