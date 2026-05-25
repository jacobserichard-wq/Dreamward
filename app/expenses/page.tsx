// app/expenses/page.tsx
//
// Phase 9.3 commit 6 of ~8. The new /expenses surface — list view
// of expense-type processed_items with channel filter chips +
// "+ New expense" CTA that opens the ExpenseForm modal.
//
// Companion to the existing /invoices page (AR / customer invoices)
// — /expenses tracks money OUT (vendor bills, supplies, subscriptions);
// /invoices tracks money IN (customer invoices awaiting payment).
// Two distinct accounting concepts, two distinct surfaces.
//
// Data fetches on mount:
//   - /api/expenses?channel=<active filter> → list + summary
//   - /api/categories?industry=<x> via /api/client → category list
//     for the form dropdown
//   - /api/events → events list for the form's conditional picker

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import PageHeader from "../components/PageHeader";
import ErrorBanner from "../components/ErrorBanner";
import ExpenseForm, {
  type ExpenseFormCategory,
  type ExpenseFormEvent,
  type ExpenseFormSubmit,
} from "../components/ExpenseForm";
import ConfirmModal from "../components/ConfirmModal";
import {
  CANONICAL_CHANNELS,
  type ChannelMeta,
} from "@/lib/profitability/channels";

interface ExpenseRow {
  id: number;
  vendor: string | null;
  amount: number;
  dueDate: string | null;
  category: string | null;
  source: string | null;
  channel: string | null;
  eventId: number | null;
  status: string | null;
  notes: string | null;
  createdAt: string;
}

interface ExpensesResponse {
  expenses: ExpenseRow[];
  summary: { totalAmount: number; count: number };
}

interface ClientInfoResponse {
  industry: string | null;
  plan: string;
  businessName: string | null;
}

interface EventApiRow {
  id: number;
  name: string;
  startDate: string;
}

// Channels surfaced as filter chips — same set as the form's
// channel dropdown (no coming-soon channels; coming-soon channels
// can't have expenses tagged to them yet).
const FILTER_CHANNELS: readonly ChannelMeta[] = CANONICAL_CHANNELS.filter(
  (c) => !c.comingSoon
);

