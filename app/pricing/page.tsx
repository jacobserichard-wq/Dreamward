// app/pricing/page.tsx
//
// Sub-session 33: standalone pricing page. Sources tier data from
// TIER_DISPLAY (lib/plans) so prices/brackets/names never drift
// from the landing page or /billing. Public route — no auth gate.
//
// "Built for people. Priced for people." — feature-flat tiers that
// scale by business size, not by which features you're allowed to
// use. This page exists so prospects comparing tools have one URL
// that lays out the whole model + answers the obvious questions.

import Link from "next/link";
import SignInButton from "../components/SignInButton";
import { TIER_DISPLAY, type PaidPlanName } from "@/lib/plans";

export const metadata = {
  title: "Pricing",
  description:
    "Every feature on every tier. Priced by your business size, not by feature gates. Starts at $10/month — your tier auto-adjusts as you grow.",
};

const TIER_ORDER: PaidPlanName[] = ["dream", "maker", "growth", "pro"];

// Service-level bullets per tier (product features are flat across
// all tiers — see the "every tier includes" grid). Mirrors
// app/billing/page.tsx TIER_SERVICE_FEATURES.
const SERVICE_FEATURES: Record<PaidPlanName, string[]> = {
  dream: ["Every product feature", "All integrations", "Standard email support"],
  maker: ["Every product feature", "All integrations", "Standard email support"],
  growth: ["Everything in Maker", "Priority support", "Faster response times"],
  pro: [
    "Everything in Growth",
    "Same-day priority support",
    "Dedicated support contact",
  ],
};

const INCLUDED_EVERYWHERE = [
  "Shopify integration",
  "Wix integration",
  "Square integration",
  "CSV / XLSX upload",
  "Per-SKU cost history",
  "Gross margin tracking",
  "Live stock counts",
  "Receipt vault",
  "Schedule-C P&L",
  "Events + mileage",
  "AR + invoice follow-up",
  "Audit trail + CPA export",
];

const FAQ: { q: string; a: string }[] = [
  {
    q: "Do cheaper tiers get fewer features?",
    a: "No. Every tier — from the $10 Dream plan to the $99 Pro plan — includes every product feature: all integrations, COGS, gross margin, live stock, Schedule-C reports, receipt vault, everything. The only difference between tiers is how fast you get support.",
  },
  {
    q: "How do you decide which tier I'm on?",
    a: "By your business size, measured as your trailing-12-month revenue tracked through Dreamward. Under $5k/year is Dream, $5k–$50k is Maker, $50k–$500k is Growth, $500k+ is Pro. You pick a starting tier when you sign up, and we move you up automatically as you grow.",
  },
  {
    q: "What happens when my revenue grows past a threshold?",
    a: "Your tier auto-adjusts on a calendar-month boundary, and the new price takes effect on your next billing cycle — never mid-cycle, never a surprise charge. No upsell calls, no “upgrade to unlock” walls.",
  },
  {
    q: "Is there a free trial?",
    a: "Yes — every tier starts with a 14-day free trial. No credit card required to start. You get full access to every feature during the trial.",
  },
  {
    q: "What if I want to cancel?",
    a: "Cancel anytime from your billing page. Your data exports cleanly to CSV, so you’re never locked in.",
  },
  {
    q: "Why is this so much cheaper than QuickBooks or Xero?",
    a: "Because we built one focused tool — gross-margin tracking and Schedule-C-ready reports — instead of a sprawling ERP. You shouldn’t have to pay $275/month or be locked out of a profit report to know whether your business is making money.",
  },
];

