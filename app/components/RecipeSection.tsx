// app/components/RecipeSection.tsx
//
// Tier 2 commit 3. The "Recipe" (bill of materials) editor on the
// SKU detail page. Defines what a finished product is made of —
// each component SKU + how much of it goes into one finished unit.
//
// Self-contained: fetches its own recipe (/api/skus/[id]/bom) + the
// SKU catalog (for the component picker) on mount, and handles
// add/remove inline. Renders a "you can make ~N" readout computed
// server-side from current component stock.
//
// Naming: "Recipe" in the UI per the locked decision (maker-
// friendly), even though the tables are bom_*.

"use client";

import { useCallback, useEffect, useState } from "react";
import Spinner from "./Spinner";

interface RecipeComponent {
  id: number;
  componentSkuId: number;
  componentCode: string;
  componentName: string;
  componentUnit: string;
  componentStock: number;
  quantityPerUnit: number;
  notes: string | null;
}

interface SkuOption {
  id: number;
  code: string;
  name: string;
}

export interface RecipeSectionProps {
  skuId: number;
  /** The finished SKU's own code — excluded from the picker. */
  skuCode: string;
}

export default function RecipeSection({ skuId, skuCode }: RecipeSectionProps) {
  const [components, setComponents] = useState<RecipeComponent[]>([]);
  const [canMake, setCanMake] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Picker state for the add-component form.
  const [skuOptions, setSkuOptions] = useState<SkuOption[]>([]);
  const [adding, setAdding] = useState(false);
  const [pickedSkuId, setPickedSkuId] = useState<string>("");
  const [qtyPerUnit, setQtyPerUnit] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<number | null>(null);

  const loadRecipe = useCallback(async () => {
    try {
      const res = await fetch(`/api/skus/${skuId}/bom`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || `HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as {
        components: RecipeComponent[];
        canMake: number | null;
      };
      setComponents(data.components);
      setCanMake(data.canMake);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load recipe");
    } finally {
      setLoading(false);
    }
  }, [skuId]);

  useEffect(() => {
    loadRecipe();
  }, [loadRecipe]);

  // Lazy-load the SKU catalog the first time the add form opens.
  const openAddForm = async () => {
    setAdding(true);
    if (skuOptions.length === 0) {
      try {
        const res = await fetch("/api/skus");
        if (res.ok) {
          const data = (await res.json()) as { skus: SkuOption[] };
          setSkuOptions(Array.isArray(data.skus) ? data.skus : []);
        }
      } catch {
        // non-fatal — the select just stays empty
      }
    }
  };

  const handleAdd = async () => {
    const componentSkuId = Number(pickedSkuId);
    const quantityPerUnit = Number(qtyPerUnit);
    if (!Number.isInteger(componentSkuId) || componentSkuId <= 0) {
      setError("Pick a component.");
      return;
    }
    if (!Number.isFinite(quantityPerUnit) || quantityPerUnit <= 0) {
      setError("Enter a positive quantity per unit.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/skus/${skuId}/bom`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ componentSkuId, quantityPerUnit }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || `HTTP ${res.status}`);
        return;
      }
      setPickedSkuId("");
      setQtyPerUnit("");
      setAdding(false);
      await loadRecipe();
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (componentSkuId: number) => {
    setRemovingId(componentSkuId);
    try {
      const res = await fetch(`/api/skus/${skuId}/bom/${componentSkuId}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || `HTTP ${res.status}`);
        return;
      }
      await loadRecipe();
    } finally {
      setRemovingId(null);
    }
  };

  // Components already in the recipe + the finished SKU itself are
  // excluded from the picker.
  const usedIds = new Set(components.map((c) => c.componentSkuId));
  const pickable = skuOptions.filter(
    (s) => s.code !== skuCode && !usedIds.has(s.id)
  );

  return (
    <section className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-base font-semibold text-slate-900 m-0">Recipe</h2>
        {canMake !== null && (
          <span
            className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
              canMake <= 0
                ? "bg-red-50 text-red-700"
                : canMake <= 5
                  ? "bg-amber-50 text-amber-700"
                  : "bg-emerald-50 text-emerald-700"
            }`}
            title="Limited by the component you have the least of"
          >
            Can make ~{canMake.toLocaleString()} with current materials
          </span>
        )}
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {loading ? (
          <div className="p-6 text-center text-slate-400 text-sm">
            Loading recipe...
          </div>
        ) : (
          <>
            {error && (
              <div className="bg-red-50 border-b border-red-200 text-red-800 px-4 py-2 text-sm">
                {error}
              </div>
            )}

            {components.length === 0 ? (
              <div className="px-4 py-5 text-sm text-slate-500">
                No recipe yet. Add the materials this product is made of —
                then logging a production run will draw them down
                automatically.
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
                    <th className="text-left py-2.5 px-4 font-medium">Component</th>
                    <th className="text-right py-2.5 px-4 font-medium">Per unit</th>
                    <th className="text-right py-2.5 px-4 font-medium">In stock</th>
                    <th className="w-10" />
                  </tr>
                </thead>
                <tbody>
                  {components.map((c) => (
                    <tr key={c.id} className="border-b border-slate-100 last:border-b-0">
                      <td className="py-2.5 px-4 text-slate-800">
                        <span className="font-mono text-xs text-slate-500">
                          {c.componentCode}
                        </span>{" "}
                        {c.componentName}
                      </td>
                      <td className="py-2.5 px-4 text-right tabular-nums text-slate-700 whitespace-nowrap">
                        {c.quantityPerUnit.toLocaleString()} {c.componentUnit}
                      </td>
                      <td
                        className={`py-2.5 px-4 text-right tabular-nums whitespace-nowrap ${
                          c.componentStock < c.quantityPerUnit
                            ? "text-red-600 font-semibold"
                            : "text-slate-500"
                        }`}
                      >
                        {c.componentStock.toLocaleString()} {c.componentUnit}
                      </td>
                      <td className="py-2.5 pr-3 text-right">
                        <button
                          type="button"
                          onClick={() => handleRemove(c.componentSkuId)}
                          disabled={removingId === c.componentSkuId}
                          title="Remove component"
                          className="text-slate-400 hover:text-red-600 cursor-pointer bg-transparent border-0 disabled:cursor-wait"
                        >
                          {removingId === c.componentSkuId ? (
                            <Spinner size={11} color="#94a3b8" />
                          ) : (
                            "\u{2715}"
                          )}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* Add component */}
            <div className="border-t border-slate-100 p-4">
              {adding ? (
                <div className="flex items-end gap-2 flex-wrap">
                  <div className="flex-1 min-w-[180px]">
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Component
                    </label>
                    <select
                      value={pickedSkuId}
                      onChange={(e) => {
                        setPickedSkuId(e.target.value);
                        setError(null);
                      }}
                      disabled={saving}
                      className="w-full py-2 px-2 text-sm border border-slate-200 rounded-lg bg-white outline-none focus:border-blue-500"
                    >
                      <option value="">— pick a SKU —</option>
                      {pickable.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.code} · {s.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="w-28">
                    <label className="block text-xs font-medium text-slate-600 mb-1">
                      Qty per unit
                    </label>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={qtyPerUnit}
                      onChange={(e) => {
                        setQtyPerUnit(e.target.value);
                        setError(null);
                      }}
                      disabled={saving}
                      placeholder="e.g. 4"
                      className="w-full py-2 px-2 text-sm border border-slate-200 rounded-lg bg-white outline-none focus:border-blue-500"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleAdd}
                    disabled={saving}
                    className="py-2 px-4 text-sm font-semibold text-white bg-blue-500 hover:bg-blue-600 rounded-lg border-0 cursor-pointer disabled:opacity-60 inline-flex items-center gap-2"
                  >
                    {saving && <Spinner size={12} color="white" />}
                    Add
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAdding(false);
                      setError(null);
                    }}
                    disabled={saving}
                    className="py-2 px-3 text-sm text-slate-600 border border-slate-300 rounded-lg cursor-pointer disabled:opacity-40 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={openAddForm}
                  className="text-sm font-medium text-blue-600 hover:text-blue-700 cursor-pointer bg-transparent border-0 p-0"
                >
                  + Add component
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
