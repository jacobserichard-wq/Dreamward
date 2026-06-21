// app/components/SkuComponentCostPanel.tsx
//
// Inventory Pass 2 — the "build cost from components" editor shown
// inside SkuCostModal when a product's cost source is set to
// components. Cost-focused sibling of RecipeSection (which is
// stock/production-focused on the detail page).
//
// Lets the maker add/remove recipe components and set quantities; the
// per-unit rolled-up cost is computed server-side (GET …/bom returns
// each line's cost + the total + a missing-cost count) and shown
// read-only. The product's stored cost only updates once EVERY
// component is priced — until then we show the partial preview + a
// clear "finish pricing" warning (matching the engine's skip rule).
//
//   GET    /api/skus/[id]/bom
//   POST   /api/skus/[id]/bom               { componentSkuId, quantityPerUnit }
//   DELETE /api/skus/[id]/bom/[componentSkuId]
//   GET    /api/skus                        (catalog for the picker)

"use client";

import { useCallback, useEffect, useState } from "react";
import Spinner from "./Spinner";

interface BomComponent {
  id: number;
  componentSkuId: number;
  componentCode: string;
  componentName: string;
  componentUnit: string;
  quantityPerUnit: number;
  unitCost: number | null;
  lineCost: number;
}

interface BomResponse {
  components: BomComponent[];
  rolledUpCost: number;
  missingCostCount: number;
}

interface CatalogSku {
  id: number;
  code: string;
  name: string;
}

export interface SkuComponentCostPanelProps {
  skuId: number;
  /** Called after any recipe change so the parent can refresh the
   *  cost history / card (the rolled-up cost may have materialized). */
  onCostChanged?: () => void;
}

