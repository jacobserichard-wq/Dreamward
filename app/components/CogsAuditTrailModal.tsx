// app/components/CogsAuditTrailModal.tsx
//
// Phase 12f commit 3 of 3. The "show your work" modal opened
// from any drillable cell on /cogs. Shows the exact line items
// that contributed to the cell's revenue and COGS, with the
// specific sku_cost_history row used per line.
//
// This is the visible audit trail that directly counters Crafty
// Base's "Opaque Costing Calculations" complaint. A merchant can
// re-derive every COGS number in a spreadsheet from what this
// modal shows.

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

export type CogsDrillScope = "totals" | "channel" | "sku" | "unmatched";

export interface CogsDrillScopeOpts {
  scope: CogsDrillScope;
  /** For scope=channel: channel id string OR "null" for the
   *  uncategorized bucket. For scope=sku: skuId as string. */
  id?: string;
  /** Human label rendered in the modal header. */
  label: string;
}

/** One FIFO layer this sale drained, oldest first. */
interface CostLayer {
  layerId: number;
  source: string;
  acquiredAt: string;
  unitCost: number;
  quantity: number;
  isEstimated: boolean;
}

interface AuditLineItem {
  id: number;
  parentId: number;
  parentSource: string | null;
  parentSourceRefId: string | null;
  parentChannel: string | null;
  parentVendor: string | null;
  parentInvoiceNumber: string | null;
  platform: string;
  externalId: string;
  externalItemId: string | null;
  name: string;
  quantity: number;
  unitPrice: number;
  revenue: number;
  currency: string;
  soldAt: string;
  matchedSkuId: number | null;
  matchedSkuCode: string | null;
  matchedSkuName: string | null;
  costLayers: CostLayer[];
  cogsIsEstimated: boolean;
  cogs: number;
}

interface DrillResponse {
  lineItems: AuditLineItem[];
  summary: {
    revenue: number;
    cogs: number;
    margin: number;
    marginPercent: number | null;
    unmatchedRevenue: number;
    unmatchedLineItemCount: number;
    totalLineItemCount: number;
  };
  truncated: boolean;
}

export interface CogsAuditTrailModalProps {
  open: boolean;
  scope: CogsDrillScopeOpts | null;
  /** ISO YYYY-MM-DD period bounds — same as /cogs current selection. */
  from: string;
  to: string;
  onClose: () => void;
}

