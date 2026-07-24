// lib/shopifyAppPricing.ts
//
// Shopify App Pricing (2026-07-23, App Store billing requirement 1.2).
// Merchants acquired through the App Store are billed BY SHOPIFY:
// we define the $10/mo + 14-day-trial plan in the Partner dashboard,
// Shopify hosts the plan-selection page and runs the charges, and we
// verify subscription state via the Partner API's activeSubscription
// query. There are NO billing webhooks in this system — state is
// verified on the welcome-link redirect and re-checked by the daily
// cron (cancellations/freezes happen without a redirect).
//
// Billing model recap (see migration 0048):
//   clients.billing_source 'stripe'  → direct signups; Stripe unchanged
//   clients.billing_source 'shopify' → App-Store installs; plan is
//     'shopify' while the subscription is active, 'canceled' after.
//   The two lanes never cross: shopify-billed clients never see
//   Stripe checkout/portal, and a Stripe-paying client connecting a
//   store keeps paying through Stripe.
//
// Env (Vercel):
//   SHOPIFY_PARTNER_API_TOKEN — Partner Dashboard → Partner API client
//   SHOPIFY_PARTNER_ORG_ID    — 4945251 (partners.shopify.com/<this>)
//   SHOPIFY_APP_GID           — gid://shopify/App/371915358209
//   SHOPIFY_APP_HANDLE        — listing handle (plan-page URL segment)

import pool from "@/lib/db";
import { shopifyGraphql } from "@/lib/shopify";

const PARTNER_API_VERSION = "2026-07";

export interface ShopifySubscription {
  planHandle: string | null;
  trialEndsAt: string | null;
  cancelAtEndOfCycle: boolean;
}

function partnerEnv() {
  const token = process.env.SHOPIFY_PARTNER_API_TOKEN;
  const orgId = process.env.SHOPIFY_PARTNER_ORG_ID;
  const appGid = process.env.SHOPIFY_APP_GID;
  if (!token) throw new Error("SHOPIFY_PARTNER_API_TOKEN env var is not set");
  if (!orgId) throw new Error("SHOPIFY_PARTNER_ORG_ID env var is not set");
  if (!appGid) throw new Error("SHOPIFY_APP_GID env var is not set");
  return { token, orgId, appGid };
}

/** The Shopify-hosted plan-selection page for a shop. */
export function planSelectionUrl(shopDomain: string): string {
  const handle = process.env.SHOPIFY_APP_HANDLE;
  if (!handle) throw new Error("SHOPIFY_APP_HANDLE env var is not set");
  const storeHandle = shopDomain.replace(/\.myshopify\.com$/i, "");
  return `https://admin.shopify.com/store/${storeHandle}/charges/${handle}/pricing_plans`;
}

/**
 * Query the Partner API for the shop's active subscription to our
 * app. Returns null when there is no active Shopify App Pricing
 * contract (never installed a plan, cancelled, or frozen).
 */
