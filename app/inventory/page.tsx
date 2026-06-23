// app/inventory/page.tsx
//
// Inventory dashboard — "what do I have, what's it worth, what's
// running low." Read-focused overview with inline quick-receive.
// Distinct from /skus (catalog/costs) and /cogs (margin on sales).

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import AppHeader from "../components/AppHeader";
import PageHeader from "../components/PageHeader";
import ErrorBanner from "../components/ErrorBanner";
import SectionTip from "../components/SectionTip";
import ReceiveStockModal from "../components/ReceiveStockModal";

interface InventoryItem {
  id: number;
  code: string;
  name: string;
  unit: string;
  quantityOnHand: number;
  reorderPoint: number;
  currentCost: number | null;
  stockValue: number;
  status: "negative" | "out" | "low" | "ok";
  isFinished: boolean;
  isRawMaterial: boolean;
}

interface CantMake {
  finishedSkuId: number;
  code: string;
  name: string;
  limitingComponent: string;
}

interface InventoryResponse {
  items: InventoryItem[];
  totals: {
    totalValue: number;
    lowCount: number;
    outCount: number;
    negativeCount: number;
    skuCount: number;
  };
  cantMake: CantMake[];
}

type Filter = "all" | "low" | "out" | "negative" | "finished" | "raw";

