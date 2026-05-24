// Per the README marketing copy + the CASA security story, Gmail
// auto-fetch is a Pro-tier-only feature. Sub-session 24 follow-up
// (Gmail label setup guide) tightened the gating to match — non-Pro
// plans get an empty labels[], and /api/gmail + /api/process now
// 403 for non-Pro callers. This closes a leak where any signed-in
// user could trigger Gmail fetches + Anthropic API spend regardless
// of their plan.
export const PLAN_FEATURES = {
  trial: {
    maxItemsPerMonth: 25,
    modules: ["invoices", "expenses", "dashboard"],
    labels: [] as string[],
  },
  starter: {
    maxItemsPerMonth: 100,
    modules: ["invoices", "expenses", "dashboard"],
    labels: [] as string[],
  },
  growth: {
    maxItemsPerMonth: Infinity,
    modules: ["invoices", "expenses", "dashboard", "events", "mileage", "ar", "exports"],
    labels: [] as string[],
  },
  pro: {
    maxItemsPerMonth: Infinity,
    modules: ["invoices", "expenses", "dashboard", "events", "mileage", "ar", "exports", "custom_categories", "tax_reports"],
    labels: ["Invoices", "AR Follow Up", "Expenses"] as string[],
  },
  canceled: {
    maxItemsPerMonth: 0,
    modules: ["dashboard"],
    labels: [] as string[],
  },
} as const;

export type PlanName = keyof typeof PLAN_FEATURES;

export function getPlanFeatures(plan: string) {
  return PLAN_FEATURES[plan as PlanName] || PLAN_FEATURES.trial;
}