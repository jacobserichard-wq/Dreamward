"use client";

import { useState, useEffect } from "react";
import Spinner from "../components/Spinner";
import ErrorBanner from "../components/ErrorBanner";
import PageHeader from "../components/PageHeader";
import { apiFetch } from "@/lib/apiFetch";

interface BillingData {
  plan: string;
  email: string;
  businessName: string;
  trialEndsAt: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  usage: {
    itemsThisMonth: number;
    maxItems: number | null;
  };
  features: {
    modules: string[];
    labels: string[];
  };
}

const PLAN_DETAILS: Record<string, { name: string; price: string; features: string[] }> = {
  trial: {
    name: "Free Trial",
    price: "$0",
    features: ["1 Gmail account", "25 items/month", "Expense tracking", "Dashboard"],
  },
  starter: {
    name: "Starter",
    price: "$19/mo",
    features: ["100 items/month", "Expense tracking", "Dashboard"],
  },
  growth: {
    name: "Growth",
    price: "$49/mo",
    features: ["Unlimited processing", "Events & mileage", "AR follow-up", "CSV/PDF exports"],
  },
  pro: {
    name: "Pro",
    price: "$89/mo",
    features: ["10 Gmail accounts", "Unlimited processing", "Custom categories", "Tax reports", "Onboarding call"],
  },
  canceled: {
    name: "Canceled",
    price: "$0",
    features: ["Dashboard only"],
  },
};

