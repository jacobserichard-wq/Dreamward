// app/market-day/page.tsx
//
// Market-Day Mode — the phone-first booth surface.
// Design: session-notes/design-market-day-mode.md (decisions D1/D2).
//
// A vendor standing behind a market table logs a sale in ONE TAP:
// big SKU tiles, running day total pinned on top, undo within reach.
// This is the cash log — card sales at the booth already stream in
// through the Square integration; this covers everything Square
// doesn't see (cash, Venmo, trades).
//
// Implementation notes:
//   - `day` is the CLIENT's local date — a Saturday market is the
//     vendor's Saturday even when the UTC date has rolled over.
//   - Taps are queued through a promise chain (tapQueueRef) so
//     rapid logging stays ordered; the server's advisory lock makes
//     it safe regardless, but the queue keeps the running total
//     monotonic on the client too.
//   - Optimistic total bump per tap, reconciled with the server's
//     authoritative total on each response; rolled back on error.
//   - First tap on an unpriced SKU opens the price sheet; the price
//     persists to the SKU (PATCH defaultSellPrice), then the sale
//     logs immediately — the prompt is paid once, ever.

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import AppHeader from "../components/AppHeader";
import ErrorBanner from "../components/ErrorBanner";
import Spinner from "../components/Spinner";
import { isPayingTier } from "@/lib/plans";

interface MarketEvent {
  id: number;
  name: string;
  startDate: string;
  endDate: string | null;
  venue: string | null;
}

interface SaleRow {
  id: number;
  name: string;
  unitPrice: number;
  quantity: number;
  matchedSkuId: number | null;
  createdAt: string;
  /** Client-only: tap accepted locally, server confirmation pending. */
  pending?: boolean;
}

interface SkuTile {
  id: number;
  code: string;
  name: string;
  defaultSellPrice: number | null;
  quantityOnHand: number;
  unit: string;
}

interface MarketDayData {
  events: MarketEvent[];
  event: MarketEvent | null;
  parent: { id: number; amount: number } | null;
  sales: SaleRow[];
  total: number;
  skus: SkuTile[];
  /** Raw materials (recipe-ingredient-only SKUs with no booth
   *  price) the API kept off the grid. Surfaced so the hiding is
   *  never silent. */
  hiddenMaterials: number;
}

