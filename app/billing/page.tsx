"use client";

import { useState, useEffect } from "react";
import Spinner from "../components/Spinner";
import ErrorBanner from "../components/ErrorBanner";
import PageHeader from "../components/PageHeader";
import AppHeader from "../components/AppHeader";
import { apiFetch } from "@/lib/apiFetch";
import { TIER_DISPLAY, BANDS, serviceTierLabel, type PaidPlanName } from "@/lib/plans";
import { SUPPORT_EMAIL } from "@/lib/support";

interface BillingData {
  plan: string;
  billingSource?: "stripe" | "shopify";
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

// Sub-session 33 pricing pivot → 7-band ladder. The billing page
// reflects "Built for people. Priced for people.": every paying band
// gets every feature, and the customer never picks a band — price is
// set by trailing-12-month revenue and auto-adjusts one step at a time.

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
        setError(`Billing portal returned no URL — please email ${SUPPORT_EMAIL}.`);
        setActionLoading(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't open billing portal");
      setActionLoading(null);
    }
  };

  // Revenue-driven: no band to pass. The server computes the band from
  // the customer's trailing revenue and starts the subscription there.
  const startCheckout = async () => {
    setActionLoading("checkout");
    setError(null);
    try {
      const data = await apiFetch<{ url?: string }>("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (data.url) {
        window.location.href = data.url;
      } else {
        setError(`Checkout returned no URL — please email ${SUPPORT_EMAIL}.`);
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

  // Shopify-billed clients (App Store installs) manage everything in
  // the Shopify admin — showing them the Stripe ladder or checkout
  // would risk double-billing and violates App Store req 1.2. Render
  // a dedicated card and nothing else.
  if (billing.billingSource === "shopify") {
    return (
      <div className="min-h-screen bg-slate-50 font-sans">
        <AppHeader />
        <div className="max-w-[900px] mx-auto py-8 px-4 sm:px-6">
          <PageHeader title="Billing & Plan" subtitle={billing.email} />
          {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
          <div className="bg-white rounded-xl border border-slate-200 p-6">
            <h2 className="text-[13px] font-medium text-slate-500 mb-2 uppercase tracking-wider m-0">
              Current plan
            </h2>
            <div className="flex items-baseline gap-3 mb-4">
              <span className="text-2xl font-bold text-slate-900">
                {billing.plan === "shopify" ? "Dreamward Pro" : "No active plan"}
              </span>
              <span className="text-lg font-semibold text-slate-500">
                {billing.plan === "shopify" ? "$10/mo" : ""}
              </span>
            </div>
            <p className="text-sm text-slate-600 m-0">
              Your subscription is billed through <strong>Shopify</strong> —
              it appears on your regular Shopify invoice. To view, change, or
              cancel your plan, open the Dreamward app&apos;s page in your
              Shopify admin. Every feature is included; nothing to configure
              here.
            </p>
            {billing.plan !== "shopify" && (
              <p className="text-sm text-amber-700 bg-yellow-50 border border-amber-200 rounded-lg py-2.5 px-4 mt-4 m-0">
                No active Shopify subscription found — choose a plan from the
                Dreamward listing in your Shopify admin to restore access.
              </p>
            )}
          </div>
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
    ? [
        "Every product feature",
        "All integrations",
        serviceTierLabel(paidTier.serviceTier),
      ]
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

        {/* Revenue-band ladder — informational. The customer never
            picks a band; their price is set by trailing revenue and
            auto-adjusts one step at a time. */}
        <h2 className="text-xl font-bold text-slate-900 mb-1">
          {billing.plan === "canceled" ? "Reactivate your plan" : "Your pricing ladder"}
        </h2>
        <p className="text-sm text-slate-500 mb-4">
          Your price is set by your trailing 12 months of revenue tracked in
          Dreamward — it moves up (and down) one band at a time,
          automatically. You never pick a tier.
        </p>
        <div className="bg-white rounded-xl border border-slate-200 divide-y divide-slate-100 mb-6">
          {BANDS.map((b) => {
            const isCurrent = billing.plan === b.id;
            return (
              <div
                key={b.id}
                className={`flex items-center justify-between px-5 py-3 ${
                  isCurrent ? "bg-blue-50" : ""
                }`}
              >
                <div className="flex items-center gap-3">
                  <span className="text-sm font-medium text-slate-700">
                    {fmtRevenueBracket(b.revenueLow, b.revenueHigh)}
                  </span>
                  {isCurrent && (
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-blue-600 bg-blue-100 px-2 py-0.5 rounded-full">
                      You&apos;re here
                    </span>
                  )}
                </div>
                <span className="text-sm font-bold text-slate-900">
                  ${b.price}
                  <span className="text-xs font-medium text-slate-400">/mo</span>
                </span>
              </div>
            );
          })}
        </div>

        {/* CTA — trial/canceled users start a subscription; the band is
            computed server-side from their revenue. Paying users change
            via the "Manage subscription" portal button in the card
            above (and the cron auto-adjusts their band monthly). */}
        {(billing.plan === "trial" || billing.plan === "canceled") && (
          <button
            onClick={startCheckout}
            disabled={actionLoading === "checkout"}
            className={`w-full sm:w-auto p-3 px-6 rounded-lg border-0 bg-green-600 text-white cursor-pointer text-sm font-semibold inline-flex items-center justify-center gap-2 mb-8 ${
              actionLoading === "checkout" ? "opacity-70 cursor-wait" : ""
            }`}
          >
            {actionLoading === "checkout" && <Spinner size={14} color="white" />}
            {actionLoading === "checkout"
              ? "Starting checkout..."
              : billing.plan === "canceled"
                ? "Reactivate subscription"
                : "Start your subscription"}
          </button>
        )}
      </div>
    </div>
  );
}