function fmtUsd(n: number): string {
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  // YYYY-MM-DD → "May 19, 2026" without timezone shenanigans
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const monthNames = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  return `${monthNames[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

function channelLabel(id: string | null): { label: string; icon: string } {
  if (!id) return { label: "Overhead", icon: "\u{1F4CB}" };
  const meta = CANONICAL_CHANNELS.find((c) => c.id === id);
  if (!meta) return { label: id, icon: "" };
  return { label: meta.label, icon: meta.icon };
}

export default function ExpensesPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [summary, setSummary] = useState<{
    totalAmount: number;
    count: number;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<string | null>(null);

  // For the form modal
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ExpenseRow | null>(null);
  const [clientInfo, setClientInfo] = useState<ClientInfoResponse | null>(null);
  const [categories, setCategories] = useState<ExpenseFormCategory[]>([]);
  const [events, setEvents] = useState<ExpenseFormEvent[]>([]);

  // Delete-confirm modal state
  const [pendingDelete, setPendingDelete] = useState<ExpenseRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  // ── Data loaders ──────────────────────────────────────────────
  const loadExpenses = useCallback(async (channelFilter: string | null) => {
    try {
      const url = new URL("/api/expenses", window.location.origin);
      if (channelFilter) url.searchParams.set("channel", channelFilter);
      url.searchParams.set("limit", "500");
      const res = await fetch(url.toString());
      if (!res.ok) {
        if (res.status === 401) {
          router.replace("/signin?callbackUrl=/expenses");
          return;
        }
        const body = await res.json().catch(() => ({}));
        setError(body.error || `HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as ExpensesResponse;
      setExpenses(data.expenses);
      setSummary(data.summary);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load expenses");
    }
  }, [router]);

  const loadClientPlusEvents = useCallback(async () => {
    try {
      const [clientRes, eventsRes] = await Promise.all([
        fetch("/api/client"),
        fetch("/api/events"),
      ]);
      if (clientRes.ok) {
        const data = (await clientRes.json()) as ClientInfoResponse;
        setClientInfo(data);
        // Build the category list for the form modal — pull from
        // the industry-aware seeded taxonomy + custom additions.
        // Industry-specific list comes through the existing
        // /api/settings preferences pipeline; rather than
        // duplicating that here, just fetch from /api/settings.
        const settingsRes = await fetch("/api/settings");
        if (settingsRes.ok) {
          const sdata = (await settingsRes.json()) as {
            industry: string | null;
            industryDefaults?: string[];
            settings?: {
              custom_categories?: string[];
              preferences?: { custom_income_categories?: string[] };
            };
          };
          const incomeSet = new Set(
            sdata.settings?.preferences?.custom_income_categories ?? []
          );
          // Pull industry defaults (mix of income+expense) + the
          // legacy expense-only custom_categories.
          const cats = (sdata.industryDefaults ?? [])
            .filter((name) => !incomeSet.has(name))
            .map((name) => ({ name } as ExpenseFormCategory));
          for (const c of sdata.settings?.custom_categories ?? []) {
            if (!cats.find((cc) => cc.name === c)) {
              cats.push({ name: c });
            }
          }
          // Sort alphabetically for the dropdown
          cats.sort((a, b) => a.name.localeCompare(b.name));
          setCategories(cats);
        }
      }
      if (eventsRes.ok) {
        const data = (await eventsRes.json()) as { events?: EventApiRow[] };
        setEvents(
          (data.events || []).map((e) => ({
            id: e.id,
            name: e.name,
            startDate: e.startDate,
          }))
        );
      }
    } catch {
      // Non-fatal — form opens but with empty dropdowns
    }
  }, []);

  // ── Initial load ──────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await Promise.all([loadExpenses(activeFilter), loadClientPlusEvents()]);
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // intentional — re-fetching on filter change handled separately

  // Re-fetch when filter changes
  useEffect(() => {
    if (loading) return;
    loadExpenses(activeFilter);
  }, [activeFilter, loadExpenses, loading]);

  // ── Save handler (passed to form) ─────────────────────────────
  // Switches between POST (new) and PATCH (edit) based on whether
  // `editing` is set when the form submits.
  const handleSaveExpense = useCallback(
    async (data: ExpenseFormSubmit) => {
      const isEdit = editing !== null;
      const url = isEdit ? `/api/expenses/${editing.id}` : "/api/expenses";
      const method = isEdit ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setFormOpen(false);
      setEditing(null);
      await loadExpenses(activeFilter);
    },
    [activeFilter, editing, loadExpenses]
  );

  // ── Open form in edit mode for an existing row ────────────────
  const openEdit = useCallback((expense: ExpenseRow) => {
    setEditing(expense);
    setFormOpen(true);
  }, []);

  // ── Delete handler (called from ConfirmModal) ─────────────────
  const handleConfirmDelete = useCallback(async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/expenses/${pendingDelete.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setPendingDelete(null);
      await loadExpenses(activeFilter);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't delete expense");
    } finally {
      setDeleting(false);
    }
  }, [pendingDelete, activeFilter, loadExpenses]);

  // ── Compute per-channel filter counts for chip badges ─────────
  const channelCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of expenses) {
      const key = e.channel ?? "__overhead__";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [expenses]);

  return (
    <div className="min-h-screen bg-slate-50 font-sans">
      <div className="max-w-[1100px] mx-auto py-8 px-4 sm:px-6">
        <PageHeader
          backHref="/dashboard"
          backLabel="FlowWork"
          title="Expenses"
          subtitle="Track money out — vendor bills, supplies, subscriptions, mileage"
        />

        {error && (
          <ErrorBanner message={error} onDismiss={() => setError(null)} />
        )}

        {/* Action bar — summary + New button */}
        <div className="flex justify-between items-center gap-3 mb-5 flex-wrap">
          <div className="flex items-baseline gap-3">
            <span className="text-2xl font-bold text-slate-900 tabular-nums">
              {summary ? fmtUsd(summary.totalAmount) : "—"}
            </span>
            <span className="text-sm text-slate-500">
              {summary
                ? `${summary.count} expense${summary.count === 1 ? "" : "s"}${activeFilter ? ` in ${channelLabel(activeFilter).label}` : ""}`
                : "loading..."}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setFormOpen(true)}
            className="py-2 px-4 rounded-lg bg-blue-500 hover:bg-blue-600 text-white text-sm font-semibold cursor-pointer border-0 inline-flex items-center gap-2"
          >
            <span>+</span> New expense
          </button>
        </div>

        {/* Filter chip row */}
        <div className="flex items-center gap-2 mb-5 flex-wrap">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500 mr-1">
            Filter:
          </span>
          <FilterChip
            label="All"
            active={activeFilter === null}
            onClick={() => setActiveFilter(null)}
          />
          {FILTER_CHANNELS.map((c) => (
            <FilterChip
              key={c.id}
              label={`${c.icon} ${c.label}`}
              count={channelCounts.get(c.id)}
              active={activeFilter === c.id}
              onClick={() => setActiveFilter(c.id)}
            />
          ))}
        </div>

        {/* Table */}
        {loading ? (
          <p className="text-center p-[60px] text-slate-500">Loading expenses…</p>
        ) : expenses.length === 0 ? (
          <div className="bg-white rounded-xl border border-slate-200 py-12 px-6 text-center">
            <p className="text-5xl mb-3">{"\u{1F4C1}"}</p>
            <p className="text-base font-medium text-slate-700 m-0 mb-1">
              No expenses {activeFilter ? `in ${channelLabel(activeFilter).label}` : "yet"}
            </p>
            <p className="text-sm text-slate-500 m-0 mb-4 max-w-md mx-auto">
              {activeFilter
                ? "Clear the filter to see all expenses, or add one tagged to this channel."
                : "Add your first expense to start tracking where your money goes."}
            </p>
            <button
              type="button"
              onClick={() => setFormOpen(true)}
              className="inline-block py-2 px-4 rounded-lg bg-blue-500 text-white text-sm font-semibold border-0 cursor-pointer hover:bg-blue-600"
            >
              Add an expense
            </button>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-slate-500 border-b border-slate-200">
                  <th className="text-left py-2.5 px-4 font-medium">Date</th>
                  <th className="text-left py-2.5 px-4 font-medium">Vendor</th>
                  <th className="text-left py-2.5 px-4 font-medium">Category</th>
                  <th className="text-left py-2.5 px-4 font-medium">Channel</th>
                  <th className="text-right py-2.5 px-4 font-medium">Amount</th>
                  <th className="w-10" aria-label="Actions" />
                </tr>
              </thead>
              <tbody>
                {expenses.map((e) => {
                  const ch = channelLabel(e.channel);
                  return (
                    <tr
                      key={e.id}
                      onClick={() => openEdit(e)}
                      className="border-b border-slate-100 last:border-b-0 hover:bg-slate-50 cursor-pointer group"
                      title="Click to edit"
                    >
                      <td className="py-3 px-4 text-slate-700 whitespace-nowrap">
                        {fmtDate(e.dueDate)}
                      </td>
                      <td className="py-3 px-4 text-slate-900 font-medium">
                        {e.vendor || "—"}
                        {e.notes && (
                          <p className="text-xs text-slate-500 m-0 mt-0.5 font-normal">
                            {e.notes}
                          </p>
                        )}
                      </td>
                      <td className="py-3 px-4 text-slate-600 text-xs">
                        {e.category || "—"}
                      </td>
                      <td className="py-3 px-4 text-slate-600 text-xs whitespace-nowrap">
                        <span className="inline-flex items-center gap-1.5">
                          <span>{ch.icon}</span>
                          <span>{ch.label}</span>
                        </span>
                      </td>
                      <td className="py-3 px-4 text-right text-slate-900 font-semibold tabular-nums whitespace-nowrap">
                        {fmtUsd(e.amount)}
                      </td>
                      <td
                        className="py-3 pr-3 text-right"
                        onClick={(ev) => ev.stopPropagation()}
                      >
                        <button
                          type="button"
                          onClick={() => setPendingDelete(e)}
                          title={`Delete expense from ${e.vendor || "this vendor"}`}
                          aria-label="Delete expense"
                          className="text-slate-300 hover:text-red-600 cursor-pointer bg-transparent border-0 text-base leading-none px-1.5 py-1 opacity-0 group-hover:opacity-100 transition-opacity"
                        >
                          {"\u{00D7}"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Sister-feature pointer for users still wondering about /invoices */}
        <p className="text-xs text-slate-400 text-center mt-6">
          Looking for customer invoices?{" "}
          <Link href="/invoices" className="text-blue-600 hover:underline">
            Go to AR / Invoices →
          </Link>
        </p>
      </div>

      <ExpenseForm
        open={formOpen}
        categories={categories}
        events={events}
        editing={editing}
        onSave={handleSaveExpense}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
      />

      {/* Delete confirmation modal */}
      <ConfirmModal
        open={pendingDelete !== null}
        title="Delete this expense?"
        message={
          pendingDelete
            ? `Remove "${pendingDelete.vendor || "Unknown"}" (${fmtUsd(
                pendingDelete.amount
              )}) from your records. This can't be undone, but your channel/profitability totals will recompute immediately.`
            : ""
        }
        confirmLabel="Delete"
        danger
        busy={deleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}

function FilterChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium cursor-pointer border transition-colors ${
        active
          ? "bg-slate-800 text-white border-slate-800"
          : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
      }`}
    >
      <span>{label}</span>
      {count != null && count > 0 && (
        <span
          className={`tabular-nums text-[10px] px-1.5 py-0.5 rounded-full ${
            active ? "bg-white/20" : "bg-slate-100 text-slate-500"
          }`}
        >
          {count}
        </span>
      )}
    </button>
  );
}
