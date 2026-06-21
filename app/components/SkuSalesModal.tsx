// app/components/SkuSalesModal.tsx
//
// Inventory simplification (June 2026). A focused "where & when did
// this sell" modal, opened from the Sales / Last sale line on a SKU
// card in the /skus list. Replaces dropping the user onto the full
// /skus/[id] detail page just to see sales.
//
// Reuses the existing COGS drill endpoint (scope=sku) over an
// all-time date range — it already returns each line item with its
// channel (where), sold-at date (when), quantity, and revenue. No
// new API surface needed.
//
//   GET /api/cogs/drill?scope=sku&id=<skuId>&from=1970-01-01&to=2999-12-31

"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

interface DrillLineItem {
  id: number;
  parentChannel: string | null;
  platform: string;
  name: string;
  quantity: number;
  unitPrice: number;
  revenue: number;
  currency: string;
  soldAt: string; // YYYY-MM-DD
}

interface DrillResponse {
  lineItems: DrillLineItem[];
  summary: { revenue: number; totalLineItemCount: number };
  truncated: boolean;
}

export interface SkuSalesModalProps {
  open: boolean;
  skuId: number;
  skuCode: string;
  skuName: string;
  onClose: () => void;
}

function fmtMoney(n: number, currency: string): string {
  const sym = currency === "USD" || !currency ? "$" : `${currency} `;
  return `${sym}${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
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

// "Where" — prefer the parent's channel (a market event, a named
// sales channel); fall back to the platform, title-cased.
function whereLabel(channel: string | null, platform: string): string {
  if (channel && channel.trim()) return channel.trim();
  const p = (platform || "").toLowerCase();
  if (p === "shopify") return "Shopify";
  if (p === "wix") return "Wix";
  if (p === "square") return "Square";
  if (p === "etsy") return "Etsy";
  if (platform) return platform.charAt(0).toUpperCase() + platform.slice(1);
  return "—";
}

export default function SkuSalesModal({
  open,
  skuId,
  skuCode,
  skuName,
  onClose,
}: SkuSalesModalProps) {
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<DrillLineItem[]>([]);
  const [revenue, setRevenue] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const url = new URL("/api/cogs/drill", window.location.origin);
      url.searchParams.set("scope", "sku");
      url.searchParams.set("id", String(skuId));
      // All-time range — sold_at is a DATE, so wide fixed bounds
      // capture every recorded sale.
      url.searchParams.set("from", "1970-01-01");
      url.searchParams.set("to", "2999-12-31");
      const res = await fetch(url.toString());
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || `HTTP ${res.status}`);
        return;
      }
      const payload = (await res.json()) as DrillResponse;
      setItems(payload.lineItems ?? []);
      setRevenue(payload.summary?.revenue ?? 0);
      setTruncated(Boolean(payload.truncated));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load sales");
    } finally {
      setLoading(false);
    }
  }, [skuId]);

  useEffect(() => {
    if (!open) return;
    void load();
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  const totalUnits = items.reduce((sum, it) => sum + (it.quantity || 0), 0);
  const currency = items[0]?.currency || "USD";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="sku-sales-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-xl shadow-2xl max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto"
      >
        <h2
          id="sku-sales-title"
          className="text-lg font-bold text-slate-900 m-0 mb-1"
        >
          Sales
        </h2>
        <p className="text-xs text-slate-500 m-0 mb-4">
          Where and when this item sold.
        </p>

        {/* SKU preview */}
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 mb-4">
          <p className="text-sm font-medium text-slate-900 m-0 truncate">
            <span className="font-mono">{skuCode}</span> · {skuName}
          </p>
          {!loading && items.length > 0 && (
            <p className="text-xs text-slate-500 m-0 mt-1">
              <span className="font-semibold text-slate-700">{items.length}</span>{" "}
              sale{items.length === 1 ? "" : "s"} ·{" "}
              <span className="font-semibold text-slate-700">
                {totalUnits.toLocaleString()}
              </span>{" "}
              unit{totalUnits === 1 ? "" : "s"} ·{" "}
              <span className="font-semibold text-slate-700">
                {fmtMoney(revenue, currency)}
              </span>{" "}
              revenue
            </p>
          )}
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-800 px-3 py-2 rounded-lg mb-3 text-sm">
            {error}
          </div>
        )}

        {loading ? (
          <p className="text-center py-6 text-slate-400 text-sm">Loading…</p>
        ) : items.length === 0 ? (
          <p className="text-center py-8 text-slate-400 text-sm border border-slate-100 rounded-lg">
            No sales recorded for this item yet.
          </p>
        ) : (
          <>
            <ul className="m-0 p-0 border border-slate-100 rounded-lg divide-y divide-slate-100">
              {items.map((it) => (
                <li
                  key={it.id}
                  className="flex items-start justify-between gap-3 px-3 py-2.5 list-none"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-slate-900 truncate">
                      {whereLabel(it.parentChannel, it.platform)}
                    </div>
                    <div className="text-xs text-slate-400">
                      {fmtDate(it.soldAt)}
                    </div>
                  </div>
                  <div className="text-right whitespace-nowrap">
                    <div className="text-sm text-slate-700 tabular-nums">
                      {it.quantity.toLocaleString()} sold
                    </div>
                    <div className="text-xs text-slate-400 tabular-nums">
                      {fmtMoney(it.revenue, it.currency)}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
            {truncated && (
              <p className="text-xs text-slate-400 text-center mt-2">
                Showing the most recent 1,000 sales.
              </p>
            )}
          </>
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
            className="py-2 px-4 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg cursor-pointer hover:bg-slate-50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
