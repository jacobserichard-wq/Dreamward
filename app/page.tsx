// app/page.tsx
//
// Sub-session 24 flow redesign commit 2 of 9. Marketing landing page
// at the public root. Replaces the stub from commit 1.
//
// Designed in session-notes/flow-redesign-design.md §5. Sections:
//   - Hero: dark gradient, brand mark, headline, sub, primary CTA
//   - Feature bullets: 4-card grid covering the headline value props
//   - Pricing tiles: 4 cards from lib/plans.ts, Pro highlighted
//   - Footer CTA + privacy/terms links
//
// Locked decisions in play:
//   #1  Marketing landing at /
//   #5  All CTAs route to Google OAuth → Trial first (no Stripe-
//       pre-payment funnel); upgrade via /billing post-signin
//   #8  Authenticated visitors get server-side auto-redirect to
//       /dashboard (preserves bookmark behavior)
//
// Pure server component for the auth redirect — the SignInButton
// island handles the client-side signIn() call.

import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { authOptions } from "@/lib/auth";
import SignInButton from "./components/SignInButton";

export const metadata = {
  title: "FlowWork — Gross margin tracking + Schedule-C P&L for small business",
  description:
    "Track real gross margin per product across Shopify, Wix, Square, and Etsy. Effective-date COGS — your historical margins never silently rewrite when a cost changes today. Schedule-C-ready P&L for your CPA, receipts attached.",
  openGraph: {
    title: "FlowWork — Gross margin tracking that doesn't lie",
    description:
      "Per-SKU COGS, per-channel margin, audit-trail on every number, Schedule-C P&L. Built for makers + small business who outgrew spreadsheets but don't need a $500/mo ERP.",
    type: "website",
  },
};

