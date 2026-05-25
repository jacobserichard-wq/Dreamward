// lib/profitability/channels.ts
//
// Phase 9.1 commit 1 of 7. Pure aggregation helper for channel
// profitability. Maps category → channel; computes per-channel
// revenue + direct expenses + net + collects unallocated overhead.
//
// Channel definition is HYBRID per session-notes/phase-9-design.md §1:
//   - Events table → Markets channel (in-person sales + booth fees +
//     mileage cost from IRS rate)
//   - processed_items grouped by category for everything else
//
// See §4 of the design doc for the canonical channel list + which
// source-of-truth query feeds each.
//
// Pure helper — no I/O, no DB calls. Caller (API route) fetches the
// raw rows + passes them in. This shape makes the math
// independently testable + decouples aggregation from the request
// lifecycle.

import type { Industry } from "../categories";
import { getCategoriesForIndustry } from "../categories";

// ---------------------------------------------------------------------
// Channel ID + display registry
// ---------------------------------------------------------------------

/** Stable IDs for each canonical channel. Used as map keys + as the
 *  collapse-state persistence key in preferences.ux.dashboard. */
export type ChannelId =
  | "shopify"
  | "markets"
  | "wholesale"
  | "service"
  | "gmail"
  | "uploads"
  | "etsy"        // coming soon (Phase 10)
  | "square"      // coming soon
  | "woocommerce" // coming soon
  ;

export interface ChannelMeta {
  id: ChannelId;
  /** Display name shown on the dashboard table */
  label: string;
  /** Emoji icon for the row */
  icon: string;
  /** True for channels not yet wired (greyed-out + "Coming soon" pill) */
  comingSoon: boolean;
  /** Where the "Add this channel" CTA points when the channel has no
   *  data. null for coming-soon channels (no CTA). */
  emptyAddHref: string | null;
  /** Label for the empty-state CTA button */
  emptyAddLabel: string | null;
  /** True if the channel requires a Pro plan to add (UI swaps the
   *  href to /billing for non-Pro users) */
  proGated: boolean;
  /** Where clicking a populated channel card drills the user to.
   *  null for coming-soon channels (no click). The whole card
   *  becomes a Link when this is non-null AND the channel has data. */
  drillHref: string | null;
}

/** The fixed canonical channel list rendered on the dashboard table
 *  regardless of whether the user has data for each. Order matters —
 *  this is the row order on the dashboard. */
export const CANONICAL_CHANNELS: readonly ChannelMeta[] = [
  {
    id: "shopify",
    label: "Shopify",
    icon: "\u{1F6D2}",
    comingSoon: false,
    emptyAddHref: "/integrations",
    emptyAddLabel: "Connect Shopify",
    proGated: true,
    drillHref: "/integrations",
  },
  {
    id: "markets",
    label: "Markets",
    icon: "\u{1F3EA}",
    comingSoon: false,
    emptyAddHref: "/events/new",
    emptyAddLabel: "Add your first event",
    proGated: false,
    drillHref: "/events",
  },
  {
    id: "wholesale",
    label: "Wholesale",
    icon: "\u{1F4CB}",
    comingSoon: false,
    emptyAddHref: "/invoices/new",
    emptyAddLabel: "Create your first invoice",
    proGated: false,
    drillHref: "/invoices",
  },
  {
    id: "service",
    label: "Service work",
    icon: "\u{1F4BC}",
    comingSoon: false,
    emptyAddHref: "/invoices/new",
    emptyAddLabel: "Add a service invoice",
    proGated: false,
    drillHref: "/invoices",
  },
  {
    id: "gmail",
    label: "Gmail invoices",
    icon: "\u{1F4E7}",
    comingSoon: false,
    emptyAddHref: "/help/gmail-setup",
    emptyAddLabel: "Set up Gmail labels",
    proGated: true,
    drillHref: "/dashboard?tab=processed&filter=gmail",
  },
  {
    id: "uploads",
    label: "Uploads",
    icon: "\u{1F4C1}",
    comingSoon: false,
    emptyAddHref: "/dashboard",
    emptyAddLabel: "Upload a file",
    proGated: false,
    drillHref: "/dashboard?tab=processed",
  },
  {
    id: "etsy",
    label: "Etsy",
    icon: "\u{1F3F7}\u{FE0F}",
    comingSoon: true,
    emptyAddHref: null,
    emptyAddLabel: null,
    proGated: false,
    drillHref: null,
  },
  {
    id: "square",
    label: "Square",
    icon: "\u{1F4B3}",
    comingSoon: true,
    emptyAddHref: null,
    emptyAddLabel: null,
    proGated: false,
    drillHref: null,
  },
  {
    id: "woocommerce",
    label: "WooCommerce",
    icon: "\u{1F6CD}\u{FE0F}",
    comingSoon: true,
    emptyAddHref: null,
    emptyAddLabel: null,
    proGated: false,
    drillHref: null,
  },
] as const;

// ---------------------------------------------------------------------
// Inputs from the route handler (DB rows already fetched)
// ---------------------------------------------------------------------