export async function getActiveSubscription(
  shopGid: string
): Promise<ShopifySubscription | null> {
  const { token, orgId, appGid } = partnerEnv();
  const res = await fetch(
    `https://partners.shopify.com/${orgId}/api/${PARTNER_API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": token,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        query: `query ActiveSubscription($appId: ID!, $shopId: ID!) {
          activeSubscription(appId: $appId, shopId: $shopId) {
            trialEndsAt
            cancelAtEndOfCycle
            items { handle }
          }
        }`,
        variables: { appId: appGid, shopId: shopGid },
      }),
    }
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(
      `Partner API activeSubscription: HTTP ${res.status} ${body.slice(0, 200)}`
    );
  }
  const payload = (await res.json()) as {
    data?: {
      activeSubscription: {
        trialEndsAt: string | null;
        cancelAtEndOfCycle: boolean;
        items: Array<{ handle: string }>;
      } | null;
    };
    errors?: Array<{ message: string }>;
  };
  if (payload.errors && payload.errors.length > 0) {
    throw new Error(
      `Partner API errors: ${payload.errors.map((e) => e.message).join("; ").slice(0, 300)}`
    );
  }
  const sub = payload.data?.activeSubscription;
  if (!sub) return null;
  return {
    planHandle: sub.items[0]?.handle ?? null,
    trialEndsAt: sub.trialEndsAt,
    cancelAtEndOfCycle: sub.cancelAtEndOfCycle,
  };
}

/**
 * Fetch + persist the shop's GID (Partner API keys subscriptions by
 * shop GID, not domain). Idempotent; cheap single-field query.
 */
export async function ensureShopGid(opts: {
  connectionId: number;
  shopDomain: string;
  accessToken: string;
}): Promise<string> {
  const existing = await pool.query<{ shop_gid: string | null }>(
    `SELECT shop_gid FROM shopify_connections WHERE id = $1`,
    [opts.connectionId]
  );
  const current = existing.rows[0]?.shop_gid;
  if (current) return current;
  const data = await shopifyGraphql<{ shop: { id: string } }>({
    shopDomain: opts.shopDomain,
    accessToken: opts.accessToken,
    query: `query { shop { id } }`,
  });
  await pool.query(
    `UPDATE shopify_connections SET shop_gid = $1, updated_at = NOW() WHERE id = $2`,
    [data.shop.id, opts.connectionId]
  );
  return data.shop.id;
}

/**
 * Post-connect billing decision for a client who just connected
 * `shopDomain` (cold App-Store install OR warm in-app connect).
 *
 * - Clients actively paying through Stripe (a band plan) keep Stripe:
 *   they were acquired outside the App Store and double-billing is
 *   forbidden. Trial/canceled clients flip to shopify billing — for
 *   a brand-new App-Store signup that's their first billing lane.
 * - If the shop already has an active Shopify subscription (e.g. a
 *   reinstall), the client is marked paid immediately.
 *
 * Returns the plan-selection URL when the merchant still needs to
 * pick a plan; callers redirect there instead of /integrations.
 * Never throws — billing must not break the connect flow; failures
 * are logged and the cron re-check heals the state.
 */
export async function ensureShopifyBilling(opts: {
  clientId: number;
  connectionId: number;
  shopDomain: string;
  accessToken: string;
}): Promise<{ planSelectionUrl: string | null }> {
  try {
    const clientRes = await pool.query<{
      plan: string;
      billing_source: string;
    }>(`SELECT plan, billing_source FROM clients WHERE id = $1`, [
      opts.clientId,
    ]);
    const client = clientRes.rows[0];
    if (!client) return { planSelectionUrl: null };

    // Stripe-paying (band plan) clients stay on Stripe.
    const stripePaying =
      client.billing_source === "stripe" &&
      client.plan !== "trial" &&
      client.plan !== "canceled" &&
      client.plan !== "shopify";
    if (stripePaying) return { planSelectionUrl: null };

    const shopGid = await ensureShopGid(opts);
    const sub = await getActiveSubscription(shopGid);
    if (sub) {
      await pool.query(
        `UPDATE clients SET billing_source = 'shopify', plan = 'shopify' WHERE id = $1`,
        [opts.clientId]
      );
      await pool.query(
        `UPDATE shopify_connections
            SET subscription_plan_handle = $1,
                subscription_trial_ends_at = $2,
                subscription_checked_at = NOW(),
                updated_at = NOW()
          WHERE id = $3`,
        [sub.planHandle, sub.trialEndsAt, opts.connectionId]
      );
      return { planSelectionUrl: null };
    }

    // No subscription yet → this client bills through Shopify and
    // must pick a plan. (plan stays what it was — usually 'trial' —
    // until the welcome-link confirm flips it to 'shopify'.)
    await pool.query(
      `UPDATE clients SET billing_source = 'shopify' WHERE id = $1`,
      [opts.clientId]
    );
    return { planSelectionUrl: planSelectionUrl(opts.shopDomain) };
  } catch (err) {
    console.warn("ensureShopifyBilling failed (cron will re-check):", err);
    return { planSelectionUrl: null };
  }
}
