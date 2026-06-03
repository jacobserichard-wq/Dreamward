// app/compare/crafty-base/page.tsx
//
// Sub-session 32 marketing refresh, commit 2 of 3. Comparison
// landing page that takes the rich "anti-Crafty" positioning
// already documented in our code comments (15+ files in
// app/skus/, app/cogs/, lib/cogs/, app/components/Sku*) and
// surfaces it as public-facing copy.
//
// Content sourced from:
//   - The Crafty Base complaint dossier the user shared on
//     2026-05-30 (session-notes for the marketing refresh)
//   - Existing internal product comments that name the specific
//     Crafty Base anti-pattern each feature counters
//   - Public Crafty Base pricing page snapshot (Indie / Indie+ /
//     Business tiers gating Profit & Loss reports + manufacture
//     picklists)
//
// Pure server component for the public route. Auth-checked
// visitors don't redirect (unlike the landing page) — the
// comparison surface is useful for logged-in users evaluating
// whether to switch.
//
// Disclaimer: Crafty Base claims are based on public docs +
// real user complaints as of late May 2026. Pricing + feature
// matrix verified against their pricing page on 2026-05-30.

import Link from "next/link";
import SignInButton from "../../components/SignInButton";

export const metadata = {
  title: "FlowWork vs Crafty Base — Real gross margin without the legacy quirks",
  description:
    "Side-by-side comparison of FlowWork and Crafty Base for makers + small-business inventory tracking. Effective-date COGS, audit-trail transparency, one-click bulk updates — what most generic-inventory tools get wrong.",
  openGraph: {
    title: "FlowWork vs Crafty Base",
    description:
      "Real gross margin tracking without the historical-data rewrites, opaque costing, and click-heavy onboarding.",
    type: "website",
  },
};

