// lib/stripe.ts
//
// 7-band revenue ladder. Each band's Stripe price ID comes from a
// per-band env var, so the bands can be configured per environment
// (sandbox vs. live) without code changes.
//
// Setup (Jacob, on your end):
//   1. Stripe Dashboard → 7 recurring Standard (flat-rate) prices:
//        Band 1 — $10/mo   Band 2 — $15/mo   Band 3 — $22/mo
//        Band 4 — $32/mo   Band 5 — $48/mo   Band 6 — $69/mo
//        Band 7 — $99/mo
//   2. Copy each price ID (price_…, NOT prod_…)
//   3. Vercel env vars (Production + Preview):
//        STRIPE_PRICE_ID_BAND1 … STRIPE_PRICE_ID_BAND7
//
// A band with no env var configured resolves to "" — checkout and the
// reconcile cron both guard on a missing priceId and surface an error
// rather than billing the wrong amount.

import Stripe from "stripe";
import { BANDS, type PaidPlanName } from "./plans";

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2026-04-22.dahlia",
});

// Literal env references (not computed keys) so they're unambiguous and
// survive any future build-time inlining.
const BAND_PRICE_ENV: Record<PaidPlanName, string | undefined> = {
  band1: process.env.STRIPE_PRICE_ID_BAND1,
  band2: process.env.STRIPE_PRICE_ID_BAND2,
  band3: process.env.STRIPE_PRICE_ID_BAND3,
  band4: process.env.STRIPE_PRICE_ID_BAND4,
  band5: process.env.STRIPE_PRICE_ID_BAND5,
  band6: process.env.STRIPE_PRICE_ID_BAND6,
  band7: process.env.STRIPE_PRICE_ID_BAND7,
};

export const PLANS: Record<
  PaidPlanName,
  { priceId: string; name: string; price: number }
> = Object.fromEntries(
  BANDS.map((b) => [
    b.id,
    {
      priceId: BAND_PRICE_ENV[b.id] ?? "",
      name: b.range,
      price: b.price,
    },
  ])
) as Record<PaidPlanName, { priceId: string; name: string; price: number }>;

/** Resolve a Stripe price ID back to its band. Used by the webhook
 *  handler to set client.plan when a subscription event fires. Returns
 *  null when the price ID doesn't match any configured band. */
export function planFromPriceId(
  priceId: string | undefined
): PaidPlanName | null {
  if (!priceId) return null;
  for (const [name, config] of Object.entries(PLANS)) {
    if (config.priceId && config.priceId === priceId) {
      return name as PaidPlanName;
    }
  }
  return null;
}
