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
  title: "FlowWork — Mission control for your money",
  description:
    "One bookkeeping ledger for every revenue source. Sync Shopify, pull invoices from Gmail, upload CSV/XLSX from Square/Stripe/QuickBooks — and hand your CPA a clean Schedule C at tax time.",
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
          <Link
            href="/signin"
            className="text-sm text-white/80 hover:text-white no-underline"
          >
            Sign in
          </Link>
        </div>

        {/* Hero. Phase 8f: pivoted to "command center" positioning
            now that Shopify integration is live. Headline reframes
            FlowWork as the unified-revenue control plane vs Shopify's
            "we only see our own orders" scope. AI references softened
            throughout (Jacob feedback: "AI" word is polarizing for
            the bookkeeper-audience reader; describe the outcome, not
            the mechanism). */}
        <div className="max-w-[1100px] mx-auto px-4 sm:px-8 pt-12 sm:pt-20 pb-16 sm:pb-24 text-center">
          <h2 className="text-3xl sm:text-5xl font-extrabold m-0 mb-4 leading-tight">
            Mission control for your money.
          </h2>
          <p className="text-xl sm:text-2xl font-semibold text-white m-0 mb-2 leading-snug">
            Stop chasing receipts across five different platforms.
          </p>
          <p className="text-base text-white/80 max-w-2xl mx-auto m-0 mb-8 leading-relaxed">
            FlowWork pulls from Shopify, Gmail, and CSV uploads —
            categorizes everything automatically — and hands your CPA a
            clean Schedule C at tax time.
          </p>
          <SignInButton label="Start your free trial &rarr;" />
          <p className="text-xs text-white/60 mt-4">
            14-day free trial. No credit card required.
          </p>
        </div>
      </header>

      {/* Feature bullets. Phase 8f rewrite: Shopify-led ordering +
          softened AI language throughout. Card #1 leads with the
          actual new differentiator. Card #4 folds mileage into the
          CPA-handoff card (still surfaced, just consolidated). */}
      <section className="max-w-[1100px] mx-auto px-4 sm:px-8 py-12 sm:py-16">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <FeatureCard
            icon={"\u{1F6D2}"}
            title="Sync your Shopify store"
            body="Connect once. FlowWork pulls every order, refund, and shipping fee automatically. Coming soon: Etsy, Square, WooCommerce."
          />
          <FeatureCard
            icon={"\u{1F4E7}"}
            title="Reads your Gmail invoices"
            body="Label vendor bills in Gmail; FlowWork extracts vendor, amount, date, and category in seconds. 90%+ correct on the first pass."
          />
          <FeatureCard
            icon={"\u{1F4C1}"}
            title="Upload from anywhere"
            body="CSV or XLSX from Square, Stripe, QuickBooks, Xero, Wave — column mapping happens automatically. No template required."
          />
          <FeatureCard
            icon={"\u{1F4CA}"}
            title="CPA-ready in one click"
            body="Annual summary with Schedule C line mapping + quarterly estimates + mileage deductions, exported as CSV and PDF to your CPA's inbox."
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
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <ChannelCard
            icon={"\u{1F6D2}"}
            label="Shopify"
            blurb="Live sync of orders, refunds, fees"
          />
          <ChannelCard
            icon={"\u{1F4E7}"}
            label="Gmail"
            blurb="Vendor invoices, customer payments"
          />
          <ChannelCard
            icon={"\u{1F4C1}"}
            label="CSV / XLSX"
            blurb="Square, Stripe, QuickBooks, Xero, Wave"
          />
          <ChannelCard
            icon={"\u{1F697}"}
            label="Events"
            blurb="Markets, fairs, pop-ups with auto-mileage"
          />
        </div>
        <p className="text-center text-xs text-slate-500 mt-6">
          <strong className="text-slate-700">Coming next:</strong>{" "}
          Etsy · Square · WooCommerce · Stripe Connect
        </p>
      </section>

      {/* Pricing */}
      <section className="bg-slate-50 py-12 sm:py-20">
        <div className="max-w-[1100px] mx-auto px-4 sm:px-8">
          <div className="text-center mb-10">
            <h3 className="text-2xl sm:text-3xl font-bold text-slate-900 m-0 mb-2">
              Simple pricing. Start free.
            </h3>
            <p className="text-sm sm:text-base text-slate-600 m-0">
              Upgrade when you outgrow the free tier — your data stays
              with you.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <PricingTile
              name="Trial"
              price="Free"
              priceSub="for 14 days"
              features={[
                "25 items/month",
                "Invoices, expenses, dashboard",
                "CSV + XLSX upload",
                "Manual entry",
              ]}
              ctaLabel="Start free"
              highlighted={false}
            />
            <PricingTile
              name="Starter"
              price="$19"
              priceSub="/month"
              features={[
                "100 items/month",
                "Everything in Trial",
                "Sample data + onboarding",
                "Email support",
              ]}
              ctaLabel="Start with Starter"
              highlighted={false}
            />
            {/* Growth carries the "Most popular" highlight — the
                middle tier is the natural conversion sweet spot for
                growing small businesses (unlimited items + events +
                AR + exports without the Pro price tag). */}
            <PricingTile
              name="Growth"
              price="$49"
              priceSub="/month"
              features={[
                "Unlimited items",
                "Events + mileage tracking",
                "AR + invoice follow-ups",
                "CSV/PDF exports",
              ]}
              ctaLabel="Start with Growth"
              highlighted
            />
            {/* Phase 8f: Pro tile updated to lead with Shopify
                integration (the new Pro-only headline feature).
                "Custom categories" dropped from visible bullets
                (still exists in product; weaker selling point than
                the other 4). */}
            <PricingTile
              name="Pro"
              price="$89"
              priceSub="/month"
              features={[
                "Everything in Growth",
                "Shopify integration",
                "Gmail auto-fetch",
                "Tax reports + Schedule C",
                "White-glove onboarding call",
              ]}
              ctaLabel="Start with Pro"
              highlighted={false}
            />
          </div>

          <p className="text-center text-xs text-slate-500 mt-6">
            All paid tiers start with a 14-day free trial. Cancel
            anytime — your data exports cleanly to CSV.
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
  features,
  ctaLabel,
  highlighted,
}: {
  name: string;
  price: string;
  priceSub: string;
  features: string[];
  ctaLabel: string;
  highlighted: boolean;
}) {
  // Locked decision #11: every pricing CTA routes to the same Google
  // OAuth flow (→ Trial by default). Users upgrade to their chosen
  // tier from /billing after signing in. ctaLabel varies for
  // intent-tracking via PostHog/etc later; behavior identical today.
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
        className={`mb-4 ${highlighted ? "text-white" : "text-slate-900"}`}
      >
        <span className="text-3xl font-extrabold">{price}</span>
        <span
          className={`text-sm ml-1 ${highlighted ? "text-white/80" : "text-slate-500"}`}
        >
          {priceSub}
        </span>
      </div>
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
        href="/signin"
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
