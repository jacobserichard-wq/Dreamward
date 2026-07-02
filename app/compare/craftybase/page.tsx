// app/compare/craftybase/page.tsx
//
// Named head-to-head: Dreamward vs Craftybase. Captures the
// "Craftybase alternative" search intent that the generic /compare
// page gives up (positioning refresh P2).
//
// IMPORTANT — accuracy discipline (named competitor): every claim in
// the "Craftybase" column is limited to what's publicly documented
// about the product (averaging/real-time recosting, tiered plan limits,
// an online/handmade-inventory focus). We do NOT assert defects
// ("buggy", "corrupts data", "quietly rewrites") — those are fine on
// the generic page but become risky factual assertions once a real
// company is named. Lead with Dreamward's verifiable positives; keep
// the contrast factual + hedged. Re-verify against Craftybase's live
// pricing/docs before making claims stronger.
//
// Pure server component (public route). SignInButton is the client
// island for the CTA.

import Link from "next/link";
import SignInButton from "../../components/SignInButton";
import FaqSection from "../../components/FaqSection";

export const metadata = {
  title:
    "Dreamward vs Craftybase — Real-time margin tracking without the rewrites",
  description:
    "Compare Dreamward to Craftybase: FIFO costing that never rewrites history, every feature on every plan, and pricing that scales with your revenue — plus in-person market P&L that online-only inventory tools skip.",
  openGraph: {
    title: "Dreamward vs Craftybase",
    description:
      "A Craftybase alternative built for makers who sell in person AND online: FIFO costing, every feature on every plan, from $10/month.",
    type: "website",
  },
};

