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
  /** 'product' (finished good) | 'component' (material). Only components
   *  are offered as recipe ingredients. */
  kind: string;
}

export interface RecipeSectionProps {
  skuId: number;
  /** The finished SKU's own code — excluded from the picker. */
  skuCode: string;
  /** Bumped by the parent after a production run so the component
   *  stock + "can make N" readout reload. */
  refreshKey?: number;
}

export default function RecipeSection({
  skuId,
  skuCode,
  refreshKey,
}: RecipeSectionProps) {
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

  // "Create new material" sub-mode — make the ingredient SKU inline
  // instead of bouncing out to the catalog.
  const [createMode, setCreateMode] = useState(false);
  const [newCode, setNewCode] = useState("");
  const [newName, setNewName] = useState("");
  const [newUnit, setNewUnit] = useState("each");

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
    // refreshKey in deps: a production run elsewhere changed
    // component stock, so reload the "in stock" + "can make N" data.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadRecipe, refreshKey]);

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

  // Create a brand-new material SKU, then add it to this recipe — in
  // one action, so the user never leaves the page. Cost defaults to 0
  // (settable later on the material's own detail page).
  const handleCreateAndAdd = async () => {
    const code = newCode.trim();
    const name = newName.trim();
    const quantityPerUnit = Number(qtyPerUnit);
    if (!code) {
      setError("Enter a code for the new material.");
      return;
    }
    if (!name) {
      setError("Enter a name for the new material.");
      return;
    }
    if (!Number.isFinite(quantityPerUnit) || quantityPerUnit <= 0) {
      setError("Enter a positive quantity per unit.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // 1. Create the material SKU.
      const todayIso = new Date().toISOString().slice(0, 10);
      const createRes = await fetch("/api/skus", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code,
          name,
          unit: newUnit.trim() || "each",
          cost: 0,
          effectiveDate: todayIso,
          // A recipe ingredient is a material, not a finished good — so it
          // shows in the (component-only) picker and lands under Raw
          // materials in inventory.
          kind: "component",
        }),
      });
      if (!createRes.ok) {
        const body = await createRes.json().catch(() => ({}));
        setError(body.error || `Couldn't create material (HTTP ${createRes.status})`);
        return;
      }
      const created = (await createRes.json()) as { sku: { id: number } };

      // 2. Add it as a component of this recipe.
      const bomRes = await fetch(`/api/skus/${skuId}/bom`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          componentSkuId: created.sku.id,
          quantityPerUnit,
        }),
      });
      if (!bomRes.ok) {
        const body = await bomRes.json().catch(() => ({}));
        setError(body.error || `Material created but couldn't add to recipe (HTTP ${bomRes.status})`);
        return;
      }

      // Reset + refresh. Invalidate the cached picker list so the
      // new material shows if the user switches back to "pick".
      setNewCode("");
      setNewName("");
      setNewUnit("each");
      setQtyPerUnit("");
      setCreateMode(false);
      setAdding(false);
      setSkuOptions([]);
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

  // The picker offers only materials (kind='component') — a recipe is
  // built from raw materials, not other finished products. Also exclude
  // the finished SKU itself + components already in the recipe.
  const usedIds = new Set(components.map((c) => c.componentSkuId));
  const pickable = skuOptions.filter(
    (s) => s.kind === "component" && s.code !== skuCode && !usedIds.has(s.id)
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
              {!adding ? (
                <button
                  type="button"
                  onClick={openAddForm}
                  className="text-sm font-medium text-blue-600 hover:text-blue-700 cursor-pointer bg-transparent border-0 p-0"
                >
                  + Add component
                </button>
              ) : createMode ? (
                // ── Create a new material inline ──────────────────
                <div>
                  <div className="flex items-end gap-2 flex-wrap mb-2">
                    <div className="w-24">
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        Code
                      </label>
                      <input
                        type="text"
                        value={newCode}
                        onChange={(e) => {
                          setNewCode(e.target.value);
                          setError(null);
                        }}
                        disabled={saving}
                        placeholder="WAX"
                        className="w-full py-2 px-2 text-sm border border-slate-200 rounded-lg bg-white outline-none focus:border-blue-500"
                      />
                    </div>
                    <div className="flex-1 min-w-[140px]">
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        Material name
                      </label>
                      <input
                        type="text"
                        value={newName}
                        onChange={(e) => {
                          setNewName(e.target.value);
                          setError(null);
                        }}
                        disabled={saving}
                        placeholder="Soy wax"
                        className="w-full py-2 px-2 text-sm border border-slate-200 rounded-lg bg-white outline-none focus:border-blue-500"
                      />
                    </div>
                    <div className="w-20">
                      <label className="block text-xs font-medium text-slate-600 mb-1">
                        Unit
                      </label>
                      <select
                        value={newUnit}
                        onChange={(e) => setNewUnit(e.target.value)}
                        disabled={saving}
                        className="w-full py-2 px-2 text-sm border border-slate-200 rounded-lg bg-white outline-none focus:border-blue-500"
                      >
                        <option value="each">each</option>
                        <option value="oz">oz</option>
                        <option value="g">g</option>
                        <option value="lb">lb</option>
                        <option value="kg">kg</option>
                        <option value="ml">ml</option>
                        <option value="L">L</option>
                        <option value="ft">ft</option>
                        <option value="in">in</option>
                        <option value="yd">yd</option>
                        <option value="pcs">pcs</option>
                      </select>
                    </div>
                    <div className="w-24">
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
                        placeholder="4"
                        className="w-full py-2 px-2 text-sm border border-slate-200 rounded-lg bg-white outline-none focus:border-blue-500"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={handleCreateAndAdd}
                      disabled={saving}
                      className="py-2 px-4 text-sm font-semibold text-white bg-blue-500 hover:bg-blue-600 rounded-lg border-0 cursor-pointer disabled:opacity-60 inline-flex items-center gap-2"
                    >
                      {saving && <Spinner size={12} color="white" />}
                      Create &amp; add
                    </button>
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    <button
                      type="button"
                      onClick={() => {
                        setCreateMode(false);
                        setError(null);
                      }}
                      disabled={saving}
                      className="text-blue-600 hover:underline cursor-pointer bg-transparent border-0 p-0"
                    >
                      {"\u{2190}"} Pick an existing SKU instead
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAdding(false);
                        setCreateMode(false);
                        setError(null);
                      }}
                      disabled={saving}
                      className="text-slate-500 hover:underline cursor-pointer bg-transparent border-0 p-0"
                    >
                      Cancel
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-400 m-0 mt-2">
                    Creates a new material SKU and adds it to this recipe.
                    Set its cost + stock later on the material&apos;s own
                    page.
                  </p>
                </div>
              ) : (
                // ── Pick an existing SKU ──────────────────────────
                <div>
                  <div className="flex items-end gap-2 flex-wrap mb-2">
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
                        <option value="">— pick a component —</option>
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
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    <button
                      type="button"
                      onClick={() => {
                        setCreateMode(true);
                        setError(null);
                      }}
                      disabled={saving}
                      className="text-blue-600 hover:underline cursor-pointer bg-transparent border-0 p-0"
                    >
                      + Create a new material instead
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAdding(false);
                        setError(null);
                      }}
                      disabled={saving}
                      className="text-slate-500 hover:underline cursor-pointer bg-transparent border-0 p-0"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
