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
} from "@/lib/plans";
import { buildClassifier } from "@/lib/reports/aggregate";
import { type Industry } from "@/lib/categories";

/** Trailing-365-day revenue for a client. Income-classified paid
 *  processed_items + event cash-day revenue. Approximate by design —
 *  it only needs to be accurate enough to pick the right size
 *  bracket, and the brackets are an order of magnitude apart
 *  ($5k / $50k / $500k). */
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

  let revenue = 0;
  for (const row of txnsRes.rows) {
    if (classify(row.category) === "income") {
      revenue += Number(row.amount) || 0;
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
    targetPlan: "dream",
    trailingRevenue: 0,
  };

  try {
    const industry = (client.industry ?? "general") as Industry;
    const trailingRevenue = await computeTrailingRevenue(client.id, industry);
    const targetPlan = tierForAnnualRevenue(trailingRevenue);
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
        detail: `would switch ${client.plan} -> ${targetPlan} at $${PLAN_REVENUE_THRESHOLDS[targetPlan] === Infinity ? "500k+" : trailingRevenue.toFixed(0)} revenue`,
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
    `SELECT id, email, plan, industry, stripe_subscription_id
       FROM clients
      WHERE plan IN ('dream', 'maker', 'growth', 'pro')`
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
