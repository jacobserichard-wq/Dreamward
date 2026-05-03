import Stripe from "stripe";

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2026-04-22.dahlia"
});

export const PLANS = {
  starter: {
    priceId: "price_1TSpgoBeNxvLulr9f4aeZEbD",
    name: "Starter",
    price: 19,
    features: ["1 Gmail account", "100 items/mo", "Expense tracking", "Dashboard"],
  },
  growth: {
    priceId: "price_1TSpgpBeNxvLulr9pABRmVqT",
    name: "Growth",
    price: 49,
    features: ["Unlimited processing", "Events & sales logging", "Mileage tracking", "AR follow-ups", "CSV/PDF exports"],
  },
  pro: {
    priceId: "price_1TSpgpBeNxvLulr9Wsr5gajq",
    name: "Pro",
    price: 89,
    features: ["Multiple Gmail accounts", "Custom categories", "Tax-time reports", "Schedule C mapping", "Onboarding call"],
  },
};