export default function CraftybaseComparePage() {
  return (
    <div className="min-h-screen bg-oat font-sans text-forest">
      {/* Header */}
      <header className="border-b border-sand/70">
        <div className="max-w-[1100px] mx-auto px-4 sm:px-8 py-5 flex justify-between items-center">
          <Link
            href="/"
            className="m-0 text-xl sm:text-2xl font-semibold font-serif no-underline text-forest flex items-center gap-2"
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

        <div className="max-w-[1100px] mx-auto px-4 sm:px-8 pt-12 sm:pt-20 pb-12 sm:pb-16 text-center">
          <p className="text-xs uppercase tracking-widest text-stone mb-3">
            Dreamward vs Craftybase
          </p>
          <h1 className="font-serif text-3xl sm:text-5xl font-semibold m-0 mb-4 leading-[1.1] text-forest tracking-tight">
            Looking for a Craftybase alternative?
          </h1>
          <p className="text-lg sm:text-xl text-bark max-w-2xl mx-auto m-0 mb-8 leading-relaxed">
            Real-time margin tracking, FIFO costing that doesn&apos;t rewrite
            history, and every feature on every plan — built for makers who
            sell in person <span className="text-eucalyptus-dark">and</span>{" "}
            online. Starting at $10/month.
          </p>
          <SignInButton label="Start free 14-day trial" />
          <p className="text-xs text-stone mt-4">
            14-day free trial. No credit card required.
          </p>
        </div>
      </header>

      {/* Quick-read table — every "Craftybase" cell is a documented fact,
          not a defect claim. */}
      <section className="max-w-[1100px] mx-auto px-4 sm:px-8 py-12 sm:py-16">
        <div className="text-center mb-8">
          <h2 className="font-serif text-2xl sm:text-3xl font-semibold text-forest m-0 mb-2">
            The quick read
          </h2>
          <p className="text-sm text-bark m-0">
            Both track recipe COGS well. Here&apos;s where Dreamward is built
            differently.
          </p>
        </div>
        <div className="bg-cream rounded-2xl border border-sand overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-eucalyptus-soft/40 border-b border-sand">
                <th className="text-left py-3 px-4 font-semibold text-forest w-[40%]">
                  What you actually care about
                </th>
                <th className="text-left py-3 px-4 font-semibold text-bark">
                  Craftybase
                </th>
                <th className="text-left py-3 px-4 font-semibold text-eucalyptus-dark">
                  Dreamward
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sand/60">
              <ComparisonRow
                feature="Change a material cost — does last year's profit move?"
                them="Rolling weighted-average recalculates costs as prices change"
                us="No — FIFO locks each sale's cost the moment it sells"
              />
              <ComparisonRow
                feature="In-person markets as their own P&L (booth fee + mileage)"
                them="Geared to online / handmade inventory"
                us="Yes — every market is a first-class P&L unit"
              />
              <ComparisonRow
                feature="Every feature on every plan"
                them="Plans cap what you track; price scales with limits"
                us="Yes — all of it, from $10/mo"
              />
              <ComparisonRow
                feature="What sets your price"
                them="Usage tier / object & transaction limits"
                us="Your revenue band — auto-adjusts as you grow"
              />
              <ComparisonRow
                feature="Schedule-C P&L + Form 1125-A inventory value"
                them="COGS + inventory tracking focus"
                us="On your tax report automatically, every plan"
              />
              <ComparisonRow
                feature="Entry price (billed monthly)"
                them="Craftybase Studio $49 · Stocksmith $99+"
                us="$10 — every feature + all channels included"
              />
            </tbody>
          </table>
        </div>
        <p className="text-center text-[11px] text-stone mt-3 max-w-2xl mx-auto">
          Craftybase is now <strong>Stocksmith</strong> (same team, same
          software; a smaller &ldquo;Craftybase Studio&rdquo; tier remains).
          This reflects their publicly documented method &amp; pricing as of{" "}
          {new Date().toLocaleDateString("en-US", {
            month: "long",
            year: "numeric",
          })}
          . Both are good tools — pick the one that fits how you sell.
        </p>
      </section>

      {/* Deep-dive — three defensible differentiators */}
      <section className="bg-eucalyptus-soft/40 border-y border-sand py-12 sm:py-16">
        <div className="max-w-[1100px] mx-auto px-4 sm:px-8">
          <div className="text-center mb-10">
            <h2 className="font-serif text-2xl sm:text-3xl font-semibold text-forest m-0 mb-2">
              The three that matter most
            </h2>
            <p className="text-sm text-bark max-w-2xl mx-auto m-0">
              Where the two tools genuinely diverge — and why it changes your
              numbers.
            </p>
          </div>

          <div className="space-y-6">
            <CompareSection
              num="1"
              title="Your filed numbers stay put"
              theirCopy="Craftybase (now Stocksmith) uses the rolling weighted-average cost method — every material purchase recalculates the average cost per unit, and manufacturing draws on that current average. It's a valid, IRS-accepted method, but it means a cost you enter today can move the cost-of-goods behind sales you already reported."
              ourCopy="Dreamward uses FIFO and locks each sale's cost the moment it sells — drawing down your oldest stock at the price you actually paid. Change a cost today and it applies going forward; a number you already filed never moves."
              highlight
            />
            <CompareSection
              num="2"
              title="Built for booth AND online, not just online"
              theirCopy="Craftybase is built around handmade inventory and COGS for online sellers. In-person markets — the booth fee, the drive, the cash box — aren't modeled as their own profit-and-loss."
              ourCopy="Dreamward treats every market as a first-class P&L unit: booth fee, auto-tracked mileage, and the day's sales in one place, so you can see which markets actually pay. Your online channels roll into the same ledger."
            />
            <CompareSection
              num="3"
              title="Every feature on every plan"
              theirCopy="Craftybase's plans scale by how much you track — transaction and object limits climb with price, so growing can mean paying more to keep doing what you already do."
              ourCopy="Dreamward includes every feature on every plan and prices by your revenue band instead of usage caps. Your tier auto-adjusts as you grow — no feature gates, no upgrade-to-unlock walls."
            />
          </div>
        </div>
      </section>

      {/* Pricing philosophy */}
      <section className="max-w-[1100px] mx-auto px-4 sm:px-8 py-12 sm:py-16">
        <div className="text-center mb-8">
          <span className="text-[11px] font-bold uppercase tracking-wider text-rose-dark bg-rose-soft px-3 py-1 rounded-full">
            Built for people. Priced for people.
          </span>
          <h2 className="font-serif text-2xl sm:text-3xl font-semibold text-forest m-0 mb-2 mt-3">
            Priced by your size, not by feature gates
          </h2>
          <p className="text-sm text-bark max-w-2xl mx-auto m-0 leading-relaxed">
            Dreamward includes <strong>every feature on every tier</strong> —
            FIFO costing, Schedule-C P&amp;L, receipt vault, every
            integration — from <strong>$10/mo</strong>, with your tier set by
            your revenue and adjusting automatically as you grow.
          </p>
        </div>

        <div className="flex justify-center gap-3 flex-wrap">
          <Link
            href="/pricing"
            className="inline-block py-2.5 px-6 rounded-full bg-eucalyptus text-cream text-sm font-semibold no-underline hover:bg-eucalyptus-dark"
          >
            See Dreamward plans &rarr;
          </Link>
          <Link
            href="/compare"
            className="inline-block py-2.5 px-6 rounded-full bg-cream border border-sand text-eucalyptus-dark text-sm font-semibold no-underline hover:border-eucalyptus"
          >
            The full comparison &rarr;
          </Link>
        </div>
      </section>

      <FaqSection
        faqs={[
          {
            q: "Is Dreamward a good Craftybase (now Stocksmith) alternative?",
            a: "Yes. Dreamward covers the recipe COGS and real-time inventory makers use Craftybase for, and adds in-person market P&L — booth fee, mileage, and market sales — that Craftybase doesn't model. It starts at $10/month, versus Craftybase Studio at $49 and Stocksmith at $99+.",
          },
          {
            q: "How is Dreamward's costing different from Craftybase's?",
            a: "Craftybase (Stocksmith) uses rolling weighted-average costing, which recalculates as your material prices change. Dreamward uses FIFO and locks each sale's cost the moment it sells — so a price change today never rewrites the profit on sales you already filed.",
          },
          {
            q: "Is Dreamward cheaper than Craftybase?",
            a: "Dreamward is $10/month with every feature included, and your tier is set by your revenue. Craftybase's smaller Studio tier is $49/month, and its main product (now Stocksmith) runs $99–$349/month with features gated to higher tiers (as of July 2026).",
          },
          {
            q: "Can I move my catalog from Craftybase to Dreamward?",
            a: "Yes. Paste or import your product catalog (insert-only, so it never overwrites), connect Etsy, Shopify, Square, or Wix to re-import past orders, and see real margins in minutes. Your data always exports back to CSV — no lock-in.",
          },
          {
            q: "Does Dreamward handle selling at markets and online at the same time?",
            a: "That's the core of it. Every market is its own P&L — booth fee plus auto-tracked mileage plus the day's sales — and your online channels roll into the same ledger, giving you one honest P&L and one Schedule C across booth and online.",
          },
        ]}
      />

      {/* Bottom CTA */}
      <section className="bg-eucalyptus-soft/50 border-t border-sand py-12 sm:py-16">
        <div className="max-w-[800px] mx-auto px-4 sm:px-8 text-center">
          <h2 className="font-serif text-2xl sm:text-3xl font-semibold m-0 mb-3 text-forest">
            Try it on your own products
          </h2>
          <p className="text-base text-bark m-0 mb-6 max-w-xl mx-auto">
            14-day free trial. Connect Etsy, Shopify, Wix, or Square, add a
            market or two, and see your real gross-margin numbers in under 10
            minutes.
          </p>
          <SignInButton label="Start free 14-day trial" />
          <p className="text-xs text-stone mt-4">No credit card required.</p>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-sand py-6 text-center text-xs text-stone">
        <p className="m-0 mb-2 text-bark">
          Your data is yours. Export to CSV anytime. No lock-in.
        </p>
        <Link href="/" className="text-bark no-underline mx-2 hover:text-forest">
          Home
        </Link>
        <span className="text-sand">{"\u{00B7}"}</span>
        <Link
          href="/privacy"
          className="text-bark no-underline mx-2 hover:text-forest"
        >
          Privacy
        </Link>
        <span className="text-sand">{"\u{00B7}"}</span>
        <Link
          href="/terms"
          className="text-bark no-underline mx-2 hover:text-forest"
        >
          Terms
        </Link>
        <p className="m-0 mt-2">
          {"\u{00A9}"} {new Date().getFullYear()} Dreamward. Craftybase is a
          trademark of its respective owner; this page is an independent
          comparison.
        </p>
      </footer>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────

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

function ComparisonRow({
  feature,
  them,
  us,
}: {
  feature: string;
  them: string;
  us: string;
}) {
  return (
    <tr>
      <td className="py-3 px-4 text-forest font-medium">{feature}</td>
      <td className="py-3 px-4 text-bark">{them}</td>
      <td className="py-3 px-4 text-eucalyptus-dark">
        <span className="inline-flex items-start gap-1.5">
          <span className="text-eucalyptus">{"\u{2713}"}</span>
          <span>{us}</span>
        </span>
      </td>
    </tr>
  );
}

function CompareSection({
  num,
  title,
  theirCopy,
  ourCopy,
  highlight,
}: {
  num: string;
  title: string;
  theirCopy: string;
  ourCopy: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={`bg-cream rounded-2xl border p-6 ${
        highlight ? "border-honey ring-2 ring-honey/30" : "border-sand"
      }`}
    >
      {highlight && (
        <p className="text-[11px] uppercase tracking-widest text-honey-dark font-semibold m-0 mb-2">
          {"\u{2728}"} The one that matters most
        </p>
      )}
      <h3 className="font-serif text-lg font-semibold text-forest m-0 mb-4">
        <span className="text-stone mr-2">{num}.</span>
        {title}
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-stone font-semibold m-0 mb-2">
            Craftybase
          </p>
          <p className="text-sm text-bark leading-relaxed m-0">{theirCopy}</p>
        </div>
        <div className="md:border-l md:border-sand md:pl-4">
          <p className="text-[11px] uppercase tracking-wide text-eucalyptus-dark font-semibold m-0 mb-2">
            Dreamward
          </p>
          <p className="text-sm text-forest leading-relaxed m-0">{ourCopy}</p>
        </div>
      </div>
    </div>
  );
}
