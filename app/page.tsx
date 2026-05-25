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
  title: "FlowWork — Bookkeeping that runs itself",
  description:
    "Connect Gmail, upload CSVs, send your CPA a clean PDF — all in 5 clicks. Built for solo founders, market vendors, freelancers, and small CPA firms.",
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

        {/* Hero */}
        <div className="max-w-[1100px] mx-auto px-4 sm:px-8 pt-12 sm:pt-20 pb-16 sm:pb-24 text-center">
          <h2 className="text-3xl sm:text-5xl font-extrabold m-0 mb-4 leading-tight">
            Bookkeeping that runs itself.
          </h2>
          <p className="text-base sm:text-lg text-white/80 max-w-2xl mx-auto m-0 mb-8 leading-relaxed">
            Connect Gmail, upload CSVs, send your CPA a clean PDF — all
            in 5 clicks. Built for solo founders, market vendors,
            freelancers, and small CPA firms.
          </p>
          <SignInButton label="Start your free trial &rarr;" />
          <p className="text-xs text-white/60 mt-4">
            No credit card required. 25 items/month free, forever.
          </p>
        </div>
      </header>

      {/* Feature bullets */}
      <section className="max-w-[1100px] mx-auto px-4 sm:px-8 py-12 sm:py-16">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <FeatureCard
            icon={"\u{1F4E7}"}
            title="Auto-pull from Gmail"
            body="Label invoices and receipts in Gmail. FlowWork fetches them automatically — no copy-paste, no forwarding."
          />
          <FeatureCard
            icon={"\u{1F916}"}
            title="AI extracts every field"
            body="Claude reads each email and pulls vendor, amount, date, and category. 90%+ accurate on the first pass."
          />
          <FeatureCard
            icon={"\u{1F697}"}
            title="Mileage tracked for you"
            body="Add an event, FlowWork computes round-trip miles via Google Maps and applies the IRS rate."
          />
          <FeatureCard
            icon={"\u{1F4CA}"}
            title="One-click CPA handoff"
            body="Annual summary + Schedule C line mapping + quarterly estimates, exported as CSV and PDF to your CPA's inbox."
          />
        </div>
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
              priceSub="forever"
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
              highlighted={false}
            />
            <PricingTile
              name="Pro"
              price="$89"
              priceSub="/month"
              features={[
                "Everything in Growth",
                "Gmail auto-fetch",
                "Custom categories",
                "Tax reports + Schedule C",
                "White-glove onboarding call",
              ]}
              ctaLabel="Start with Pro"
              highlighted
            />
          </div>

          <p className="text-center text-xs text-slate-500 mt-6">
            All paid tiers start with a 14-day free trial. Cancel
            anytime — your data exports cleanly to CSV.
          </p>
        </div>
      </section>

      {/* Footer CTA */}
      <section className="py-12 sm:py-16 text-center">
        <h3 className="text-xl sm:text-2xl font-bold text-slate-900 m-0 mb-3">
          Ready to stop chasing receipts?
        </h3>
        <p className="text-sm text-slate-600 max-w-md mx-auto m-0 mb-6">
          Set up takes 5 minutes. Your CPA will thank you at tax time.
        </p>
        <SignInButton label="Start your free trial &rarr;" />
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
