import Stripe from "stripe";
import type { PlanName } from "./plans";

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2026-04-22.dahlia"
});

export const PLANS = {
  starter: {
    priceId: "price_1TSpgoBeNxvLulr9f4aeZEbD",
    name: "Starter",
    price: 19,
  },
  growth: {
    priceId: "price_1TSpgpBeNxvLulr9pABRmVqT",
    name: "Growth",
    price: 49,
  },
  pro: {
    priceId: "price_1TSpgpBeNxvLulr9Wsr5gajq",
    name: "Pro",
    price: 89,
  },
};

type PaidPlanName = Extract<PlanName, "starter" | "growth" | "pro">;

export function planFromPriceId(priceId: string | undefined): PaidPlanName | null {
  for (const [name, config] of Object.entries(PLANS)) {
    if (config.priceId === priceId) return name as PaidPlanName;
  }
  return null;
}