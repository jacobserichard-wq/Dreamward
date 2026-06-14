// app/pricing/page.tsx
//
// Standalone pricing page. Tier data comes from TIER_DISPLAY and the
// flat feature list from PLAN_FEATURE_GROUPS (both in lib/plans) so
// prices/brackets/features never drift from the landing or /billing.
// Public route — no auth gate.
//
// "Built for people. Priced for people." — feature-flat tiers that
// scale by business size. Tiles are FEATURE-FREE on purpose: the
// revenue bracket is the hero (it's the only thing that sets your
// price), and the full product list lives in one grouped block below.

import Link from "next/link";
import SignInButton from "../components/SignInButton";
import PriceSlider from "../components/PriceSlider";
import { PLAN_FEATURE_GROUPS } from "@/lib/plans";

export const metadata = {
  title: "Pricing",
  description:
    "Every feature on every tier. Priced by your business size, not by feature gates. Starts at $10/month — your tier auto-adjusts as you grow.",
};

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
    q: "Why is this so much cheaper than the big accounting tools?",
    a: "Because we built one focused tool — gross-margin tracking and Schedule-C-ready reports — instead of a sprawling ERP. You shouldn’t have to pay hundreds a month or be locked out of a profit report to know whether your business is making money.",
  },
];

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-oat font-sans text-forest">
      {/* Header — matches the landing band */}
      <header className="border-b border-sand/70">
        <div className="max-w-[1100px] mx-auto px-4 sm:px-8 py-5 flex justify-between items-center">
          <Link
            href="/"
            className="m-0 text-xl sm:text-2xl font-semibold font-serif text-forest no-underline flex items-center gap-2"
          >
            <SproutMark className="w-6 h-6 text-eucalyptus" />
            Dreamward
          </Link>
          <Link
            href="/signin"
            className="text-sm text-bark hover:text-forest no-underline"
          >
            Sign in
          </Link>
        </div>

        <div className="max-w-[1100px] mx-auto px-4 sm:px-8 pt-12 sm:pt-16 pb-14 sm:pb-20 text-center">
          <span className="text-[11px] font-bold uppercase tracking-wider text-rose-dark bg-rose-soft px-3 py-1 rounded-full">
            Built for people. Priced for people.
          </span>
          <h1 className="font-serif text-3xl sm:text-5xl font-semibold m-0 mb-4 mt-4 leading-[1.1] text-forest tracking-tight">
            Pricing that grows with you. Not against you.
          </h1>
          <p className="text-base sm:text-lg text-bark max-w-2xl mx-auto m-0 leading-relaxed">
            Every plan includes every feature. You&apos;re billed by your
            business size — not by which tools you&apos;re allowed to use. As
            your revenue grows, your tier auto-updates. No upsell calls, no
            &ldquo;upgrade to unlock&rdquo; walls.
          </p>
        </div>
      </header>

      {/* Find-your-price slider — revenue-driven, no tier to choose */}
      <section className="max-w-[1100px] mx-auto px-4 sm:px-8 -mt-8 sm:-mt-12">
        <PriceSlider />
        <p className="text-center text-xs text-stone mt-6">
          Cancel anytime — your data exports cleanly to CSV. As your tracked
          revenue grows, your price moves up one band at a time, never a
          surprise jump.
        </p>
      </section>

      {/* Every plan includes everything — grouped feature list */}
      <section className="max-w-[1100px] mx-auto px-4 sm:px-8 py-12 sm:py-16">
        <div className="bg-cream border border-sand rounded-2xl p-6 sm:p-8">
          <h2 className="text-center font-serif text-xl sm:text-2xl font-semibold text-forest m-0 mb-1">
            Every plan includes everything
          </h2>
          <p className="text-center text-sm text-bark m-0 mb-6">
            No feature gates. The tiers above differ only by support speed.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {PLAN_FEATURE_GROUPS.map((group) => (
              <div key={group.group}>
                <h3 className="text-xs font-bold uppercase tracking-wider text-eucalyptus-dark m-0 mb-3">
                  {group.group}
                </h3>
                <ul className="m-0 p-0 list-none space-y-2 text-sm text-bark">
                  {group.items.map((item) => (
                    <li key={item} className="flex items-start gap-1.5">
                      <span className="text-eucalyptus mt-0.5 flex-shrink-0">
                        {"\u{2713}"}
                      </span>
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="max-w-[760px] mx-auto px-4 sm:px-8 pb-12 sm:pb-16">
        <h2 className="font-serif text-2xl sm:text-3xl font-semibold text-forest m-0 mb-6 text-center">
          Questions
        </h2>
        <div className="space-y-4">
          {FAQ.map((item) => (
            <div key={item.q} className="bg-cream border border-sand rounded-2xl p-5">
              <h3 className="text-base font-semibold text-forest m-0 mb-2">
                {item.q}
              </h3>
              <p className="text-sm text-bark m-0 leading-relaxed">{item.a}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="bg-eucalyptus-soft/50 border-t border-sand py-12 sm:py-16">
        <div className="max-w-[800px] mx-auto px-4 sm:px-8 text-center">
          <h2 className="font-serif text-2xl sm:text-3xl font-semibold m-0 mb-3 text-forest">
            Start free. Stay because it&apos;s fair.
          </h2>
          <p className="text-base text-bark m-0 mb-6 max-w-xl mx-auto">
            14-day free trial on any tier. No credit card. Every feature
            included from day one.
          </p>
          <SignInButton label="Go dreamward &rarr;" />
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-sand py-6 text-center text-xs text-stone">
        <Link href="/" className="text-bark no-underline mx-2 hover:text-forest">
          Home
        </Link>
        <span className="text-sand">{"\u{00B7}"}</span>
        <Link href="/compare" className="text-bark no-underline mx-2 hover:text-forest">
          Compare
        </Link>
        <span className="text-sand">{"\u{00B7}"}</span>
        <Link href="/privacy" className="text-bark no-underline mx-2 hover:text-forest">
          Privacy
        </Link>
        <span className="text-sand">{"\u{00B7}"}</span>
        <Link href="/terms" className="text-bark no-underline mx-2 hover:text-forest">
          Terms
        </Link>
      </footer>
    </div>
  );
}

function SproutMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path
        d="M12 22V10"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path d="M12 13c-3.3 0-6-2.7-6-6 3.3 0 6 2.7 6 6Z" fill="currentColor" />
      <path d="M12 11c0-3.3 2.7-6 6-6 0 3.3-2.7 6-6 6Z" fill="currentColor" />
    </svg>
  );
}