export default function BillingPage() {
  const [billing, setBilling] = useState<BillingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadBilling() {
      try {
        const data = await apiFetch<BillingData>("/api/billing");
        setBilling(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Couldn't load billing information");
      } finally {
        setLoading(false);
      }
    }
    loadBilling();
  }, []);

  const openPortal = async () => {
    setActionLoading("portal");
    setError(null);
    try {
      const data = await apiFetch<{ url?: string }>("/api/stripe/portal", { method: "POST" });
      if (data.url) {
        window.location.href = data.url;
      } else {
        setError("Billing portal returned no URL — please contact support.");
        setActionLoading(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't open billing portal");
      setActionLoading(null);
    }
  };

  const startCheckout = async (planId: string) => {
    setActionLoading(planId);
    setError(null);
    try {
      const data = await apiFetch<{ url?: string }>("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId }),
      });
      if (data.url) {
        window.location.href = data.url;
      } else {
        setError("Checkout returned no URL — please contact support.");
        setActionLoading(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't start checkout");
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 font-sans">
        <div className="max-w-[900px] mx-auto py-8 px-4 sm:px-6">
          <div className="text-center text-slate-500 p-[60px] flex items-center justify-center gap-2.5">
            <Spinner size={20} />
            <span>Loading billing information...</span>
          </div>
        </div>
      </div>
    );
  }

  if (!billing) {
    return (
      <div className="min-h-screen bg-slate-50 font-sans">
        <div className="max-w-[900px] mx-auto py-8 px-4 sm:px-6">
          <p className="text-center text-red-600 p-[60px]">{error || "Unable to load billing"}</p>
        </div>
      </div>
    );
  }

  const currentPlan = PLAN_DETAILS[billing.plan] || PLAN_DETAILS.trial;
  const usagePct = billing.usage.maxItems
    ? Math.min(Math.round((billing.usage.itemsThisMonth / billing.usage.maxItems) * 100), 100)
    : null;

  return (
    <div className="min-h-screen bg-slate-50 font-sans">
      <div className="max-w-[900px] mx-auto py-8 px-4 sm:px-6">
        <PageHeader
          backHref="/"
          backLabel="FlowWork"
          title="Billing & Plan"
          subtitle={billing.email}
        />

        {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

        {/* Current Plan Card */}
        <div className="bg-white rounded-xl border border-slate-200 p-6 mb-8">
          <div className="flex justify-between items-start mb-5 flex-wrap gap-3">
            <div>
              <h2 className="text-[13px] font-medium text-slate-500 mb-2 uppercase tracking-wider m-0">
                Current plan
              </h2>
              <div className="flex items-baseline gap-3">
                <span className="text-2xl font-bold text-slate-900">{currentPlan.name}</span>
                <span className="text-lg font-semibold text-slate-500">{currentPlan.price}</span>
              </div>
            </div>
            {billing.stripeCustomerId && (
              <button
                onClick={openPortal}
                disabled={actionLoading === "portal"}
                className={`py-2.5 px-5 rounded-lg border border-slate-200 bg-white cursor-pointer text-sm font-medium text-slate-700 inline-flex items-center gap-2 ${
                  actionLoading === "portal" ? "opacity-60 cursor-wait" : ""
                }`}
              >
                {actionLoading === "portal" && <Spinner size={14} color="#334155" />}
                {actionLoading === "portal" ? "Opening portal..." : "Manage subscription"}
              </button>
            )}
          </div>

          {billing.plan === "trial" && billing.trialEndsAt && (
            <div className="bg-yellow-50 border border-amber-200 text-amber-800 py-2.5 px-4 rounded-lg text-sm mb-5">
              {"Trial ends "}
              {new Date(billing.trialEndsAt).toLocaleDateString("en-US", {
                month: "long",
                day: "numeric",
                year: "numeric",
              })}
            </div>
          )}

          {/* Usage */}
          <div className="mb-5">
            <div className="flex justify-between mb-2">
              <span className="text-sm text-slate-500">Items processed this month</span>
              <span className="text-sm font-semibold text-slate-900">
                {billing.usage.itemsThisMonth}
                {billing.usage.maxItems ? ` / ${billing.usage.maxItems}` : " (unlimited)"}
              </span>
            </div>
            {usagePct !== null && (
              <div className="h-2 rounded bg-slate-200">
                <div
                  className={`h-2 rounded transition-[width] duration-300 ${
                    usagePct >= 90
                      ? "bg-red-600"
                      : usagePct >= 70
                      ? "bg-amber-500"
                      : "bg-green-600"
                  }`}
                  style={{ width: `${usagePct}%` }}
                />
              </div>
            )}
          </div>

          {/* Current features */}
          <div className="flex flex-col gap-2">
            {currentPlan.features.map((f) => (
              <div key={f} className="flex items-center gap-2 text-sm text-slate-700">
                <span className="text-green-600 font-bold text-sm">{"✓"}</span>
                <span>{f}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Plan Comparison */}
        <h2 className="text-xl font-bold text-slate-900 mb-4">
          {billing.plan === "canceled" ? "Reactivate your plan" : "Upgrade your plan"}
        </h2>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(250px,1fr))] gap-4 mb-8">
          {(["starter", "growth", "pro"] as const).map((planId) => {
            const plan = PLAN_DETAILS[planId];
            const isCurrent = billing.plan === planId;
            const isDowngrade =
              (billing.plan === "pro" && (planId === "starter" || planId === "growth")) ||
              (billing.plan === "growth" && planId === "starter");

            // Border precedence: featured > current > default. Matches the
            // original spread-order behavior where planCardFeatured overrode
            // planCardCurrent.
            const borderClass =
              planId === "growth"
                ? "border-2 border-violet-500"
                : isCurrent
                ? "border-2 border-blue-500"
                : "border border-slate-200";

            return (
              <div
                key={planId}
                className={`bg-white rounded-xl p-6 flex flex-col relative ${borderClass}`}
              >
                {planId === "growth" && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-violet-500 text-white text-xs font-semibold py-1 px-4 rounded-[20px] whitespace-nowrap">
                    Most popular
                  </div>
                )}
                <h3 className="text-xl font-bold text-slate-900 mt-2 mb-1">{plan.name}</h3>
                <div className="text-3xl font-extrabold text-slate-900 mb-4">{plan.price}</div>
                <div className="flex flex-col gap-2 mb-5 flex-1">
                  {plan.features.map((f) => (
                    <div key={f} className="flex items-center gap-2 text-[13px] text-slate-600">
                      <span className="text-green-600 font-bold text-sm">{"✓"}</span>
                      <span>{f}</span>
                    </div>
                  ))}
                </div>
                {isCurrent ? (
                  <div className="text-center p-2.5 text-sm font-semibold text-blue-500 bg-blue-50 rounded-lg">
                    Current plan
                  </div>
                ) : isDowngrade ? (
                  <button
                    onClick={openPortal}
                    disabled={actionLoading === "portal"}
                    className={`p-3 rounded-lg border border-slate-200 bg-white cursor-pointer text-sm font-medium text-slate-500 text-center inline-flex items-center justify-center gap-2 ${
                      actionLoading === "portal" ? "opacity-60 cursor-wait" : ""
                    }`}
                  >
                    {actionLoading === "portal" && <Spinner size={14} color="#64748b" />}
                    {actionLoading === "portal" ? "Opening portal..." : "Manage in portal"}
                  </button>
                ) : (
                  <button
                    onClick={() => startCheckout(planId)}
                    disabled={actionLoading === planId}
                    className={`p-3 rounded-lg border-0 bg-green-600 text-white cursor-pointer text-sm font-semibold text-center inline-flex items-center justify-center gap-2 ${
                      actionLoading === planId ? "opacity-70 cursor-wait" : ""
                    }`}
                  >
                    {actionLoading === planId && <Spinner size={14} color="white" />}
                    {actionLoading === planId
                      ? "Starting checkout..."
                      : `Upgrade to ${plan.name}`}
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