function fmtUsd(n: number): string {
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${months[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

export default function CogsAuditTrailModal({
  open,
  scope,
  from,
  to,
  onClose,
}: CogsAuditTrailModalProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DrillResponse | null>(null);

  const load = useCallback(async () => {
    if (!scope) return;
    setLoading(true);
    setError(null);
    try {
      const url = new URL("/api/cogs/drill", window.location.origin);
      url.searchParams.set("from", from);
      url.searchParams.set("to", to);
      url.searchParams.set("scope", scope.scope);
      if (scope.id != null) url.searchParams.set("id", scope.id);
      const res = await fetch(url.toString());
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || `HTTP ${res.status}`);
        return;
      }
      const payload = (await res.json()) as DrillResponse;
      setData(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load audit");
    } finally {
      setLoading(false);
    }
  }, [scope, from, to]);

  // Fetch fresh on every open (period or scope changes silently
  // close + re-open this modal so the existing useEffect re-fires)
  useEffect(() => {
    if (open) {
      setData(null);
      load();
    }
  }, [open, load]);

  // Esc to close
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  // Sort: highest revenue first so the most impactful rows are on top
  const sortedRows = useMemo(() => {
    if (!data) return [];
    return [...data.lineItems].sort((a, b) => b.revenue - a.revenue);
  }, [data]);

  if (!open || !scope) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="audit-trail-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white rounded-xl shadow-2xl max-w-5xl w-full p-6 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-start justify-between gap-3 mb-1">
          <h2
            id="audit-trail-title"
            className="text-lg font-bold text-slate-900 m-0"
          >
            Audit trail: {scope.label}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 bg-transparent border-0 text-xl leading-none cursor-pointer"
            aria-label="Close"
          >
            {"\u{00D7}"}
          </button>
        </div>
        <p className="text-xs text-slate-500 m-0 mb-4">
          Every line item below contributed to that cell. The{" "}
          <strong>cost source</strong> column shows the exact
          sku_cost_history row used — the effective date is on or
          before the sale date, so historical sales keep their
          historical cost.
        </p>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-800 px-3 py-2 rounded-lg mb-3 text-sm">
            {error}
          </div>
        )}

        {/* Headline summary */}
        {data && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
            <SummaryChip label="Revenue" value={fmtUsd(data.summary.revenue)} />
            <SummaryChip label="COGS" value={fmtUsd(data.summary.cogs)} />
            <SummaryChip
              label="Margin"
              value={fmtUsd(data.summary.margin)}
              highlight
            />
            <SummaryChip
              label="Line items"
              value={`${data.summary.totalLineItemCount}${data.truncated ? "+" : ""}`}
              sub={
                data.summary.unmatchedLineItemCount > 0
                  ? `${data.summary.unmatchedLineItemCount} unmatched`
                  : undefined
              }
            />
          </div>
        )}

        {loading ? (
          <p className="text-center p-10 text-slate-500">
            Loading line items…
          </p>
        ) : !data || data.lineItems.length === 0 ? (
          <p className="text-center p-10 text-slate-500 text-sm">
            No line items in this slice.
          </p>
        ) : (
          <>
            <div className="border border-slate-200 rounded-lg overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-slate-50">
                  <tr className="text-[10px] uppercase tracking-wide text-slate-500 border-b border-slate-200">
                    <th className="text-left py-2 px-3 font-medium">Date</th>
                    <th className="text-left py-2 px-3 font-medium">
                      Source / order
                    </th>
                    <th className="text-left py-2 px-3 font-medium">Item</th>
                    <th className="text-right py-2 px-3 font-medium">Qty</th>
                    <th className="text-right py-2 px-3 font-medium">
                      Unit price
                    </th>
                    <th className="text-right py-2 px-3 font-medium">Revenue</th>
                    <th className="text-left py-2 px-3 font-medium">SKU</th>
                    <th className="text-left py-2 px-3 font-medium">
                      FIFO layers
                    </th>
                    <th className="text-right py-2 px-3 font-medium">
                      Cost/unit
                    </th>
                    <th className="text-right py-2 px-3 font-medium">COGS</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((r) => (
                    <tr
                      key={r.id}
                      className="border-b border-slate-100 last:border-b-0"
                    >
                      <td className="py-2 px-3 text-slate-600 whitespace-nowrap">
                        {fmtDate(r.soldAt)}
                      </td>
                      <td className="py-2 px-3 text-slate-700">
                        <span className="text-slate-400 mr-1">
                          {r.parentSource ?? "—"}
                        </span>
                        {r.parentInvoiceNumber ?? r.parentSourceRefId ?? "—"}
                      </td>
                      <td className="py-2 px-3 text-slate-800 truncate max-w-[220px]">
                        {r.name}
                      </td>
                      <td className="py-2 px-3 text-right text-slate-700 tabular-nums">
                        {r.quantity}
                      </td>
                      <td className="py-2 px-3 text-right text-slate-700 tabular-nums whitespace-nowrap">
                        {fmtUsd(r.unitPrice)}
                      </td>
                      <td className="py-2 px-3 text-right text-slate-900 font-semibold tabular-nums whitespace-nowrap">
                        {fmtUsd(r.revenue)}
                      </td>
                      <td className="py-2 px-3 text-slate-700">
                        {r.matchedSkuCode ? (
                          <span className="font-mono">{r.matchedSkuCode}</span>
                        ) : (
                          <span className="text-amber-700 italic">
                            unmatched
                          </span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-slate-500 text-[10px]">
                        {r.costLayers.length > 0 ? (
                          <div className="space-y-0.5">
                            {r.costLayers.map((l) => (
                              <div key={l.layerId}>
                                {l.quantity} @ {fmtUsd(l.unitCost)}
                                <span className="text-slate-400">
                                  {" "}
                                  · {fmtDate(l.acquiredAt)}
                                </span>
                              </div>
                            ))}
                            {r.cogsIsEstimated && (
                              <div className="text-amber-700 italic">
                                + estimated (low stock)
                              </div>
                            )}
                          </div>
                        ) : r.matchedSkuId == null ? (
                          <span className="italic">no SKU mapped</span>
                        ) : r.cogsIsEstimated ? (
                          <span className="text-amber-700 italic">
                            estimated — no cost layer
                          </span>
                        ) : (
                          <span className="italic">—</span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-right text-slate-700 tabular-nums whitespace-nowrap">
                        {r.quantity > 0 && r.cogs > 0
                          ? fmtUsd(r.cogs / r.quantity)
                          : "—"}
                      </td>
                      <td className="py-2 px-3 text-right text-slate-900 font-semibold tabular-nums whitespace-nowrap">
                        {fmtUsd(r.cogs)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {data.truncated && (
              <p className="text-xs text-amber-700 m-0 mt-2 italic">
                Showing first 1,000 line items — narrow the period or
                filter by channel/SKU to see all.
              </p>
            )}
          </>
        )}

        <div className="flex justify-end mt-5">
          <button
            type="button"
            onClick={onClose}
            className="py-2 px-4 text-sm font-semibold text-white bg-blue-500 hover:bg-blue-600 rounded-lg border-0 cursor-pointer"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function SummaryChip({
  label,
  value,
  sub,
  highlight,
}: {
  label: string;
  value: string;
  sub?: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-2.5 ${highlight ? "bg-emerald-50 border-emerald-200" : "bg-white border-slate-200"}`}
    >
      <p className="text-[10px] uppercase tracking-wide text-slate-500 m-0 mb-0.5">
        {label}
      </p>
      <p
        className={`text-sm font-bold m-0 tabular-nums ${highlight ? "text-emerald-800" : "text-slate-900"}`}
      >
        {value}
      </p>
      {sub && (
        <p className="text-[10px] text-slate-500 m-0 mt-0.5">{sub}</p>
      )}
    </div>
  );
}
