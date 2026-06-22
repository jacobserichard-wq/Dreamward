// app/components/reports/InventoryCogsReport.tsx
//
// "Inventory & COGS" business report. Bridges the inventory page to the
// tax report: current stock value + per-SKU breakdown, the period's COGS
// (line-item engine), and the year's beginning/ending inventory value
// (Form 1125-A). All-channels (inventory is global), so no channel
// filter; the period drives COGS and the year drives inventory valuation.
//
//   /api/inventory             -> items + totalValue (now)
//   /api/cogs/summary?from&to  -> period COGS
//   /api/reports/annual?year=Y -> beginning/ending inventory valuation

"use client";

import { useCallback, useEffect, useState } from "react";
import ReportExportButtons from "./ReportExportButtons";
import type { ReportExportSpec } from "./reportExport";

interface InvItem {
  id: number;
  code: string | null;
  name: string;
  unit: string;
  quantityOnHand: number;
  currentCost: number | null;
  stockValue: number;
}
interface InventoryResp {
  items: InvItem[];
  totals: { totalValue: number };
}
interface CogsResp {
  totals: { cogs: number };
}
interface AnnualResp {
  inventoryValuation: {
    beginning: number | null;
    ending: number | null;
    endingIsLive: boolean;
  };
}

export interface InventoryCogsReportProps {
  from: string;
  to: string;
  periodLabel: string;
}

function fmtUsd(n: number | null): string {
  if (n == null) return "—";
  const abs = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return n < 0 ? `-$${abs}` : `$${abs}`;
}