function fmtBracket(low: number, high: number): string {
  const k = (n: number) => (n >= 1000 ? `$${Math.round(n / 1000)}k` : `$${n}`);
  if (high === Infinity) return `${k(low)}+/year revenue`;
  if (low === 0) return `Under ${k(high)}/year revenue`;
  return `${k(low)}–${k(high)}/year revenue`;
}

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-white font-sans">
      {/* Header — matches the landing page band */}
      <header className="bg-gradient-to-br from-slate-900 to-slate-800 text-white">
        <div className="max-w-[1100px] mx-auto px-4 sm:px-8 py-5 flex justify-between items-center">
          <Link href="/" className="m-0 text-xl sm:text-2xl font-bold text-white no-underline">
            <span className="text-xl sm:text-2xl">{"\u{26A1}"}</span> Dreamward
          </Link>
          <Link
            href="/signin"
            className="text-sm text-white/80 hover:text-white no-underline"
          >
            Sign in
          </Link>
        </div>

        <div className="max-w-[1100px] mx-auto px-4 sm:px-8 pt-10 sm:pt-16 pb-12 sm:pb-16 text-center">
          <span className="text-[11px] font-bold uppercase tracking-wider text-amber-300 bg-white/10 px-3 py-1 rounded-full">
            Built for people. Priced for people.
          </span>
          <h1 className="text-3xl sm:text-5xl font-extrabold m-0 mb-4 mt-4 leading-tight">
            Pricing that grows with you. Not against you.
          </h1>
          <p className="text-base sm:text-lg text-white/80 max-w-2xl mx-auto m-0 leading-relaxed">
            Every tier includes every feature. You&apos;re billed by your
            business size, not by which tools you&apos;re allowed to use. As
            your revenue grows, your tier auto-updates — no upsell calls, no
            &ldquo;upgrade to unlock&rdquo; walls.
          </p>
        </div>
      </header>

      {/* Pricing tiles */}
      <section className="max-w-[1100px] mx-auto px-4 sm:px-8 -mt-8 sm:-mt-10">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {TIER_ORDER.map((id) => {
            const tier = TIER_DISPLAY[id];
            const highlighted = id === "maker";
            return (
              <div
                key={id}
                className={`relative rounded-xl p-6 ${
                  highlighted
                    ? "bg-gradient-to-br from-blue-600 to-violet-600 text-white shadow-xl"
                    : "bg-white border border-slate-200 text-slate-900"
                }`}
              >
                {highlighted && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-amber-400 text-amber-950 text-[11px] font-bold uppercase tracking-wider px-3 py-1 rounded-full">
                    Most popular
                  </div>
                )}
                <h3
                  className={`text-lg font-bold m-0 mb-0.5 ${highlighted ? "text-white" : "text-slate-900"}`}
                >
                  {tier.name}
                </h3>
                <div className={`mb-0.5 ${highlighted ? "text-white" : "text-slate-900"}`}>
                  <span className="text-3xl font-extrabold">${tier.priceMonthly}</span>
                  <span className={`text-sm ml-1 ${highlighted ? "text-white/80" : "text-slate-500"}`}>
                    /month
                  </span>
                </div>
                <p className={`text-xs m-0 mb-4 ${highlighted ? "text-white/75" : "text-slate-500"}`}>
                  {fmtBracket(tier.revenueLow, tier.revenueHigh)}
                </p>
                <ul
                  className={`space-y-1.5 m-0 mb-5 p-0 list-none text-sm ${
                    highlighted ? "text-white/90" : "text-slate-700"
                  }`}
                >
                  {SERVICE_FEATURES[id].map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <span
                        className={`flex-shrink-0 mt-0.5 ${highlighted ? "text-amber-300" : "text-emerald-600"}`}
                      >
                        {"\u{2713}"}
                      </span>
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <Link
                  href="/signin?callbackUrl=/onboarding"
                  className={`block text-center py-2 px-4 rounded-lg text-sm font-semibold no-underline cursor-pointer ${
                    highlighted
                      ? "bg-white text-blue-700 hover:bg-slate-100"
                      : "bg-slate-900 text-white hover:bg-slate-800"
                  }`}
                >
                  Start with {tier.name}
                </Link>
              </div>
            );
          })}
        </div>

        <p className="text-center text-xs text-slate-500 mt-6">
          All tiers start with a 14-day free trial. No credit card required.
          Cancel anytime — your data exports cleanly to CSV.
        </p>
      </section>

      {/* Every tier includes */}
      <section className="max-w-[1100px] mx-auto px-4 sm:px-8 py-12 sm:py-16">
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-5 sm:p-8">
          <h2 className="text-center text-lg sm:text-xl font-bold text-slate-900 m-0 mb-1">
            Every tier includes every feature
          </h2>
          <p className="text-center text-sm text-slate-500 m-0 mb-6">
            No feature gates. The tiers above differ only by support speed.
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5 text-sm text-slate-700">
            {INCLUDED_EVERYWHERE.map((f) => (
              <div key={f} className="flex items-start gap-1.5">
                <span className="text-emerald-600 mt-0.5">{"\u{2713}"}</span>
                <span>{f}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="max-w-[760px] mx-auto px-4 sm:px-8 pb-12 sm:pb-16">
        <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 m-0 mb-6 text-center">
          Questions
        </h2>
        <div className="space-y-4">
          {FAQ.map((item) => (
            <div key={item.q} className="bg-white border border-slate-200 rounded-xl p-5">
              <h3 className="text-base font-semibold text-slate-900 m-0 mb-2">
                {item.q}
              </h3>
              <p className="text-sm text-slate-600 m-0 leading-relaxed">{item.a}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="bg-gradient-to-br from-slate-900 to-slate-800 text-white py-12 sm:py-16">
        <div className="max-w-[800px] mx-auto px-4 sm:px-8 text-center">
          <h2 className="text-2xl sm:text-3xl font-bold m-0 mb-3">
            Start free. Stay because it&apos;s fair.
          </h2>
          <p className="text-base text-white/80 m-0 mb-6 max-w-xl mx-auto">
            14-day free trial on any tier. No credit card. Every feature
            included from day one.
          </p>
          <SignInButton label="Start your free trial &rarr;" />
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-200 py-6 text-center text-xs text-slate-400">
        <Link href="/" className="text-slate-500 no-underline mx-2">
          Home
        </Link>
        <span className="text-slate-300">{"\u{00B7}"}</span>
        <Link href="/compare/crafty-base" className="text-slate-500 no-underline mx-2">
          Compare
        </Link>
        <span className="text-slate-300">{"\u{00B7}"}</span>
        <Link href="/privacy" className="text-slate-500 no-underline mx-2">
          Privacy
        </Link>
        <span className="text-slate-300">{"\u{00B7}"}</span>
        <Link href="/terms" className="text-slate-500 no-underline mx-2">
          Terms
        </Link>
      </footer>
    </div>
  );
}
