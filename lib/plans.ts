// Sub-session 33 strategic pricing pivot. "Built for people. Priced
// for people." — feature-flat pricing where every paying tier gets
// every product feature. Tiers differentiate by business size
// (auto-switched based on annual revenue tracked through the app)
// and by service level (support response time + onboarding depth),
// never by which features the customer is allowed to use.
//
// Old model (deprecated): starter/growth/pro gated COGS, integrations,
// reports, etc. behind Pro. Solo makers could not evaluate the
// product's actual value without paying $89/mo.
//
// New model: Dream / Maker / Growth / Pro all list every module.
// Service-level perks (priority support, white-glove onboarding,
// quarterly check-ins) are the only Pro-tier extras. Trial keeps
// 14-day full access; Canceled retains read-only dashboard.
//
// Revenue thresholds drive automatic tier switching via a monthly
// cron job (lib/revenueTier.ts). Customer never picks a tier
// manually; they sign up, FlowWork places them on Dream by default,
// then bumps them up as their tracked revenue crosses thresholds.

/** Maximum annual revenue (USD) covered by each tier. Set to
 *  Infinity on Pro because Pro is the ceiling. Trial / Canceled
 *  don't have revenue thresholds — they're transient states. */
export const PLAN_REVENUE_THRESHOLDS = {
  dream: 5_000,
  maker: 50_000,
  growth: 500_000,
  pro: Infinity,
} as const;

/** Feature set per plan. Note: all paying tiers (and the 14-day
 *  trial) list the same `modules` array — that's the strategic
 *  promise. The differentiator is `service.tier` below, not
 *  features.
 *
 *  `labels` is retained for forward compatibility with the Gmail
 *  feature flag (FEATURES.GMAIL_INGEST). All tiers currently
 *  hold the same labels array; when GMAIL_INGEST flips back to
 *  true, the route handler reads from the canonical Pro labels
 *  list. Keeping the field on every tier means flipping the flag
 *  doesn't require a plan-registry migration. */
const ALL_MODULES = [
  "invoices",
  "expenses",
  "dashboard",
  "events",
  "mileage",
  "ar",
  "exports",
  "custom_categories",
  "tax_reports",
  "integrations",
  "cogs",
  "stock_tracking",
  "receipt_vault",
] as const;

export const PLAN_FEATURES = {
  trial: {
    maxItemsPerMonth: Infinity,
    modules: [...ALL_MODULES] as string[],
    labels: [] as string[],
    /** Service tier — "standard" = email support, normal turnaround */
    serviceTier: "standard" as const,
  },
  dream: {
    maxItemsPerMonth: Infinity,
    modules: [...ALL_MODULES] as string[],
    labels: [] as string[],
    serviceTier: "standard" as const,
  },
  maker: {
    maxItemsPerMonth: Infinity,
    modules: [...ALL_MODULES] as string[],
    labels: [] as string[],
    serviceTier: "standard" as const,
  },
  growth: {
    maxItemsPerMonth: Infinity,
    modules: [...ALL_MODULES] as string[],
    labels: [] as string[],
    /** Priority email + free onboarding session */
    serviceTier: "priority" as const,
  },
  pro: {
    maxItemsPerMonth: Infinity,
    modules: [...ALL_MODULES] as string[],
    labels: ["Invoices", "AR Follow Up", "Expenses"] as string[],
    /** Same-day support + custom onboarding + quarterly check-ins */
    serviceTier: "premium" as const,
  },
  canceled: {
    maxItemsPerMonth: 0,
    modules: ["dashboard"] as string[],
    labels: [] as string[],
    serviceTier: "standard" as const,
  },
} as const;

export type PlanName = keyof typeof PLAN_FEATURES;

/** The four paid product tiers (excludes trial + canceled which are
 *  states, not products). */
export type PaidPlanName = Extract<
  PlanName,
  "dream" | "maker" | "growth" | "pro"
>;

/** Plans that have full product access. Used by the feature-gating
 *  sweep (commit 3) to replace `plan === "pro"` checks. */
export const FULL_ACCESS_PLANS: ReadonlySet<PlanName> = new Set([
  "trial",
  "dream",
  "maker",
  "growth",
  "pro",
]);

/** Returns true when the plan has full feature access. Trial users
 *  evaluate the full product for 14 days; Dream/Maker/Growth/Pro
 *  all retain it permanently. Canceled users get read-only
 *  dashboard. */
export function isPayingTier(plan: string | null | undefined): boolean {
  if (!plan) return false;
  return FULL_ACCESS_PLANS.has(plan as PlanName);
}

export function getPlanFeatures(plan: string) {
  return PLAN_FEATURES[plan as PlanName] || PLAN_FEATURES.trial;
}

/** Map an annual revenue figure (USD) to the appropriate tier.
 *  Used by the monthly auto-switch cron job. Boundaries are
 *  inclusive on the low end:
 *    revenue <  $5k       → dream
 *    revenue >= $5k       → maker
 *    revenue >= $50k      → growth
 *    revenue >= $500k     → pro
 */
export function tierForAnnualRevenue(revenueUsd: number): PaidPlanName {
  if (revenueUsd >= PLAN_REVENUE_THRESHOLDS.growth) return "pro";
  if (revenueUsd >= PLAN_REVENUE_THRESHOLDS.maker) return "growth";
  if (revenueUsd >= PLAN_REVENUE_THRESHOLDS.dream) return "maker";
  return "dream";
}

/** Display metadata per tier — drives the pricing tiles + billing
 *  page. The `id` field doubles as the plan name in the URL path
 *  for upgrade flows. */
export const TIER_DISPLAY: Record<PaidPlanName, {
  id: PaidPlanName;
  name: string;
  priceMonthly: number;
  revenueLow: number;     // inclusive
  revenueHigh: number;    // exclusive, Infinity for Pro
  tagline: string;
  serviceTier: "standard" | "priority" | "premium";
}> = {
  dream: {
    id: "dream",
    name: "Dream",
    priceMonthly: 10,
    revenueLow: 0,
    revenueHigh: 5_000,
    tagline: "For solo sellers chasing the dream.",
    serviceTier: "standard",
  },
  maker: {
    id: "maker",
    name: "Maker",
    priceMonthly: 19,
    revenueLow: 5_000,
    revenueHigh: 50_000,
    tagline: "For solo + small-team makers earning their living.",
    serviceTier: "standard",
  },
  growth: {
    id: "growth",
    name: "Growth",
    priceMonthly: 49,
    revenueLow: 50_000,
    revenueHigh: 500_000,
    tagline: "For businesses scaling beyond the kitchen table.",
    serviceTier: "priority",
  },
  pro: {
    id: "pro",
    name: "Pro",
    priceMonthly: 99,
    revenueLow: 500_000,
    revenueHigh: Infinity,
    tagline: "For established businesses that need white-glove service.",
    serviceTier: "premium",
  },
};