function fmtMoney(n: number): string {
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  })}`;
}

export default function SkuComponentCostPanel({
  skuId,
  onCostChanged,
}: SkuComponentCostPanelProps) {
  const [components, setComponents] = useState<BomComponent[]>([]);
  const [rolledUpCost, setRolledUpCost] = useState(0);
  const [missingCostCount, setMissingCostCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [catalog, setCatalog] = useState<CatalogSku[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Add-component form
  const [pickId, setPickId] = useState("");
  const [pickQty, setPickQty] = useState("");

  const loadBom = useCallback(async () => {
    try {
      const res = await fetch(`/api/skus/${skuId}/bom`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || `HTTP ${res.status}`);
        return;
      }
      const payload = (await res.json()) as BomResponse;
      setComponents(payload.components ?? []);
      setRolledUpCost(payload.rolledUpCost ?? 0);
      setMissingCostCount(payload.missingCostCount ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load recipe");
    }
  }, [skuId]);

  const loadCatalog = useCallback(async () => {
    try {
      const res = await fetch("/api/skus");
      if (!res.ok) return;
      const payload = (await res.json()) as { skus: CatalogSku[] };
      setCatalog(payload.skus ?? []);
    } catch {
      // Non-fatal — picker just stays empty.
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    (async () => {
      await Promise.all([loadBom(), loadCatalog()]);
      setLoading(false);
    })();
  }, [loadBom, loadCatalog]);

  const refreshAfterChange = useCallback(async () => {
    await loadBom();
    onCostChanged?.();
  }, [loadBom, onCostChanged]);

  const handleAdd = useCallback(async () => {
    const cid = Number(pickId);
    const qty = Number(pickQty);
    if (!Number.isInteger(cid) || cid <= 0) {
      setError("Pick a component.");
      return;
    }
    if (!Number.isFinite(qty) || qty <= 0) {
      setError("Quantity must be a positive number.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/skus/${skuId}/bom`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ componentSkuId: cid, quantityPerUnit: qty }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || `HTTP ${res.status}`);
        return;
      }
      setPickId("");
      setPickQty("");
      await refreshAfterChange();
    } finally {
      setBusy(false);
    }
  }, [pickId, pickQty, skuId, refreshAfterChange]);

  const handleRemove = useCallback(
    async (componentSkuId: number) => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(
          `/api/skus/${skuId}/bom/${componentSkuId}`,
          { method: "DELETE" }
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError(body.error || `HTTP ${res.status}`);
          return;
        }
        await refreshAfterChange();
      } finally {
        setBusy(false);
      }
    },
    [skuId, refreshAfterChange]
  );

  // Commit a quantity edit (upsert reuses the POST endpoint).
  const handleQtyCommit = useCallback(
    async (componentSkuId: number, raw: string, prev: number) => {
      const qty = Number(raw);
      if (!Number.isFinite(qty) || qty <= 0 || qty === prev) {
        // Invalid or unchanged → reload to snap back to the stored value.
        await loadBom();
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(`/api/skus/${skuId}/bom`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            componentSkuId,
            quantityPerUnit: qty,
          }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError(body.error || `HTTP ${res.status}`);
          return;
        }
        await refreshAfterChange();
      } finally {
        setBusy(false);
      }
    },
    [skuId, refreshAfterChange, loadBom]
  );

  // Components not already in the recipe + not the product itself.
  const usedIds = new Set(components.map((c) => c.componentSkuId));
  const pickable = catalog.filter(
    (s) => s.id !== skuId && !usedIds.has(s.id)
  );

  if (loading) {
    return <p className="text-center py-6 text-slate-400 text-sm">Loading recipe…</p>;
  }

  return (
    <div>
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-800 px-3 py-2 rounded-lg mb-3 text-sm">
          {error}
        </div>
      )}

      {components.length === 0 ? (
        <p className="text-center py-5 text-slate-400 text-sm border border-slate-100 rounded-lg mb-3">
          No components yet. Add what this product is made of below — the
          cost builds up automatically.
        </p>
      ) : (
        <ul className="m-0 p-0 border border-slate-100 rounded-lg divide-y divide-slate-100 mb-3">
          {components.map((c) => {
            const noCost = c.unitCost == null;
            const zeroCost = c.unitCost === 0;
            return (
              <li
                key={c.id}
                className="flex items-center justify-between gap-3 px-3 py-2.5 list-none"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-900 truncate">
                    {c.componentName}
                  </div>
                  <div className="text-xs text-slate-400">
                    {noCost ? (
                      <span className="text-amber-600">no cost set</span>
                    ) : zeroCost ? (
                      <span className="text-amber-600">priced at $0</span>
                    ) : (
                      <>{fmtMoney(c.unitCost!)} / {c.componentUnit || "unit"}</>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 whitespace-nowrap">
                  <input
                    type="text"
                    inputMode="decimal"
                    defaultValue={String(c.quantityPerUnit)}
                    disabled={busy}
                    onBlur={(e) =>
                      handleQtyCommit(
                        c.componentSkuId,
                        e.target.value,
                        c.quantityPerUnit
                      )
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                    }}
                    className="w-14 py-1 px-2 text-xs text-right border border-slate-200 rounded outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 disabled:bg-slate-50"
                    title="Quantity per finished unit"
                  />
                  <span className="text-xs text-slate-400">×</span>
                  <span className="text-sm font-semibold text-slate-700 tabular-nums w-16 text-right">
                    {fmtMoney(c.lineCost)}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRemove(c.componentSkuId)}
                    disabled={busy}
                    title="Remove component"
                    aria-label="Remove component"
                    className="text-slate-300 hover:text-red-600 cursor-pointer bg-transparent border-0 text-base leading-none px-1 disabled:opacity-30"
                  >
                    {"×"}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Rolled-up total */}
      <div className="flex items-center justify-between px-1 mb-3">
        <span className="text-sm font-semibold text-slate-700">
          Built unit cost
        </span>
        <span className="text-base font-bold text-slate-900 tabular-nums">
          {fmtMoney(rolledUpCost)}
        </span>
      </div>

      {missingCostCount > 0 && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2 rounded-lg mb-3 text-xs">
          {missingCostCount} component{missingCostCount === 1 ? "" : "s"} have
          no cost set. This product&rsquo;s cost won&rsquo;t update until every
          component is priced — set their costs (each is a SKU you can open
          and price).
        </div>
      )}

      {/* Add component */}
      <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
        <h4 className="text-xs font-semibold text-slate-700 m-0 mb-2">
          Add a component
        </h4>
        <div className="flex items-end gap-2">
          <div className="flex-1 min-w-0">
            <label className="block text-[11px] font-medium text-slate-500 mb-1">
              Component
            </label>
            <select
              value={pickId}
              onChange={(e) => {
                setPickId(e.target.value);
                setError(null);
              }}
              disabled={busy || pickable.length === 0}
              className="w-full py-2 px-2 text-sm border border-slate-200 rounded-lg outline-none box-border bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 disabled:bg-slate-100"
            >
              <option value="">
                {pickable.length === 0 ? "No other SKUs" : "Select…"}
              </option>
              {pickable.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.code} · {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="w-20">
            <label className="block text-[11px] font-medium text-slate-500 mb-1">
              Qty / unit
            </label>
            <input
              type="text"
              inputMode="decimal"
              value={pickQty}
              onChange={(e) => setPickQty(e.target.value)}
              placeholder="1"
              disabled={busy}
              className="w-full py-2 px-2 text-sm border border-slate-200 rounded-lg outline-none box-border bg-white focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 disabled:bg-slate-100"
            />
          </div>
          <button
            type="button"
            onClick={handleAdd}
            disabled={busy || !pickId}
            className="py-2 px-3 text-sm font-semibold text-white bg-blue-500 hover:bg-blue-600 rounded-lg border-0 cursor-pointer disabled:opacity-60 inline-flex items-center gap-1.5"
          >
            {busy && <Spinner size={12} color="white" />}
            Add
          </button>
        </div>
        <p className="text-[11px] text-slate-400 m-0 mt-2">
          Don&rsquo;t see a material? Create it as a SKU (Components tab)
          first, give it a cost, then add it here.
        </p>
      </div>
    </div>
  );
}
