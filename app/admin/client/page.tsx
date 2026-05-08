"use client";

import { useSearchParams } from "next/navigation";
import { useState, useEffect, Suspense } from "react";
import PageHeader from "../../components/PageHeader";
import { planColor } from "@/lib/planColor";

function statusColor(status: string): string {
  const map: Record<string, string> = {
    pending: "bg-amber-100 text-amber-800",
    paid: "bg-green-100 text-green-800",
    overdue: "bg-red-100 text-red-800",
    needs_review: "bg-indigo-100 text-indigo-800",
  };
  return map[status] || "";
}

function ClientDetailContent() {
  const searchParams = useSearchParams();
  const clientId = searchParams.get("id");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!clientId) {
      setError("No client ID provided");
      setLoading(false);
      return;
    }
    async function load() {
      try {
        const res = await fetch(`/api/admin/client?id=${clientId}`);
        if (res.status === 403) {
          setError("Access denied");
          setLoading(false);
          return;
        }
        if (!res.ok) throw new Error("Failed to load");
        const json = await res.json();
        setData(json);
      } catch {
        setError("Failed to load client");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [clientId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 font-sans">
        <div className="max-w-[900px] mx-auto py-8 px-4 sm:px-6">
          <p className="text-center p-[60px] text-slate-500">Loading client...</p>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-slate-50 font-sans">
        <div className="max-w-[900px] mx-auto py-8 px-4 sm:px-6">
          <div className="bg-red-50 border border-red-200 rounded-xl p-8 text-center text-red-800">
            {error || "Client not found"}
          </div>
        </div>
      </div>
    );
  }

  const { client, settings, items, stats } = data;

  function fmt(amount: number) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(amount);
  }

  function fmtDate(d: string) {
    return d
      ? new Date(d).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })
      : "—";
  }

  return (
    <div className="min-h-screen bg-slate-50 font-sans">
      <div className="max-w-[900px] mx-auto py-8 px-4 sm:px-6">
        <PageHeader
          backHref="/admin"
          backLabel="Admin"
          title={client.business_name || client.email}
          subtitle={client.email}
          rightSlot={
            <span
              className={`py-[3px] px-2.5 rounded-[20px] text-xs font-semibold uppercase tracking-[0.3px] ${planColor(
                client.plan
              )}`}
            >
              {client.plan}
            </span>
          }
        />

        {/* Client Info Grid */}
        <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-4 mb-8">
          <div className="bg-white rounded-xl border border-slate-200 py-5 px-6">
            <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mt-0 mb-4 pb-3 border-b border-slate-100">
              Account Details
            </h3>
            <div className="flex justify-between py-2 border-b border-slate-50">
              <span className="text-[13px] text-slate-500">ID</span>
              <span className="text-[13px] font-medium text-slate-900">{client.id}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-slate-50">
              <span className="text-[13px] text-slate-500">Industry</span>
              <span className="text-[13px] font-medium text-slate-900">{client.industry || "—"}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-slate-50">
              <span className="text-[13px] text-slate-500">Plan</span>
              <span className="text-[13px] font-medium text-slate-900">{client.plan}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-slate-50">
              <span className="text-[13px] text-slate-500">Stripe ID</span>
              <span className="text-[13px] font-medium text-slate-900">{client.stripe_customer_id || "None"}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-slate-50">
              <span className="text-[13px] text-slate-500">Onboarded</span>
              <span className="text-[13px] font-medium text-slate-900">
                {client.onboarding_completed ? "✓ Yes" : "✗ No"}
              </span>
            </div>
            <div className="flex justify-between py-2 border-b border-slate-50">
              <span className="text-[13px] text-slate-500">Joined</span>
              <span className="text-[13px] font-medium text-slate-900">{fmtDate(client.created_at)}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-slate-50">
              <span className="text-[13px] text-slate-500">Trial Ends</span>
              <span className="text-[13px] font-medium text-slate-900">{fmtDate(client.trial_ends_at)}</span>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 py-5 px-6">
            <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mt-0 mb-4 pb-3 border-b border-slate-100">
              Usage Stats
            </h3>
            <div className="flex justify-between py-2 border-b border-slate-50">
              <span className="text-[13px] text-slate-500">Total Items</span>
              <span className="text-[13px] font-medium text-slate-900">{stats.total_items}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-slate-50">
              <span className="text-[13px] text-slate-500">This Month</span>
              <span className="text-[13px] font-medium text-slate-900">{stats.items_this_month}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-slate-50">
              <span className="text-[13px] text-slate-500">Pending</span>
              <span className="text-[13px] font-medium text-slate-900">{stats.pending}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-slate-50">
              <span className="text-[13px] text-slate-500">Paid</span>
              <span className="text-[13px] font-medium text-slate-900">{stats.paid}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-slate-50">
              <span className="text-[13px] text-slate-500">Overdue</span>
              <span className="text-[13px] font-medium text-slate-900">{stats.overdue}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-slate-50">
              <span className="text-[13px] text-slate-500">Total Amount</span>
              <span className="text-[13px] font-medium text-slate-900">
                {fmt(parseFloat(stats.total_amount))}
              </span>
            </div>
            <div className="flex justify-between py-2 border-b border-slate-50">
              <span className="text-[13px] text-slate-500">Avg Confidence</span>
              <span className="text-[13px] font-medium text-slate-900">
                {Math.round(parseFloat(stats.avg_confidence))}%
              </span>
            </div>
          </div>

          {settings && (
            <div className="bg-white rounded-xl border border-slate-200 py-5 px-6">
              <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-wider mt-0 mb-4 pb-3 border-b border-slate-100">
                Settings
              </h3>
              <div className="flex flex-col gap-2 py-2 border-b border-slate-50">
                <span className="text-[13px] text-slate-500">Active Modules</span>
                <div className="flex flex-wrap gap-1.5">
                  {(settings.active_modules || []).map((m: string) => (
                    <span
                      key={m}
                      className="py-1 px-2.5 rounded-[20px] text-xs font-medium bg-blue-50 text-blue-700"
                    >
                      {m}
                    </span>
                  ))}
                  {(!settings.active_modules || settings.active_modules.length === 0) && (
                    <span className="text-[13px] font-medium text-slate-900">Default</span>
                  )}
                </div>
              </div>
              <div className="flex flex-col gap-2 py-2 border-b border-slate-50">
                <span className="text-[13px] text-slate-500">Expense Categories</span>
                <div className="flex flex-wrap gap-1.5">
                  {(settings.custom_categories || []).map((c: string) => (
                    <span
                      key={c}
                      className="py-1 px-2.5 rounded-[20px] text-xs font-medium bg-green-50 text-green-600"
                    >
                      {c}
                    </span>
                  ))}
                  {(!settings.custom_categories || settings.custom_categories.length === 0) && (
                    <span className="text-[13px] font-medium text-slate-900">None</span>
                  )}
                </div>
              </div>
              <div className="flex flex-col gap-2 py-2 border-b border-slate-50">
                <span className="text-[13px] text-slate-500">Preferences</span>
                <span className="text-[13px] font-medium text-slate-900">
                  {settings.preferences && Object.keys(settings.preferences).length > 0
                    ? Object.entries(settings.preferences)
                        .map(([k, v]) => `${k}: ${v}`)
                        .join(", ")
                    : "Default"}
                </span>
              </div>
            </div>
          )}
        </div>

        {/* Recent Items */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="py-4 px-6 border-b border-slate-200">
            <h2 className="text-lg font-bold text-slate-900 m-0">Recent Items ({items.length})</h2>
          </div>
          {items.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider bg-slate-50 border-b border-slate-200">Vendor</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider bg-slate-50 border-b border-slate-200">Category</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider bg-slate-50 border-b border-slate-200">Amount</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider bg-slate-50 border-b border-slate-200">Status</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider bg-slate-50 border-b border-slate-200">Source</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider bg-slate-50 border-b border-slate-200">Confidence</th>
                    <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider bg-slate-50 border-b border-slate-200">Date</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item: any) => (
                    <tr key={item.id} className="border-b border-slate-100">
                      <td className="py-3 px-4 text-slate-700">
                        <span className="font-semibold">{item.vendor || "—"}</span>
                      </td>
                      <td className="py-3 px-4 text-slate-700">
                        <span className="capitalize">{item.category || "—"}</span>
                      </td>
                      <td className="py-3 px-4 text-slate-700">
                        {item.amount ? fmt(parseFloat(item.amount)) : "—"}
                      </td>
                      <td className="py-3 px-4 text-slate-700">
                        <span
                          className={`py-[3px] px-2.5 rounded-[20px] text-[11px] font-semibold uppercase ${statusColor(
                            item.status
                          )}`}
                        >
                          {item.status}
                        </span>
                      </td>
                      <td className="py-3 px-4 text-slate-700">
                        <span className="text-xs text-slate-500">{item.source || "email"}</span>
                      </td>
                      <td className="py-3 px-4 text-slate-700">
                        {item.confidence ? `${item.confidence}%` : "—"}
                      </td>
                      <td className="py-3 px-4 text-slate-700">
                        <span className="text-[13px] text-slate-500">{fmtDate(item.processed_at)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="p-10 text-center text-slate-400">No items yet</div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ClientDetailPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <ClientDetailContent />
    </Suspense>
  );
}
