// lib/stripe.ts
//
// Sub-session 33 strategic pricing pivot. Price IDs migrated to
// env vars so the new Dream/Maker/Growth/Pro products can be
// configured per environment without code changes.
//
// Setup (Jacob, on your end):
//   1. Stripe Dashboard → Create 4 recurring products:
//        Dream  — $10/month
//        Maker  — $19/month
//        Growth — $49/month
//        Pro    — $99/month
//   2. Copy each price ID
//   3. Vercel env vars (Production + Preview):
//        STRIPE_PRICE_ID_DREAM
//        STRIPE_PRICE_ID_MAKER
//        STRIPE_PRICE_ID_GROWTH
//        STRIPE_PRICE_ID_PRO
//
// Falls back to the legacy hardcoded Starter/Growth/Pro IDs while
// the new products are being created so the app doesn't error
// mid-deploy. Once env vars are set, the fallback is dead code.

import Stripe from "stripe";
import type { PaidPlanName } from "./plans";

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2026-04-22.dahlia",
});

/** Legacy hardcoded price IDs — kept as fallback during the
 *  transition to env-backed config. Remove once
 *  STRIPE_PRICE_ID_* env vars are confirmed live in Vercel. */
const LEGACY_PRICE_IDS = {
  // The old "starter" product now maps to "maker" semantically.
  starter_as_maker: "price_1TSpgoBeNxvLulr9f4aeZEbD",
  growth: "price_1TSpgpBeNxvLulr9pABRmVqT",
  pro: "price_1TSpgpBeNxvLulr9Wsr5gajq",
};

export const PLANS: Record<
  PaidPlanName,
  { priceId: string; name: string; price: number }
> = {
  dream: {
    priceId: process.env.STRIPE_PRICE_ID_DREAM ?? "",
    name: "Dream",
    price: 10,
  },
  maker: {
    priceId:
      process.env.STRIPE_PRICE_ID_MAKER ?? LEGACY_PRICE_IDS.starter_as_maker,
    name: "Maker",
    price: 19,
  },
  growth: {
    priceId: process.env.STRIPE_PRICE_ID_GROWTH ?? LEGACY_PRICE_IDS.growth,
    name: "Growth",
    price: 49,
  },
  pro: {
    priceId: process.env.STRIPE_PRICE_ID_PRO ?? LEGACY_PRICE_IDS.pro,
    name: "Pro",
    price: 99,
  },
};

/** Resolve a Stripe price ID back to its plan tier. Used by the
 *  webhook handler to set client.plan when a subscription event
 *  fires. Returns null when the price ID doesn't match any tier
 *  (likely a legacy ID that's been retired). */
export function planFromPriceId(
  priceId: string | undefined
): PaidPlanName | null {
  if (!priceId) return null;
  for (const [name, config] of Object.entries(PLANS)) {
    if (config.priceId && config.priceId === priceId) {
      return name as PaidPlanName;
    }
  }
  // Defense in depth: also match the raw legacy IDs so any
  // existing subscriptions (created against the old Starter/Growth/
  // Pro products) still resolve cleanly during the transition.
  if (priceId === LEGACY_PRICE_IDS.starter_as_maker) return "maker";
  if (priceId === LEGACY_PRICE_IDS.growth) return "growth";
  if (priceId === LEGACY_PRICE_IDS.pro) return "pro";
  return null;
}
