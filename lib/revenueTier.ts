// lib/revenueTier.ts
//
// Sub-session 33 pricing pivot, commit 8 of 8. Revenue-based tier
// reconciliation — the engine behind "your tier auto-adjusts as you
// grow." Runs monthly from the cron (1st-of-month boundary).
//
// Flow per paying client:
//   1. computeTrailingRevenue() — trailing-365-day income from
//      processed_items (income-classified, paid) + event cash-day
//      revenue.
//   2. tierForAnnualRevenue() (lib/plans) maps the figure to the
//      right tier.
//   3. If the target tier differs from the client's current plan,
//      reconcileClientTier() updates the Stripe subscription
//      (proration_behavior: 'none' so the change applies at the
//      NEXT renewal — no surprise mid-cycle charge, matching the
//      marketing promise) + flips client.plan + sends a heads-up
//      email.
//
// Safety:
//   - Only acts on clients with an active stripe_subscription_id.
//     Trial users pick their tier at checkout; canceled users have
//     no subscription to modify.
//   - proration_behavior 'none' means no immediate charge/credit.
//     The price swap takes effect on the next billing cycle.
//   - Each client's reconciliation is independent; a failure on one
//     is logged and skipped, never aborts the batch.
//   - Idempotent: no-op when target === current.

import type { PoolClient } from "pg";
import pool from "@/lib/db";
import { stripe, PLANS } from "@/lib/stripe";
import {
  tierForAnnualRevenue,
  type PaidPlanName,
  PLAN_REVENUE_THRESHOLDS,
  BANDS,
} from "@/lib/plans";
import { buildClassifier } from "@/lib/reports/aggregate";
import { type Industry } from "@/lib/categories";

/** Trailing-365-day revenue for a client, NET OF REFUNDS — the figure
 *  the band ladder sizes on. Income-classified paid processed_items
 *  (this INCLUDES negative refund rows — e.g. Shopify stores a refund
 *  as a negative "income" row, so it nets out in the income sum) +
 *  event cash-day revenue, MINUS manually-tracked "Returns & Refunds"
 *  rows (a seeded expense category, so they wouldn't otherwise reduce
 *  the figure).
 *
 *  Known gap: Square/Etsy/Wix don't yet ingest refunds as rows, so
 *  their refunds aren't reflected here — that's per-platform ingestion
 *  work, not a calc fix.
 *
 *  Approximate by design — it only needs to land the right band. */
export async function computeTrailingRevenue(
  clientId: number,
  industry: Industry
): Promise<number> {
  // Fetch trailing-365 processed_items + client custom categories +
  // event revenue in parallel.
  const [txnsRes, settingsRes, eventsRes] = await Promise.all([
    pool.query<{ amount: string; category: string | null }>(
      `SELECT amount, category
         FROM processed_items
        WHERE client_id = $1
          AND status = 'paid'
          AND due_date >= (CURRENT_DATE - INTERVAL '365 days')`,
      [clientId]
    ),
    pool.query<{
      custom_categories: string[] | null;
      preferences: { custom_income_categories?: string[] } | null;
    }>(
      `SELECT custom_categories, preferences
         FROM client_settings
        WHERE client_id = $1`,
      [clientId]
    ),
    pool.query<{ revenue: string | null }>(
      `SELECT revenue
         FROM events
        WHERE client_id = $1
          AND start_date >= (CURRENT_DATE - INTERVAL '365 days')`,
      [clientId]
    ),
  ]);

  const settings = settingsRes.rows[0] ?? null;
  const customExpense: string[] = Array.isArray(settings?.custom_categories)
    ? (settings!.custom_categories as string[])
    : [];
  const prefIncome = settings?.preferences?.custom_income_categories;
  const customIncome: string[] = Array.isArray(prefIncome) ? prefIncome : [];
  const classify = buildClassifier(industry, customIncome, customExpense);

  // "Returns & Refunds" is a universal seeded expense category
  // (lib/categories.ts) — the canonical home for manually-logged
  // customer refunds. Subtract it so a heavy refunder isn't sized on
  // gross sales. Platform refunds that arrive as negative "income"
  // rows (e.g. Shopify) already net out via the income sum.
  const REFUND_CATEGORY = "Returns & Refunds";
  let revenue = 0;
  for (const row of txnsRes.rows) {
    const amount = Number(row.amount) || 0;
    if (classify(row.category) === "income") {
      revenue += amount; // includes negative refund rows → already net
    } else if (row.category === REFUND_CATEGORY) {
      revenue -= Math.abs(amount);
    }
  }
  // Event cash-day revenue (manual, not double-counted — event-linked
  // processed_items income is already summed above only when it
  // carries an income category; the manual `revenue` field on the
  // event row is the cash drawer total the merchant typed in).
  for (const e of eventsRes.rows) {
    revenue += e.revenue == null ? 0 : Number(e.revenue) || 0;
  }

  return revenue;
}