export default function CraftyBaseComparePage() {
  return (
    <div className="min-h-screen bg-white font-sans">
      {/* Header — matches the marketing landing for consistency */}
      <header className="bg-gradient-to-br from-slate-900 to-slate-800 text-white">
        <div className="max-w-[1100px] mx-auto px-4 sm:px-8 py-5 flex justify-between items-center">
          <Link href="/" className="m-0 text-xl sm:text-2xl font-bold no-underline text-white">
            <span className="text-xl sm:text-2xl">{"\u{26A1}"}</span> FlowWork
          </Link>
          <Link
            href="/signin"
            className="text-sm text-white/80 hover:text-white no-underline"
          >
            Sign in
          </Link>
        </div>

        <div className="max-w-[1100px] mx-auto px-4 sm:px-8 pt-10 sm:pt-16 pb-12 sm:pb-20 text-center">
          <p className="text-xs uppercase tracking-widest text-white/60 mb-3">
            Comparison
          </p>
          <h2 className="text-3xl sm:text-5xl font-extrabold m-0 mb-4 leading-tight">
            FlowWork vs Crafty Base
          </h2>
          <p className="text-lg sm:text-xl text-white/85 max-w-2xl mx-auto m-0 mb-8 leading-relaxed">
            Same persona — makers, small-batch manufacturers, market
            sellers. Different bets on how to track cost-of-goods.
          </p>
          <SignInButton label="Start your free trial &rarr;" />
          <p className="text-xs text-white/60 mt-4">
            14-day free trial. No credit card required.
          </p>
        </div>
      </header>

      {/* TL;DR table */}
      <section className="max-w-[1100px] mx-auto px-4 sm:px-8 py-12 sm:py-16">
        <div className="text-center mb-8">
          <h3 className="text-2xl sm:text-3xl font-bold text-slate-900 m-0 mb-2">
            The quick read
          </h3>
          <p className="text-sm text-slate-600 m-0">
            Where the two tools differ on the things makers complain
            about most.
          </p>
        </div>
        <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left py-3 px-4 font-semibold text-slate-700 w-[40%]">
                  Feature
                </th>
                <th className="text-left py-3 px-4 font-semibold text-slate-500">
                  Crafty Base
                </th>
                <th className="text-left py-3 px-4 font-semibold text-blue-700">
                  FlowWork
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              <ComparisonRow
                feature="Editing a SKU's cost retroactively rewrites historical COGS"
                them="Yes — recipes apply backward to past sales"
                themBad
                us="No — effective-date locked per sale"
              />
              <ComparisonRow
                feature="Audit trail showing which cost row was used per sale"
                them="No — final number only"
                themBad
                us="Yes — click any cell to drill in"
              />
              <ComparisonRow
                feature="Square POS 'Custom Amount' sales auto-mapped to SKUs"
                them="No — lands as generic, breaks deduction"
                themBad
                us="Yes — one-time name match, then auto-resolves"
              />
              <ComparisonRow
                feature="Bulk-update cost on 50 SKUs at once"
                them="Manual click per SKU (or buggy CSV import)"
                themBad
                us="One modal, live preview, atomic save"
              />
              <ComparisonRow
                feature="Paste from spreadsheet to create SKUs"
                them="Buggy CSV import that corrupts existing data"
                themBad
                us="Strict insert-only, smart column detection"
              />
              <ComparisonRow
                feature="Schedule-C P&L for tax handoff"
                them="Behind Indie+ paid tier"
                themBad
                us="Included on the standard Pro plan"
              />
              <ComparisonRow
                feature="Profit & loss report"
                them="Locked on the base tier"
                themBad
                us="Included on every paid tier"
              />
              <ComparisonRow
                feature="Receipt attachments on expenses"
                them="Limited — not a first-class feature"
                them2
                us="Drag-drop on every expense, private storage"
              />
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-slate-400 mt-4 text-center max-w-2xl mx-auto">
          Comparison based on Crafty Base public documentation +
          aggregated user complaints as of late May 2026. Crafty Base
          may update their feature set; verify directly with their
          team if you need the latest.
        </p>
      </section>

      {/* The 4 categories */}
      <section className="bg-slate-50 py-12 sm:py-16">
        <div className="max-w-[1100px] mx-auto px-4 sm:px-8">
          <div className="text-center mb-10">
            <h3 className="text-2xl sm:text-3xl font-bold text-slate-900 m-0 mb-2">
              Where they fall short — and what we did instead
            </h3>
            <p className="text-sm text-slate-600 max-w-2xl mx-auto m-0">
              The four areas Crafty Base users complain about most,
              and the specific FlowWork features that address each.
            </p>
          </div>

          <div className="space-y-6">
            <CompareSection
              num="1"
              title="The data entry nightmare"
              theirHeading="Crafty Base"
              theirCopy="Adding a single raw material means clicking through multiple tabs. Bulk editing is &ldquo;highly prone to formatting errors, often corrupting existing data.&rdquo; Unit-conversion math is &ldquo;math-heavy and frustrating for creative entrepreneurs.&rdquo;"
              ourHeading="FlowWork"
              ourCopy="Bulk cost update across N selected SKUs in one modal with live old → new preview. Paste-from-spreadsheet (Excel, Google Sheets, Numbers, Airtable) with smart column detection — strict insert-only so it never overwrites existing data."
            />

            <CompareSection
              num="2"
              title="Broken & laggy automation"
              theirHeading="Crafty Base"
              theirCopy="On lower tiers, an Etsy sale does NOT auto-deduct raw materials — you must log a manual &ldquo;Manufacturing Run.&rdquo; Square in-person sales sync as generic &ldquo;Custom Amount&rdquo; line items with no SKU — &ldquo;Crafty Base cannot automatically deduct the correct materials, throwing off stock levels.&rdquo;"
              ourHeading="FlowWork"
              ourCopy="Real-time webhook sync from Shopify, Wix, and Square. Square &ldquo;Custom Amount&rdquo; items are first-class — map them once by name, future sales auto-resolve. Per-SKU COGS computes automatically, no Manufacturing Run needed. Finished-goods stock auto-decrements on every sale; raw-material bill-of-materials deduction is on the roadmap."
            />

            <CompareSection
              num="3"
              title="Outdated, retroactive architecture"
              theirHeading="Crafty Base"
              theirCopy="&ldquo;If you update a recipe today, Crafty Base often applies those changes retroactively to items made six months ago. This alters historical Cost of Goods Sold data and completely ruins past tax reporting.&rdquo;"
              ourHeading="FlowWork"
              ourCopy="Effective-date discipline: every cost is dated. Sales priced through a cost row keep their cost forever — changing today's price never rewrites your historical margins. If you do edit a past cost, a confirm modal names the count of affected sales so you know exactly what's about to change."
              highlight
            />

            <CompareSection
              num="4"
              title="Opaque costing, passive alerts"
              theirHeading="Crafty Base"
              theirCopy="&ldquo;When the system calculates the average cost of a material, it does not explicitly show its work. Users report feeling anxious because they have to blindly trust the software's final COGS number without a clear, visual audit trail.&rdquo;"
              ourHeading="FlowWork"
              ourCopy="Click any cell on the COGS dashboard — the audit modal shows every contributing line item with the exact sku_cost_history row used per sale, its effective date, and per-unit cost. Anyone can re-derive every number in a spreadsheet from what's shown."
            />
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="max-w-[1100px] mx-auto px-4 sm:px-8 py-12 sm:py-16">
        <div className="text-center mb-8">
          <h3 className="text-2xl sm:text-3xl font-bold text-slate-900 m-0 mb-2">
            Pricing transparency
          </h3>
          <p className="text-sm text-slate-600 max-w-2xl mx-auto m-0">
            Crafty Base&apos;s Profit &amp; Loss Report, advanced
            auto-manufacturing, and material lot tracking are gated
            behind Indie+ ($59/mo) and Business ($129/mo) tiers.
            FlowWork includes the equivalent features in the standard
            Pro tier ($89/mo) and ships gross-margin reporting on
            Growth ($49/mo).
          </p>
        </div>
        <div className="flex justify-center">
          <Link
            href="/#pricing"
            className="inline-block py-2.5 px-6 rounded-lg bg-blue-500 text-white text-sm font-semibold no-underline hover:bg-blue-600"
          >
            See FlowWork plans &rarr;
          </Link>
        </div>
        <p className="text-[11px] text-slate-400 mt-6 text-center">
          Crafty Base pricing referenced from their public pricing
          page on 2026-05-30. Plan names + tier-gating may have
          changed since.
        </p>
      </section>

      {/* Bottom CTA */}
      <section className="bg-gradient-to-br from-slate-900 to-slate-800 text-white py-12 sm:py-16">
        <div className="max-w-[800px] mx-auto px-4 sm:px-8 text-center">
          <h3 className="text-2xl sm:text-3xl font-bold m-0 mb-3">
            Try it on your own SKUs
          </h3>
          <p className="text-base text-white/80 m-0 mb-6 max-w-xl mx-auto">
            14-day free trial. Connect Shopify / Wix / Square,
            re-import historical orders, and see your real
            gross-margin numbers in under 10 minutes.
          </p>
          <SignInButton label="Start your free trial &rarr;" />
          <p className="text-xs text-white/60 mt-4">
            No credit card required.
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-200 py-6 text-center text-xs text-slate-400">
        <Link href="/" className="text-slate-500 no-underline mx-2">
          Home
        </Link>
        <span className="text-slate-300">{"\u{00B7}"}</span>
        <Link href="/privacy" className="text-slate-500 no-underline mx-2">
          Privacy
        </Link>
        <span className="text-slate-300">{"\u{00B7}"}</span>
        <Link href="/terms" className="text-slate-500 no-underline mx-2">
          Terms
        </Link>
        <p className="m-0 mt-2">
          {"\u{00A9}"} {new Date().getFullYear()} FlowWork
        </p>
      </footer>
    </div>
  );
}

