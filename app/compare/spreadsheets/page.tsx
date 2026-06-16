// app/compare/spreadsheets/page.tsx
//
// SEO comparison page: Dreamward vs. tracking COGS/inventory in a
// spreadsheet (Excel / Google Sheets). Names NO company — "spreadsheet"
// is a category, not a competitor — so it stays on-brand with the
// no-named-competitor rule while capturing the huge "outgrew my
// spreadsheet" search intent. Mirrors /compare's structure + Sage &
// Rose styling. Pure server component; SignInButton is the client CTA.

import Link from "next/link";
import SignInButton from "../../components/SignInButton";

export const metadata = {
  title: "Dreamward vs. spreadsheets — COGS & inventory without broken formulas",
  description:
    "Outgrew your inventory spreadsheet? See why makers move from Excel/Google Sheets to Dreamward: per-SKU cost of goods that calculates itself, costs that never rewrite last year's profit, live stock from synced sales, and a one-click Schedule-C P&L.",
  openGraph: {
    title: "Dreamward vs. spreadsheets",
    description:
      "Real gross-margin and inventory tracking for makers — without the broken formulas, manual CSV pasting, and tax-time reformatting.",
    type: "website",
  },
};

export default function CompareSpreadsheetsPage() {
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
            Spreadsheets vs. Dreamward
          </p>
          <h1 className="font-serif text-3xl sm:text-5xl font-semibold m-0 mb-4 leading-[1.1] text-forest tracking-tight">
            Your spreadsheet got you here.
            <br className="hidden sm:block" /> It won&apos;t get you there.
          </h1>
          <p className="text-lg sm:text-xl text-bark max-w-2xl mx-auto m-0 mb-8 leading-relaxed">
            A spreadsheet is a great place to start — until one wrong cell
            quietly rewrites last year&apos;s profit. Here&apos;s what you
            get when your numbers live somewhere built for them.
          </p>
          <SignInButton label="Go dreamward &rarr;" />
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
            The spreadsheet headaches makers hit most — and how Dreamward
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
                  A spreadsheet
                </th>
                <th className="text-left py-3 px-4 font-semibold text-eucalyptus-dark">
                  Dreamward
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-sand/60">
              <ComparisonRow
                feature="Update a material cost"
                them="Overwrite the cell — and last year's profit silently changes"
                themBad
                us="Dated costs — every past sale keeps the cost it had"
              />
              <ComparisonRow
                feature="Per-SKU cost of goods"
                them="Hand-built formulas you maintain (and debug)"
                themBad
                us="Calculated for you on every sale, from your recipe"
              />
              <ComparisonRow
                feature="Insert a row / reorder things"
                them="A formula breaks somewhere and the totals lie"
                themBad
                us="Structured data — there's nothing to break"
              />
              <ComparisonRow
                feature="Online & market sales"
                them="Export a CSV, paste it, reformat — every single time"
                themBad
                us="Shopify, Etsy, Square & Wix sync in automatically"
              />
              <ComparisonRow
                feature="Live stock counts"
                them="Manual tallies that drift the moment you sell"
                themBad
                us="Auto-deducted from every synced sale"
              />
              <ComparisonRow
                feature="Who changed this number, and when?"
                them="No idea — there's no history"
                themBad
                us="A visible audit trail on every number"
              />
              <ComparisonRow
                feature="Schedule-C profit & loss for taxes"
                them="Copy, paste, reformat into something your CPA accepts"
                them2
                us="One click — CPA-ready PDF + CSV, every plan"
              />
              <ComparisonRow
                feature="Two people editing at once"
                them="Version conflicts and overwritten work"
                them2
                us="One source of truth, always current"
              />
            </tbody>
          </table>
        </div>
      </section>

      {/* Deep-dive */}
      <section className="bg-eucalyptus-soft/40 border-y border-sand py-12 sm:py-16">
        <div className="max-w-[1100px] mx-auto px-4 sm:px-8">
          <div className="text-center mb-10">
            <h2 className="font-serif text-2xl sm:text-3xl font-semibold text-forest m-0 mb-2">
              What actually changes
            </h2>
            <p className="text-sm text-bark max-w-2xl mx-auto m-0">
              The differences that save your evenings — and protect your
              tax numbers.
            </p>
          </div>

          <div className="space-y-6">
            <CompareSection
              num="1"
              title="One cell can't rewrite your history"
              theirCopy="When a material gets more expensive, you overwrite the cost cell — and every formula that referenced it recalculates your PAST months too. The profit you already reported quietly changes."
              ourCopy="Costs are dated. A March sale keeps its March cost forever. Raise a price today and only today's sales use it — and if you ever edit an old cost, Dreamward shows exactly how many past sales it would touch first."
              highlight
            />
            <CompareSection
              num="2"
              title="The math maintains itself"
              theirCopy="Per-SKU cost of goods means hand-building (and re-checking) formulas across tabs. One mis-dragged cell and your margins are wrong without you knowing."
              ourCopy="Define a product's recipe once. Dreamward computes cost of goods and gross margin on every sale — per product, per channel, per period — and you can click any number to see exactly how it was built."
            />
            <CompareSection
              num="3"
              title="It fills itself in"
              theirCopy="Sales don't enter themselves. You export a CSV from each store, paste it in, fix the columns, and hope you didn't double-paste — over and over, forever."
              ourCopy="Connect Shopify, Etsy, Square, or Wix and sales flow in on their own — deducting materials and updating stock automatically. Cash and market-day sales? Tap them in on your phone at the booth."
            />
            <CompareSection
              num="4"
              title="Tax time in minutes, not a weekend"
              theirCopy="At tax time you stitch tabs together, reformat everything, and manually total categories into something your accountant can use — praying the formulas still add up."
              ourCopy="A Schedule-C-ready profit & loss (plus inventory value for Form 1125-A) generates in one click as a PDF + CSV — included on every plan, even the $10 tier."
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
            Cheaper than the time you spend in the sheet
          </h2>
          <p className="text-sm text-bark max-w-2xl mx-auto m-0 leading-relaxed">
            Dreamward includes <strong>every feature on every tier</strong>{" "}
            — integrations, COGS, live stock, Schedule-C reports, receipt
            vault. You pay by your business size, starting at $10/mo, and
            your tier adjusts automatically as you grow. No feature gates,
            no upsell calls.
          </p>
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
            Bring your spreadsheet — we&apos;ll take it from here
          </h2>
          <p className="text-base text-bark m-0 mb-6 max-w-xl mx-auto">
            Paste your product list straight from your sheet (insert-only,
            so it never overwrites anything), connect a store, and see your
            real gross-margin numbers in under 10 minutes.
          </p>
          <SignInButton label="Go dreamward &rarr;" />
          <p className="text-xs text-stone mt-4">No credit card required.</p>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-sand py-6 text-center text-xs text-stone">
        <Link href="/" className="text-bark no-underline mx-2 hover:text-forest">
          Home
        </Link>
        <span className="text-sand">{"\u{00B7}"}</span>
        <Link
          href="/compare"
          className="text-bark no-underline mx-2 hover:text-forest"
        >
          Compare
        </Link>
        <span className="text-sand">{"\u{00B7}"}</span>
        <Link
          href="/pricing"
          className="text-bark no-underline mx-2 hover:text-forest"
        >
          Pricing
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
            A spreadsheet
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
