// app/skus/[id]/page.tsx
//
// Phase 12b commit 4 of 4. Detail page for a single SKU.
//
// Sections:
//   1. Header card with code + name + active chip + Edit button
//   2. Cost history table with × delete buttons (typo escape hatch)
//   3. Inline "Add new cost" form (the primary cost-change path)
//   4. Platform aliases list (display only; create UI ships in
//      Phase 12d's bulk-match page)
//
// The Edit button re-uses the SkuForm modal from the list page so
// the name + description + archive UX is consistent across both
// surfaces.
//
// Data shape from GET /api/skus/[id]:
//   { sku: SkuRow, costHistory: CostHistoryRow[], aliases: AliasRow[] }
//
// On any mutation (edit / add cost / delete cost / archive /
// restore), we re-fetch the full payload rather than try to
// reconstruct local state across three related lists. The detail
// page is a single tab; a fresh fetch is cheap.

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import PageHeader from "../../components/PageHeader";
import AppHeader from "../../components/AppHeader";
import ErrorBanner from "../../components/ErrorBanner";
import Spinner from "../../components/Spinner";
import SkuForm, {
  type SkuFormEditSubmit,
} from "../../components/SkuForm";
import ConfirmModal from "../../components/ConfirmModal";
import ReceiveStockModal from "../../components/ReceiveStockModal";
import RecipeSection from "../../components/RecipeSection";

interface SkuRow {
  id: number;
  code: string;
  name: string;
  description: string | null;
  active: boolean;
  currentCost: number | null;
  costCurrency: string | null;
  costEffectiveDate: string | null;
  salesCount: number;
  lastSaleDate: string | null;
  // Sub-session 33 Tier 1 commit 3: stock cache from migration 0020.
  // Drives the Stock section + the Receive Stock modal's current
  // count display.
  quantityOnHand: number;
  createdAt: string;
  updatedAt: string;
}

interface CostHistoryRow {
  id: number;
  cost: number;
  currency: string;
  effectiveDate: string;
  notes: string | null;
  createdAt: string;
  /** How many historical line items resolve their COGS through
   *  this row. > 0 → edit/delete shows a confirm-modal warning
   *  that the action will rewrite recorded historical COGS. */
  affectedLineItemCount: number;
}

interface AliasRow {
  id: number;
  platform: string;
  externalId: string;
  externalSku: string | null;
  createdAt: string;
}

interface SkuDetailResponse {
  sku: SkuRow;
  costHistory: CostHistoryRow[];
  aliases: AliasRow[];
}

// Sub-session 33 Tier 1 commit 4: stock history row shape mirrors
// the API response from /api/skus/[id]/inventory/history.
interface InventoryHistoryRow {
  id: number;
  delta: number;
  reason: "sale" | "receive" | "manual" | "recount" | "correction";
  notes: string | null;
  sourceLineItemId: number | null;
  runningBalance: number;
  createdAt: string;
}

interface InventoryHistoryResponse {
  adjustments: InventoryHistoryRow[];
  totalCount: number;
}

const REASON_LABELS: Record<InventoryHistoryRow["reason"], string> = {
  sale: "Sale",
  receive: "Received",
  manual: "Manual adjustment",
  recount: "Recount",
  correction: "Correction",
};

