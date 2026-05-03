export const PLAN_FEATURES = {
  trial: {
    maxItemsPerMonth: 25,
    modules: ["invoices", "expenses", "dashboard"],
    labels: ["Invoices", "Expenses"] as string[],
  },
  starter: {
    maxItemsPerMonth: 100,
    modules: ["invoices", "expenses", "dashboard"],
    labels: ["Invoices", "Expenses"] as string[],
  },
  growth: {
    maxItemsPerMonth: Infinity,
    modules: ["invoices", "expenses", "dashboard", "events", "mileage", "ar", "exports"],
    labels: ["Invoices", "AR Follow Up", "Expenses"] as string[],
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