// app/how-it-works/page.tsx
//
// Standalone "How it works" page — the four-stage explainer on its own
// route so it can be linked from the onboarding checklist and shared
// directly. Renders the same <HowItWorks> section used on the landing.
// Public route (no auth gate); works pre- or post-signin.

import Link from "next/link";
import HowItWorks from "../components/HowItWorks";
import SignInButton from "../components/SignInButton";

export const metadata = {
  title: "How it works",
  description:
    "How Dreamward works, in plain English: your sales and costs come in, each transaction gets labeled, Dreamward does the math, and you get tax-ready answers.",
};

export default function HowItWorksPage() {
  return (
    <div className="min-h-screen bg-oat font-sans text-forest">
      <header className="border-b border-sand/70">
        <div className="max-w-[1100px] mx-auto px-4 sm:px-8 py-5 flex justify-between items-center">
          <Link
            href="/"
            className="m-0 text-xl sm:text-2xl font-semibold font-serif text-forest no-underline flex items-center gap-2"
          >
            <SproutMark className="w-6 h-6 text-eucalyptus" />
            Dreamward
          </Link>
          <Link href="/signin" className="text-sm text-bark hover:text-forest no-underline">
            Sign in
          </Link>
        </div>
        <div className="max-w-[1100px] mx-auto px-4 sm:px-8 pt-10 sm:pt-14 text-center">
          <h1 className="font-serif text-3xl sm:text-5xl font-semibold m-0 mb-3 leading-[1.1] text-forest tracking-tight">
            How Dreamward works
          </h1>
          <p className="text-base sm:text-lg text-bark max-w-2xl mx-auto m-0">
            One ledger for every way you sell — from a market-table cash sale to
            a Shopify order — turned into real margins and a tax-ready P&amp;L.
          </p>
        </div>
      </header>

      <HowItWorks />

      <section className="bg-eucalyptus-soft/50 border-t border-sand py-12 sm:py-16">
        <div className="max-w-[800px] mx-auto px-4 sm:px-8 text-center">
          <h2 className="font-serif text-2xl sm:text-3xl font-semibold m-0 mb-3 text-forest">
            See it on your own numbers
          </h2>
          <p className="text-base text-bark m-0 mb-6 max-w-xl mx-auto">
            14-day free trial. Connect a store or add a sale and watch your real
            margins appear.
          </p>
          <SignInButton label="Go dreamward &rarr;" />
        </div>
      </section>

      <footer className="border-t border-sand py-6 text-center text-xs text-stone">
        <Link href="/" className="text-bark no-underline mx-2 hover:text-forest">
          Home
        </Link>
        <span className="text-sand">{"\u{00B7}"}</span>
        <Link href="/pricing" className="text-bark no-underline mx-2 hover:text-forest">
          Pricing
        </Link>
        <span className="text-sand">{"\u{00B7}"}</span>
        <Link href="/compare" className="text-bark no-underline mx-2 hover:text-forest">
          Compare
        </Link>
      </footer>
    </div>
  );
}

function SproutMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" className={className} aria-hidden="true">
      <path d="M12 22V10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <path d="M12 13c-3.3 0-6-2.7-6-6 3.3 0 6 2.7 6 6Z" fill="currentColor" />
      <path d="M12 11c0-3.3 2.7-6 6-6 0 3.3-2.7 6-6 6Z" fill="currentColor" />
    </svg>
  );
}
