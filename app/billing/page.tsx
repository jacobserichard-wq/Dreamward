"use client";

import { useState, useEffect } from "react";
import Spinner from "../components/Spinner";
import ErrorBanner from "../components/ErrorBanner";
import PageHeader from "../components/PageHeader";
import AppHeader from "../components/AppHeader";
import { apiFetch } from "@/lib/apiFetch";
import { TIER_DISPLAY, type PaidPlanName } from "@/lib/plans";

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

// Sub-session 33 pricing pivot. The billing page now reflects the
// "Built for people. Priced for people." model: every paying tier
// gets every feature, tiers differ only by business-size bracket +
// service level. The tier order matters for the comparison grid +
// the "is this a downgrade?" check.
const TIER_ORDER: PaidPlanName[] = ["dream", "maker", "growth", "pro"];

/** Per-tier service-level feature bullets shown on the comparison
 *  cards. Deliberately NOT product features — those are flat across
 *  all tiers (see the "every tier includes" note). These bullets
 *  describe what changes as you move up: support speed + onboarding
 *  depth. */
const TIER_SERVICE_FEATURES: Record<PaidPlanName, string[]> = {
  dream: [
    "Every product feature",
    "All integrations",
    "Standard email support",
  ],
  maker: [
    "Every product feature",
    "All integrations",
    "Standard email support",
  ],
  growth: [
    "Everything in Maker",
    "Priority support",
    "Faster response times",
  ],
  pro: [
    "Everything in Growth",
    "Same-day priority support",
    "Dedicated support contact",
  ],
};

/** Display metadata for the non-paid plan states. */
const STATE_DISPLAY: Record<
  "trial" | "canceled",
  { name: string; price: string }
> = {
  trial: { name: "Free Trial", price: "$0" },
  canceled: { name: "Canceled", price: "$0" },
};

function fmtRevenueBracket(low: number, high: number): string {
  const fmtK = (n: number) =>
    n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${n}`;
  if (high === Infinity) return `${fmtK(low)}+/year revenue`;
  if (low === 0) return `Under ${fmtK(high)}/year revenue`;
  return `${fmtK(low)}–${fmtK(high)}/year revenue`;
}

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

  // Resolve display for the current plan. Paid tiers come from
  // TIER_DISPLAY; trial/canceled from STATE_DISPLAY; anything
  // unrecognized falls back to trial.
  const paidTier = TIER_DISPLAY[billing.plan as PaidPlanName];
  const currentPlanName = paidTier
    ? paidTier.name
    : STATE_DISPLAY[billing.plan as "trial" | "canceled"]?.name ??
      STATE_DISPLAY.trial.name;
  const currentPlanPrice = paidTier
    ? `$${paidTier.priceMonthly}/mo`
    : STATE_DISPLAY[billing.plan as "trial" | "canceled"]?.price ??
      STATE_DISPLAY.trial.price;
  const currentPlanBracket = paidTier
    ? fmtRevenueBracket(paidTier.revenueLow, paidTier.revenueHigh)
    : null;
  const currentServiceFeatures = paidTier
    ? TIER_SERVICE_FEATURES[paidTier.id]
    : billing.plan === "canceled"
      ? ["Dashboard only — reactivate to restore full access"]
      : ["Full access during your 14-day trial"];
  const usagePct = billing.usage.maxItems
    ? Math.min(Math.round((billing.usage.itemsThisMonth / billing.usage.maxItems) * 100), 100)
    : null;

  return (
    <div className="min-h-screen bg-slate-50 font-sans">
      <AppHeader />
      <div className="max-w-[900px] mx-auto py-8 px-4 sm:px-6">
        <PageHeader
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
                <span className="text-2xl font-bold text-slate-900">{currentPlanName}</span>
                <span className="text-lg font-semibold text-slate-500">{currentPlanPrice}</span>
              </div>
              {currentPlanBracket && (
                <p className="text-xs text-slate-500 m-0 mt-1">
                  {currentPlanBracket} · auto-adjusts as you grow
                </p>
              )}
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
            {currentServiceFeatures.map((f) => (
              <div key={f} className="flex items-center gap-2 text-sm text-slate-700">
                <span className="text-green-600 font-bold text-sm">{"✓"}</span>
                <span>{f}</span>
              </div>
            ))}
          </div>
        </div>

        {/* "Every tier includes" reassurance — reinforces the
            no-feature-gates promise before the comparison grid. */}
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 mb-6 text-sm text-emerald-900">
          <strong>Every tier includes every feature.</strong> Integrations,
          COGS, gross margin, live stock, Schedule-C reports, receipt vault —
          all of it, on every plan. You&apos;re billed by your business size,
          not by which tools you&apos;re allowed to use. As your tracked
          revenue grows, your tier auto-adjusts on a calendar-month boundary.
        </div>

        {/* Plan Comparison */}
        <h2 className="text-xl font-bold text-slate-900 mb-1">
          {billing.plan === "canceled" ? "Reactivate your plan" : "Choose your tier"}
        </h2>
        <p className="text-sm text-slate-500 mb-4">
          Pick the tier that matches your current revenue. We&apos;ll move you
          up automatically as you grow — no upsell calls.
        </p>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(230px,1fr))] gap-4 mb-8">
          {TIER_ORDER.map((planId) => {
            const tier = TIER_DISPLAY[planId];
            const isCurrent = billing.plan === planId;
            // Downgrade = target tier sits below the current paid tier
            // in TIER_ORDER. Stripe portal handles proration on
            // downgrades; checkout handles upgrades + new subs.
            const currentIdx = TIER_ORDER.indexOf(billing.plan as PaidPlanName);
            const targetIdx = TIER_ORDER.indexOf(planId);
            const isDowngrade = currentIdx >= 0 && targetIdx < currentIdx;

            // Maker carries the "Most popular" highlight (the new
            // conversion sweet spot for solo makers).
            const borderClass =
              planId === "maker"
                ? "border-2 border-violet-500"
                : isCurrent
                ? "border-2 border-blue-500"
                : "border border-slate-200";

            return (
              <div
                key={planId}
                className={`bg-white rounded-xl p-6 flex flex-col relative ${borderClass}`}
              >
                {planId === "maker" && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-violet-500 text-white text-xs font-semibold py-1 px-4 rounded-[20px] whitespace-nowrap">
                    Most popular
                  </div>
                )}
                <h3 className="text-xl font-bold text-slate-900 mt-2 mb-0.5">{tier.name}</h3>
                <div className="text-3xl font-extrabold text-slate-900 mb-0.5">
                  ${tier.priceMonthly}
                  <span className="text-sm font-medium text-slate-400">/mo</span>
                </div>
                <p className="text-xs text-slate-500 m-0 mb-4">
                  {fmtRevenueBracket(tier.revenueLow, tier.revenueHigh)}
                </p>
                <div className="flex flex-col gap-2 mb-5 flex-1">
                  {TIER_SERVICE_FEATURES[planId].map((f) => (
                    <div key={f} className="flex items-start gap-2 text-[13px] text-slate-600">
                      <span className="text-green-600 font-bold text-sm mt-0.5">{"✓"}</span>
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
                    {actionLoading === "portal" ? "Opening portal..." : "Change in portal"}
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
                      : isCurrent
                        ? "Current plan"
                        : `Choose ${tier.name}`}
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
