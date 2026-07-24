// Pricing model — "Built for people. Priced for people." Every paying
// customer gets every product feature; price is set purely by business
// size (trailing-12-month revenue tracked through the app) and the only
// other differentiator is service level (support response time).
//
// 7-band revenue ladder (sub-session 33 → smoother-ladder revision):
// the old 4 tiers (Dream/Maker/Growth/Pro) jumped too coarsely — a
// $5.5k seller paid the same as a $45k one. The ladder below has
// narrower bands so price tracks size fairly. The customer never picks
// a band: they sign up onto the trial, check out onto the band their
// revenue maps to, and a monthly cron (lib/revenueTier.ts) nudges the
// band up or down one step at a time as revenue moves.
//
// EVERYTHING derives from the BANDS array — thresholds, the revenue→
// band lookup, the Stripe price map (lib/stripe.ts), the billing
// display tiles, and the marketing "find your price" slider — so the
// ladder can never drift between surfaces. Trial keeps 14-day full
// access; Canceled retains a read-only dashboard.
//
// Legacy 4-tier plan values (dream/maker/growth/pro) are still treated
// as paying for back-compat until existing rows are migrated to bands
// (db/migrations/0027_*). They are NOT valid PaidPlanName values.

export type PaidPlanName =
  | "band1"
  | "band2"
  | "band3"
  | "band4"
  | "band5"
  | "band6"
  | "band7";

export type PlanName = "trial" | PaidPlanName | "canceled";

export type ServiceTier = "standard" | "priority" | "premium";

export interface BandDef {
  id: PaidPlanName;
  /** Monthly price in USD. */
  price: number;
  /** Display label for the revenue range, e.g. "$30k–$60k". */
  range: string;
  /** Trailing-12-month revenue floor (inclusive). */
  revenueLow: number;
  /** Trailing-12-month revenue ceiling (exclusive; Infinity at top). */
  revenueHigh: number;
  serviceTier: ServiceTier;
}

/** Canonical revenue→price ladder. Single source of truth. */
export const BANDS: readonly BandDef[] = [
  { id: "band1", price: 10, range: "under $5k",   revenueLow: 0,       revenueHigh: 5_000,    serviceTier: "standard" },
  { id: "band2", price: 15, range: "$5k–$15k",    revenueLow: 5_000,   revenueHigh: 15_000,   serviceTier: "standard" },
  { id: "band3", price: 22, range: "$15k–$30k",   revenueLow: 15_000,  revenueHigh: 30_000,   serviceTier: "standard" },
  { id: "band4", price: 32, range: "$30k–$60k",   revenueLow: 30_000,  revenueHigh: 60_000,   serviceTier: "priority" },
  { id: "band5", price: 48, range: "$60k–$120k",  revenueLow: 60_000,  revenueHigh: 120_000,  serviceTier: "priority" },
  { id: "band6", price: 69, range: "$120k–$300k", revenueLow: 120_000, revenueHigh: 300_000,  serviceTier: "premium"  },
  { id: "band7", price: 99, range: "$300k+",      revenueLow: 300_000, revenueHigh: Infinity, serviceTier: "premium"  },
] as const;

const BAND_BY_ID: Record<PaidPlanName, BandDef> = Object.fromEntries(
  BANDS.map((b) => [b.id, b])
) as Record<PaidPlanName, BandDef>;

const BAND_IDS: ReadonlySet<string> = new Set(BANDS.map((b) => b.id));

/** Legacy 4-tier plan names. Kept as "paying" so no existing account
 *  loses access between this deploy and the data migration. Not valid
 *  PaidPlanName values — they resolve to full access in getPlanFeatures
 *  via the band-not-found fallback. */
const LEGACY_PAID: ReadonlySet<string> = new Set([
  "dream",
  "maker",
  "growth",
  "pro",
]);

// All product modules. FLAT across every paying tier + the trial —
// that's the strategic promise. `labels` is retained for forward-compat
// with the Gmail feature flag (FEATURES.GMAIL_INGEST); it's empty while
// the flag is off so flipping it back doesn't need a plan migration.
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

export interface PlanFeatures {
  maxItemsPerMonth: number;
  modules: string[];
  labels: string[];
  serviceTier: ServiceTier;
}

/** Resolve the feature set for any plan value. Bands, the trial, and
 *  legacy paid names all get full access (legacy via the band-not-found
 *  fallback). Canceled is read-only dashboard. Unknown → full access
 *  (fail-open: a paying customer is never wrongly locked out). */
export function getPlanFeatures(plan: string): PlanFeatures {
  if (plan === "canceled") {
    return {
      maxItemsPerMonth: 0,
      modules: ["dashboard"],
      labels: [],
      serviceTier: "standard",
    };
  }
  const band = BAND_BY_ID[plan as PaidPlanName];
  return {
    maxItemsPerMonth: Infinity,
    modules: [...ALL_MODULES],
    labels: [],
    serviceTier: band?.serviceTier ?? "standard",
  };
}