/** One processed_items row (subset of columns needed for aggregation). */
export interface ChannelTxnRow {
  amount: number;
  category: string | null;
  source: string | null;
  event_id: number | null;
  /** Type tag derived by the caller via the industry-aware classifier
   *  (matches the existing /api/profitability pattern). */
  kind: "income" | "expense" | "unknown";
}

/** One event row + its mileage_cost (already computed via IRS rate). */
export interface ChannelEventRow {
  id: number;
  revenue: number;
  booth_fee: number;
  mileage_cost: number;
}

// ---------------------------------------------------------------------
// Output shapes
// ---------------------------------------------------------------------

export interface ChannelMetrics {
  id: ChannelId;
  label: string;
  icon: string;
  comingSoon: boolean;
  /** Has any data for the time window — drives "active" vs "empty" UI */
  hasData: boolean;
  revenue: number;
  /** Direct expenses attributable to this channel */
  directExpenses: number;
  /** revenue - directExpenses (channel-attributable view) */
  netAttributable: number;
  /** revenue - directExpenses - allocatedOverhead (fully-allocated view) */
  netAllocated: number;
  /** Pro-rata share of unallocated overhead (zero when not in allocated mode) */
  allocatedOverhead: number;
  /** For the dashboard CTA when hasData=false */
  emptyAddHref: string | null;
  emptyAddLabel: string | null;
  proGated: boolean;
  /** Where clicking a populated channel card drills the user to */
  drillHref: string | null;
}

export interface ChannelAggregateResult {
  channels: ChannelMetrics[];
  /** Sum of expense rows not attributable to any channel (rent, SaaS,
   *  contractor fees not tied to an event, etc.). Surfaced as a
   *  separate Overhead row at the bottom of the dashboard table. */
  overhead: number;
  /** Sum of revenue across all channels — used for the bar chart
   *  width normalization + pro-rata overhead calculation. */
  totalRevenue: number;
  totalDirectExpenses: number;
  /** netAttributable summed across all channels - overhead */
  netProfit: number;
}

// ---------------------------------------------------------------------
// Classifier: category name → channel id
// ---------------------------------------------------------------------

/** Income category names that should be assigned to specific
 *  channels. Source: lib/categories.ts seeded taxonomy across all
 *  industries. This list is the bridge between the user-facing
 *  category taxonomy and the channel rollup. */
const CATEGORY_TO_CHANNEL: Record<string, ChannelId> = {
  // Markets / events
  "Event Sales": "markets",

  // Online stores (will pick up Shopify orders regardless of category
  // because Shopify rows are routed by source — see classifyTxn below).
  "Online Sales": "shopify",

  // Wholesale
  "Wholesale Orders": "wholesale",
  "Retail Wholesale": "wholesale",
  "Distributor": "wholesale",

  // Service work
  "Service Income": "service",
  "Consulting": "service",
  "Retainer / Subscription": "service",
  "Project Income": "service",
  "Hourly Income": "service",
  "Custom Orders": "service",
  "Client Work": "service",
};

/** Categorize a single income row into a channel. Priority:
 *  1. source='shopify' → Shopify channel (Shopify backfill / webhook)
 *  2. source IN ('gmail','email') → Gmail channel
 *  3. event_id IS NOT NULL → Markets channel (event-linked income)
 *  4. category name → channel via CATEGORY_TO_CHANNEL map
 *  5. source='manual' (no event link) → Uploads channel
 *  6. anything else → Uploads channel (catch-all for unknown income)
 */
function classifyIncomeRow(row: ChannelTxnRow): ChannelId {
  if (row.source === "shopify") return "shopify";
  if (row.source === "gmail" || row.source === "email") return "gmail";
  if (row.event_id !== null) return "markets";
  if (row.category && CATEGORY_TO_CHANNEL[row.category]) {
    return CATEGORY_TO_CHANNEL[row.category];
  }
  return "uploads";
}

/** Classify an EXPENSE row into a channel (for direct-expense
 *  attribution) — or return null if the expense should fall into
 *  the unallocated overhead pool.
 *
 *  v1 rules (intentionally conservative — over-allocate = wrong;
 *  under-allocate = honest):
 *  - event_id IS NOT NULL → Markets channel
 *  - source='shopify' AND kind='expense' → Shopify channel
 *    (future: Shopify subscription + transaction fees; v1 mostly $0)
 *  - everything else → null (overhead pool)
 */
function classifyExpenseRow(row: ChannelTxnRow): ChannelId | null {
  if (row.event_id !== null) return "markets";
  if (row.source === "shopify") return "shopify";
  return null;
}

// ---------------------------------------------------------------------
// The aggregation function
// ---------------------------------------------------------------------

export interface ComputeChannelsOpts {
  /** All processed_items rows in the time range, already classified
   *  income/expense by the caller. */
  txns: ChannelTxnRow[];
  /** All events in the time range with mileage_cost pre-computed. */
  events: ChannelEventRow[];
  /** "attributable" = revenue - direct expenses; "allocated" = ALSO
   *  subtracts pro-rata overhead share. Default 'attributable'. */
  mode?: "attributable" | "allocated";
  /** Industry (for future per-industry channel customization;
   *  unused in v1 but in the signature for forward-compat). */
  industry?: Industry;
}

