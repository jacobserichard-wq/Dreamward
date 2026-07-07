// app/for/farmers-market-vendors/page.tsx
//
// Industry landing page — farmers market vendors. First of the /for/*
// series (positioning refresh P5). Leads with the wedge that's uniquely
// Dreamward's: every market as a first-class P&L unit, plus the hybrid
// booth+online story. No fabricated testimonials (house rule) — the
// "Picture a Saturday" block is an illustrative scenario in second
// person, not an attributed quote.
//
// Pure server component (public route). SignInButton + PriceSlider are
// the client islands.

import Link from "next/link";
import SignInButton from "../../components/SignInButton";
import PriceSlider from "../../components/PriceSlider";

export const metadata = {
  title: "Dreamward for farmers market vendors — one P&L for booth + online",
  description:
    "Track every market as its own P&L: booth fees, mileage, and the day's sales in one place — plus your Etsy, Shopify, and Square sales. Real per-product margin and a Schedule-C-ready P&L, from $10/month.",
};

export default function FarmersMarketVendorsPage() {
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
            For farmers market vendors
          </p>
          <h1 className="font-serif text-3xl sm:text-5xl font-semibold m-0 mb-4 leading-[1.1] text-forest tracking-tight">
            Dreamward for farmers market vendors
          </h1>
          <p className="text-lg sm:text-xl text-bark max-w-2xl mx-auto m-0 mb-8 leading-relaxed">
            Your booth fees, your ingredients, and your online sales — one
            honest P&amp;L. Find out which markets actually made money.
          </p>
          <SignInButton label="Start free 14-day trial" />
          <p className="text-xs text-stone mt-4">No credit card required.</p>
        </div>
      </header>

      {/* Three things that matter most to a market vendor */}
      <section className="max-w-[1100px] mx-auto px-4 sm:px-8 py-12 sm:py-16">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <FeatureCard
            icon={"\u{1F697}"}
            title="Every market is its own P&L"
            body="Log the booth fee and Dreamward tracks the mileage there and back automatically. Add the day's sales and you see exactly what Saturday cleared — so you know which markets are worth the 5am alarm and which aren't."
          />
          <FeatureCard
            icon={"\u{1F9FA}"}
            title="Booth sales that still track materials"
            body="Ring up a '$12 mixed dozen' or a hand-totaled market special, and the right ingredients still come out of your stock. Match a custom item once, and every one after resolves itself."
          />
          <FeatureCard
            icon={"\u{1F4D1}"}
            title="Booth + online, one tax return"
            body="Market cash, your Square reader, and your Etsy or Shopify shop roll into one P&L — and one Schedule C at tax time, with inventory value (Form 1125-A) figured for you."
          />
        </div>
      </section>

      {/* Illustrative scenario — NOT an attributed quote (no fabricated
          social proof). Second person keeps it honest + concrete. */}
      <section className="bg-eucalyptus-soft/40 border-y border-sand py-12 sm:py-16">
        <div className="max-w-[760px] mx-auto px-4 sm:px-8">
          <h2 className="font-serif text-2xl sm:text-3xl font-semibold text-forest m-0 mb-5 text-center">
            Picture a Saturday
          </h2>
          <p className="text-base text-bark leading-relaxed m-0">
            You pay $40 for the booth and drive 22 miles each way. You sell
            $380 in jams and a few hand-totaled gift boxes, run a couple of
            cards on your Square reader, and take the rest in cash. By the
            time you&apos;re unpacking at home, Dreamward already knows the
            booth fee, the mileage deduction, which jars left your inventory,
            and what the day actually earned after materials — not just what
            landed in the cash box.
          </p>
        </div>
      </section>

      {/* Pricing — reuse the same revenue slider as the homepage */}
      <section className="max-w-[1100px] mx-auto px-4 sm:px-8 py-12 sm:py-16">
        <div className="text-center mb-8">
          <h2 className="font-serif text-2xl sm:text-3xl font-semibold text-forest m-0 mb-2">
            Priced for a market stall, not an enterprise
          </h2>
          <p className="text-sm text-bark max-w-2xl mx-auto m-0">
            Every feature on every plan, from $10/month. Your price is set by
            your revenue and moves with you — never by which tools
            you&apos;re allowed to use.
          </p>
        </div>
        <PriceSlider />
      </section>

      {/* Bottom CTA */}
      <section className="bg-eucalyptus-soft/50 border-t border-sand py-12 sm:py-16">
        <div className="max-w-[800px] mx-auto px-4 sm:px-8 text-center">
          <h2 className="font-serif text-2xl sm:text-3xl font-semibold m-0 mb-3 text-forest">
            See your next market&apos;s real numbers
          </h2>
          <p className="text-base text-bark m-0 mb-6 max-w-xl mx-auto">
            14-day free trial. Add an event, connect your online shops, and
            watch one honest P&amp;L come together in your first afternoon.
          </p>
          <SignInButton label="Start free 14-day trial" />
          <p className="text-xs text-stone mt-4">No credit card required.</p>
        </div>
      </section>

      {/* Footer — carries the same trust line as the homepage */}
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
          {"\u{00A9}"} {new Date().getFullYear()} Dreamward
        </p>
      </footer>
    </div>
  );
}

// ─── Helpers (server-component-safe) ─────────────────────────────────

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
    <div className="bg-cream rounded-2xl border border-sand p-5 text-center">
      <div className="text-3xl mb-3">{icon}</div>
      <h3 className="font-serif text-base font-semibold text-forest m-0 mb-2">
        {title}
      </h3>
      <p className="text-sm text-bark m-0 leading-relaxed">{body}</p>
    </div>
  );
}
