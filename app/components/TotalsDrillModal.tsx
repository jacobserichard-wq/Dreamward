// app/components/TotalsDrillModal.tsx
//
// Drill-down modal for the dashboard's big totals. Clicking Total
// Sales / Total Expenses / Net Profit opens this and lists the
// itemized contributors that sum to the headline number, fetched from
// /api/profitability/drill (which mirrors the channel math so the list
// reconciles).
//
// mode 'net' shows the Sales − Expenses = Net reconciliation up top
// (using the figures already on the dashboard) plus a Sales/Expenses
// tab toggle to drill either side. mode 'income'/'expense' opens
// straight to that list.

"use client";

import { useCallback, useEffect, useState } from "react";
import { parseKey, monthBounds, monthSelectionLabel } from "./MonthFilterPill";

type DrillKind = "income" | "expense";

interface DrillRow {
  label: string;
  sublabel: string | null;
  amount: number;
  date: string | null;
  kind: "txn" | "event";
}

export interface TotalsDrillModalProps {
  open: boolean;
  mode: "income" | "expense" | "net";
  /** Selected months as "YYYY-MM" keys (from the Totals filter). */
  months: string[];
  totals: { sales: number; expenses: number; net: number };
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

export default function TotalsDrillModal({
  open,
  mode,
  months,
  totals,
  onClose,
}: TotalsDrillModalProps) {
  const [activeKind, setActiveKind] = useState<DrillKind>(
    mode === "expense" ? "expense" : "income"
  );
  const [rows, setRows] = useState<DrillRow[]>([]);
  const [fetchedTotal, setFetchedTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Reset the active tab whenever the modal (re)opens for a mode.
  useEffect(() => {
    if (!open) return;
    setActiveKind(mode === "expense" ? "expense" : "income");
  }, [open, mode]);

  const load = useCallback(
    async (kind: DrillKind) => {
      setLoading(true);
      setError(null);
      try {
        if (months.length === 0) {
          setRows([]);
          setFetchedTotal(0);
          return;
        }
        const today = new Date();
        const parts = await Promise.all(
          months.map(async (k) => {
            const { year, monthIdx } = parseKey(k);
            const { from, to } = monthBounds(year, monthIdx, today);
            const url = new URL(
              "/api/profitability/drill",
              window.location.origin
            );
            url.searchParams.set("from", from);
            url.searchParams.set("to", to);
            url.searchParams.set("kind", kind);
            const res = await fetch(url.toString());
            if (!res.ok) {
              const body = await res.json().catch(() => ({}));
              throw new Error(body.error || `HTTP ${res.status}`);
            }
            return (await res.json()) as { rows: DrillRow[]; total: number };
          })
        );
        setRows(
          parts
            .flatMap((p) => p.rows ?? [])
            .sort((a, b) => b.amount - a.amount)
        );
        setFetchedTotal(parts.reduce((s, p) => s + (p.total ?? 0), 0));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't load details");
      } finally {
        setLoading(false);
      }
    },
    [months]
  );

  useEffect(() => {
    if (!open) return;
    void load(activeKind);
  }, [open, activeKind, load]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  const title =
    mode === "net"
      ? "Net profit"
      : mode === "expense"
        ? "Total expenses"
        : "Total sales";
  const showTabs = mode === "net";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="totals-drill-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-xl shadow-2xl max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto"
      >
        <h2
          id="totals-drill-title"
          className="text-lg font-bold text-slate-900 m-0 mb-1"
        >
          {title}
        </h2>
        <p className="text-xs text-slate-500 m-0 mb-4">
          What makes up this number — {monthSelectionLabel(months)}.
        </p>

        {/* Net reconciliation header */}
        {mode === "net" && (
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 mb-4 flex items-center justify-between gap-2 flex-wrap text-sm">
            <span className="text-slate-600">
              Sales{" "}
              <span className="font-semibold text-emerald-700">
                {fmtUsd(totals.sales)}
              </span>
            </span>
            <span className="text-slate-400">−</span>
            <span className="text-slate-600">
              Expenses{" "}
              <span className="font-semibold text-slate-800">
                {fmtUsd(totals.expenses)}
              </span>
            </span>
            <span className="text-slate-400">=</span>
            <span className="text-slate-600">
              Net{" "}
              <span
                className={`font-bold ${totals.net < 0 ? "text-red-700" : "text-emerald-700"}`}
              >
                {fmtUsd(totals.net)}
              </span>
            </span>
          </div>
        )}

        {/* Tabs (net mode) */}
        {showTabs && (
          <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1 w-fit mb-4">
            {(["income", "expense"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setActiveKind(k)}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold cursor-pointer border-0 transition-colors ${
                  activeKind === k
                    ? "bg-white text-slate-900 shadow-sm"
                    : "bg-transparent text-slate-500 hover:text-slate-700"
                }`}
              >
                {k === "income" ? "Sales" : "Expenses"}
              </button>
            ))}
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-800 px-3 py-2 rounded-lg mb-3 text-sm">
            {error}
          </div>
        )}

        {loading ? (
          <p className="text-center py-8 text-slate-400 text-sm">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="text-center py-8 text-slate-400 text-sm border border-slate-100 rounded-lg">
            No {activeKind === "income" ? "sales" : "expenses"} recorded for
            the selected months.
          </p>
        ) : (
          <>
            <ul className="m-0 p-0 border border-slate-100 rounded-lg divide-y divide-slate-100">
              {rows.map((r, i) => (
                <li
                  key={i}
                  className="flex items-center justify-between gap-3 px-3 py-2.5 list-none"
                >
                  <div className="min-w-0">
                    <div className="text-sm text-slate-900 truncate">
                      {r.label}
                    </div>
                    <div className="text-xs text-slate-400">
                      {r.sublabel ? `${r.sublabel} · ` : ""}
                      {fmtDate(r.date)}
                    </div>
                  </div>
                  <span className="text-sm font-semibold text-slate-900 tabular-nums whitespace-nowrap">
                    {fmtUsd(r.amount)}
                  </span>
                </li>
              ))}
            </ul>
            <div className="flex items-center justify-between mt-3 px-1">
              <span className="text-xs text-slate-500">
                {rows.length} item{rows.length === 1 ? "" : "s"}
              </span>
              <span className="text-sm font-bold text-slate-900 tabular-nums">
                Total {fmtUsd(fetchedTotal)}
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
