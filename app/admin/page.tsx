"use client";

import { useState, useEffect } from "react";
import PageHeader from "../components/PageHeader";
import { planColor } from "@/lib/planColor";

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

export default function AdminPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadAdmin() {
      try {
        const res = await fetch("/api/admin");
        if (res.status === 403) {
          setError("Access denied. Admin only.");
          setLoading(false);
          return;
        }
        if (!res.ok) throw new Error("Failed to load");
        const data = await res.json();
        setClients(data.clients || []);
      } catch {
        setError("Failed to load admin data");
      } finally {
        setLoading(false);
      }
    }
    loadAdmin();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 font-sans">
        <div className="max-w-[1100px] mx-auto py-8 px-4 sm:px-6">
          <p className="text-center p-[60px] text-slate-500">Loading admin dashboard...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 font-sans">
        <div className="max-w-[1100px] mx-auto py-8 px-4 sm:px-6">
          <div className="bg-red-50 border border-red-200 rounded-xl p-8 text-center text-red-800">
            <h2 className="m-0 mb-2 text-xl">{"\u{1F6AB}"} Access Denied</h2>
            <p className="m-0 text-slate-500">{error}</p>
          </div>
        </div>
      </div>
    );
  }

  const totalRevenue = clients.reduce((sum, c) => {
    const prices: Record<string, number> = { starter: 19, growth: 49, pro: 89 };
    return sum + (prices[c.plan] || 0);
  }, 0);

  const planCounts = clients.reduce((acc, c) => {
    acc[c.plan] = (acc[c.plan] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="min-h-screen bg-slate-50 font-sans">
      <div className="max-w-[1100px] mx-auto py-8 px-4 sm:px-6">
        <PageHeader
          backHref="/"
          backLabel="FlowWork"
          title={<>{"\u{1F6E0}️"} Admin Dashboard</>}
          subtitle={`${clients.length} total clients`}
        />

        {/* Summary Stats */}
        <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-4 mb-8">
          <div className="bg-white rounded-xl border border-slate-200 py-5 px-6">
            <div className="text-3xl font-extrabold text-slate-900">{clients.length}</div>
            <div className="text-[13px] text-slate-500 mt-1">Total Clients</div>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 py-5 px-6">
            <div className="text-3xl font-extrabold text-slate-900">${totalRevenue}</div>
            <div className="text-[13px] text-slate-500 mt-1">Monthly Revenue</div>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 py-5 px-6">
            <div className="text-3xl font-extrabold text-slate-900">{planCounts.trial || 0}</div>
            <div className="text-[13px] text-slate-500 mt-1">On Trial</div>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 py-5 px-6">
            <div className="text-3xl font-extrabold text-slate-900">
              {(planCounts.starter || 0) + (planCounts.growth || 0) + (planCounts.pro || 0)}
            </div>
            <div className="text-[13px] text-slate-500 mt-1">Paying</div>
          </div>
        </div>

        {/* Client Table */}
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="py-4 px-6 border-b border-slate-200">
            <h2 className="text-lg font-bold text-slate-900 m-0">All Clients</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider bg-slate-50 border-b border-slate-200">Business</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider bg-slate-50 border-b border-slate-200">Email</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider bg-slate-50 border-b border-slate-200">Plan</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider bg-slate-50 border-b border-slate-200">Industry</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider bg-slate-50 border-b border-slate-200">Items</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider bg-slate-50 border-b border-slate-200">This Month</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider bg-slate-50 border-b border-slate-200">Onboarded</th>
                  <th className="text-left py-3 px-4 text-xs font-semibold text-slate-500 uppercase tracking-wider bg-slate-50 border-b border-slate-200">Joined</th>
                </tr>
              </thead>
              <tbody>
                {clients.map((client) => (
                  <tr
                    key={client.id}
                    onClick={() => (window.location.href = `/admin/client?id=${client.id}`)}
                    className="border-b border-slate-100 cursor-pointer"
                  >
                    <td className="py-3.5 px-4 text-slate-700">
                      <span className="font-semibold text-slate-900">
                        {client.business_name || "—"}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-slate-700">
                      <span className="text-[13px] text-slate-500">{client.email}</span>
                    </td>
                    <td className="py-3.5 px-4 text-slate-700">
                      <span
                        className={`py-[3px] px-2.5 rounded-[20px] text-xs font-semibold uppercase tracking-[0.3px] ${planColor(client.plan)}`}
                      >
                        {client.plan}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-slate-700">
                      <span className="text-[13px] text-slate-500 capitalize">
                        {client.industry || "—"}
                      </span>
                    </td>
                    <td className="py-3.5 px-4 text-slate-700">{client.total_items}</td>
                    <td className="py-3.5 px-4 text-slate-700">{client.items_this_month}</td>
                    <td className="py-3.5 px-4 text-slate-700">
                      {client.onboarding_completed ? (
                        <span className="text-green-600 font-bold">{"✓"}</span>
                      ) : (
                        <span className="text-red-600 font-bold">{"✗"}</span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 text-slate-700">
                      <span className="text-[13px] text-slate-500">
                        {client.created_at
                          ? new Date(client.created_at).toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            })
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
