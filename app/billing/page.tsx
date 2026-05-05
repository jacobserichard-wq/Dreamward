"use client";

import { useState, useEffect } from "react";
import Spinner from "../components/Spinner";
import ErrorBanner from "../components/ErrorBanner";
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
    features: ["1 Gmail account", "100 items/month", "Expense tracking", "Dashboard"],
  },
  growth: {
    name: "Growth",
    price: "$49/mo",
    features: ["3 Gmail accounts", "Unlimited processing", "Events & mileage", "AR follow-up", "CSV/PDF exports"],
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
      <div style={s.container}>
        <div style={s.content}>
          <div style={{ textAlign: "center", color: "#64748b", padding: 60, display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
            <Spinner size={20} />
            <span>Loading billing information...</span>
          </div>
        </div>
      </div>
    );
  }

  if (!billing) {
    return (
      <div style={s.container}>
        <div style={s.content}>
          <p style={{ textAlign: "center", color: "#dc2626", padding: 60 }}>{error || "Unable to load billing"}</p>
        </div>
      </div>
    );
  }

  const currentPlan = PLAN_DETAILS[billing.plan] || PLAN_DETAILS.trial;
  const usagePct = billing.usage.maxItems
    ? Math.min(Math.round((billing.usage.itemsThisMonth / billing.usage.maxItems) * 100), 100)
    : null;

  return (
    <div style={s.container}>
      <div style={s.content}>
        {/* Header */}
        <div style={s.header}>
          <a href="/" style={s.backLink}>{"\u2190"} Back to FlowWork</a>
          <h1 style={s.title}>Billing & Plan</h1>
          <p style={s.subtitle}>{billing.email}</p>
        </div>

        {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

        {/* Current Plan Card */}
        <div style={s.card}>
          <div style={s.cardHeader}>
            <div>
              <h2 style={s.cardTitle}>Current plan</h2>
              <div style={s.planRow}>
                <span style={s.planName}>{currentPlan.name}</span>
                <span style={s.planPrice}>{currentPlan.price}</span>
              </div>
            </div>
            {billing.stripeCustomerId && (
              <button
                onClick={openPortal}
                disabled={actionLoading === "portal"}
                style={{
                  ...s.portalBtn,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  ...(actionLoading === "portal" ? { opacity: 0.6, cursor: "wait" } : {}),
                }}
              >
                {actionLoading === "portal" && <Spinner size={14} color="#334155" />}
                {actionLoading === "portal" ? "Opening portal..." : "Manage subscription"}
              </button>
            )}
          </div>

          {billing.plan === "trial" && billing.trialEndsAt && (
            <div style={s.trialBanner}>
              {"Trial ends "}{new Date(billing.trialEndsAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
            </div>
          )}

          {/* Usage */}
          <div style={s.usageSection}>
            <div style={s.usageHeader}>
              <span style={s.usageLabel}>Items processed this month</span>
              <span style={s.usageCount}>
                {billing.usage.itemsThisMonth}
                {billing.usage.maxItems ? ` / ${billing.usage.maxItems}` : " (unlimited)"}
              </span>
            </div>
            {usagePct !== null && (
              <div style={s.usageBarBg}>
                <div style={{
                  ...s.usageBarFill,
                  width: `${usagePct}%`,
                  background: usagePct >= 90 ? "#dc2626" : usagePct >= 70 ? "#f59e0b" : "#16a34a",
                }} />
              </div>
            )}
          </div>

          {/* Current features */}
          <div style={s.featureList}>
            {currentPlan.features.map((f) => (
              <div key={f} style={s.featureItem}>
                <span style={s.featureCheck}>{"\u2713"}</span>
                <span>{f}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Plan Comparison */}
        <h2 style={s.sectionTitle}>
          {billing.plan === "canceled" ? "Reactivate your plan" : "Upgrade your plan"}
        </h2>
        <div style={s.planGrid}>
          {(["starter", "growth", "pro"] as const).map((planId) => {
            const plan = PLAN_DETAILS[planId];
            const isCurrent = billing.plan === planId;
            const isDowngrade = (
              (billing.plan === "pro" && (planId === "starter" || planId === "growth")) ||
              (billing.plan === "growth" && planId === "starter")
            );

            return (
              <div key={planId} style={{
                ...s.planCard,
                ...(isCurrent ? s.planCardCurrent : {}),
                ...(planId === "growth" ? s.planCardFeatured : {}),
              }}>
                {planId === "growth" && <div style={s.popularBadge}>Most popular</div>}
                <h3 style={s.planCardName}>{plan.name}</h3>
                <div style={s.planCardPrice}>{plan.price}</div>
                <div style={s.planCardFeatures}>
                  {plan.features.map((f) => (
                    <div key={f} style={s.planCardFeature}>
                      <span style={s.featureCheck}>{"\u2713"}</span>
                      <span>{f}</span>
                    </div>
                  ))}
                </div>
                {isCurrent ? (
                  <div style={s.currentLabel}>Current plan</div>
                ) : isDowngrade ? (
                  <button
                    onClick={openPortal}
                    disabled={actionLoading === "portal"}
                    style={{
                      ...s.downgradeBtn,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 8,
                      ...(actionLoading === "portal" ? { opacity: 0.6, cursor: "wait" } : {}),
                    }}
                  >
                    {actionLoading === "portal" && <Spinner size={14} color="#64748b" />}
                    {actionLoading === "portal" ? "Opening portal..." : "Manage in portal"}
                  </button>
                ) : (
                  <button
                    onClick={() => startCheckout(planId)}
                    disabled={actionLoading === planId}
                    style={{
                      ...s.upgradeBtn,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 8,
                      ...(actionLoading === planId ? { opacity: 0.7, cursor: "wait" } : {}),
                    }}
                  >
                    {actionLoading === planId && <Spinner size={14} color="white" />}
                    {actionLoading === planId ? "Starting checkout..." : `Upgrade to ${plan.name}`}
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

// ─── Styles ──────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  container: {
    minHeight: "100vh",
    background: "#f8fafc",
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  },
  content: { maxWidth: 900, margin: "0 auto", padding: "32px 24px" },
  header: { marginBottom: 32 },
  backLink: {
    fontSize: 14,
    color: "#3b82f6",
    textDecoration: "none",
    display: "inline-block",
    marginBottom: 12,
  },
  title: { fontSize: 28, fontWeight: 700, color: "#0f172a", margin: "0 0 4px" },
  subtitle: { fontSize: 14, color: "#64748b", margin: 0 },

  card: {
    background: "white",
    borderRadius: 12,
    border: "1px solid #e2e8f0",
    padding: "24px",
    marginBottom: 32,
  },
  cardHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    marginBottom: 20,
    flexWrap: "wrap" as const,
    gap: 12,
  },
  cardTitle: { fontSize: 13, fontWeight: 500, color: "#64748b", margin: "0 0 8px", textTransform: "uppercase" as const, letterSpacing: "0.5px" },
  planRow: { display: "flex", alignItems: "baseline", gap: 12 },
  planName: { fontSize: 24, fontWeight: 700, color: "#0f172a" },
  planPrice: { fontSize: 18, fontWeight: 600, color: "#64748b" },
  portalBtn: {
    padding: "10px 20px",
    borderRadius: 8,
    border: "1px solid #e2e8f0",
    background: "white",
    cursor: "pointer",
    fontSize: 14,
    fontWeight: 500,
    color: "#334155",
  },

  trialBanner: {
    background: "#fefce8",
    border: "1px solid #fde68a",
    color: "#92400e",
    padding: "10px 16px",
    borderRadius: 8,
    fontSize: 14,
    marginBottom: 20,
  },

  usageSection: { marginBottom: 20 },
  usageHeader: { display: "flex", justifyContent: "space-between", marginBottom: 8 },
  usageLabel: { fontSize: 14, color: "#64748b" },
  usageCount: { fontSize: 14, fontWeight: 600, color: "#0f172a" },
  usageBarBg: { height: 8, borderRadius: 4, background: "#e2e8f0" },
  usageBarFill: { height: 8, borderRadius: 4, transition: "width 0.3s" },

  featureList: { display: "flex", flexDirection: "column" as const, gap: 8 },
  featureItem: { display: "flex", alignItems: "center", gap: 8, fontSize: 14, color: "#334155" },
  featureCheck: { color: "#16a34a", fontWeight: 700, fontSize: 14 },

  sectionTitle: { fontSize: 20, fontWeight: 700, color: "#0f172a", marginBottom: 16 },

  planGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(250px, 1fr))",
    gap: 16,
    marginBottom: 32,
  },
  planCard: {
    background: "white",
    borderRadius: 12,
    border: "1px solid #e2e8f0",
    padding: "24px",
    display: "flex",
    flexDirection: "column" as const,
    position: "relative" as const,
  },
  planCardCurrent: { borderColor: "#3b82f6", borderWidth: 2 },
  planCardFeatured: { borderColor: "#8b5cf6", borderWidth: 2 },
  popularBadge: {
    position: "absolute" as const,
    top: -12,
    left: "50%",
    transform: "translateX(-50%)",
    background: "#8b5cf6",
    color: "white",
    fontSize: 12,
    fontWeight: 600,
    padding: "4px 16px",
    borderRadius: 20,
    whiteSpace: "nowrap" as const,
  },
  planCardName: { fontSize: 20, fontWeight: 700, color: "#0f172a", margin: "8px 0 4px" },
  planCardPrice: { fontSize: 28, fontWeight: 800, color: "#0f172a", marginBottom: 16 },
  planCardFeatures: { display: "flex", flexDirection: "column" as const, gap: 8, marginBottom: 20, flex: 1 },
  planCardFeature: { display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#475569" },
  currentLabel: {
    textAlign: "center" as const,
    padding: "10px",
    fontSize: 14,
    fontWeight: 600,
    color: "#3b82f6",
    background: "#eff6ff",
    borderRadius: 8,
  },
  upgradeBtn: {
    padding: "12px",
    borderRadius: 8,
    border: "none",
    background: "#16a34a",
    color: "white",
    cursor: "pointer",
    fontSize: 14,
    fontWeight: 600,
    textAlign: "center" as const,
  },
  downgradeBtn: {
    padding: "12px",
    borderRadius: 8,
    border: "1px solid #e2e8f0",
    background: "white",
    color: "#64748b",
    cursor: "pointer",
    fontSize: 14,
    fontWeight: 500,
    textAlign: "center" as const,
  },
};