export default async function MarketingLandingPage() {
  // Locked decision #8: server-side auth check + redirect.
  // Bookmarks pointing at flowworks.it.com/ keep working — logged-in
  // users never see the marketing page after their first session.
  const session = await getServerSession(authOptions);
  if (session) {
    redirect("/dashboard");
  }

  return (
    <div className="min-h-screen bg-white font-sans">
      {/* Header band — minimal nav for the public landing */}
      <header className="bg-gradient-to-br from-slate-900 to-slate-800 text-white">
        <div className="max-w-[1100px] mx-auto px-4 sm:px-8 py-5 flex justify-between items-center">
          <h1 className="m-0 text-xl sm:text-2xl font-bold">
            <span className="text-xl sm:text-2xl">{"\u{26A1}"}</span> FlowWork
          </h1>
          <div className="flex items-center gap-4 sm:gap-5">
            <Link
              href="/pricing"
              className="text-sm text-white/80 hover:text-white no-underline"
            >
              Pricing
            </Link>
            <Link
              href="/signin"
              className="text-sm text-white/80 hover:text-white no-underline"
            >
              Sign in
            </Link>
          </div>
        </div>

        {/* Hero. Sub-session 32 marketing refresh: leads with the
            gross-margin + audit-trail differentiation shipped in
            Phase 12 (COGS) + Phase 13 (Schedule-C P&L). The
            "mission control" brand line stays — it works whether
            you're describing channel rollups or per-SKU margin.
            Sub-copy now anchors on the concrete differentiator
            (real gross margin, effective-date discipline) instead
            of the generic "one dashboard" pitch. */}
        <div className="max-w-[1100px] mx-auto px-4 sm:px-8 pt-12 sm:pt-20 pb-16 sm:pb-24 text-center">
          <h2 className="text-3xl sm:text-5xl font-extrabold m-0 mb-4 leading-tight">
            Mission control for your money.
          </h2>
          <p className="text-xl sm:text-2xl font-semibold text-white m-0 mb-2 leading-snug">
            Real gross margin. Per product. Per channel. Per period.
          </p>
          <p className="text-base text-white/80 max-w-2xl mx-auto m-0 mb-8 leading-relaxed">
            FlowWork tracks the actual cost behind every sale — so when
            wholesale prices change, your historical margins{" "}
            <em>stay historical</em>. Built for makers + small businesses
            who outgrew spreadsheets but don&apos;t need a $500/month ERP.
          </p>
          <SignInButton label="Start your free trial &rarr;" />
          <p className="text-xs text-white/60 mt-4">
            14-day free trial. No credit card required.
          </p>
        </div>
      </header>

      {/* Feature cards. Sub-session 32 rewrite: leads with the
          gross-margin + audit-trail combo (Phase 12). Card #2
          surfaces Schedule-C P&L (Phase 13). Card #3 names every
          live integration (no more "Coming soon: Square" — we
          shipped Square + Wix). Card #4 is the receipt vault
          (Phase 9.4). Gmail + CSV moved to the channels section
          below — they're ingestion methods, not headline
          differentiators. */}
      <section className="max-w-[1100px] mx-auto px-4 sm:px-8 py-12 sm:py-16">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <FeatureCard
            icon={"\u{1F4CA}"}
            title="Margin, stock, and recipes for makers"
            body="Per-SKU cost history with effective-date discipline — change today's price and old sales keep their old cost. Live stock counts decrement on every sale. Define a recipe for any product, log a production run, and watch raw materials draw down automatically."
          />
          <FeatureCard
            icon={"\u{1F4D1}"}
            title="Schedule-C P&L for your CPA"
            body="Annual report formatted as a true profit & loss statement — Revenue → COGS → Gross Profit → Operating Expenses → Net. PDF + CSV in one click, ready to email to your accountant."
          />
          <FeatureCard
            icon={"\u{1F6D2}"}
            title="Sync every revenue source"
            body="Real-time webhook sync from Shopify, Wix, and Square, plus daily Etsy shop sync. Line items flow into per-product margin automatically. CSV/XLSX upload covers market days, Venmo/Zelle, and anything else without a connected source."
          />
          <FeatureCard
            icon={"\u{1F4CE}"}
            title="Receipt vault for every expense"
            body="Drag-drop receipts into any expense. Private Vercel Blob storage, full audit-defense compliance. Preview images + PDFs inline; download originals anytime."
          />
        </div>
      </section>

      {/* "Where your money moves" section. Phase 8f addition:
          reinforces the multi-source story right before pricing.
          Concrete platform names = SEO + reassurance for visitors
          searching e.g. "shopify quickbooks alternative". Coming-
          soon list signals roadmap without commitment. */}
      <section className="max-w-[1100px] mx-auto px-4 sm:px-8 pb-12 sm:pb-16">
        <div className="text-center mb-8">
          <h3 className="text-2xl sm:text-3xl font-bold text-slate-900 m-0 mb-2">
            Where your money moves
          </h3>
          <p className="text-sm sm:text-base text-slate-600 m-0">
            One ledger for every channel.
          </p>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <ChannelCard
            icon={"\u{1F6D2}"}
            label="Shopify"
            blurb="Real-time orders + per-SKU line items"
          />
          <ChannelCard
            icon={"\u{1F310}"}
            label="Wix"
            blurb="eCommerce orders auto-pulled with COGS"
          />
          <ChannelCard
            icon={"\u{1F4B3}"}
            label="Square"
            blurb="POS + online payments with line-item COGS"
          />
          <ChannelCard
            icon={"\u{1F3F7}\u{FE0F}"}
            label="Etsy"
            blurb="Shop orders + listing line items, synced daily"
          />
          <ChannelCard
            icon={"\u{1F697}"}
            label="Events"
            blurb="Markets, fairs, pop-ups with auto-mileage"
          />
        </div>
        <p className="text-center text-xs text-slate-500 mt-6">
          <strong className="text-slate-700">Also supported:</strong>{" "}
          CSV/XLSX from QuickBooks/Stripe/anything · Manual entry with
          drag-drop receipt attachments
          <br />
          <span className="text-slate-400">
            <strong className="text-slate-500">Coming next:</strong>{" "}
            WooCommerce · Stripe Connect
          </span>
        </p>

        {/* Sub-session 32 marketing commit 2: link to the head-to-head
            page. Positioned right above pricing — visitors comparing
            tools see it before they see the price tag. Subtle pill so
            it doesn't compete with the primary CTA. */}
        <div className="text-center mt-8">
          <Link
            href="/compare/crafty-base"
            className="inline-flex items-center gap-2 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-full px-4 py-2 no-underline hover:border-slate-400 hover:text-slate-900"
          >
            <span>{"\u{2696}\u{FE0F}"}</span>
            <span>How FlowWork compares to Crafty Base</span>
            <span className="text-slate-400">{"\u{2192}"}</span>
          </Link>
        </div>
      </section>

      {/* Pricing — Sub-session 33 strategic pivot.
          "Built for people. Priced for people." — feature-flat
          pricing where every paying tier gets every product feature.
          Tiers differentiate by business size (auto-detected from
          tracked revenue) and service level, never by which features
          the customer is allowed to use. The corporate playbook —
          gate features by tier, coerce upgrades — is what we're
          building against; the pricing tiles + section copy reflect
          that position deliberately. */}
      <section className="bg-slate-50 py-12 sm:py-20">
        <div className="max-w-[1100px] mx-auto px-4 sm:px-8">
          <div className="text-center mb-3">
            <span className="text-[11px] font-bold uppercase tracking-wider text-amber-800 bg-amber-100 px-3 py-1 rounded-full">
              Built for people. Priced for people.
            </span>
          </div>
          <div className="text-center mb-10">
            <h3 className="text-2xl sm:text-3xl font-bold text-slate-900 m-0 mb-2">
              Pricing that grows with you. Not against you.
            </h3>
            <p className="text-sm sm:text-base text-slate-600 m-0 max-w-2xl mx-auto leading-relaxed">
              Every tier includes every feature. We charge based on
              your business size, not which tools you&apos;re allowed
              to use. As your revenue grows, your tier auto-updates —
              no upsell calls, no &ldquo;upgrade to unlock&rdquo;
              walls.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <PricingTile
              name="Dream"
              price="$10"
              priceSub="/month"
              eligibility="Under $5k/year revenue"
              features={[
                "Every product feature included",
                "All integrations",
                "Full COGS + gross margin",
                "Schedule-C P&L for your CPA",
                "Standard email support",
              ]}
              ctaLabel="Start with Dream"
              highlighted={false}
            />
            {/* Maker carries "Most popular" — the new conversion sweet
                spot. Solo makers graduating out of Dream land here;
                $19/mo with everything included is the price-to-value
                story we want front and center. */}
            <PricingTile
              name="Maker"
              price="$19"
              priceSub="/month"
              eligibility="$5k–$50k/year revenue"
              features={[
                "Every product feature included",
                "All integrations",
                "Full COGS + gross margin",
                "Schedule-C P&L for your CPA",
                "Standard email support",
              ]}
              ctaLabel="Start with Maker"
              highlighted
            />
            <PricingTile
              name="Growth"
              price="$49"
              priceSub="/month"
              eligibility="$50k–$500k/year revenue"
              features={[
                "Everything in Maker",
                "Priority support",
                "Faster response times",
              ]}
              ctaLabel="Start with Growth"
              highlighted={false}
            />
            <PricingTile
              name="Pro"
              price="$99"
              priceSub="/month"
              eligibility="$500k+/year revenue"
              features={[
                "Everything in Growth",
                "Same-day priority support",
                "Dedicated support contact",
              ]}
              ctaLabel="Start with Pro"
              highlighted={false}
            />
          </div>

          {/* What's included — single source of truth that reinforces
              the "every tier" promise. Visible reminder that the
              tile lists aren't gating anything; they're just summary
              labels. */}
          <div className="mt-8 bg-white border border-slate-200 rounded-xl p-5 sm:p-6">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-500 m-0 mb-3 text-center">
              Every tier includes
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2 text-sm text-slate-700">
              <div className="flex items-start gap-1.5">
                <span className="text-emerald-600 mt-0.5">{"\u{2713}"}</span>
                <span>Shopify integration</span>
              </div>
              <div className="flex items-start gap-1.5">
                <span className="text-emerald-600 mt-0.5">{"\u{2713}"}</span>
                <span>Wix integration</span>
              </div>
              <div className="flex items-start gap-1.5">
                <span className="text-emerald-600 mt-0.5">{"\u{2713}"}</span>
                <span>Square integration</span>
              </div>
              <div className="flex items-start gap-1.5">
                <span className="text-emerald-600 mt-0.5">{"\u{2713}"}</span>
                <span>CSV / XLSX upload</span>
              </div>
              <div className="flex items-start gap-1.5">
                <span className="text-emerald-600 mt-0.5">{"\u{2713}"}</span>
                <span>Per-SKU cost history</span>
              </div>
              <div className="flex items-start gap-1.5">
                <span className="text-emerald-600 mt-0.5">{"\u{2713}"}</span>
                <span>Gross margin tracking</span>
              </div>
              <div className="flex items-start gap-1.5">
                <span className="text-emerald-600 mt-0.5">{"\u{2713}"}</span>
                <span>Live stock counts</span>
              </div>
              <div className="flex items-start gap-1.5">
                <span className="text-emerald-600 mt-0.5">{"\u{2713}"}</span>
                <span>Receipt vault</span>
              </div>
              <div className="flex items-start gap-1.5">
                <span className="text-emerald-600 mt-0.5">{"\u{2713}"}</span>
                <span>Schedule-C P&amp;L</span>
              </div>
              <div className="flex items-start gap-1.5">
                <span className="text-emerald-600 mt-0.5">{"\u{2713}"}</span>
                <span>Events + mileage</span>
              </div>
              <div className="flex items-start gap-1.5">
                <span className="text-emerald-600 mt-0.5">{"\u{2713}"}</span>
                <span>AR + invoice follow-up</span>
              </div>
              <div className="flex items-start gap-1.5">
                <span className="text-emerald-600 mt-0.5">{"\u{2713}"}</span>
                <span>Audit trail + CPA export</span>
              </div>
            </div>
          </div>

          <p className="text-center text-xs text-slate-500 mt-6">
            All tiers start with a 14-day free trial. No credit card
            required. Cancel anytime — your data exports cleanly to
            CSV. As your tracked revenue grows, your tier auto-bumps
            on a calendar-month boundary; no surprise charges.
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-200 py-6 text-center text-xs text-slate-400">
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

// ─── Section helpers (server-component-safe) ─────────────────────────────────

function FeatureCard({
  icon,
  title,
  body,
}: {
  icon: string;
  title: string;
  body: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 text-center">
      <div className="text-3xl mb-3">{icon}</div>
      <h4 className="text-base font-semibold text-slate-900 m-0 mb-2">
        {title}
      </h4>
      <p className="text-sm text-slate-600 m-0 leading-relaxed">{body}</p>
    </div>
  );
}

// Phase 8f addition. Smaller + denser than FeatureCard — fits in a
// 4-column grid even on mobile (2 cols at sm:, 4 at md+). Used by
// the "Where your money moves" section.
function ChannelCard({
  icon,
  label,
  blurb,
}: {
  icon: string;
  label: string;
  blurb: string;
}) {
  return (
    <div className="bg-white rounded-lg border border-slate-200 p-4 text-center">
      <div className="text-2xl mb-2">{icon}</div>
      <div className="text-sm font-semibold text-slate-900 mb-1">{label}</div>
      <div className="text-xs text-slate-500 leading-snug">{blurb}</div>
    </div>
  );
}

function PricingTile({
  name,
  price,
  priceSub,
  eligibility,
  features,
  ctaLabel,
  highlighted,
}: {
  name: string;
  price: string;
  priceSub: string;
  /** Optional revenue-bracket line shown under the price. Drives
   *  the "we charge by your size, not by features" story. */
  eligibility?: string;
  features: string[];
  ctaLabel: string;
  highlighted: boolean;
}) {
  // Locked decision #11: every pricing CTA routes to the same Google
  // OAuth flow (→ Trial by default). Users upgrade to their chosen
  // tier from /billing after signing in. ctaLabel varies for
  // intent-tracking via PostHog/etc later; behavior identical today.
  //
  // Fable-5 audit fix: route through ?callbackUrl=/onboarding so
  // pricing-tile signups get the guided setup, matching the hero
  // CTA. Previously they landed on a bare /dashboard.
  return (
    <div
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
      <h4
        className={`text-lg font-bold m-0 mb-1 ${highlighted ? "text-white" : "text-slate-900"}`}
      >
        {name}
      </h4>
      <div
        className={`mb-1 ${highlighted ? "text-white" : "text-slate-900"}`}
      >
        <span className="text-3xl font-extrabold">{price}</span>
        <span
          className={`text-sm ml-1 ${highlighted ? "text-white/80" : "text-slate-500"}`}
        >
          {priceSub}
        </span>
      </div>
      {eligibility && (
        <p
          className={`text-xs m-0 mb-4 ${highlighted ? "text-white/75" : "text-slate-500"}`}
        >
          {eligibility}
        </p>
      )}
      <ul
        className={`space-y-1.5 m-0 mb-5 p-0 list-none text-sm ${
          highlighted ? "text-white/90" : "text-slate-700"
        }`}
      >
        {features.map((f) => (
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
        {ctaLabel}
      </Link>
    </div>
  );
}
