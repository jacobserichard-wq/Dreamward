// app/compare/page.tsx
//
// Comparison page — Dreamward vs. the typical maker COGS/inventory
// tool. Deliberately GENERIC: no competitor is named (cleaner tone,
// no legal/teardown vibe, on-brand "built for people"). The points
// are the real differentiators makers care about, in plain language.
//
// Generic framing tradeoff: we give up the "{competitor} alternative"
// SEO capture a named page would get. Acceptable pre-launch; can add
// a separate named landing later if that channel proves worth it.
//
// Pure server component (public route). SignInButton is the client
// island for the CTA.

import Link from "next/link";
import SignInButton from "../components/SignInButton";

export const metadata = {
  title: "How Dreamward compares — real gross margin, no legacy quirks",
  description:
    "How Dreamward is different from the usual maker COGS + inventory tools: FIFO costing that values each sale at the price you actually paid and never rewrites your past numbers, a visible audit trail, one-click bulk updates, and every feature on every plan.",
  openGraph: {
    title: "How Dreamward compares",
    description:
      "Real gross-margin tracking without the historical-data rewrites, black-box costing, and feature gates.",
    type: "website",
  },
};

export default function ComparePage() {
  return (
    <div className="min-h-screen bg-oat font-sans text-forest">
      {/* Header — mirrors the marketing landing */}
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
            Comparison
          </p>
          <h1 className="font-serif text-3xl sm:text-5xl font-semibold m-0 mb-4 leading-[1.1] text-forest tracking-tight">
            Why makers switch to Dreamward
          </h1>
          <p className="text-lg sm:text-xl text-bark max-w-2xl mx-auto m-0 mb-8 leading-relaxed">
            Most cost-of-goods tools were built for spreadsheets-people,
            not makers. Here&apos;s where Dreamward does it differently —
            in plain English.
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
            The things makers complain about most — and how Dreamward
            handles each.
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
                  Most maker tools
                </th>
                <th className="text-left py-3 px-4 font-semibold text-eucalyptus-dark">
                  Dreamward
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sand/60">
              <ComparisonRow
                feature="Changing a cost today rewrites last year's profit"
                them="Yes — it quietly changes past sales"
                themBad
                us="No — every sale keeps the cost it had"
              />
              <ComparisonRow
                feature="See the math behind a cost number"
                them="No — you just get a final total"
                themBad
                us="Yes — click any number to see how it's built"
              />
              <ComparisonRow
                feature="In-person 'custom amount' sales deduct the right materials"
                them="No — lands generic, throws off stock"
                themBad
                us="Yes — match it once, then it's automatic"
              />
              <ComparisonRow
                feature="Update costs on dozens of products at once"
                them="One at a time (or a risky import)"
                themBad
                us="All at once, with a live before/after preview"
              />
              <ComparisonRow
                feature="Build your product list from a spreadsheet"
                them="Buggy import that can corrupt your data"
                themBad
                us="Paste it in — only adds, never overwrites"
              />
              <ComparisonRow
                feature="Tax-ready profit & loss for your accountant"
                them="Costs extra (higher tier only)"
                themBad
                us="Included on every plan — even the $10 tier"
              />
              <ComparisonRow
                feature="Attach receipts to expenses"
                them="Clunky — not a real feature"
                them2
                us="Drag-and-drop on every expense, private storage"
              />
              <ComparisonRow
                feature="Inventory value for your tax return (Form 1125-A)"
                them="Not provided"
                them2
                us="On your tax report automatically"
              />
            </tbody>
          </table>
        </div>
      </section>

      {/* Deep-dive — four plain-language differentiators */}
      <section className="bg-eucalyptus-soft/40 border-y border-sand py-12 sm:py-16">
        <div className="max-w-[1100px] mx-auto px-4 sm:px-8">
          <div className="text-center mb-10">
            <h2 className="font-serif text-2xl sm:text-3xl font-semibold text-forest m-0 mb-2">
              The four that matter most
            </h2>
            <p className="text-sm text-bark max-w-2xl mx-auto m-0">
              The differences that actually change your day — and your
              tax numbers.
            </p>
          </div>

          <div className="space-y-6">
            <CompareSection
              num="1"
              title="Your past numbers stay put"
              theirCopy="Change a recipe or a cost today and many tools quietly rewrite what your past items cost — which wrecks the tax numbers you already filed."
              ourCopy="Each sale's cost is locked in the moment it sells, using FIFO — it draws down your oldest stock at the price you actually paid. A sale keeps that cost forever, so changing a cost today never rewrites a number you already filed."
              highlight
            />
            <CompareSection
              num="2"
              title="You can see the math"
              theirCopy="You get a final cost-of-goods number with no way to see how it was reached — so you're stuck trusting a black box at tax time."
              ourCopy="Click any number on your COGS dashboard and see every sale behind it and the exact cost layers it drew from. You could re-create it by hand in a spreadsheet."
            />
            <CompareSection
              num="3"
              title="Setup that doesn't fight you"
              theirCopy="Adding materials means clicking through tab after tab, and bulk edits or spreadsheet imports are known to corrupt the data you already entered."
              ourCopy="Update costs across many products in one screen with a preview, or paste your whole catalog from a spreadsheet — insert-only, so it never overwrites what's already there."
            />
            <CompareSection
              num="4"
              title="Sales that actually deduct materials"
              theirCopy="On cheaper plans an online sale won't auto-deduct your materials, and in-person 'custom' sales land as generic line items — quietly throwing off your stock."
              ourCopy="Shopify, Wix, Square, and Etsy sales sync and deduct materials automatically on every plan. Map a one-off 'custom' item once and future ones resolve themselves."
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
            Most tools gate features. We don&apos;t.
          </h2>
          <p className="text-sm text-bark max-w-2xl mx-auto m-0 leading-relaxed">
            The usual maker tools lock profit &amp; loss reports,
            automatic material deduction, or lot tracking behind pricier
            tiers — pay more to unlock what you already need. Dreamward
            includes <strong>every feature on every tier</strong>. You
            pay by your business size, starting at $10/mo, and your tier
            adjusts automatically as you grow.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-3xl mx-auto mb-8">
          <div className="bg-cream border border-sand rounded-2xl p-5">
            <p className="text-sm font-bold text-forest m-0 mb-2">
              Most maker tools
            </p>
            <ul className="m-0 p-0 list-none space-y-1.5 text-[13px] text-bark">
              <li className="flex items-start gap-2">
                <span className="text-red-400 mt-0.5">{"\u{2717}"}</span>
                <span>Profit &amp; loss locked behind a pricier tier</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-red-400 mt-0.5">{"\u{2717}"}</span>
                <span>Lot tracking &amp; auto-deduction cost extra</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-red-400 mt-0.5">{"\u{2717}"}</span>
                <span>Pay more to unlock what you already need</span>
              </li>
            </ul>
          </div>
          <div className="bg-cream border-2 border-eucalyptus rounded-2xl p-5">
            <p className="text-sm font-bold text-forest m-0 mb-2">Dreamward</p>
            <ul className="m-0 p-0 list-none space-y-1.5 text-[13px] text-bark">
              <li className="flex items-start gap-2">
                <span className="text-eucalyptus mt-0.5">{"\u{2713}"}</span>
                <span>Every feature on every tier — from $10/mo</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-eucalyptus mt-0.5">{"\u{2713}"}</span>
                <span>Priced by business size, not feature gates</span>
              </li>
              <li className="flex items-start gap-2">
                <span className="text-eucalyptus mt-0.5">{"\u{2713}"}</span>
                <span>Tier auto-adjusts as you grow — no upsell calls</span>
              </li>
            </ul>
          </div>
        </div>

        <div className="flex justify-center">
          <Link
            href="/pricing"
            className="inline-block py-2.5 px-6 rounded-full bg-eucalyptus text-cream text-sm font-semibold no-underline hover:bg-eucalyptus-dark"
          >
            See Dreamward plans &rarr;
          </Link>
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="bg-eucalyptus-soft/50 border-t border-sand py-12 sm:py-16">
        <div className="max-w-[800px] mx-auto px-4 sm:px-8 text-center">
          <h2 className="font-serif text-2xl sm:text-3xl font-semibold m-0 mb-3 text-forest">
            Try it on your own products
          </h2>
          <p className="text-base text-bark m-0 mb-6 max-w-xl mx-auto">
            14-day free trial. Connect Etsy, Shopify, Wix, or Square,
            re-import your past orders, and see your real gross-margin
            numbers in under 10 minutes.
          </p>
          <SignInButton label="Start free 14-day trial" />
          <p className="text-xs text-stone mt-4">No credit card required.</p>
          <p className="text-sm text-bark mt-6 m-0">
            Coming from Excel or Google Sheets?{" "}
            <Link
              href="/compare/spreadsheets"
              className="text-eucalyptus-dark underline hover:text-forest"
            >
              See Dreamward vs. spreadsheets &rarr;
            </Link>
          </p>
          <p className="text-sm text-bark mt-2 m-0">
            Comparing to Craftybase?{" "}
            <Link
              href="/compare/craftybase"
              className="text-eucalyptus-dark underline hover:text-forest"
            >
              See Dreamward vs. Craftybase &rarr;
            </Link>
          </p>
          <p className="text-sm text-bark mt-2 m-0">
            Using QuickBooks?{" "}
            <Link
              href="/compare/quickbooks"
              className="text-eucalyptus-dark underline hover:text-forest"
            >
              See Dreamward vs. QuickBooks &rarr;
            </Link>
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-sand py-6 text-center text-xs text-stone">
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
          {"\u{00A9}"} {new Date().getFullYear()} Dreamward
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
  themBad,
  them2,
  us,
}: {
  feature: string;
  them: string;
  themBad?: boolean;
  them2?: boolean;
  us: string;
}) {
  const themClass = themBad
    ? "text-red-700"
    : them2
      ? "text-honey-dark"
      : "text-bark";
  return (
    <tr>
      <td className="py-3 px-4 text-forest font-medium">{feature}</td>
      <td className={`py-3 px-4 ${themClass}`}>
        <span className="inline-flex items-start gap-1.5">
          {themBad && <span className="text-red-500">{"\u{2716}"}</span>}
          {them2 && <span className="text-honey">{"\u{26A0}"}</span>}
          <span>{them}</span>
        </span>
      </td>
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
            Most tools
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