export function computeChannels(opts: ComputeChannelsOpts): ChannelAggregateResult {
  const mode = opts.mode ?? "attributable";

  // Initialize zero-state for every canonical channel so all 9 rows
  // appear even when the user has no data for some of them.
  const channelMap = new Map<ChannelId, ChannelMetrics>();
  for (const meta of CANONICAL_CHANNELS) {
    channelMap.set(meta.id, {
      id: meta.id,
      label: meta.label,
      icon: meta.icon,
      comingSoon: meta.comingSoon,
      hasData: false,
      revenue: 0,
      directExpenses: 0,
      netAttributable: 0,
      netAllocated: 0,
      allocatedOverhead: 0,
      emptyAddHref: meta.emptyAddHref,
      emptyAddLabel: meta.emptyAddLabel,
      proGated: meta.proGated,
      drillHref: meta.drillHref,
    });
  }

  let overhead = 0;

  // ── Aggregate processed_items ──────────────────────────────────
  for (const row of opts.txns) {
    if (row.kind === "income") {
      const cid = classifyIncomeRow(row);
      const ch = channelMap.get(cid);
      if (!ch) continue; // unknown channel — shouldn't happen but defend
      ch.revenue += row.amount;
      ch.hasData = true;
    } else if (row.kind === "expense") {
      const cid = classifyExpenseRow(row);
      if (cid === null) {
        // Unallocated → overhead pool
        overhead += row.amount;
        continue;
      }
      const ch = channelMap.get(cid);
      if (!ch) continue;
      ch.directExpenses += row.amount;
      // hasData stays true if the channel had income too; an expense-
      // only channel (e.g., user logged Shopify subscription as
      // source=shopify before connecting) still surfaces as having
      // data because that's a real signal worth showing.
      ch.hasData = true;
    }
    // 'unknown' rows: ignored (matches the existing
    // /api/profitability behavior — unclassified items don't pollute
    // the rollup; they're flagged in the Reports unknownAmount field).
  }

  // ── Aggregate events into Markets channel ──────────────────────
  // events.revenue is manual cash revenue (separate from event-linked
  // processed_items income, which was already counted above). booth_fee
  // + mileage_cost are direct Markets expenses.
  const markets = channelMap.get("markets")!;
  for (const ev of opts.events) {
    if (ev.revenue > 0) {
      markets.revenue += ev.revenue;
      markets.hasData = true;
    }
    if (ev.booth_fee > 0) {
      markets.directExpenses += ev.booth_fee;
      markets.hasData = true;
    }
    if (ev.mileage_cost > 0) {
      markets.directExpenses += ev.mileage_cost;
      markets.hasData = true;
    }
  }

  // ── Compute net per channel ────────────────────────────────────
  let totalRevenue = 0;
  let totalDirectExpenses = 0;
  for (const ch of channelMap.values()) {
    ch.netAttributable = ch.revenue - ch.directExpenses;
    totalRevenue += ch.revenue;
    totalDirectExpenses += ch.directExpenses;
  }

  // ── Pro-rata overhead allocation (if requested) ────────────────
  if (mode === "allocated" && overhead > 0 && totalRevenue > 0) {
    for (const ch of channelMap.values()) {
      const share = ch.revenue / totalRevenue;
      ch.allocatedOverhead = share * overhead;
      ch.netAllocated = ch.netAttributable - ch.allocatedOverhead;
    }
  } else {
    for (const ch of channelMap.values()) {
      ch.netAllocated = ch.netAttributable;
    }
  }

  return {
    channels: Array.from(channelMap.values()),
    overhead,
    totalRevenue,
    totalDirectExpenses,
    netProfit: totalRevenue - totalDirectExpenses - overhead,
  };
}

// ---------------------------------------------------------------------
// Convenience: build the kind classifier matching /api/profitability
// ---------------------------------------------------------------------

/** Builds the income/expense classifier for a given industry +
 *  custom-category preferences. Pulled out here so the channels
 *  route handler can use the same classification rules as
 *  /api/profitability without duplicating the lookup table logic. */
export function buildKindClassifier(
  industry: Industry,
  customIncome: string[],
  customExpense: string[]
): (category: string | null) => "income" | "expense" | "unknown" {
  const seeded = new Map<string, "income" | "expense">();
  for (const c of getCategoriesForIndustry(industry)) {
    seeded.set(c.name, c.type);
  }
  const customInc = new Set(customIncome);
  const customExp = new Set(customExpense);

  // Phase 1 umbrella values predating the type-tagged taxonomy.
  const LEGACY_INCOME = new Set(["invoice", "ar_followup"]);
  const LEGACY_EXPENSE = new Set(["expense"]);

  return (category) => {
    if (!category) return "unknown";
    const seededKind = seeded.get(category);
    if (seededKind) return seededKind;
    if (customInc.has(category)) return "income";
    if (customExp.has(category)) return "expense";
    if (LEGACY_INCOME.has(category)) return "income";
    if (LEGACY_EXPENSE.has(category)) return "expense";
    return "unknown";
  };
}