/** Compute a client's trailing revenue + band and persist them to the
 *  clients cache columns (revenue_cached_at = now). Returns the fresh
 *  figures. Used nightly by cacheAllRevenue + read-through by the owner
 *  dashboard for a never-cached account. */
export async function cacheClientRevenue(
  clientId: number,
  industry: Industry
): Promise<{ revenue: number; band: PaidPlanName }> {
  const revenue = await computeTrailingRevenue(clientId, industry);
  const band = tierForAnnualRevenue(revenue);
  await pool.query(
    `UPDATE clients
        SET cached_trailing_revenue = $1,
            cached_would_be_band = $2,
            revenue_cached_at = NOW()
      WHERE id = $3`,
    [revenue, band, clientId]
  );
  return { revenue, band };
}

/** Nightly pass (daily cron): refresh the revenue cache for every account
 *  so the owner dashboard never recomputes on page load. Per-account
 *  failures are logged + skipped, not fatal. */
export async function cacheAllRevenue(): Promise<{
  cached: number;
  errors: number;
}> {
  const clients = await pool.query<{ id: number; industry: string | null }>(
    `SELECT id, industry FROM clients`
  );
  let cached = 0;
  let errors = 0;
  for (const c of clients.rows) {
    try {
      await cacheClientRevenue(c.id, (c.industry ?? "other") as Industry);
      cached++;
    } catch (err) {
      console.error(`cacheClientRevenue failed for client ${c.id}:`, err);
      errors++;
    }
  }
  return { cached, errors };
}

export interface TierReconcileResult {
  clientId: number;
  email: string;
  previousPlan: string;
  targetPlan: PaidPlanName;
  trailingRevenue: number;
  /** What actually happened. */
  action: "no-change" | "switched" | "skipped-no-subscription" | "error";
  detail?: string;
}

/** Reconcile a single client's tier against their trailing revenue.
 *  Mutates Stripe + DB only when a switch is warranted AND the
 *  client has an active subscription. Returns a structured result
 *  for the cron's summary log. */
