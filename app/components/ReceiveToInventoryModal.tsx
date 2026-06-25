// app/components/ReceiveToInventoryModal.tsx
//
// Turn a purchase (expense transaction) into component stock: pick the
// material it bought + the quantity received. Adds stock and sets the
// material's per-unit cost (= amount ÷ quantity). Inventory/margin-side
// only — the expense still counts as the cash cost in Net Profit.

"use client";

import { useEffect, useState } from "react";
import Spinner from "./Spinner";

interface ComponentSku {
  id: number;
  code: string;
  name: string;
  unit: string;
}

export interface ReceiveToInventoryTxn {
  id: number;
  vendor: string;
  amount: number;
}

export interface ReceiveToInventoryModalProps {
  open: boolean;
  transaction: ReceiveToInventoryTxn | null;
  onClose: () => void;
  onReceived: () => void | Promise<void>;
}

export default function ReceiveToInventoryModal({
  open,
  transaction,
  onClose,
  onReceived,
}: ReceiveToInventoryModalProps) {
  const [components, setComponents] = useState<ComponentSku[]>([]);
  const [skuId, setSkuId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSkuId("");
    setQuantity("");
    setError(null);
  }, [open]);

  useEffect(() => {
    if (!open || components.length > 0) return;
    (async () => {
      try {
        const res = await fetch("/api/skus");
        if (!res.ok) return;
        const data = (await res.json()) as {
          skus: {
            id: number;
            code: string;
            name: string;
            unit: string;
            active: boolean;
            kind: string;
          }[];
        };
        setComponents(
          (data.skus || [])
            .filter((s) => s.active && s.kind === "component")
            .map((s) => ({ id: s.id, code: s.code, name: s.name, unit: s.unit }))
        );
      } catch {
        // non-fatal
      }
    })();
  }, [open, components.length]);

  useEffect(() => {
    if (!open || saving) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, saving, onClose]);

  if (!open || !transaction) return null;

  const picked = components.find((c) => String(c.id) === skuId);
  const qtyNum = Number(quantity);
  const validQty = Number.isFinite(qtyNum) && qtyNum > 0;
  const unitCost = validQty ? transaction.amount / qtyNum : null;
  const unit = picked?.unit && picked.unit !== "each" ? picked.unit : picked?.unit ?? "";

  const handleReceive = async () => {
    setError(null);
    if (!skuId) {
      setError("Pick a component.");
      return;
    }
    if (!validQty) {
      setError("Enter a positive quantity.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/inventory/receive-from-expense", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          transactionId: transaction.id,
          skuId: Number(skuId),
          quantity: qtyNum,
        }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setError(b.error || `HTTP ${res.status}`);
        return;
      }
      await onReceived();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't receive");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="receive-inv-title"
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
          id="receive-inv-title"
          className="text-lg font-bold text-slate-900 m-0 mb-1"
        >
          Receive into inventory
        </h2>
        <p className="text-xs text-slate-500 m-0 mb-4">
          Turn this purchase into component stock. Adds the quantity to the
          material&apos;s stock and sets its unit cost — it does <strong>not</strong>{" "}
          change your expenses or net profit.
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
          <Field label="Component (material)" htmlFor="receive-sku">
            <select
              id="receive-sku"
              value={skuId}
              onChange={(e) => {
                setSkuId(e.target.value);
                setError(null);
              }}
              disabled={saving || components.length === 0}
              className="w-full py-2 px-3 text-sm border border-slate-200 rounded-lg outline-none box-border bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 disabled:bg-slate-50"
            >
              <option value="">— pick a component —</option>
              {components.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} · {c.name}
                  {c.unit && c.unit !== "each" ? ` (${c.unit})` : ""}
                </option>
              ))}
            </select>
            {components.length === 0 && (
              <p className="text-xs text-slate-500 mt-1 m-0">
                No materials yet — create them under My Products → SKUs &amp;
                Components first.
              </p>
            )}
          </Field>

          <Field label="Quantity received" htmlFor="receive-qty">
            <div className="flex items-center gap-1.5">
              <input
                id="receive-qty"
                type="text"
                inputMode="decimal"
                value={quantity}
                onChange={(e) => {
                  setQuantity(e.target.value);
                  setError(null);
                }}
                placeholder="e.g. 5000"
                disabled={saving}
                className="w-full py-2 px-3 text-sm border border-slate-200 rounded-lg outline-none box-border focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 disabled:bg-slate-50"
              />
              {unit && (
                <span className="text-sm text-slate-500 whitespace-nowrap">
                  {unit}
                </span>
              )}
            </div>
          </Field>

          {unitCost != null && picked && (
            <p className="text-[11px] text-slate-500 m-0 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
              Adds <strong>{qtyNum.toLocaleString()} {picked.unit}</strong> to{" "}
              {picked.code} stock and sets its cost to{" "}
              <strong>${unitCost.toFixed(4)} / {picked.unit}</strong>.
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
            onClick={handleReceive}
            disabled={saving || components.length === 0}
            className="py-2 px-4 text-sm font-semibold text-white bg-blue-500 hover:bg-blue-600 rounded-lg border-0 cursor-pointer disabled:opacity-60 inline-flex items-center gap-2"
          >
            {saving && <Spinner size={12} color="white" />}
            {saving ? "Receiving…" : "Receive into inventory"}
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
      <label
        htmlFor={htmlFor}
        className="block text-xs font-medium text-slate-700 mb-1"
      >
        {label}
      </label>
      {children}
    </div>
  );
}