/** True when the plan has full feature access — trial, any band, a
 *  not-yet-migrated legacy paid name, or an active Shopify App
 *  Pricing subscription ('shopify', billed by Shopify — see
 *  lib/shopifyAppPricing.ts). Canceled returns false. */
export function isPayingTier(plan: string | null | undefined): boolean {
  if (!plan) return false;
  return (
    plan === "trial" ||
    plan === "shopify" ||
    BAND_IDS.has(plan) ||
    LEGACY_PAID.has(plan)
  );
}

/** Map trailing-12-month revenue (USD) to its band. Boundaries are
 *  inclusive on the low end (revenue < ceiling → that band). */
export function tierForAnnualRevenue(revenueUsd: number): PaidPlanName {
  for (const b of BANDS) {
    if (revenueUsd < b.revenueHigh) return b.id;
  }
  return BANDS[BANDS.length - 1].id;
}

/** Per-band revenue ceiling. Derived from BANDS — used by the
 *  reconcile cron's log detail. */
export const PLAN_REVENUE_THRESHOLDS: Record<PaidPlanName, number> =
  Object.fromEntries(BANDS.map((b) => [b.id, b.revenueHigh])) as Record<
    PaidPlanName,
    number
  >;

/** Display metadata per band — drives the /billing page. Derived from
 *  BANDS so price/brackets never drift. `name` is the revenue range
 *  (bands have no marketing name — the range IS the identity). */
export const TIER_DISPLAY: Record<
  PaidPlanName,
  {
    id: PaidPlanName;
    name: string;
    priceMonthly: number;
    revenueLow: number;
    revenueHigh: number;
    serviceTier: ServiceTier;
  }
> = Object.fromEntries(
  BANDS.map((b) => [
    b.id,
    {
      id: b.id,
      name: b.range,
      priceMonthly: b.price,
      revenueLow: b.revenueLow,
      revenueHigh: b.revenueHigh,
      serviceTier: b.serviceTier,
    },
  ])
) as Record<
  PaidPlanName,
  {
    id: PaidPlanName;
    name: string;
    priceMonthly: number;
    revenueLow: number;
    revenueHigh: number;
    serviceTier: ServiceTier;
  }
>;

/** Short human label for a plan value, for badges/headers. Bands show
 *  their price ("$32/mo"); trial/canceled show their state; legacy
 *  names show capitalized until migrated. */
export function planDisplayLabel(plan: string | null | undefined): string {
  if (!plan) return "";
  if (plan === "trial") return "Trial";
  if (plan === "canceled") return "Canceled";
  const band = BAND_BY_ID[plan as PaidPlanName];
  if (band) return `$${band.price}/mo`;
  return plan.charAt(0).toUpperCase() + plan.slice(1);
}

/** One-line description of a service tier, shown on the billing page. */
export function serviceTierLabel(tier: ServiceTier): string {
  switch (tier) {
    case "premium":
      return "Same-day priority support + dedicated contact";
    case "priority":
      return "Priority support — faster response times";
    default:
      return "Standard email support";
  }
}

// The full product list, grouped for scannability. FLAT across every
// band — the single source of truth shown on the landing pricing
// section and the /pricing page, so the "every plan includes
// everything" promise never drifts between them. Add new features
// here once and both surfaces pick them up.
export const PLAN_FEATURE_GROUPS: { group: string; items: string[] }[] = [
  {
    group: "Sell everywhere",
    items: [
      // Honest-copy rule: only claim live sync for live integrations
      // (Square + bank feed). Shopify/Wix/Etsy are CSV until their
      // FEATURES flags flip — update this line when each goes live.
      "Square sync · CSV import for Shopify, Wix & Etsy",
      "Bank feed — auto-import expenses",
      "CSV / XLSX upload",
      "Market Day mode — tap sales at your booth",
      "Find markets near you",
    ],
  },
  {
    group: "Know your real numbers",
    items: [
      "Per-SKU cost history (effective-date)",
      "Gross margin per product & channel",
      "Live stock counts",
      "Recipes + production runs",
      "Audit trail on every number",
    ],
  },
  {
    group: "Tax-ready & organized",
    items: [
      "Schedule-C P&L (PDF + CSV for your CPA)",
      "Inventory value (Form 1125-A)",
      "Receipt vault on every expense",
      "AR + invoice follow-up",
      "Event mileage tracking",
    ],
  },
];

// Powers the "find your price" slider on the marketing pages. Derived
// from BANDS — the slider, /billing, checkout, and the auto-switch cron
// now all run on the same ladder. Each band's `range` is display text;
// `price` is monthly USD.
export const PRICE_LADDER: { range: string; price: number }[] = BANDS.map(
  (b) => ({ range: b.range, price: b.price })
);