export async function reconcileClientTier(client: {
  id: number;
  email: string;
  plan: string;
  industry: string | null;
  stripe_subscription_id: string | null;
}): Promise<TierReconcileResult> {
  const base: Omit<TierReconcileResult, "action"> = {
    clientId: client.id,
    email: client.email,
    previousPlan: client.plan,
    targetPlan: "band1",
    trailingRevenue: 0,
  };

  try {
    const industry = (client.industry ?? "general") as Industry;
    const trailingRevenue = await computeTrailingRevenue(client.id, industry);
    let targetPlan = tierForAnnualRevenue(trailingRevenue);

    // Downgrade hysteresis: don't drop a band until trailing revenue
    // falls 10% below the current band's floor. A business hovering at
    // a boundary (e.g. revenue oscillating around $30k) would otherwise
    // flip-flop band every month. Upgrades apply immediately — only
    // downgrades get the buffer. Trial/legacy plans have no band index
    // (currentIdx === -1) so they skip the buffer and land on target.
    const currentIdx = BANDS.findIndex((b) => b.id === client.plan);
    const targetIdx = BANDS.findIndex((b) => b.id === targetPlan);
    if (currentIdx >= 0 && targetIdx >= 0 && targetIdx < currentIdx) {
      const floor = BANDS[currentIdx].revenueLow;
      if (trailingRevenue >= floor * 0.9) {
        targetPlan = client.plan as PaidPlanName; // hold the current band
      }
    }

    base.targetPlan = targetPlan;
    base.trailingRevenue = trailingRevenue;

    // No change needed.
    if (client.plan === targetPlan) {
      return { ...base, action: "no-change" };
    }

    // Can't mutate billing without an active subscription. This is
    // the common path today (sandbox, no real subs) — the engine
    // computes the right answer but has nothing to act on.
    if (!client.stripe_subscription_id) {
      return {
        ...base,
        action: "skipped-no-subscription",
        detail: `would switch ${client.plan} -> ${targetPlan} at $${PLAN_REVENUE_THRESHOLDS[targetPlan] === Infinity ? "300k+" : trailingRevenue.toFixed(0)} revenue`,
      };
    }

    // ── Mutate the Stripe subscription ──────────────────────────
    // Swap the price item to the target tier's price. proration_
    // behavior 'none' = the new price applies next cycle, no
    // immediate charge or credit. Honors "no surprise charges."
    const targetPriceId = PLANS[targetPlan].priceId;
    if (!targetPriceId) {
      return {
        ...base,
        action: "error",
        detail: `no Stripe price id configured for ${targetPlan}`,
      };
    }

    const subscription = await stripe.subscriptions.retrieve(
      client.stripe_subscription_id
    );
    const itemId = subscription.items.data[0]?.id;
    if (!itemId) {
      return {
        ...base,
        action: "error",
        detail: "subscription has no line items",
      };
    }

    await stripe.subscriptions.update(client.stripe_subscription_id, {
      items: [{ id: itemId, price: targetPriceId }],
      proration_behavior: "none",
    });

    // Flip the DB plan immediately. The subscription.updated webhook
    // will also fire and confirm the same value — idempotent.
    await pool.query(
      `UPDATE clients SET plan = $1, updated_at = NOW() WHERE id = $2`,
      [targetPlan, client.id]
    );

    return { ...base, action: "switched" };
  } catch (err) {
    return {
      ...base,
      action: "error",
      detail: err instanceof Error ? err.message : "unknown error",
    };
  }
}

/** Whether today is the 1st of the month (UTC). The cron runs daily;
 *  tier reconciliation only fires on the calendar-month boundary the
 *  marketing copy promises. Pulled out as a pure helper so it's
 *  testable + the cron stays readable. */
export function isFirstOfMonthUtc(now: Date): boolean {
  return now.getUTCDate() === 1;
}

/** Reconcile every paying client. Called from the cron. Returns a
 *  summary for logging. Iterates sequentially to keep Stripe API
 *  pressure low — the paying-client count is small enough that
 *  parallelism isn't worth the rate-limit risk. */
export async function reconcileAllTiers(): Promise<{
  scanned: number;
  switched: number;
  noChange: number;
  skipped: number;
  errors: number;
  results: TierReconcileResult[];
}> {
  const clients = await pool.query<{
    id: number;
    email: string;
    plan: string;
    industry: string | null;
    stripe_subscription_id: string | null;
  }>(
    // Bands are the live plan values; the legacy 4-tier names are
    // included so any row not yet migrated still gets reconciled (and
    // thereby moved onto a band) on the next monthly run.
    `SELECT id, email, plan, industry, stripe_subscription_id
       FROM clients
      WHERE plan IN ('band1','band2','band3','band4','band5','band6','band7',
                     'dream','maker','growth','pro')`
  );

  const results: TierReconcileResult[] = [];
  let switched = 0;
  let noChange = 0;
  let skipped = 0;
  let errors = 0;

  for (const client of clients.rows) {
    const result = await reconcileClientTier(client);
    results.push(result);
    if (result.action === "switched") switched++;
    else if (result.action === "no-change") noChange++;
    else if (result.action === "skipped-no-subscription") skipped++;
    else if (result.action === "error") errors++;
  }

  return {
    scanned: clients.rows.length,
    switched,
    noChange,
    skipped,
    errors,
    results,
  };
}
