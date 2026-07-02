// app/compare/quickbooks/page.tsx
//
// Named head-to-head: Dreamward vs QuickBooks (Online). Captures the
// "QuickBooks alternative for makers" search intent.
//
// ACCURACY DISCIPLINE (named competitor — Intuit): QuickBooks Online
// uses FIFO inventory costing, SAME as Dreamward — so we do NOT run the
// "rewrites history / averaging" angle here (that's the Craftybase
// page). The verified, defensible contrast is maker-native features
// QBO genuinely lacks: no native bill-of-materials/recipe/assembly, no
// per-handmade-product material deduction, no in-person market P&L, and
// inventory gated to the $115/mo Plus tier. Claims below are limited to
// those. Re-verify QBO features + pricing before strengthening.

import Link from "next/link";
import SignInButton from "../../components/SignInButton";
import FaqSection from "../../components/FaqSection";

export const metadata = {
  title: "Dreamward vs QuickBooks — maker COGS QuickBooks Online can't do",
  description:
    "A QuickBooks alternative for handmade businesses: recipe/material COGS, per-channel margin, and in-person market P&L that QuickBooks Online doesn't offer — every feature on every plan, from $10/month.",
  openGraph: {
    title: "Dreamward vs QuickBooks",
    description:
      "Maker-native COGS, recipes, and market P&L that QuickBooks Online doesn't do — from $10/month.",
    type: "website",
  },
};

