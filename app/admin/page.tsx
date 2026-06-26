"use client";

import { useState, useEffect, useCallback } from "react";
import PageHeader from "../components/PageHeader";
import { planColor } from "@/lib/planColor";
import { BANDS, planDisplayLabel } from "@/lib/plans";

interface Client {
  id: number;
  email: string;
  business_name: string | null;
  industry: string | null;
  plan: string;
  stripe_customer_id: string | null;
  onboarding_completed: boolean;
  trial_ends_at: string | null;
  created_at: string;
  updated_at: string;
  total_items: string;
  items_this_month: string;
}

interface Cost {
  id: number;
  label: string;
  amount: number;
  cadence: "monthly" | "annual";
  notes: string | null;
}

const BAND_IDS = new Set<string>(BANDS.map((b) => b.id));
const bandPrice = (plan: string): number =>
  BANDS.find((b) => b.id === plan)?.price ?? 0;
/** A cost's monthly-equivalent (annual costs ÷ 12). */
const monthlyOf = (c: Cost): number =>
  c.cadence === "annual" ? c.amount / 12 : c.amount;

function fmtUsd(n: number): string {
  return `$${n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export default function AdminPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [costs, setCosts] = useState<Cost[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Cost editor state
  const [newCost, setNewCost] = useState({
    label: "",
    amount: "",
    cadence: "monthly" as "monthly" | "annual",
  });
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState({
    label: "",
    amount: "",
    cadence: "monthly" as "monthly" | "annual",
  });
  const [busyId, setBusyId] = useState<number | null>(null);

  const loadCosts = useCallback(async () => {
    const res = await fetch("/api/admin/costs");
    if (res.ok) {
      const data = (await res.json()) as { costs: Cost[] };
      setCosts(data.costs ?? []);
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/admin");
        if (res.status === 403) {
          setError("Access denied. Owner only.");
          return;
        }
        if (!res.ok) throw new Error("Failed to load");
        const data = await res.json();
        setClients(data.clients || []);
        await loadCosts();
      } catch {
        setError("Failed to load owner dashboard");
      } finally {
        setLoading(false);
      }
    })();
  }, [loadCosts]);

  // ── Cost mutations ──────────────────────────────────────────────
  const addCost = async () => {
    const amount = Number(newCost.amount.replace(/[$,\s]/g, ""));
    if (!newCost.label.trim() || !Number.isFinite(amount) || amount < 0) return;
    setAdding(true);
    try {
      const res = await fetch("/api/admin/costs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: newCost.label.trim(),
          amount,
          cadence: newCost.cadence,
        }),
      });
      if (res.ok) {
        setNewCost({ label: "", amount: "", cadence: "monthly" });
        await loadCosts();
      }
    } finally {
      setAdding(false);
    }
  };

  const saveEdit = async (id: number) => {
    const amount = Number(editDraft.amount.replace(/[$,\s]/g, ""));
    if (!editDraft.label.trim() || !Number.isFinite(amount) || amount < 0) return;
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/costs/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: editDraft.label.trim(),
          amount,
          cadence: editDraft.cadence,
        }),
      });
      if (res.ok) {
        setEditingId(null);
        await loadCosts();
      }
    } finally {
      setBusyId(null);
    }
  };

  const deleteCost = async (id: number) => {
    setBusyId(id);
    try {
      const res = await fetch(`/api/admin/costs/${id}`, { method: "DELETE" });
      if (res.ok) await loadCosts();
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 font-sans">
        <div className="max-w-[960px] mx-auto py-8 px-4 sm:px-6">
          <p className="text-center p-[60px] text-slate-500">
            Loading owner dashboard…
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 font-sans">
        <div className="max-w-[960px] mx-auto py-8 px-4 sm:px-6">
          <div className="bg-red-50 border border-red-200 rounded-xl p-8 text-center text-red-800">
            <h2 className="m-0 mb-2 text-xl">{"\u{1F6AB}"} Access Denied</h2>
            <p className="m-0 text-slate-500">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  // ── Derived metrics ─────────────────────────────────────────────
  const trialCount = clients.filter((c) => c.plan === "trial").length;
  const canceledCount = clients.filter((c) => c.plan === "canceled").length;
  const paidClients = clients.filter((c) => BAND_IDS.has(c.plan));
  const paidCount = paidClients.length;
  const mrr = paidClients.reduce((s, c) => s + bandPrice(c.plan), 0);
  const monthlyCost = costs.reduce((s, c) => s + monthlyOf(c), 0);
  const net = mrr - monthlyCost;

  // Trials expiring within 7 days
  const now = Date.now();
  const soonMs = 7 * 24 * 60 * 60 * 1000;
  const expiringSoon = clients.filter(
    (c) =>
      c.plan === "trial" &&
      c.trial_ends_at &&
      new Date(c.trial_ends_at).getTime() - now <= soonMs &&
      new Date(c.trial_ends_at).getTime() >= now
  ).length;

  // Paid breakdown by band (only bands with >0)
  const bandBreakdown = BANDS.map((b) => ({
    band: b,
    count: paidClients.filter((c) => c.plan === b.id).length,
  })).filter((x) => x.count > 0);

  return (
    <div className="min-h-screen bg-slate-50 font-sans">
      <div className="max-w-[960px] mx-auto py-8 px-4 sm:px-6">
        <PageHeader
          backHref="/dashboard"
          backLabel="Dreamward"
          title={<>{"\u{1F6E0}\u{FE0F}"} Owner Dashboard</>}
          subtitle={`${clients.length} accounts · ${paidCount} paying`}
        />

        {/* P&L strip */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          <Stat
            label="Subscribers"
            value={`${paidCount} paid`}
            sub={`${trialCount} on trial`}
          />
          <Stat label="MRR" value={fmtUsd(mrr)} sub="recurring / mo" />
          <Stat
            label="Monthly costs"
            value={fmtUsd(monthlyCost)}
            sub={`${costs.length} item${costs.length === 1 ? "" : "s"}`}
          />
          <Stat
            label="Net / mo"
            value={fmtUsd(net)}
            sub={net >= 0 ? "profit" : "burning"}
            highlight={net >= 0 ? "good" : "bad"}
          />
        </div>

        {/* Subscriber breakdown */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6">
          <h2 className="text-sm font-semibold text-slate-700 m-0 mb-3 uppercase tracking-wide">
            Subscribers
          </h2>
          <div className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
            <Pill label="On trial" n={trialCount} />
            <Pill label="Paying" n={paidCount} />
            <Pill label="Canceled" n={canceledCount} />
            {expiringSoon > 0 && (
              <span className="text-amber-700">
                ⚠ {expiringSoon} trial{expiringSoon === 1 ? "" : "s"} expiring ≤7
                days
              </span>
            )}
          </div>
          {bandBreakdown.length > 0 && (
            <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-500">
              {bandBreakdown.map(({ band, count }) => (
                <span key={band.id}>
                  {band.range} (${band.price}):{" "}
                  <span className="font-semibold text-slate-700">{count}</span>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Operating costs */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 mb-6">
          <div className="flex items-baseline justify-between gap-3 mb-3">
            <h2 className="text-sm font-semibold text-slate-700 m-0 uppercase tracking-wide">
              Operating costs
            </h2>
            <span className="text-sm text-slate-500">
              {fmtUsd(monthlyCost)}
              <span className="text-xs text-slate-400"> / mo total</span>
            </span>
          </div>

          {costs.length === 0 && (
            <p className="text-sm text-slate-400 italic m-0 mb-3">
              No costs yet — add your hosting, services, fees below.
            </p>
          )}

          <ul className="m-0 p-0 list-none space-y-1.5">
            {costs.map((c) =>
              editingId === c.id ? (
                <li
                  key={c.id}
                  className="flex flex-wrap items-center gap-2 py-1.5"
                >
                  <input
                    value={editDraft.label}
                    onChange={(e) =>
                      setEditDraft((d) => ({ ...d, label: e.target.value }))
                    }
                    className="flex-1 min-w-[120px] py-1.5 px-2 text-sm border border-slate-200 rounded outline-none focus:border-blue-500"
                  />
                  <input
                    value={editDraft.amount}
                    onChange={(e) =>
                      setEditDraft((d) => ({ ...d, amount: e.target.value }))
                    }
                    inputMode="decimal"
                    className="w-24 py-1.5 px-2 text-sm text-right border border-slate-200 rounded outline-none focus:border-blue-500"
                  />
                  <select
                    value={editDraft.cadence}
                    onChange={(e) =>
                      setEditDraft((d) => ({
                        ...d,
                        cadence: e.target.value as "monthly" | "annual",
                      }))
                    }
                    className="py-1.5 px-2 text-sm border border-slate-200 rounded outline-none bg-white"
                  >
                    <option value="monthly">/mo</option>
                    <option value="annual">/yr</option>
                  </select>
                  <button
                    onClick={() => saveEdit(c.id)}
                    disabled={busyId === c.id}
                    className="text-xs font-semibold text-white bg-blue-500 hover:bg-blue-600 rounded px-2.5 py-1.5 border-0 cursor-pointer disabled:opacity-50"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => setEditingId(null)}
                    className="text-xs text-slate-500 hover:text-slate-700 bg-transparent border-0 cursor-pointer"
                  >
                    Cancel
                  </button>
                </li>
              ) : (
                <li
                  key={c.id}
                  className="flex items-center justify-between gap-3 py-1.5 group"
                >
                  <span className="text-sm text-slate-700 truncate">
                    {c.label}
                  </span>
                  <span className="flex items-center gap-3 flex-shrink-0">
                    <span className="text-sm text-slate-900 tabular-nums">
                      {fmtUsd(c.amount)}
                      <span className="text-xs text-slate-400">
                        {c.cadence === "annual" ? "/yr" : "/mo"}
                      </span>
                    </span>
                    {c.cadence === "annual" && (
                      <span className="text-xs text-slate-400 tabular-nums">
                        ({fmtUsd(monthlyOf(c))}/mo)
                      </span>
                    )}
                    <button
                      onClick={() => {
                        setEditingId(c.id);
                        setEditDraft({
                          label: c.label,
                          amount: String(c.amount),
                          cadence: c.cadence,
                        });
                      }}
                      className="text-xs text-blue-600 hover:underline bg-transparent border-0 cursor-pointer opacity-0 group-hover:opacity-100"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => deleteCost(c.id)}
                      disabled={busyId === c.id}
                      className="text-xs text-slate-400 hover:text-red-600 bg-transparent border-0 cursor-pointer opacity-0 group-hover:opacity-100 disabled:opacity-50"
                      aria-label={`Delete ${c.label}`}
                    >
                      {"\u{00D7}"}
                    </button>
                  </span>
                </li>
              )
            )}
          </ul>

          {/* Add a cost */}
          <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-slate-100">
            <input
              value={newCost.label}
              onChange={(e) =>
                setNewCost((c) => ({ ...c, label: e.target.value }))
              }
              placeholder="e.g. Vercel, Railway, domain…"
              className="flex-1 min-w-[140px] py-1.5 px-2 text-sm border border-slate-200 rounded outline-none focus:border-blue-500"
            />
            <input
              value={newCost.amount}
              onChange={(e) =>
                setNewCost((c) => ({ ...c, amount: e.target.value }))
              }
              inputMode="decimal"
              placeholder="$0.00"
              className="w-24 py-1.5 px-2 text-sm text-right border border-slate-200 rounded outline-none focus:border-blue-500"
            />
            <select
              value={newCost.cadence}
              onChange={(e) =>
                setNewCost((c) => ({
                  ...c,
                  cadence: e.target.value as "monthly" | "annual",
                }))
              }
              className="py-1.5 px-2 text-sm border border-slate-200 rounded outline-none bg-white"
            >
              <option value="monthly">/mo</option>
              <option value="annual">/yr</option>
            </select>
            <button
              onClick={addCost}
              disabled={adding || !newCost.label.trim()}
              className="text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-700 rounded px-3 py-1.5 border-0 cursor-pointer disabled:opacity-50"
            >
              + Add
            </button>
          </div>
        </div>

        {/* Client table */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="py-4 px-6 border-b border-slate-200">
            <h2 className="text-lg font-bold text-slate-900 m-0">All accounts</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  {["Business", "Email", "Plan", "Items", "This Month", "Joined"].map(
                    (h) => (
                      <th
                        key={h}
                        className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider bg-slate-50 border-b border-slate-200"
                      >
                        {h}
                      </th>
                    )
                  )}
                </tr>
              </thead>
              <tbody>
                {clients.map((client) => (
                  <tr
                    key={client.id}
                    onClick={() =>
                      (window.location.href = `/admin/client?id=${client.id}`)
                    }
                    className="border-b border-slate-100 cursor-pointer hover:bg-slate-50"
                  >
                    <td className="py-3.5 px-4">
                      <span className="font-semibold text-slate-900">
                        {client.business_name || "—"}
                      </span>
                    </td>
                    <td className="py-3.5 px-4">
                      <span className="text-[13px] text-slate-500">
                        {client.email}
                      </span>
                    </td>
                    <td className="py-3.5 px-4">
                      <span
                        className={`py-[3px] px-2.5 rounded-[20px] text-xs font-semibold ${planColor(client.plan)}`}
                      >
                        {planDisplayLabel(client.plan)}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-slate-700">
                      {client.total_items}
                    </td>
                    <td className="py-3.5 px-4 text-slate-700">
                      {client.items_this_month}
                    </td>
                    <td className="py-3.5 px-4">
                      <span className="text-[13px] text-slate-500">
                        {client.created_at
                          ? new Date(client.created_at).toLocaleDateString(
                              "en-US",
                              { month: "short", day: "numeric", year: "numeric" }
                            )
                          : "—"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  highlight,
}: {
  label: string;
  value: string;
  sub?: string;
  highlight?: "good" | "bad";
}) {
  const base =
    highlight === "good"
      ? "bg-emerald-50 border-emerald-200"
      : highlight === "bad"
        ? "bg-red-50 border-red-200"
        : "bg-white border-slate-200";
  const valColor =
    highlight === "good"
      ? "text-emerald-800"
      : highlight === "bad"
        ? "text-red-800"
        : "text-slate-900";
  return (
    <div className={`rounded-xl border py-4 px-5 ${base}`}>
      <div className="text-[11px] uppercase tracking-wide text-slate-500 mb-1">
        {label}
      </div>
      <div className={`text-2xl font-extrabold tabular-nums ${valColor}`}>
        {value}
      </div>
      {sub && <div className="text-xs text-slate-500 mt-0.5">{sub}</div>}
    </div>
  );
}

function Pill({ label, n }: { label: string; n: number }) {
  return (
    <span className="text-slate-600">
      {label}: <span className="font-bold text-slate-900">{n}</span>
    </span>
  );
}