// ─── Section helpers ─────────────────────────────────────────────────

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
  // themBad = visual red emphasis on the Crafty Base column
  // them2 = neutral "kinda but not really" amber emphasis
  const themClass = themBad
    ? "text-red-700"
    : them2
      ? "text-amber-700"
      : "text-slate-600";
  return (
    <tr>
      <td className="py-3 px-4 text-slate-800 font-medium">{feature}</td>
      <td className={`py-3 px-4 ${themClass}`}>
        <span className="inline-flex items-start gap-1.5">
          {themBad && <span className="text-red-500">{"\u{2716}"}</span>}
          {them2 && <span className="text-amber-500">{"\u{26A0}"}</span>}
          <span>{them}</span>
        </span>
      </td>
      <td className="py-3 px-4 text-emerald-700">
        <span className="inline-flex items-start gap-1.5">
          <span className="text-emerald-500">{"\u{2713}"}</span>
          <span>{us}</span>
        </span>
      </td>
    </tr>
  );
}

function CompareSection({
  num,
  title,
  theirHeading,
  theirCopy,
  ourHeading,
  ourCopy,
  highlight,
}: {
  num: string;
  title: string;
  theirHeading: string;
  theirCopy: string;
  ourHeading: string;
  ourCopy: string;
  /** Visual amber callout when this is the marquee differentiator
   *  (the effective-date discipline section). */
  highlight?: boolean;
}) {
  return (
    <div
      className={`bg-white rounded-xl border p-6 ${
        highlight ? "border-amber-300 ring-2 ring-amber-100" : "border-slate-200"
      }`}
    >
      {highlight && (
        <p className="text-[11px] uppercase tracking-widest text-amber-700 font-semibold m-0 mb-2">
          {"\u{2728}"} The killer differentiator
        </p>
      )}
      <h4 className="text-lg font-bold text-slate-900 m-0 mb-4">
        <span className="text-slate-400 mr-2">{num}.</span>
        {title}
      </h4>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <p className="text-[11px] uppercase tracking-wide text-slate-500 font-semibold m-0 mb-2">
            {theirHeading}
          </p>
          <p
            className="text-sm text-slate-700 leading-relaxed m-0"
            // eslint-disable-next-line react/no-danger
            dangerouslySetInnerHTML={{ __html: theirCopy }}
          />
        </div>
        <div className="md:border-l md:border-slate-200 md:pl-4">
          <p className="text-[11px] uppercase tracking-wide text-blue-700 font-semibold m-0 mb-2">
            {ourHeading}
          </p>
          <p className="text-sm text-slate-700 leading-relaxed m-0">
            {ourCopy}
          </p>
        </div>
      </div>
    </div>
  );
}