function usd(n: number): string {
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function fmtQty(n: number, unit: string): string {
  const q = n.toLocaleString();
  return unit && unit !== "each" ? `${q} ${unit}` : q;
}

function statusBadge(status: InventoryItem["status"]): {
  label: string;
  cls: string;
} {
  switch (status) {
    case "negative":
      return { label: "Negative", cls: "bg-red-100 text-red-800" };
    case "out":
      return { label: "Out", cls: "bg-slate-200 text-slate-700" };
    case "low":
      return { label: "Low", cls: "bg-amber-100 text-amber-800" };
    default:
      return { label: "OK", cls: "bg-emerald-100 text-emerald-800" };
  }
}

export default function InventoryPage() {
  const router = useRouter();
  const [data, setData] = useState<InventoryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [receiveFor, setReceiveFor] = useState<InventoryItem | null>(null);

  // Inline reorder-point editing.
  const [editingReorderId, setEditingReorderId] = useState<number | null>(null);
  const [reorderDraft, setReorderDraft] = useState<string>("");
  const [savingReorder, setSavingReorder] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/inventory");
      if (res.status === 401) {
        router.replace("/signin?callbackUrl=/inventory");
        return;
      }
      if (res.status === 403) {
        setForbidden(true);
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || `HTTP ${res.status}`);
        return;
      }
      setData((await res.json()) as InventoryResponse);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load inventory");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    load();
  }, [load]);

  const saveReorder = useCallback(
    async (skuId: number) => {
      const value = Number(reorderDraft);
      if (!Number.isFinite(value) || value < 0) {
        setEditingReorderId(null);
        return;
      }
      setSavingReorder(true);
      try {
        const res = await fetch(`/api/skus/${skuId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reorderPoint: value }),
        });
        if (res.ok) {
          // Reload so the status recomputes against the new threshold.
          await load();
        }
      } finally {
        setSavingReorder(false);
        setEditingReorderId(null);
      }
    },
    [reorderDraft, load]
  );

  const filtered = useMemo(() => {
    if (!data) return [];
    switch (filter) {
      case "low":
        return data.items.filter((i) => i.status === "low");
      case "out":
        return data.items.filter((i) => i.status === "out");
      case "negative":
        return data.items.filter((i) => i.status === "negative");
      case "finished":
        return data.items.filter((i) => i.isFinished);
      case "raw":
        return data.items.filter((i) => i.isRawMaterial);
      default:
        return data.items;
    }
  }, [data, filter]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 font-sans">
        <AppHeader />
        <div className="max-w-[1100px] mx-auto py-8 px-4 sm:px-6">
          <p className="text-center p-[60px] text-slate-500">
            Loading inventory...
          </p>
        </div>
      </div>
    );
  }

  if (forbidden) {
    return (
      <div className="min-h-screen bg-slate-50 font-sans">
        <AppHeader />
        <div className="max-w-[1100px] mx-auto py-8 px-4 sm:px-6">
          <PageHeader
            title="Inventory"
            subtitle="Stock levels, value, and reorder alerts"
          />
          <div className="bg-amber-50 border border-amber-200 rounded-xl py-8 px-6 text-center">
            <p className="text-base font-medium text-amber-900 m-0 mb-2">
              {"\u{1F512}"} Active subscription required
            </p>
            <p className="text-sm text-amber-800 m-0 mb-5">
              Start your subscription — from $10/mo — to track inventory
              levels and value. Included on every tier.
            </p>
            <Link
              href="/billing"
              className="inline-block py-2.5 px-6 rounded-lg bg-amber-600 text-white text-sm font-semibold no-underline"
            >
              View plans
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const filterChips: { key: Filter; label: string; count?: number }[] = [
    { key: "all", label: "All", count: data?.totals.skuCount },
    { key: "finished", label: "Finished goods" },
    { key: "raw", label: "Raw materials" },
    { key: "negative", label: "Negative", count: data?.totals.negativeCount },
    { key: "out", label: "Out", count: data?.totals.outCount },
    { key: "low", label: "Low", count: data?.totals.lowCount },
  ];

  return (
    <div className="min-h-screen bg-slate-50 font-sans">
      <AppHeader />
      <div className="max-w-[1100px] mx-auto py-8 px-4 sm:px-6">
        <PageHeader
          title="Inventory"
          subtitle="Stock levels, value, and reorder alerts across every SKU"
          rightSlot={
            <Link
              href="/skus"
              className="inline-flex items-center gap-1.5 py-2 px-3.5 rounded-lg text-sm font-semibold border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 no-underline whitespace-nowrap transition-colors"
            >
              SKUs &amp; Components →
            </Link>
          }
        />

        <SectionTip id="inventory" title="Your stock at a glance">
          Total inventory value is your stock multiplied by each SKU&apos;s
          current cost — the number your CPA needs for ending inventory at
          tax time. Set a <strong>reorder point</strong> on any SKU and it
          shows up under <strong>Low</strong> when it drops to that level.
          The <strong>Can&apos;t make</strong>{" "}banner flags finished
          products you&apos;re out of materials for.
        </SectionTip>

        {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

        {/* Headline cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500 m-0 mb-1">
              Inventory value
            </p>
            <p className="text-2xl font-extrabold text-slate-900 m-0 tabular-nums">
              {usd(data?.totals.totalValue ?? 0)}
            </p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500 m-0 mb-1">
              Low stock
            </p>
            <p className="text-2xl font-extrabold text-amber-600 m-0 tabular-nums">
              {data?.totals.lowCount ?? 0}
            </p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500 m-0 mb-1">
              Out of stock
            </p>
            <p className="text-2xl font-extrabold text-slate-700 m-0 tabular-nums">
              {data?.totals.outCount ?? 0}
            </p>
          </div>
          <div className="bg-white border border-slate-200 rounded-xl p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500 m-0 mb-1">
              Negative
            </p>
            <p className="text-2xl font-extrabold text-red-600 m-0 tabular-nums">
              {data?.totals.negativeCount ?? 0}
            </p>
          </div>
        </div>

        {/* Can't-make alerts */}
        {data && data.cantMake.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-6">
            <p className="text-sm font-semibold text-red-900 m-0 mb-2">
              {"\u{26A0}\u{FE0F}"} Can&apos;t make {data.cantMake.length}{" "}
              {data.cantMake.length === 1 ? "product" : "products"} — out of
              materials
            </p>
            <ul className="m-0 p-0 list-none space-y-1 text-sm text-red-800">
              {data.cantMake.map((c) => (
                <li key={c.finishedSkuId} className="flex items-center gap-2">
                  <Link
                    href={`/skus/${c.finishedSkuId}`}
                    className="font-medium text-red-900 hover:underline no-underline"
                  >
                    {c.code} · {c.name}
                  </Link>
                  <span className="text-red-600 text-xs">
                    — out of {c.limitingComponent}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Filter chips */}
        <div className="flex flex-wrap gap-2 mb-4">
          {filterChips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              onClick={() => setFilter(chip.key)}
              className={`py-1.5 px-3 rounded-full text-[13px] font-medium border cursor-pointer ${
                filter === chip.key
                  ? "bg-slate-800 text-white border-slate-800"
                  : "bg-white text-slate-600 border-slate-200 hover:border-slate-400"
              }`}
            >
              {chip.label}
              {chip.count !== undefined && (
                <span className="ml-1.5 opacity-70 tabular-nums">
                  {chip.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Stock table */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
                <th className="text-left py-2.5 px-4 font-medium">SKU</th>
                <th className="text-right py-2.5 px-4 font-medium">On hand</th>
                <th className="text-right py-2.5 px-4 font-medium">Unit cost</th>
                <th className="text-right py-2.5 px-4 font-medium">Value</th>
                <th className="text-right py-2.5 px-4 font-medium">Reorder at</th>
                <th className="text-left py-2.5 px-4 font-medium">Status</th>
                <th className="w-20" />
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} className="py-8 text-center text-slate-400">
                    {data && data.items.length === 0
                      ? "No SKUs yet. Add products on the SKUs page."
                      : "Nothing matches this filter."}
                  </td>
                </tr>
              ) : (
                filtered.map((item) => {
                  const badge = statusBadge(item.status);
                  return (
                    <tr
                      key={item.id}
                      className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50"
                    >
                      <td className="py-3 px-4">
                        <Link
                          href={`/skus/${item.id}`}
                          className="no-underline text-slate-900 hover:text-blue-700"
                        >
                          <span className="font-mono text-xs text-slate-500">
                            {item.code}
                          </span>{" "}
                          {item.name}
                          {item.isFinished && (
                            <span className="ml-1 text-[10px]" title="Has a recipe">
                              {"\u{1F9EA}"}
                            </span>
                          )}
                        </Link>
                      </td>
                      <td className="py-3 px-4 text-right tabular-nums whitespace-nowrap">
                        {fmtQty(item.quantityOnHand, item.unit)}
                      </td>
                      <td className="py-3 px-4 text-right tabular-nums text-slate-600 whitespace-nowrap">
                        {item.currentCost != null ? usd(item.currentCost) : "—"}
                      </td>
                      <td className="py-3 px-4 text-right tabular-nums font-semibold text-slate-900 whitespace-nowrap">
                        {usd(item.stockValue)}
                      </td>
                      <td className="py-3 px-4 text-right tabular-nums whitespace-nowrap">
                        {editingReorderId === item.id ? (
                          <input
                            type="text"
                            inputMode="decimal"
                            autoFocus
                            value={reorderDraft}
                            disabled={savingReorder}
                            onChange={(e) => setReorderDraft(e.target.value)}
                            onBlur={() => saveReorder(item.id)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") e.currentTarget.blur();
                              else if (e.key === "Escape")
                                setEditingReorderId(null);
                            }}
                            className="w-16 py-1 px-1.5 text-sm text-right border border-blue-400 rounded outline-none"
                          />
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setEditingReorderId(item.id);
                              setReorderDraft(
                                item.reorderPoint > 0
                                  ? String(item.reorderPoint)
                                  : ""
                              );
                            }}
                            title="Set a reorder point"
                            className="text-slate-500 hover:text-blue-700 cursor-pointer bg-transparent border-0 border-b border-dotted border-slate-300 px-0.5"
                          >
                            {item.reorderPoint > 0
                              ? item.reorderPoint.toLocaleString()
                              : "set"}
                          </button>
                        )}
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${badge.cls}`}
                        >
                          {badge.label}
                        </span>
                      </td>
                      <td className="py-3 pr-3 text-right">
                        <button
                          type="button"
                          onClick={() => setReceiveFor(item)}
                          className="text-xs font-medium text-blue-600 hover:text-blue-700 cursor-pointer bg-transparent border-0"
                        >
                          Receive
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {data && (
          <p className="text-xs text-slate-400 mt-3 text-center">
            Inventory value = stock × each SKU&apos;s current cost. Used for
            ending inventory on your tax reports.
          </p>
        )}
      </div>

      {/* Quick-receive modal */}
      {receiveFor && (
        <ReceiveStockModal
          open={receiveFor !== null}
          skuId={receiveFor.id}
          skuCode={receiveFor.code}
          skuName={receiveFor.name}
          currentQuantity={receiveFor.quantityOnHand}
          unit={receiveFor.unit}
          onClose={() => setReceiveFor(null)}
          onSaved={() => {
            setReceiveFor(null);
            void load(); // refresh totals + statuses
          }}
        />
      )}
    </div>
  );
}
