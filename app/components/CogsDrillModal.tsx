// app/components/CogsDrillModal.tsx
//
// Drill-down for the dashboard "Profit margin" card. Clicking the
// Revenue / COGS / Margin number opens this and lists the individual
// sale line items that make up the figure — name, channel, date, and
// the revenue / COGS / margin for each.
//
// Fetches /api/cogs/drill (scope=totals) once per selected month and
// concatenates, so it matches the card's month-checklist selection and
// reconciles to the card's totals. Unmatched line items (no SKU)
// contribute revenue but zero COGS, surfaced with an "Unmatched" tag.

"use client";

import { useCallback, useEffect, useState } from "react";

interface DrillLineItem {
  id: number;
  name: string;
  parentChannel: string | null;
  platform: string;
  quantity: number;
  revenue: number;
  cogs: number;
  soldAt: string;
  matchedSkuId: number | null;
  matchedSkuCode: string | null;
}

export interface CogsDrillModalProps {
  open: boolean;
  /** Selected months as "YYYY-MM" keys (from the card). */
  months: string[];
  /** Which figure was clicked — sets the title + the sort column. */
  focus: "revenue" | "cogs" | "margin";
  /** Human label for the period (e.g. "Year to date · 2026"). */
  periodLabel: string;
  onClose: () => void;
}

function fmtUsd(n: number): string {
  const abs = Math.abs(n).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return n < 0 ? `-$${abs}` : `$${abs}`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso ?? "—";
  const months = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${months[Number(m[2]) - 1]} ${Number(m[3])}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}
function isoDate(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}
function monthBounds(year: number, monthIdx: number, today: Date) {
  const from = `${year}-${pad2(monthIdx + 1)}-01`;
  const lastDay = new Date(Date.UTC(year, monthIdx + 1, 0)).getUTCDate();
  let to = `${year}-${pad2(monthIdx + 1)}-${pad2(lastDay)}`;
  const todayStr = isoDate(today);
  if (to > todayStr) to = todayStr;
  return { from, to };
}

export default function CogsDrillModal({
  open,
  months,
  focus,
  periodLabel,
  onClose,
}: CogsDrillModalProps) {
  const [rows, setRows] = useState<DrillLineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (months.length === 0) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const today = new Date();
      const parts = await Promise.all(
        months.map(async (k) => {
          const [y, m] = k.split("-").map(Number);
          const { from, to } = monthBounds(y, m - 1, today);
          const url = new URL("/api/cogs/drill", window.location.origin);
          url.searchParams.set("scope", "totals");
          url.searchParams.set("from", from);
          url.searchParams.set("to", to);
          const res = await fetch(url.toString());
          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.error || `HTTP ${res.status}`);
          }
          const payload = (await res.json()) as { lineItems: DrillLineItem[] };
          return payload.lineItems ?? [];
        })
      );
      setRows(parts.flat());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load details");
    } finally {
      setLoading(false);
    }
  }, [months]);

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

  const sorted = [...rows].sort((a, b) => {
    if (focus === "cogs") return b.cogs - a.cogs;
    if (focus === "margin") return b.revenue - b.cogs - (a.revenue - a.cogs);
    return b.revenue - a.revenue;
  });

  const totalRevenue = rows.reduce((s, r) => s + r.revenue, 0);
  const totalCogs = rows.reduce((s, r) => s + r.cogs, 0);
  const totalMargin = totalRevenue - totalCogs;

  const title =
    focus === "cogs"
      ? "COGS detail"
      : focus === "margin"
        ? "Margin detail"
        : "Revenue detail";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="cogs-drill-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-xl shadow-2xl max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto"
      >
        <h2
          id="cogs-drill-title"
          className="text-lg font-bold text-slate-900 m-0 mb-1"
        >
          {title}
        </h2>
        <p className="text-xs text-slate-500 m-0 mb-4">
          Every sale line item for {periodLabel.replace(/ · .*/, "")}.
        </p>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-800 px-3 py-2 rounded-lg mb-3 text-sm">
            {error}
          </div>
        )}

        {loading ? (
          <p className="text-center py-8 text-slate-400 text-sm">Loading…</p>
        ) : sorted.length === 0 ? (
          <p className="text-center py-8 text-slate-400 text-sm border border-slate-100 rounded-lg">
            No itemized sales for this period.
          </p>
        ) : (
          <>
            {/* Column header */}
            <div className="flex items-center gap-3 px-3 pb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              <span className="flex-1">Item</span>
              <span className="w-20 text-right">Revenue</span>
              <span className="w-16 text-right">COGS</span>
              <span className="w-20 text-right">Margin</span>
            </div>
            <ul className="m-0 p-0 border border-slate-100 rounded-lg divide-y divide-slate-100">
              {sorted.map((r) => {
                const margin = r.revenue - r.cogs;
                return (
                  <li
                    key={r.id}
                    className="flex items-center gap-3 px-3 py-2.5 list-none"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-slate-900 truncate">
                        {r.name}
                        {r.matchedSkuId == null && (
                          <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 text-[10px] font-semibold align-middle">
                            Unmatched
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-400 truncate">
                        {r.matchedSkuCode ? `${r.matchedSkuCode} · ` : ""}
                        {r.parentChannel || r.platform || "—"} ·{" "}
                        {fmtDate(r.soldAt)}
                        {r.quantity ? ` · ×${r.quantity.toLocaleString()}` : ""}
                      </div>
                    </div>
                    <span className="w-20 text-right text-sm tabular-nums text-slate-900">
                      {fmtUsd(r.revenue)}
                    </span>
                    <span className="w-16 text-right text-sm tabular-nums text-slate-600">
                      {fmtUsd(r.cogs)}
                    </span>
                    <span
                      className={`w-20 text-right text-sm font-semibold tabular-nums ${
                        margin < 0 ? "text-red-700" : "text-slate-900"
                      }`}
                    >
                      {fmtUsd(margin)}
                    </span>
                  </li>
                );
              })}
            </ul>
            {/* Totals footer */}
            <div className="flex items-center gap-3 px-3 pt-2 mt-1 border-t border-slate-200 text-sm font-bold text-slate-900">
              <span className="flex-1">Total ({rows.length})</span>
              <span className="w-20 text-right tabular-nums">
                {fmtUsd(totalRevenue)}
              </span>
              <span className="w-16 text-right tabular-nums text-slate-600">
                {fmtUsd(totalCogs)}
              </span>
              <span
                className={`w-20 text-right tabular-nums ${
                  totalMargin < 0 ? "text-red-700" : "text-emerald-700"
                }`}
              >
                {fmtUsd(totalMargin)}
              </span>
            </div>
          </>
        )}

        <div className="flex justify-end mt-5">
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