function fmtMoney(n: number, currency: string): string {
  const sym = currency === "USD" || !currency ? "$" : `${currency} `;
  return `${sym}${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  })}`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const monthNames = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${monthNames[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

function todayIso(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function platformLabel(p: string): { label: string; icon: string } {
  switch (p) {
    case "shopify":
      return { label: "Shopify", icon: "\u{1F6CD}" };
    case "wix":
      return { label: "Wix", icon: "\u{1F310}" };
    case "square":
      return { label: "Square", icon: "\u{25A0}" };
    default:
      return { label: p, icon: "" };
  }
}

export default function SkuDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const skuId = Number(params?.id);

  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<SkuDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [notFound, setNotFound] = useState(false);

  // ── Add-cost inline form state ────────────────────────────────
  const [newCost, setNewCost] = useState("");
  const [newDate, setNewDate] = useState(todayIso());
  const [newNotes, setNewNotes] = useState("");
  const [addingCost, setAddingCost] = useState(false);

  // ── Edit modal state ──────────────────────────────────────────
  const [editOpen, setEditOpen] = useState(false);

  // ── Receive stock modal state (Tier 1 commit 3) ───────────────
  const [receiveOpen, setReceiveOpen] = useState(false);

  // ── Stock history state (Tier 1 commit 4) ─────────────────────
  // Loaded lazily — first fetch fires after the SKU detail loads.
  // Re-fetched after a successful receive so the new row shows up
  // at the top of the table.
  const [stockHistory, setStockHistory] = useState<InventoryHistoryRow[]>([]);
  const [stockHistoryTotal, setStockHistoryTotal] = useState<number>(0);
  const [stockHistoryLoading, setStockHistoryLoading] = useState(false);

  // ── Cost deletion state (which row is being deleted) ─────────
  const [deletingCostId, setDeletingCostId] = useState<number | null>(null);

  // Inline-edit state for cost amount in the history table.
  // editingCostId is the row currently in edit mode (null when none).
  const [editingCostId, setEditingCostId] = useState<number | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [savingCostId, setSavingCostId] = useState<number | null>(null);
  /** When the user acknowledges the historical-impact warning for
   *  an edit, we add the row id to this set. commitCostEdit reads
   *  it to know whether to pass acknowledgeHistoricalChange: true
   *  to the PATCH endpoint. Cleared after the save commits. */
  const [ackedHistoricalIds, setAckedHistoricalIds] = useState<Set<number>>(
    new Set()
  );

  // Historical-impact confirm modal state. Fires when the user
  // tries to edit or delete a cost row that has affected line
  // items (the operation would silently rewrite historical COGS).
  const [historicalConfirm, setHistoricalConfirm] = useState<{
    kind: "edit" | "delete";
    row: CostHistoryRow;
  } | null>(null);
  const [historicalConfirmBusy, setHistoricalConfirmBusy] = useState(false);

  const loadDetail = useCallback(async () => {
    if (!Number.isFinite(skuId)) return;
    try {
      const res = await fetch(`/api/skus/${skuId}`);
      if (!res.ok) {
        if (res.status === 401) {
          router.replace(`/signin?callbackUrl=/skus/${skuId}`);
          return;
        }
        if (res.status === 403) {
          setForbidden(true);
          return;
        }
        if (res.status === 404) {
          setNotFound(true);
          return;
        }
        const body = await res.json().catch(() => ({}));
        setError(body.error || `HTTP ${res.status}`);
        return;
      }
      const payload = (await res.json()) as SkuDetailResponse;
      setData(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load SKU");
    }
  }, [skuId, router]);

  // Sub-session 33 Tier 1 commit 4: stock history loader. Separate
  // from loadDetail so the Stock section can refresh after a receive
  // without re-fetching cost history + aliases too.
  const loadStockHistory = useCallback(async () => {
    if (!Number.isFinite(skuId)) return;
    setStockHistoryLoading(true);
    try {
      const res = await fetch(`/api/skus/${skuId}/inventory/history?limit=50`);
      if (!res.ok) {
        // Non-fatal — the rest of the page still works. Log + leave
        // history empty so the empty-state row renders.
        console.error("Stock history load failed:", res.status);
        return;
      }
      const payload = (await res.json()) as InventoryHistoryResponse;
      setStockHistory(payload.adjustments);
      setStockHistoryTotal(payload.totalCount);
    } catch (err) {
      console.error("Stock history load failed:", err);
    } finally {
      setStockHistoryLoading(false);
    }
  }, [skuId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Detail first so the page shell renders ASAP; history is
      // secondary and loads in parallel without blocking the shell.
      await loadDetail();
      if (!cancelled) setLoading(false);
      void loadStockHistory();
    })();
    return () => {
      cancelled = true;
    };
  }, [loadDetail, loadStockHistory]);

  // ── Mutation handlers ────────────────────────────────────────
  const handleSaveEdit = useCallback(
    async (form: SkuFormEditSubmit) => {
      const res = await fetch(`/api/skus/${skuId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      await loadDetail();
      setEditOpen(false);
    },
    [skuId, loadDetail]
  );

  const handleToggleActive = useCallback(
    async (newActive: boolean) => {
      const url = `/api/skus/${skuId}`;
      let res: Response;
      if (newActive) {
        res = await fetch(url, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ active: true }),
        });
      } else {
        res = await fetch(url, { method: "DELETE" });
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      await loadDetail();
      setEditOpen(false);
    },
    [skuId, loadDetail]
  );

  const handleAddCost = useCallback(async () => {
    setError(null);
    const cleaned = newCost.replace(/[$,\s]/g, "");
    const costNum = Number(cleaned);
    if (!Number.isFinite(costNum) || costNum < 0) {
      setError("Cost must be a non-negative number.");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) {
      setError("Effective date must be a valid date.");
      return;
    }
    setAddingCost(true);
    try {
      const res = await fetch(`/api/skus/${skuId}/costs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cost: costNum,
          effectiveDate: newDate,
          notes: newNotes.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || `HTTP ${res.status}`);
        return;
      }
      // Reset form + re-fetch the whole detail (current-cost may
      // have flipped if this row's effective_date is the newest
      // <= today).
      setNewCost("");
      setNewDate(todayIso());
      setNewNotes("");
      await loadDetail();
    } finally {
      setAddingCost(false);
    }
  }, [newCost, newDate, newNotes, skuId, loadDetail]);

  // ── Inline cost edit handlers ────────────────────────────────
  /** Internal: actually open the inline editor (skips any
   *  historical-impact gating — the gating wrapper below handles
   *  that decision). */
  const openCostEditor = useCallback((row: CostHistoryRow) => {
    setEditingCostId(row.id);
    setEditingValue(String(row.cost));
    setError(null);
  }, []);

  /** Public: user-facing click handler. Routes through the
   *  historical-impact confirm modal when affectedLineItemCount > 0
   *  so the merchant knows their edit will rewrite recorded COGS. */
  const startEditingCost = useCallback(
    (row: CostHistoryRow) => {
      if (row.affectedLineItemCount > 0) {
        setHistoricalConfirm({ kind: "edit", row });
        return;
      }
      openCostEditor(row);
    },
    [openCostEditor]
  );

  const cancelEditingCost = useCallback(() => {
    setEditingCostId(null);
    setEditingValue("");
  }, []);

  const commitCostEdit = useCallback(
    async (costRowId: number, originalCost: number) => {
      const cleaned = editingValue.replace(/[$,\s]/g, "");
      // Empty/identical → no-op, just close the editor
      if (cleaned === "" || cleaned === String(originalCost)) {
        cancelEditingCost();
        return;
      }
      const num = Number(cleaned);
      if (!Number.isFinite(num) || num < 0) {
        setError("Cost must be a non-negative number.");
        return;
      }
      setSavingCostId(costRowId);
      setError(null);
      try {
        const body: Record<string, unknown> = { cost: num };
        if (ackedHistoricalIds.has(costRowId)) {
          body.acknowledgeHistoricalChange = true;
        }
        const res = await fetch(
          `/api/skus/${skuId}/costs/${costRowId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }
        );
        if (!res.ok) {
          const bodyJson = await res.json().catch(() => ({}));
          setError(bodyJson.error || `HTTP ${res.status}`);
          return;
        }
        // Clear the ack flag for this row on successful save —
        // a future edit needs a fresh confirmation.
        setAckedHistoricalIds((prev) => {
          if (!prev.has(costRowId)) return prev;
          const next = new Set(prev);
          next.delete(costRowId);
          return next;
        });
        cancelEditingCost();
        await loadDetail();
      } finally {
        setSavingCostId(null);
      }
    },
    [editingValue, skuId, loadDetail, cancelEditingCost, ackedHistoricalIds]
  );

  /** Internal: the actual DELETE network call. Caller is
   *  responsible for any user confirmation. Returns true on
   *  success so the historical-confirm modal can close itself. */
  const runDeleteCost = useCallback(
    async (
      costRowId: number,
      acknowledgeHistoricalChange: boolean
    ): Promise<boolean> => {
      setError(null);
      setDeletingCostId(costRowId);
      try {
        const url = new URL(
          `/api/skus/${skuId}/costs/${costRowId}`,
          window.location.origin
        );
        if (acknowledgeHistoricalChange) {
          url.searchParams.set("acknowledgeHistoricalChange", "true");
        }
        const res = await fetch(url.toString(), { method: "DELETE" });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError(body.error || `HTTP ${res.status}`);
          return false;
        }
        await loadDetail();
        return true;
      } finally {
        setDeletingCostId(null);
      }
    },
    [skuId, loadDetail]
  );

  const handleDeleteCost = useCallback(
    async (row: CostHistoryRow) => {
      // Two tiers of confirmation:
      //   N > 0 → historical-impact ConfirmModal (handled by the
      //           modal at the bottom of the page; we open it here)
      //   N = 0 → native confirm — destructive but reversible
      //           via the inline add-cost form.
      if (row.affectedLineItemCount > 0) {
        setHistoricalConfirm({ kind: "delete", row });
        return;
      }
      if (
        !window.confirm(
          "Delete this cost row? Historical sales priced against it will fall back to the next-newest cost on their date."
        )
      ) {
        return;
      }
      await runDeleteCost(row.id, false);
    },
    [runDeleteCost]
  );

  // ── Identify which cost row is the "current" one (highlighted
  // in the table). It's the newest row with effective_date <=
  // today — same logic as the API's LATERAL subquery.
  const currentCostRowId = useMemo(() => {
    if (!data) return null;
    const today = todayIso();
    const active = data.costHistory
      .filter((r) => r.effectiveDate <= today)
      .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate));
    return active[0]?.id ?? null;
  }, [data]);

  // ── Soonest future-dated cost (for the "current cost is —"
  // explainer chip). Only computed when no current cost exists;
  // helps the merchant understand that the SKU isn't broken —
  // just hasn't started using any of its scheduled costs yet.
  const nextFutureCost = useMemo(() => {
    if (!data) return null;
    if (data.sku.currentCost != null) return null; // current cost exists, no explainer needed
    const today = todayIso();
    const future = data.costHistory
      .filter((r) => r.effectiveDate > today)
      .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
    return future[0] ?? null;
  }, [data]);

  // ── Render guards ────────────────────────────────────────────
  if (!Number.isFinite(skuId)) {
    return (
      <div className="min-h-screen bg-slate-50 font-sans">
        <AppHeader />
        <div className="max-w-[1100px] mx-auto py-8 px-4 sm:px-6">
          <PageHeader
            backHref="/skus"
            backLabel="SKUs"
            title="Invalid SKU"
            subtitle="The URL doesn't look right."
          />
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
            backHref="/skus"
            backLabel="SKUs"
            title="SKU details"
            subtitle="Pro feature"
          />
          <div className="bg-white rounded-xl border border-slate-200 py-12 px-6 text-center">
            <p className="text-base font-medium text-slate-700 m-0 mb-4">
              SKU catalog is part of FlowWork Pro.
            </p>
            <Link
              href="/upgrade"
              className="inline-block py-2 px-4 rounded-lg bg-blue-500 text-white text-sm font-semibold no-underline hover:bg-blue-600"
            >
              See Pro plans
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className="min-h-screen bg-slate-50 font-sans">
        <AppHeader />
        <div className="max-w-[1100px] mx-auto py-8 px-4 sm:px-6">
          <PageHeader
            backHref="/skus"
            backLabel="SKUs"
            title="SKU not found"
            subtitle="It may have been deleted or never existed."
          />
        </div>
      </div>
    );
  }

  if (loading || !data) {
    return (
      <div className="min-h-screen bg-slate-50 font-sans">
        <AppHeader />
        <div className="max-w-[1100px] mx-auto py-8 px-4 sm:px-6">
          <p className="text-center p-[60px] text-slate-500">Loading SKU…</p>
        </div>
      </div>
    );
  }

  const { sku, costHistory, aliases } = data;

  return (
    <div className="min-h-screen bg-slate-50 font-sans">
      <div className="max-w-[1100px] mx-auto py-8 px-4 sm:px-6">
        <PageHeader
          backHref="/skus"
          backLabel="SKUs"
          title={
            <span className="inline-flex items-center gap-3">
              <span className="font-mono">{sku.code}</span>
              <span className="text-slate-500 font-normal text-lg">
                {"·"}
              </span>
              <span>{sku.name}</span>
              {!sku.active && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-100 text-slate-500 text-xs font-medium uppercase tracking-wide">
                  Archived
                </span>
              )}
            </span>
          }
          subtitle={sku.description ?? undefined}
          rightSlot={
            <button
              type="button"
              onClick={() => setEditOpen(true)}
              className="py-2 px-4 rounded-lg border border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-medium cursor-pointer"
            >
              Edit details
            </button>
          }
        />

        {error && (
          <ErrorBanner message={error} onDismiss={() => setError(null)} />
        )}

        {/* Summary chips */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
          <SummaryChip
            label="Current cost"
            value={
              sku.currentCost != null
                ? fmtMoney(sku.currentCost, sku.costCurrency || "USD")
                : "—"
            }
            sub={
              sku.costEffectiveDate
                ? `effective ${fmtDate(sku.costEffectiveDate)}`
                : nextFutureCost
                  ? `next: ${fmtMoney(nextFutureCost.cost, nextFutureCost.currency)} starts ${fmtDate(nextFutureCost.effectiveDate)}`
                  : "no cost on or before today"
            }
          />
          <SummaryChip
            label="Sales mapped"
            value={sku.salesCount > 0 ? String(sku.salesCount) : "—"}
            sub={
              sku.lastSaleDate
                ? `last ${fmtDate(sku.lastSaleDate)}`
                : "no line items yet"
            }
          />
          <SummaryChip
            label="Aliases"
            value={String(aliases.length)}
            sub={
              aliases.length === 0
                ? "auto-fill begins with Phase 12c"
                : `across ${new Set(aliases.map((a) => a.platform)).size} platform${
                    new Set(aliases.map((a) => a.platform)).size === 1
                      ? ""
                      : "s"
                  }`
            }
          />
        </div>

        {/* Stock on hand (Sub-session 33 Tier 1 commit 3). Sits above
            Cost history because "do I have any" is the question
            merchants check first when opening a SKU. Color cues:
            red < 0 (data quality flag — sold more than received,
            usually means initial stock was never set), amber 1-10
            (low stock warning), green > 10 (healthy), slate = 0
            (out of stock — neutral, not alarming if expected). */}
        <section className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-base font-semibold text-slate-900 m-0">
              Stock on hand
            </h2>
            <button
              type="button"
              onClick={() => setReceiveOpen(true)}
              className="py-1.5 px-3 text-xs font-semibold text-white bg-blue-500 hover:bg-blue-600 rounded-lg border-0 cursor-pointer"
            >
              + Receive stock
            </button>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4 flex items-baseline gap-3">
            <span
              className={`text-3xl font-bold tabular-nums ${
                sku.quantityOnHand < 0
                  ? "text-red-600"
                  : sku.quantityOnHand === 0
                    ? "text-slate-400"
                    : sku.quantityOnHand <= 10
                      ? "text-amber-600"
                      : "text-emerald-600"
              }`}
            >
              {sku.quantityOnHand.toLocaleString()}
            </span>
            <span className="text-sm text-slate-500">
              {sku.quantityOnHand === 1 ? "unit" : "units"}
            </span>
            {sku.quantityOnHand < 0 && (
              <span className="text-xs text-red-600 ml-2">
                Negative — likely missing a starting count. Click &ldquo;Receive
                stock&rdquo; to set it.
              </span>
            )}
            {sku.quantityOnHand === 0 && sku.salesCount > 0 && (
              <span className="text-xs text-slate-500 ml-2">
                Out of stock.
              </span>
            )}
            {sku.quantityOnHand === 0 && sku.salesCount === 0 && (
              <span className="text-xs text-slate-500 ml-2">
                Not counted yet. Click &ldquo;Receive stock&rdquo; to set a
                starting count.
              </span>
            )}
          </div>

          {/* Stock history table (Sub-session 33 Tier 1 commit 4).
              Renders below the badge so the most important info
              ("how many do I have right now?") is read first. The
              running-balance column is computed server-side via
              window function so it stays correct even when the
              table is paginated. */}
          {(stockHistory.length > 0 || stockHistoryLoading) && (
            <div className="mt-4 bg-white rounded-xl border border-slate-200 overflow-x-auto">
              <div className="px-4 py-2.5 border-b border-slate-100 flex items-center justify-between">
                <h3 className="text-xs uppercase tracking-wide text-slate-500 font-semibold m-0">
                  Stock history
                </h3>
                {stockHistoryTotal > stockHistory.length && (
                  <span className="text-xs text-slate-400">
                    Showing {stockHistory.length} of {stockHistoryTotal}
                  </span>
                )}
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
                    <th className="text-left py-2.5 px-4 font-medium">Date</th>
                    <th className="text-left py-2.5 px-4 font-medium">Reason</th>
                    <th className="text-right py-2.5 px-4 font-medium">
                      Change
                    </th>
                    <th className="text-right py-2.5 px-4 font-medium">
                      Balance after
                    </th>
                    <th className="text-left py-2.5 px-4 font-medium">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {stockHistoryLoading && stockHistory.length === 0 ? (
                    <tr>
                      <td
                        colSpan={5}
                        className="py-6 text-center text-slate-400 text-xs"
                      >
                        Loading...
                      </td>
                    </tr>
                  ) : (
                    stockHistory.map((adj) => (
                      <tr
                        key={adj.id}
                        className="border-b border-slate-100 last:border-b-0"
                      >
                        <td className="py-2.5 px-4 text-slate-700 whitespace-nowrap text-xs">
                          {fmtDate(adj.createdAt)}
                        </td>
                        <td className="py-2.5 px-4 text-slate-700 text-xs">
                          {REASON_LABELS[adj.reason] ?? adj.reason}
                        </td>
                        <td
                          className={`py-2.5 px-4 text-right tabular-nums font-semibold whitespace-nowrap ${
                            adj.delta > 0
                              ? "text-emerald-600"
                              : "text-slate-700"
                          }`}
                        >
                          {adj.delta > 0 ? "+" : ""}
                          {adj.delta.toLocaleString()}
                        </td>
                        <td className="py-2.5 px-4 text-right text-slate-700 tabular-nums whitespace-nowrap">
                          {adj.runningBalance.toLocaleString()}
                        </td>
                        <td className="py-2.5 px-4 text-slate-500 text-xs">
                          {adj.notes ?? (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* Recipe (bill of materials) — Tier 2. Defines what this
            product is made of so production runs can draw down
            materials. */}
        <RecipeSection skuId={sku.id} skuCode={sku.code} />

        {/* Cost history */}
        <section className="mb-6">
          <h2 className="text-base font-semibold text-slate-900 m-0 mb-3">
            Cost history
          </h2>
          <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
                  <th className="text-left py-2.5 px-4 font-medium">
                    Effective date
                  </th>
                  <th className="text-right py-2.5 px-4 font-medium">Cost</th>
                  <th className="text-left py-2.5 px-4 font-medium">Notes</th>
                  <th className="w-32 text-right py-2.5 px-4 font-medium">
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {costHistory.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-slate-500">
                      No cost history yet.
                    </td>
                  </tr>
                ) : (
                  costHistory.map((c) => {
                    const isCurrent = c.id === currentCostRowId;
                    const isFuture = c.effectiveDate > todayIso();
                    return (
                      <tr
                        key={c.id}
                        className="border-b border-slate-100 last:border-b-0"
                      >
                        <td className="py-3 px-4 text-slate-700 whitespace-nowrap">
                          {fmtDate(c.effectiveDate)}
                        </td>
                        <td className="py-3 px-4 text-right text-slate-900 font-semibold tabular-nums whitespace-nowrap">
                          {editingCostId === c.id ? (
                            <div className="inline-flex items-center gap-1">
                              <span className="text-slate-500">$</span>
                              <input
                                type="text"
                                inputMode="decimal"
                                value={editingValue}
                                onChange={(e) =>
                                  setEditingValue(e.target.value)
                                }
                                onBlur={() => commitCostEdit(c.id, c.cost)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.currentTarget.blur();
                                  } else if (e.key === "Escape") {
                                    cancelEditingCost();
                                  }
                                }}
                                autoFocus
                                disabled={savingCostId === c.id}
                                className="w-24 py-1 px-2 text-sm text-right font-semibold tabular-nums border border-blue-300 rounded outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 disabled:bg-slate-50"
                              />
                              {savingCostId === c.id && (
                                <Spinner size={12} color="currentColor" />
                              )}
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => startEditingCost(c)}
                              className="group inline-flex items-center gap-1.5 text-right text-slate-900 font-semibold tabular-nums whitespace-nowrap bg-transparent border-0 cursor-pointer hover:bg-blue-50 rounded px-2 py-1 -mx-2 -my-1 transition-colors"
                              title="Click to edit"
                            >
                              <span className="border-b border-dashed border-slate-300 group-hover:border-blue-500">
                                {fmtMoney(c.cost, c.currency)}
                              </span>
                              <span
                                aria-hidden="true"
                                className="text-[11px] text-slate-300 group-hover:text-blue-600 transition-colors"
                              >
                                {"✎"}
                              </span>
                            </button>
                          )}
                        </td>
                        <td className="py-3 px-4 text-slate-600 text-xs">
                          {c.notes ?? "—"}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="inline-flex items-center gap-2">
                            {isCurrent && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-semibold uppercase tracking-wide">
                                Current
                              </span>
                            )}
                            {isFuture && (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 text-[10px] font-semibold uppercase tracking-wide">
                                Scheduled
                              </span>
                            )}
                            {c.affectedLineItemCount > 0 && (
                              <span
                                className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 text-[10px] font-semibold uppercase tracking-wide"
                                title={`This row's cost is the COGS source for ${c.affectedLineItemCount} historical line item${c.affectedLineItemCount === 1 ? "" : "s"}. Editing or deleting will retroactively change recorded COGS.`}
                              >
                                Used by {c.affectedLineItemCount} sale
                                {c.affectedLineItemCount === 1 ? "" : "s"}
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => handleDeleteCost(c)}
                              disabled={deletingCostId === c.id}
                              title="Delete cost row"
                              aria-label="Delete cost row"
                              className="text-slate-300 hover:text-red-600 cursor-pointer bg-transparent border-0 text-base leading-none px-1.5 py-1 disabled:opacity-30"
                            >
                              {deletingCostId === c.id ? (
                                <Spinner size={12} color="currentColor" />
                              ) : (
                                "\u{00D7}"
                              )}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* Add new cost inline form */}
        <section className="mb-6">
          <h3 className="text-sm font-semibold text-slate-700 m-0 mb-2">
            Add new cost
          </h3>
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_2fr_auto] gap-3 items-end">
              <div>
                <label
                  htmlFor="new-cost"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Per-unit cost
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">
                    {"$"}
                  </span>
                  <input
                    id="new-cost"
                    type="text"
                    inputMode="decimal"
                    value={newCost}
                    onChange={(e) => {
                      setNewCost(e.target.value);
                      setError(null);
                    }}
                    placeholder="0.00"
                    disabled={addingCost}
                    className="w-full py-2 pl-7 pr-3 text-sm border border-slate-200 rounded-lg outline-none box-border focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 disabled:bg-slate-50"
                  />
                </div>
              </div>

              <div>
                <label
                  htmlFor="new-date"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Effective date
                </label>
                <input
                  id="new-date"
                  type="date"
                  value={newDate}
                  onChange={(e) => setNewDate(e.target.value)}
                  disabled={addingCost}
                  className="w-full py-2 px-3 text-sm border border-slate-200 rounded-lg outline-none box-border focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 disabled:bg-slate-50"
                />
              </div>

              <div>
                <label
                  htmlFor="new-notes"
                  className="block text-xs font-medium text-slate-700 mb-1"
                >
                  Notes (optional)
                </label>
                <input
                  id="new-notes"
                  type="text"
                  value={newNotes}
                  onChange={(e) => setNewNotes(e.target.value)}
                  placeholder="Why did the cost change?"
                  disabled={addingCost}
                  className="w-full py-2 px-3 text-sm border border-slate-200 rounded-lg outline-none box-border focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 disabled:bg-slate-50"
                />
              </div>

              <button
                type="button"
                onClick={handleAddCost}
                disabled={addingCost}
                className="py-2 px-4 text-sm font-semibold text-white bg-blue-500 hover:bg-blue-600 rounded-lg border-0 cursor-pointer disabled:opacity-60 inline-flex items-center gap-2 self-end whitespace-nowrap"
              >
                {addingCost && <Spinner size={12} color="white" />}
                {addingCost ? "Adding..." : "Add cost"}
              </button>
            </div>
            <p className="text-xs text-slate-500 m-0 mt-2">
              Backdate to apply to historical sales, or future-date to
              schedule a price change that goes live automatically.
            </p>
          </div>
        </section>

        {/* Platform aliases — display only in 12b */}
        <section className="mb-6">
          <h2 className="text-base font-semibold text-slate-900 m-0 mb-3">
            Platform aliases
          </h2>
          <div className="bg-white rounded-xl border border-slate-200">
            {aliases.length === 0 ? (
              <div className="py-6 px-4 text-center text-sm text-slate-500">
                <p className="m-0 mb-1">No platform aliases yet.</p>
                <p className="m-0 text-xs">
                  These auto-populate as Phase 12c (line-item
                  ingestion) lands. Bulk-matching unmapped items will
                  live at{" "}
                  <span className="font-mono text-slate-400">
                    /skus/unmatched
                  </span>{" "}
                  in Phase 12d.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-slate-100 m-0 p-0">
                {aliases.map((a) => {
                  const meta = platformLabel(a.platform);
                  return (
                    <li
                      key={a.id}
                      className="flex items-center justify-between gap-3 px-4 py-3 list-none"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span>{meta.icon}</span>
                        <span className="text-sm font-medium text-slate-700">
                          {meta.label}
                        </span>
                        <span className="text-xs font-mono text-slate-500 truncate">
                          {a.externalId}
                        </span>
                      </div>
                      {a.externalSku && (
                        <span className="text-xs text-slate-400 font-mono whitespace-nowrap">
                          SKU {a.externalSku}
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>
      </div>

      <SkuForm
        open={editOpen}
        editing={{
          id: sku.id,
          code: sku.code,
          name: sku.name,
          description: sku.description,
          active: sku.active,
        }}
        onSave={async () => {
          // Unreachable in edit mode — onSaveEdit is what runs.
        }}
        onSaveEdit={handleSaveEdit}
        onToggleActive={handleToggleActive}
        onClose={() => setEditOpen(false)}
      />

      {/* Historical-impact confirm modal. Fires when the merchant
          tries to edit OR delete a cost row that has historical line
          items resolved through it. The confirm flow records an
          acknowledgement that the PATCH/DELETE call carries through
          to the API. */}
      <ConfirmModal
        open={historicalConfirm !== null}
        title={
          historicalConfirm?.kind === "delete"
            ? "Delete past cost row?"
            : "Edit past cost row?"
        }
        message={
          historicalConfirm
            ? (historicalConfirm.kind === "delete"
                ? `Deleting this cost row (effective ${fmtDate(historicalConfirm.row.effectiveDate)}, ${fmtMoney(historicalConfirm.row.cost, historicalConfirm.row.currency)}) will retroactively rewrite COGS on ${historicalConfirm.row.affectedLineItemCount} historical sale${historicalConfirm.row.affectedLineItemCount === 1 ? "" : "s"}. Those sales will re-bucket to the next-earliest cost row (or $0 if none exists). Are you sure?`
                : `Editing this cost (effective ${fmtDate(historicalConfirm.row.effectiveDate)}, currently ${fmtMoney(historicalConfirm.row.cost, historicalConfirm.row.currency)}) will retroactively rewrite COGS on ${historicalConfirm.row.affectedLineItemCount} historical sale${historicalConfirm.row.affectedLineItemCount === 1 ? "" : "s"}. Your gross-margin numbers for past periods will change. Continue?`)
            : ""
        }
        confirmLabel={historicalConfirm?.kind === "delete" ? "Yes, delete" : "Yes, edit anyway"}
        danger={historicalConfirm?.kind === "delete"}
        busy={historicalConfirmBusy}
        onConfirm={async () => {
          if (!historicalConfirm) return;
          setHistoricalConfirmBusy(true);
          try {
            if (historicalConfirm.kind === "delete") {
              const ok = await runDeleteCost(
                historicalConfirm.row.id,
                true
              );
              if (ok) setHistoricalConfirm(null);
            } else {
              // For edit: record the ack flag for this row, then
              // open the inline editor. commitCostEdit will read
              // ackedHistoricalIds and pass it through to the
              // PATCH endpoint.
              setAckedHistoricalIds((prev) => {
                const next = new Set(prev);
                next.add(historicalConfirm.row.id);
                return next;
              });
              openCostEditor(historicalConfirm.row);
              setHistoricalConfirm(null);
            }
          } finally {
            setHistoricalConfirmBusy(false);
          }
        }}
        onCancel={() => setHistoricalConfirm(null)}
      />

      {/* Receive stock modal (Sub-session 33 Tier 1 commit 3). Only
          rendered when a SKU is loaded — defensive against opening
          before the detail fetch completes. */}
      {sku && (
        <ReceiveStockModal
          open={receiveOpen}
          skuId={sku.id}
          skuCode={sku.code}
          skuName={sku.name}
          currentQuantity={sku.quantityOnHand}
          onClose={() => setReceiveOpen(false)}
          onSaved={(newQty) => {
            // Patch local state so the UI reflects the new total
            // immediately without a refetch round trip. data is the
            // single source of truth for the page; we mutate just
            // the sku.quantityOnHand leaf.
            setData((prev) =>
              prev
                ? { ...prev, sku: { ...prev.sku, quantityOnHand: newQty } }
                : prev
            );
            setReceiveOpen(false);
            // Refresh stock history so the new receive row appears
            // at the top of the table. Cheap query — single SKU, 50
            // rows max.
            void loadStockHistory();
          }}
        />
      )}
    </div>
  );
}

function SummaryChip({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <p className="text-xs uppercase tracking-wide text-slate-500 m-0 mb-1">
        {label}
      </p>
      <p className="text-xl font-bold text-slate-900 m-0 tabular-nums">
        {value}
      </p>
      {sub && <p className="text-xs text-slate-500 m-0 mt-0.5">{sub}</p>}
    </div>
  );
}