/** The vendor's local calendar date — NOT UTC. */
function localDayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function fmtUsd(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
}

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function MarketDayPage() {
  const day = useMemo(() => localDayIso(), []);

  const [plan, setPlan] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<MarketDayData | null>(null);
  const [chosenEventId, setChosenEventId] = useState<number | null>(null);

  // Price sheet: set/edit a SKU's sell price. logAfterSave = the
  // sheet was opened by a sale tap (not the pencil), so saving also
  // logs the sale.
  const [priceSheet, setPriceSheet] = useState<{
    sku: SkuTile;
    logAfterSave: boolean;
  } | null>(null);
  const [priceInput, setPriceInput] = useState("");
  const [priceSaving, setPriceSaving] = useState(false);

  // Custom-sale sheet.
  const [customOpen, setCustomOpen] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customPrice, setCustomPrice] = useState("");

  // Tap feedback: tile id flashed for ~300ms after a tap.
  const [flashSkuId, setFlashSkuId] = useState<number | null>(null);

  const [undoBusyId, setUndoBusyId] = useState<number | null>(null);

  // Serialize sale POSTs — see header comment.
  const tapQueueRef = useRef<Promise<void>>(Promise.resolve());
  // Temp ids for optimistic rows, replaced by server ids on confirm.
  const tempIdRef = useRef(-1);

  const load = useCallback(
    async (eventId: number | null) => {
      setError(null);
      try {
        const planRes = await fetch("/api/client");
        if (planRes.status === 401) {
          window.location.href = "/signin?callbackUrl=/market-day";
          return;
        }
        if (planRes.ok) {
          const p = (await planRes.json()) as { plan: string };
          setPlan(p.plan);
          if (!isPayingTier(p.plan)) {
            setLoading(false);
            return;
          }
        }
        const url = new URL("/api/market-day", window.location.origin);
        url.searchParams.set("day", day);
        if (eventId !== null) url.searchParams.set("eventId", String(eventId));
        const res = await fetch(url.toString());
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError(body.error || `HTTP ${res.status}`);
          return;
        }
        setData((await res.json()) as MarketDayData);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't load");
      } finally {
        setLoading(false);
      }
    },
    [day]
  );

  useEffect(() => {
    load(chosenEventId);
  }, [load, chosenEventId]);

  // ── Core: log one sale (SKU tap or custom) ─────────────────────
  const logSale = useCallback(
    (opts: { sku?: SkuTile; customName?: string; price: number }) => {
      const event = data?.event;
      if (!event) return;
      const { sku, price } = opts;
      const tempId = tempIdRef.current--;
      const optimistic: SaleRow = {
        id: tempId,
        name: sku ? sku.name : opts.customName || "Custom sale",
        unitPrice: price,
        quantity: 1,
        matchedSkuId: sku?.id ?? null,
        createdAt: new Date().toISOString(),
        pending: true,
      };

      // Optimistic: total bumps, sale appears, stock ticks down.
      setData((prev) =>
        prev
          ? {
              ...prev,
              total: prev.total + price,
              sales: [optimistic, ...prev.sales],
              skus: sku
                ? prev.skus.map((s) =>
                    s.id === sku.id
                      ? { ...s, quantityOnHand: s.quantityOnHand - 1 }
                      : s
                  )
                : prev.skus,
            }
          : prev
      );
      if (sku) {
        setFlashSkuId(sku.id);
        window.setTimeout(() => {
          setFlashSkuId((cur) => (cur === sku.id ? null : cur));
        }, 350);
      }

      tapQueueRef.current = tapQueueRef.current.then(async () => {
        try {
          const res = await fetch("/api/market-day/sale", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              eventId: event.id,
              day,
              skuId: sku?.id,
              customName: sku ? undefined : opts.customName || "Custom sale",
              price,
            }),
          });
          const body = (await res.json().catch(() => ({}))) as {
            sale?: SaleRow;
            total?: number;
            error?: string;
          };
          if (!res.ok || !body.sale) {
            throw new Error(body.error || `HTTP ${res.status}`);
          }
          // Confirm: swap the temp row for the server row, adopt the
          // authoritative total.
          setData((prev) =>
            prev
              ? {
                  ...prev,
                  total: body.total ?? prev.total,
                  sales: prev.sales.map((s) =>
                    s.id === tempId ? { ...body.sale!, pending: false } : s
                  ),
                }
              : prev
          );
        } catch (err) {
          // Roll the tap back — total, row, and stock.
          setData((prev) =>
            prev
              ? {
                  ...prev,
                  total: prev.total - price,
                  sales: prev.sales.filter((s) => s.id !== tempId),
                  skus: sku
                    ? prev.skus.map((s) =>
                        s.id === sku.id
                          ? { ...s, quantityOnHand: s.quantityOnHand + 1 }
                          : s
                      )
                    : prev.skus,
                }
              : prev
          );
          setError(
            `That sale didn't save (${err instanceof Error ? err.message : "network"}). Tap it again when you have signal.`
          );
        }
      });
    },
    [data?.event, day]
  );

  const handleTileTap = useCallback(
    (sku: SkuTile) => {
      if (sku.defaultSellPrice === null) {
        setPriceInput("");
        setPriceSheet({ sku, logAfterSave: true });
        return;
      }
      logSale({ sku, price: sku.defaultSellPrice });
    },
    [logSale]
  );

  const handleSavePrice = useCallback(async () => {
    if (!priceSheet) return;
    const price = Number(priceInput.replace(/[$,\s]/g, ""));
    if (!Number.isFinite(price) || price <= 0) {
      setError("Enter a price greater than zero.");
      return;
    }
    setPriceSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/skus/${priceSheet.sku.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ defaultSellPrice: price }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const updated: SkuTile = { ...priceSheet.sku, defaultSellPrice: price };
      setData((prev) =>
        prev
          ? {
              ...prev,
              skus: prev.skus.map((s) => (s.id === updated.id ? updated : s)),
            }
          : prev
      );
      const { logAfterSave } = priceSheet;
      setPriceSheet(null);
      if (logAfterSave) logSale({ sku: updated, price });
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Couldn't save the price"
      );
    } finally {
      setPriceSaving(false);
    }
  }, [priceSheet, priceInput, logSale]);

  const handleCustomSale = useCallback(() => {
    const price = Number(customPrice.replace(/[$,\s]/g, ""));
    if (!Number.isFinite(price) || price <= 0) {
      setError("Enter a price greater than zero.");
      return;
    }
    setCustomOpen(false);
    logSale({ customName: customName.trim() || "Custom sale", price });
    setCustomName("");
    setCustomPrice("");
  }, [customName, customPrice, logSale]);

  const handleUndo = useCallback(
    async (sale: SaleRow) => {
      if (sale.pending) return; // still in flight — let it land first
      setUndoBusyId(sale.id);
      setError(null);
      try {
        const res = await fetch(`/api/market-day/sale/${sale.id}`, {
          method: "DELETE",
        });
        const body = (await res.json().catch(() => ({}))) as {
          undone?: boolean;
          total?: number;
          error?: string;
        };
        if (!res.ok || !body.undone) {
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        setData((prev) =>
          prev
            ? {
                ...prev,
                total: body.total ?? 0,
                sales: prev.sales.filter((s) => s.id !== sale.id),
                skus:
                  sale.matchedSkuId !== null
                    ? prev.skus.map((s) =>
                        s.id === sale.matchedSkuId
                          ? {
                              ...s,
                              quantityOnHand:
                                s.quantityOnHand + sale.quantity,
                            }
                          : s
                      )
                    : prev.skus,
              }
            : prev
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't undo");
      } finally {
        setUndoBusyId(null);
      }
    },
    []
  );

  // ── Render states ────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 font-sans">
        <AppHeader />
        <p className="text-center p-[60px] text-slate-500">
          Loading Market Day…
        </p>
      </div>
    );
  }

  if (plan !== null && !isPayingTier(plan)) {
    return (
      <div className="min-h-screen bg-slate-50 font-sans">
        <AppHeader />
        <div className="max-w-[600px] mx-auto py-8 px-4">
          <div className="bg-amber-50 border border-amber-200 rounded-xl py-8 px-6 text-center">
            <p className="text-base font-medium text-amber-900 m-0 mb-2">
              {"\u{1F512}"} Active subscription required
            </p>
            <p className="text-sm text-amber-800 m-0 mb-5">
              Market Day mode is included on every plan — from $10/mo.
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

  const event = data?.event ?? null;
  const candidates = data?.events ?? [];

  return (
    <div className="min-h-screen bg-slate-50 font-sans">
      <AppHeader />

      {/* ── Sticky running total ─────────────────────────────── */}
      {event && (
        <div className="sticky top-0 z-20 bg-white/95 backdrop-blur border-b border-slate-200 px-4 py-3">
          <div className="max-w-[700px] mx-auto flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs text-slate-500 m-0 truncate">
                {event.name}
                {event.venue ? ` · ${event.venue}` : ""}
              </p>
              <p className="text-[11px] text-slate-400 m-0">
                {data?.sales.length ?? 0} sale
                {(data?.sales.length ?? 0) === 1 ? "" : "s"} today
              </p>
            </div>
            <p className="text-3xl font-bold text-slate-900 m-0 tabular-nums whitespace-nowrap">
              {fmtUsd(data?.total ?? 0)}
            </p>
          </div>
        </div>
      )}

      <div className="max-w-[700px] mx-auto py-4 px-4 pb-24">
        <Link
          href="/events"
          className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline mb-4"
        >
          {"\u{2190}"} Back to events
        </Link>
        {error && (
          <ErrorBanner message={error} onDismiss={() => setError(null)} />
        )}

        {/* ── No event today ───────────────────────────────────── */}
        {!event && candidates.length === 0 && (
          <div className="bg-white rounded-xl border border-slate-200 py-12 px-6 text-center mt-4">
            <p className="text-5xl mb-3">{"\u{1F3EA}"}</p>
            <p className="text-base font-medium text-slate-700 m-0 mb-1">
              No event scheduled today
            </p>
            <p className="text-sm text-slate-500 m-0 mb-5 max-w-sm mx-auto">
              Market Day mode logs sales against an event so booth
              fees, mileage, and P&amp;L all tie together. Create
              today&apos;s market first.
            </p>
            <Link
              href="/events?new=1"
              className="inline-block py-2.5 px-5 rounded-lg bg-blue-500 text-white text-sm font-semibold no-underline hover:bg-blue-600"
            >
              + Add today&apos;s event
            </Link>
          </div>
        )}

        {/* ── Multiple events today: pick one ─────────────────── */}
        {!event && candidates.length > 1 && (
          <div className="bg-white rounded-xl border border-slate-200 p-5 mt-4">
            <p className="text-sm font-medium text-slate-700 m-0 mb-3">
              You have {candidates.length} events today — which booth
              are you at?
            </p>
            <div className="space-y-2">
              {candidates.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => setChosenEventId(e.id)}
                  className="w-full text-left p-3 rounded-lg border border-slate-200 hover:border-blue-400 hover:bg-blue-50 cursor-pointer bg-white"
                >
                  <span className="text-sm font-semibold text-slate-900 block">
                    {e.name}
                  </span>
                  {e.venue && (
                    <span className="text-xs text-slate-500">{e.venue}</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Live mode ────────────────────────────────────────── */}
        {event && data && (
          <>
            {candidates.length > 1 && (
              <p className="text-xs text-slate-500 m-0 mb-3">
                Logging to <strong>{event.name}</strong> ·{" "}
                <button
                  type="button"
                  onClick={() => setChosenEventId(null)}
                  className="text-blue-600 hover:underline bg-transparent border-0 cursor-pointer p-0 text-xs"
                >
                  switch event
                </button>
              </p>
            )}

            {/* Tap grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 mt-3">
              {data.skus.map((sku) => (
                <button
                  key={sku.id}
                  type="button"
                  onClick={() => handleTileTap(sku)}
                  className={`relative text-left p-3.5 min-h-[92px] rounded-xl border-2 bg-white cursor-pointer transition-all active:scale-95 ${
                    flashSkuId === sku.id
                      ? "border-emerald-500 bg-emerald-50"
                      : "border-slate-200 hover:border-slate-300"
                  }`}
                >
                  <span className="text-sm font-semibold text-slate-900 block leading-tight mb-1 pr-6">
                    {sku.name}
                  </span>
                  <span
                    className={`text-lg font-bold tabular-nums block ${
                      sku.defaultSellPrice !== null
                        ? "text-slate-900"
                        : "text-blue-600 text-sm font-semibold"
                    }`}
                  >
                    {sku.defaultSellPrice !== null
                      ? fmtUsd(sku.defaultSellPrice)
                      : "Set price"}
                  </span>
                  {sku.quantityOnHand !== 0 && (
                    <span
                      className={`text-[11px] tabular-nums ${
                        sku.quantityOnHand < 0
                          ? "text-red-600"
                          : "text-slate-400"
                      }`}
                    >
                      {sku.quantityOnHand} left
                    </span>
                  )}
                  {/* Edit price — small corner target, doesn't log */}
                  <span
                    role="button"
                    tabIndex={0}
                    aria-label={`Edit price for ${sku.name}`}
                    onClick={(ev) => {
                      ev.stopPropagation();
                      setPriceInput(
                        sku.defaultSellPrice !== null
                          ? String(sku.defaultSellPrice)
                          : ""
                      );
                      setPriceSheet({ sku, logAfterSave: false });
                    }}
                    onKeyDown={(ev) => {
                      if (ev.key === "Enter" || ev.key === " ") {
                        ev.stopPropagation();
                        ev.preventDefault();
                        setPriceInput(
                          sku.defaultSellPrice !== null
                            ? String(sku.defaultSellPrice)
                            : ""
                        );
                        setPriceSheet({ sku, logAfterSave: false });
                      }
                    }}
                    className="absolute top-2 right-2 text-slate-300 hover:text-slate-600 text-sm leading-none p-1"
                  >
                    {"\u{270E}"}
                  </span>
                </button>
              ))}

              {/* Custom sale tile */}
              <button
                type="button"
                onClick={() => {
                  setCustomName("");
                  setCustomPrice("");
                  setCustomOpen(true);
                }}
                className="text-left p-3.5 min-h-[92px] rounded-xl border-2 border-dashed border-slate-300 bg-white cursor-pointer transition-all active:scale-95 hover:border-slate-400"
              >
                <span className="text-sm font-semibold text-slate-600 block leading-tight mb-1">
                  + Custom sale
                </span>
                <span className="text-xs text-slate-400">
                  Anything not in your catalog
                </span>
              </button>
            </div>

            {data.skus.length === 0 && (
              <p className="text-xs text-slate-500 mt-3 mb-0">
                No SKUs yet — tiles appear here for every active SKU in
                your{" "}
                <Link href="/skus" className="text-blue-600 hover:underline">
                  catalog
                </Link>
                . You can still log sales with the Custom tile above.
              </p>
            )}

            {data.hiddenMaterials > 0 && (
              <p className="text-[11px] text-slate-400 mt-3 mb-0">
                {data.hiddenMaterials} raw material
                {data.hiddenMaterials === 1 ? "" : "s"} (recipe
                ingredients without a booth price) hidden. To sell one
                directly, set its booth price from{" "}
                <Link href="/skus" className="text-blue-600 hover:underline">
                  its SKU page
                </Link>
                .
              </p>
            )}

            {/* Recent sales + undo */}
            {data.sales.length > 0 && (
              <div className="mt-6">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500 mb-2">
                  Today&apos;s sales
                </h2>
                <ul className="space-y-1.5 m-0 p-0 list-none">
                  {data.sales.map((s) => (
                    <li
                      key={s.id}
                      className={`flex items-center justify-between gap-3 bg-white border border-slate-200 rounded-lg px-3 py-2 ${
                        s.pending ? "opacity-60" : ""
                      }`}
                    >
                      <div className="min-w-0">
                        <span className="text-sm text-slate-900 font-medium block truncate">
                          {s.name}
                        </span>
                        <span className="text-[11px] text-slate-400">
                          {s.pending ? "saving…" : fmtTime(s.createdAt)}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 whitespace-nowrap">
                        <span className="text-sm font-semibold tabular-nums text-slate-900">
                          {fmtUsd(s.unitPrice * s.quantity)}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleUndo(s)}
                          disabled={s.pending || undoBusyId === s.id}
                          className="text-xs text-slate-500 hover:text-red-600 bg-transparent border border-slate-200 rounded px-2 py-1 cursor-pointer disabled:opacity-40 disabled:cursor-wait"
                        >
                          {undoBusyId === s.id ? "…" : "Undo"}
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
                <p className="text-[11px] text-slate-400 mt-2 mb-0">
                  Sales roll into one &ldquo;Market sales —{" "}
                  {event.name}&rdquo; entry, tied to this event&apos;s
                  P&amp;L and your Markets channel. SKU sales also
                  update stock and per-product margin.
                </p>
              </div>
            )}
          </>
        )}
      </div>

      {/* ── Price sheet ─────────────────────────────────────────── */}
      {priceSheet && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/40 flex items-end sm:items-center justify-center p-4"
          onClick={() => !priceSaving && setPriceSheet(null)}
        >
          <div
            className="bg-white rounded-2xl p-5 w-full max-w-sm"
            onClick={(ev) => ev.stopPropagation()}
          >
            <h3 className="text-base font-bold text-slate-900 m-0 mb-1">
              {priceSheet.sku.name}
            </h3>
            <p className="text-xs text-slate-500 m-0 mb-3">
              {priceSheet.logAfterSave
                ? "Set the booth price once — future taps log instantly."
                : "Update the booth price for this product."}
            </p>
            <div className="flex items-center gap-2 mb-4">
              <span className="text-2xl font-bold text-slate-400">$</span>
              <input
                type="number"
                inputMode="decimal"
                min="0.01"
                step="0.01"
                autoFocus
                value={priceInput}
                onChange={(ev) => setPriceInput(ev.target.value)}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter") handleSavePrice();
                }}
                placeholder="0.00"
                className="flex-1 text-2xl font-bold text-slate-900 border border-slate-300 rounded-lg px-3 py-2 w-full focus:outline-none focus:ring-2 focus:ring-blue-500/30 tabular-nums"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPriceSheet(null)}
                disabled={priceSaving}
                className="flex-1 py-2.5 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 cursor-pointer disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSavePrice}
                disabled={priceSaving}
                className="flex-1 py-2.5 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-sm font-semibold cursor-pointer border-0 disabled:opacity-60 inline-flex items-center justify-center gap-2"
              >
                {priceSaving && <Spinner size={12} color="white" />}
                {priceSheet.logAfterSave ? "Save & log sale" : "Save price"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Custom sale sheet ───────────────────────────────────── */}
      {customOpen && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/40 flex items-end sm:items-center justify-center p-4"
          onClick={() => setCustomOpen(false)}
        >
          <div
            className="bg-white rounded-2xl p-5 w-full max-w-sm"
            onClick={(ev) => ev.stopPropagation()}
          >
            <h3 className="text-base font-bold text-slate-900 m-0 mb-3">
              Custom sale
            </h3>
            <input
              type="text"
              value={customName}
              onChange={(ev) => setCustomName(ev.target.value)}
              placeholder="What sold? (optional)"
              className="w-full text-sm border border-slate-300 rounded-lg px-3 py-2.5 mb-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
            />
            <div className="flex items-center gap-2 mb-4">
              <span className="text-2xl font-bold text-slate-400">$</span>
              <input
                type="number"
                inputMode="decimal"
                min="0.01"
                step="0.01"
                autoFocus
                value={customPrice}
                onChange={(ev) => setCustomPrice(ev.target.value)}
                onKeyDown={(ev) => {
                  if (ev.key === "Enter") handleCustomSale();
                }}
                placeholder="0.00"
                className="flex-1 text-2xl font-bold text-slate-900 border border-slate-300 rounded-lg px-3 py-2 w-full focus:outline-none focus:ring-2 focus:ring-blue-500/30 tabular-nums"
              />
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setCustomOpen(false)}
                className="flex-1 py-2.5 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleCustomSale}
                className="flex-1 py-2.5 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-sm font-semibold cursor-pointer border-0"
              >
                Log sale
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