export default function InventoryCogsReport({
  from,
  to,
  periodLabel,
}: InventoryCogsReportProps) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<InvItem[]>([]);
  const [stockValue, setStockValue] = useState(0);
  const [cogs, setCogs] = useState(0);
  const [valuation, setValuation] = useState<AnnualResp["inventoryValuation"]>({
    beginning: null,
    ending: null,
    endingIsLive: false,
  });

  const year = Number(to.slice(0, 4));

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [invRes, cogsRes, annualRes] = await Promise.all([
        fetch("/api/inventory"),
        fetch(`/api/cogs/summary?from=${from}&to=${to}`),
        fetch(`/api/reports/annual?year=${year}`),
      ]);
      if (!invRes.ok) throw new Error(`Inventory HTTP ${invRes.status}`);
      const inv = (await invRes.json()) as InventoryResp;
      setItems(
        inv.items
          .filter((i) => i.quantityOnHand !== 0 || i.stockValue !== 0)
          .sort((a, b) => b.stockValue - a.stockValue)
      );
      setStockValue(inv.totals.totalValue);
      if (cogsRes.ok) {
        const c = (await cogsRes.json()) as CogsResp;
        setCogs(c.totals.cogs);
      }
      if (annualRes.ok) {
        const a = (await annualRes.json()) as AnnualResp;
        setValuation(a.inventoryValuation);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load inventory");
    } finally {
      setLoading(false);
    }
  }, [from, to, year]);

  useEffect(() => {
    void load();
  }, [load]);

  const buildSpec = (): ReportExportSpec => ({
    filename: `inventory-cogs-${from}_${to}`,
    title: "Inventory & COGS",
    meta: [
      `Period (COGS): ${periodLabel}`,
      `Inventory valuation year: ${year}`,
    ],
    tables: [
      {
        heading: "Summary",
        columns: ["Metric", "Value"],
        rows: [
          ["Current inventory value", fmtUsd(stockValue)],
          ["COGS (period)", fmtUsd(cogs)],
          [`Beginning inventory (${year})`, fmtUsd(valuation.beginning)],
          [`Ending inventory (${year})`, fmtUsd(valuation.ending)],
        ],
      },
      {
        heading: "Stock by SKU",
        columns: ["SKU", "On hand", "Unit cost", "Value"],
        rows: items.map((i) => [
          `${i.code ? i.code + " " : ""}${i.name}`,
          `${i.quantityOnHand}${i.unit && i.unit !== "each" ? " " + i.unit : ""}`,
          fmtUsd(i.currentCost),
          fmtUsd(i.stockValue),
        ]),
      },
    ],
  });

  if (loading) {
    return (
      <p className="text-center py-12 text-slate-500 text-sm">
        Loading inventory…
      </p>
    );
  }
  if (error) return <p className="text-sm text-red-700 py-4">{error}</p>;

  const kpis = [
    { label: "Inventory value (now)", value: fmtUsd(stockValue) },
    { label: "COGS (period)", value: fmtUsd(cogs) },
    { label: `Beginning inv. (${year})`, value: fmtUsd(valuation.beginning) },
    {
      label: `Ending inv. (${year})`,
      value: fmtUsd(valuation.ending),
      note: valuation.endingIsLive ? "live" : undefined,
    },
  ];

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-1 flex-wrap">
        <div>
          <h2 className="text-xl font-bold text-slate-900 m-0">
            Inventory &amp; COGS
          </h2>
          <p className="text-xs text-slate-500 m-0">
            {periodLabel} · stock value + cost of goods
          </p>
        </div>
        <ReportExportButtons buildSpec={buildSpec} />
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-4">
        {kpis.map((k) => (
          <div
            key={k.label}
            className="bg-white border border-slate-200 rounded-xl p-4"
          >
            <p className="text-[10px] uppercase tracking-wide text-slate-500 m-0 mb-1">
              {k.label}
            </p>
            <p className="text-xl font-bold text-slate-900 m-0 tabular-nums">
              {k.value}
            </p>
            {k.note && (
              <p className="text-[11px] text-slate-400 m-0 mt-0.5">{k.note}</p>
            )}
          </div>
        ))}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl p-5 mt-4">
        <h3 className="text-sm font-semibold text-slate-700 m-0 mb-3 uppercase tracking-wide">
          Stock by SKU
        </h3>
        {items.length === 0 ? (
          <p className="text-center py-6 text-slate-400 text-sm">
            No stock on hand.
          </p>
        ) : (
          <>
            <div className="flex items-center gap-3 px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              <span className="flex-1">SKU</span>
              <span className="w-24 text-right">On hand</span>
              <span className="w-24 text-right">Unit cost</span>
              <span className="w-24 text-right">Value</span>
            </div>
            <ul className="m-0 p-0 list-none">
              {items.map((i) => (
                <li
                  key={i.id}
                  className="flex items-center gap-3 px-1 py-2 border-t border-slate-100"
                >
                  <span className="flex-1 min-w-0 text-sm text-slate-800 truncate">
                    {i.code && (
                      <span className="font-mono text-slate-500 mr-1.5">
                        {i.code}
                      </span>
                    )}
                    {i.name}
                  </span>
                  <span className="w-24 text-right text-sm tabular-nums text-slate-700">
                    {i.quantityOnHand.toLocaleString()}
                    {i.unit && i.unit !== "each" ? ` ${i.unit}` : ""}
                  </span>
                  <span className="w-24 text-right text-sm tabular-nums text-slate-500">
                    {fmtUsd(i.currentCost)}
                  </span>
                  <span className="w-24 text-right text-sm tabular-nums font-semibold text-slate-900">
                    {fmtUsd(i.stockValue)}
                  </span>
                </li>
              ))}
              <li className="flex items-center gap-3 px-1 py-2.5 border-t-2 border-slate-200 font-bold text-slate-900">
                <span className="flex-1 text-sm">Total</span>
                <span className="w-24" />
                <span className="w-24" />
                <span className="w-24 text-right text-sm tabular-nums">
                  {fmtUsd(stockValue)}
                </span>
              </li>
            </ul>
          </>
        )}
        <p className="text-[11px] text-slate-400 m-0 mt-3">
          Beginning/ending inventory feed Form 1125-A; COGS is the line-item
          product cost for the period. Not tax advice — verify with your CPA.
        </p>
      </div>
    </div>
  );
}