export default function QuickbooksComparePage() {
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
            Dreamward vs QuickBooks
          </p>
          <h1 className="font-serif text-3xl sm:text-5xl font-semibold m-0 mb-4 leading-[1.1] text-forest tracking-tight">
            A QuickBooks alternative built for makers
          </h1>
          <p className="text-lg sm:text-xl text-bark max-w-2xl mx-auto m-0 mb-8 leading-relaxed">
            QuickBooks is solid general accounting. Dreamward does the
            maker-specific parts it doesn&apos;t — recipe COGS, per-channel
            margin, and in-person markets — at a fraction of the price.
          </p>
          <SignInButton label="Start free 14-day trial" />
          <p className="text-xs text-stone mt-4">
            14-day free trial. No credit card required.
          </p>
        </div>
      </header>

      {/* Quick-read table */}
      <section className="max-w-[1100px] mx-auto px-4 sm:px-8 py-12 sm:py-16">
        <div className="text-center mb-8">
          <h2 className="font-serif text-2xl sm:text-3xl font-semibold text-forest m-0 mb-2">
            The quick read
          </h2>
          <p className="text-sm text-bark m-0">
            QuickBooks runs your books. Here&apos;s the maker-specific work it
            leaves to you.
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
                  QuickBooks Online
                </th>
                <th className="text-left py-3 px-4 font-semibold text-eucalyptus-dark">
                  Dreamward
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sand/60">
              <ComparisonRow
                feature="Recipe / bill-of-materials costing for handmade products"
                them="No native BOM or assemblies in QuickBooks Online"
                us="Built in — cost every product from its materials"
              />
              <ComparisonRow
                feature="Auto-deduct raw materials when a product sells"
                them="Not in QBO — materials tracked by hand"
                us="Automatic on every sale, every channel"
              />
              <ComparisonRow
                feature="In-person markets & events as their own P&L"
                them="General ledger — booth fee + mileage not modeled"
                us="Every market is a first-class P&L unit"
              />
              <ComparisonRow
                feature="Inventory tracking"
                them="Plus tier ($115/mo) and up"
                us="Every plan, from $10/mo"
              />
              <ComparisonRow
                feature="Built for"
                them="General accounting — often needs an accountant"
                us="Makers — plain English, no accountant required"
              />
            </tbody>
          </table>
        </div>
        <p className="text-center text-[11px] text-stone mt-3 max-w-2xl mx-auto">
          QuickBooks Online uses FIFO inventory costing, the same as Dreamward —
          the difference here is maker-native features (recipes, markets,
          per-channel margin), not the valuation method. Reflects QuickBooks
          Online&apos;s publicly documented features &amp; pricing as of{" "}
          {new Date().toLocaleDateString("en-US", {
            month: "long",
            year: "numeric",
          })}
          . QuickBooks is a trademark of Intuit Inc.; this is an independent
          comparison.
        </p>
      </section>

      {/* Deep-dive */}
      <section className="bg-eucalyptus-soft/40 border-y border-sand py-12 sm:py-16">
        <div className="max-w-[1100px] mx-auto px-4 sm:px-8">
          <div className="text-center mb-10">
            <h2 className="font-serif text-2xl sm:text-3xl font-semibold text-forest m-0 mb-2">
              The three that matter most
            </h2>
            <p className="text-sm text-bark max-w-2xl mx-auto m-0">
              Where a general ledger stops and a maker&apos;s tool begins.
            </p>
          </div>

          <div className="space-y-6">
            <CompareSection
              num="1"
              title="Recipes QuickBooks Online doesn't have"
              theirCopy="QuickBooks Online has no bill-of-materials or assembly feature — there's no way to define a product from its raw materials. Makers end up tracking materials by hand or bolting on a separate manufacturing tool just to know what a product costs to make."
              ourCopy="Dreamward builds every product from a recipe of its materials. Log a production run and the materials draw down while finished stock goes up; when it sells, COGS is already built from what it actually cost to make — no manual math, no add-on."
              highlight
            />
            <CompareSection
              num="2"
              title="Built for booth AND online, not just the ledger"
              theirCopy="QuickBooks records income and expenses, but it doesn't model an in-person market — the booth fee, the drive there and back, the day's mixed cash-and-card sales — as its own profit-and-loss."
              ourCopy="Dreamward treats every market as a first-class P&L: booth fee, auto-tracked mileage, and the day's sales together — right alongside your Etsy, Shopify, and Square channels in one ledger."
            />
            <CompareSection
              num="3"
              title="Priced for a maker, not a firm"
              theirCopy="QuickBooks Online only adds inventory at its Plus tier ($115/mo), climbing to $275/mo for Advanced — and even then there are no maker recipes, no material deduction, and no market P&L."
              ourCopy="Dreamward includes recipe COGS, live inventory, per-channel margin, and Schedule-C reports on every plan, from $10/mo, with your tier set by your revenue. Every feature, every plan."
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
            Everything included, from $10/mo
          </h2>
          <p className="text-sm text-bark max-w-2xl mx-auto m-0 leading-relaxed">
            Where QuickBooks gates inventory behind its <strong>$115/mo</strong>{" "}
            Plus plan (with no maker recipes even then), Dreamward includes{" "}
            <strong>every feature on every tier</strong> — recipe COGS,
            Schedule-C P&amp;L, receipt vault, every integration — from{" "}
            <strong>$10/mo</strong>, with your tier set by your revenue.
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
            q: "Is Dreamward a QuickBooks alternative for makers?",
            a: "For the maker-specific parts, yes. QuickBooks Online is general accounting — it has no recipe or bill-of-materials costing, doesn't auto-deduct raw materials when a handmade product sells, and doesn't model in-person markets. Dreamward does all three, from $10/month.",
          },
          {
            q: "Does Dreamward replace QuickBooks entirely?",
            a: "For many makers, yes — Dreamward tracks income, expenses, COGS, and inventory and produces a Schedule-C P&L (plus Form 1125-A inventory value) for your CPA. If you already rely on QuickBooks for general bookkeeping, Dreamward can run alongside it as the maker-native COGS and margin layer.",
          },
          {
            q: "Can Dreamward do recipe costing that QuickBooks can't?",
            a: "Yes. QuickBooks Online has no native bill-of-materials or assembly feature, so makers track materials by hand or bolt on a separate manufacturing tool. Dreamward builds every product from a recipe of its materials, so each sale already knows what it cost to make.",
          },
          {
            q: "Is Dreamward cheaper than QuickBooks Online?",
            a: "QuickBooks Online only adds inventory at its Plus tier ($115/month, up to $275 for Advanced, as of July 2026) — and still has no maker recipes. Dreamward includes recipe COGS, inventory, and tax-ready reports on every plan, from $10/month.",
          },
          {
            q: "Do I still need an accountant?",
            a: "Dreamward hands your accountant a clean, tax-ready Schedule-C P&L with COGS and inventory already figured, which usually means less billable time. It doesn't file your taxes or replace professional advice — it removes the year-end scramble.",
          },
        ]}
      />

      {/* Bottom CTA */}
      <section className="bg-eucalyptus-soft/50 border-t border-sand py-12 sm:py-16">
        <div className="max-w-[800px] mx-auto px-4 sm:px-8 text-center">
          <h2 className="font-serif text-2xl sm:text-3xl font-semibold m-0 mb-3 text-forest">
            Keep QuickBooks if you love it — or try the maker-native way
          </h2>
          <p className="text-base text-bark m-0 mb-6 max-w-xl mx-auto">
            14-day free trial. Add a recipe, connect a shop, and see real
            per-product margin in under 10 minutes.
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
          {"\u{00A9}"} {new Date().getFullYear()} Dreamward. QuickBooks is a
          trademark of Intuit Inc.; this page is an independent comparison.
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
            QuickBooks Online
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
