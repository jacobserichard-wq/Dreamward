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
import { FEATURES } from "../features";

// ---------------------------------------------------------------------
// Channel ID + display registry
// ---------------------------------------------------------------------

/** Stable IDs for each canonical channel. Used as map keys + as the
 *  collapse-state persistence key in preferences.ux.dashboard. */
export type ChannelId =
  | "shopify"
  | "markets"
  | "direct"
  | "wholesale"
  | "service"
  | "gmail"
  | "uploads"
  | "etsy"        // coming soon (Phase 10 — not the one we shipped)
  | "square"      // live as of Phase 11b
  | "wix"         // live as of Phase 10b (this fix backfills the missing channel registration)
  | "stripe"      // Stripe Connect — a customer's own Stripe sales (June 2026)
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
  /** Short plain-language explanation of what this channel
   *  represents. Rendered as a sub-line under the channel label
   *  in the "Add another channel" disclosure so merchants can
   *  tell at a glance whether the channel applies to their
   *  business. Omit for channels with self-explanatory names
   *  (e.g., "Shopify" — what else could it be?). */
  description?: string;
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
    // /events/new isn't a route — events use an inline-create
     // pattern on /events via the "+ New event" toggle. ?new=1
     // auto-opens that form so the zero-state CTA lands the user
     // directly in the create flow.
    emptyAddHref: "/events?new=1",
    emptyAddLabel: "Add your first event",
    proGated: false,
    drillHref: "/events",
  },
  {
    id: "direct",
    label: "Direct",
    icon: "\u{1F91D}",
    comingSoon: false,
    // Direct sales are logged via "+ Add a sale" on the Transactions view.
    emptyAddHref: "/dashboard?view=transactions",
    emptyAddLabel: "Add a sale",
    proGated: false,
    drillHref: "/dashboard?view=transactions",
    description:
      "Word-of-mouth, cash, Venmo/Zelle — direct sales not tied to a market, platform, or invoice.",
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
    description: "B2B sales — invoices to other businesses, distributors, or retailers buying your goods to resell.",
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
    description: "Consulting, custom orders, retainers, hourly work — revenue from your time rather than a physical product.",
  },
  {
    // Phase 13 rename: "Gmail invoices" → "Forwarded invoices".
    // The id stays "gmail" for back-compat with existing data
    // and the classifyIncomeRow router (source === 'gmail').
    id: "gmail",
    label: "Forwarded invoices",
    icon: "\u{1F4E7}",
    comingSoon: false,
    emptyAddHref: "/help/gmail-setup",
    emptyAddLabel: "Set up Gmail labels",
    proGated: true,
    drillHref: "/dashboard?tab=processed&filter=gmail",
    description: "Invoices + receipts forwarded into the Dreamward Gmail label, parsed by AI. Requires the Gmail integration (Pro).",
  },
  {
    // Phase 13 rename: "Uploads" → "Uncategorized". The id
    // stays "uploads" because it's stored on rows + referenced
    // by the classifier's fallback path.
    id: "uploads",
    label: "Uncategorized",
    icon: "\u{1F4C1}",
    comingSoon: false,
    emptyAddHref: "/dashboard",
    emptyAddLabel: "Upload a file",
    proGated: false,
    drillHref: "/dashboard?tab=processed",
    description: "Catch-all for transactions that don't fit any other channel. Mostly CSV-uploaded rows without an obvious tag — review periodically to re-tag.",
  },
  {
    // Live as of the Etsy integration (June 2026) — the #1
    // competitive gap closed. Was comingSoon since Phase 9.1.
    id: "etsy",
    label: "Etsy",
    icon: "\u{1F3F7}\u{FE0F}",
    comingSoon: false,
    emptyAddHref: "/integrations",
    emptyAddLabel: "Connect Etsy",
    proGated: true,
    drillHref: "/dashboard?tab=processed",
  },
  {
    id: "square",
    label: "Square",
    icon: "\u{1F4B3}",
    comingSoon: false,
    emptyAddHref: "/integrations",
    emptyAddLabel: "Connect Square",
    proGated: true,
    drillHref: "/dashboard?tab=processed",
  },
  {
    id: "wix",
    label: "Wix",
    icon: "\u{1F310}",
    comingSoon: false,
    emptyAddHref: "/integrations",
    emptyAddLabel: "Connect Wix",
    proGated: true,
    drillHref: "/dashboard?tab=processed",
  },
  {
    // Stripe CONNECT — a customer's own Stripe sales sync in as income.
    // Separate from billing Stripe. (June 2026)
    id: "stripe",
    label: "Stripe",
    icon: "\u{1F4B3}",
    comingSoon: false,
    emptyAddHref: "/integrations",
    emptyAddLabel: "Connect Stripe",
    proGated: true,
    drillHref: "/dashboard?tab=processed",
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
  /** Sales tax collected on this row (pass-through liability). Netted
   *  out of channel revenue; 0 for non-Square / untaxed rows. */
  tax: number;
  category: string | null;
  source: string | null;
  event_id: number | null;
  /** Type tag derived by the caller via the industry-aware classifier
   *  (matches the existing /api/profitability pattern). */
  kind: "income" | "expense" | "unknown";
  /** Phase 9.3 commit 2: explicit channel set by the user at expense-
   *  entry time. When non-null, the classifier uses this verbatim
   *  instead of deriving from source/event_id/category. Backfilled
   *  on existing rows via migration 0011 so rollup totals don't shift.
   *  null = fall back to derivation (legacy rows, ingested rows that
   *  haven't been touched by the user yet). Required field (not
   *  optional) so the type predicate in the route handler can narrow
   *  cleanly — callers pass `null` for rows where the SELECT doesn't
   *  include the column. */
  channel: string | null;
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
  /** Phase 13: plain-language sub-line surfaced in the "Add
   *  another channel" disclosure on the dashboard. Sourced
   *  from ChannelMeta.description; absent for self-explanatory
   *  channels. */
  description?: string;
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
  /** Sales tax collected across all income rows. A pass-through
   *  liability — already EXCLUDED from revenue above; surfaced so the
   *  dashboard can show what's owed to the state. */
  salesTaxCollected: number;
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

/** Set of valid channel IDs — used to validate user-supplied
 *  explicit channel values from row.channel before trusting them.
 *  Built once at module load from the canonical channel list. */
const VALID_CHANNEL_IDS = new Set<ChannelId>(
  CANONICAL_CHANNELS.map((c) => c.id)
);

/** Sub-session 32: storage-time channel derivation for CSV/manual
 *  inserts. Mirrors the income-side rules from classifyIncomeRow
 *  but excludes the source-routed branches (shopify/wix/square/gmail)
 *  because those are set at insert time by their respective ingest
 *  paths — we don't want to double-write them.
 *
 *  Used by /api/upload/confirm to bind newly-imported rows to the
 *  right channel BEFORE they hit the dashboard, so the Processed-
 *  tab card UI matches the rollup. Returns null when no channel
 *  can be derived — the row stays "uncategorized" honestly, and
 *  the user can re-tag via the Reclassify modal. */
export function deriveStorageChannel(row: {
  category: string | null;
  event_id: number | null;
}): ChannelId | null {
  if (row.event_id !== null) return "markets";
  if (row.category && CATEGORY_TO_CHANNEL[row.category]) {
    return CATEGORY_TO_CHANNEL[row.category];
  }
  return null;
}

/** Categorize a single income row into a channel. Priority:
 *  0. Phase 9.3: explicit row.channel set by user → use verbatim
 *     (if it's a valid known channel ID)
 *  1. source='shopify' → Shopify channel (Shopify backfill / webhook)
 *  2. source IN ('gmail','email') → Gmail channel
 *  3. event_id IS NOT NULL → Markets channel (event-linked income)
 *  4. category name → channel via CATEGORY_TO_CHANNEL map
 *  5. source='manual' (no event link) → Uploads channel
 *  6. anything else → Uploads channel (catch-all for unknown income)
 */
function classifyIncomeRow(row: ChannelTxnRow): ChannelId {
  // Phase 9.3 commit 2: explicit channel beats derivation
  if (row.channel && VALID_CHANNEL_IDS.has(row.channel as ChannelId)) {
    return row.channel as ChannelId;
  }
  if (row.source === "shopify") return "shopify";
  if (row.source === "wix") return "wix";
  if (row.source === "square") return "square";
  if (row.source === "etsy") return "etsy";
  if (row.source === "gmail" || row.source === "email") {
    // Gmail hidden → its channel doesn't exist; fold into Uncategorized
    // so the revenue still shows up honestly rather than vanishing.
    return FEATURES.GMAIL_INGEST ? "gmail" : "uploads";
  }
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
 *  Priority:
 *  0. Phase 9.3: explicit row.channel set by user → use verbatim
 *  1. event_id IS NOT NULL → Markets channel
 *  2. source='shopify' AND kind='expense' → Shopify channel
 *     (future: Shopify subscription + transaction fees; v1 mostly $0)
 *  3. everything else → null (overhead pool)
 *
 *  Conservative-by-default — over-allocate is wrong; under-allocate
 *  is honest. The explicit channel column is the user's escape
 *  hatch to attribute overhead that we couldn't auto-derive.
 */
function classifyExpenseRow(row: ChannelTxnRow): ChannelId | null {
  // Phase 9.3 commit 2: explicit channel beats derivation
  if (row.channel && VALID_CHANNEL_IDS.has(row.channel as ChannelId)) {
    return row.channel as ChannelId;
  }
  if (row.event_id !== null) return "markets";
  if (row.source === "shopify") return "shopify";
  if (row.source === "wix") return "wix";
  if (row.source === "square") return "square";
  if (row.source === "etsy") return "etsy";
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
    // "Forwarded invoices" (gmail) is gated behind the Gmail feature
    // flag — hidden everywhere while ingest is off. classifyIncomeRow
    // folds any email-source row into Uncategorized in that mode, so
    // nothing is silently dropped.
    if (meta.id === "gmail" && !FEATURES.GMAIL_INGEST) continue;
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
      description: meta.description,
    });
  }

  let overhead = 0;
  // Sales tax collected — netted out of revenue, reported separately as a
  // pass-through liability.
  let salesTaxCollected = 0;

  // ── Aggregate processed_items ──────────────────────────────────
  for (const row of opts.txns) {
    if (row.kind === "income") {
      const cid = classifyIncomeRow(row);
      const ch = channelMap.get(cid);
      if (!ch) continue; // unknown channel — shouldn't happen but defend
      // Exclude sales tax from income (liability, not revenue); tips +
      // service charges stay in (they're income).
      ch.revenue += row.amount - row.tax;
      salesTaxCollected += row.tax;
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
    salesTaxCollected,
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

  // Phase 1 umbrella values predating the type-tagged taxonomy, plus
  // "Sales" — the category the Square + Etsy ingests tag payments with
  // (Shopify/Wix use the seeded "Online Sales"). "Sales" isn't in the
  // per-industry taxonomy, so without this it classifies as "unknown"
  // and the channel rollup silently drops the revenue (Total Sales /
  // Net Profit read $0 even though the payments exist).
  const LEGACY_INCOME = new Set(["invoice", "ar_followup", "Sales"]);
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
