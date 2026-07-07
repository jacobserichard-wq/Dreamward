// app/for/candle-makers/page.tsx
//
// Industry landing page — candle makers. Second of the /for/* series.
// Copy is candle-specific (recipe costing across wax/fragrance/wick/
// vessel, batch pours as production runs, margin per scent) — not a
// clone of the farmers-market page. No fabricated testimonials; the
// "pour day" block is an illustrative second-person scenario.

import Link from "next/link";
import SignInButton from "../../components/SignInButton";
import PriceSlider from "../../components/PriceSlider";

export const metadata = {
  title: "Dreamward for candle makers — true cost per pour, margin per scent",
  description:
    "Recipe costing down to the last gram of fragrance oil, batch pours that update your stock automatically, and real margin per scent across Etsy, markets, and wholesale — Schedule-C ready, from $10/month.",
};

export default function CandleMakersPage() {
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
            For candle makers
          </p>
          <h1 className="font-serif text-3xl sm:text-5xl font-semibold m-0 mb-4 leading-[1.1] text-forest tracking-tight">
            Dreamward for candle makers
          </h1>
          <p className="text-lg sm:text-xl text-bark max-w-2xl mx-auto m-0 mb-8 leading-relaxed">
            Wax, wick, and fragrance in — real margin per scent out. Know the
            true cost of every pour across Etsy, markets, and wholesale.
          </p>
          <SignInButton label="Start free 14-day trial" />
          <p className="text-xs text-stone mt-4">No credit card required.</p>
        </div>
      </header>

      {/* Three candle-specific features */}
      <section className="max-w-[1100px] mx-auto px-4 sm:px-8 py-12 sm:py-16">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <FeatureCard
            icon={"\u{1F56F}\u{FE0F}"}
            title="True cost per candle, down to the last drop of fragrance"
            body="Build a recipe from your wax, fragrance oil, wick, vessel, and label — Dreamward costs each pour from the real materials. When a fragrance supplier raises prices, every candle's margin updates; and because fragrance is priced by weight, it's counted by weight, not guessed."
          />
          <FeatureCard
            icon={"\u{1FAD9}"}
            title="Pour a batch — your stock updates itself"
            body="Log a production run (say, 24 eight-ounce lavender), and your wax, wicks, jars, and fragrance draw down automatically while finished candles go up. COGS is built from the recipe, so a sale weeks later already knows what that candle cost to make."
          />
          <FeatureCard
            icon={"\u{1F4CA}"}
            title="See which scents actually pay"
            body="Best-selling isn't the same as best-margin. Dreamward shows real per-scent, per-size margin across Etsy, Shopify, your market table, and wholesale in one view — so you make more of what earns and quietly retire what doesn't."
          />
        </div>
      </section>

      {/* Illustrative scenario — not an attributed quote */}
      <section className="bg-eucalyptus-soft/40 border-y border-sand py-12 sm:py-16">
        <div className="max-w-[760px] mx-auto px-4 sm:px-8">
          <h2 className="font-serif text-2xl sm:text-3xl font-semibold text-forest m-0 mb-5 text-center">
            Picture a pour day
          </h2>
          <p className="text-base text-bark leading-relaxed m-0">
            You melt a batch and pour 24 lavender eight-ounces. In Dreamward
            that&apos;s one production run — the wax, 24 wicks, 24 jars, and the
            fragrance you weighed out all leave your material stock, and 24
            finished candles land in inventory at their real built cost. Sell
            six on Etsy, four at Saturday&apos;s market, and a case to a local
            boutique, and each sale already carries its true cost — so your
            margin per scent is right without you touching a spreadsheet. When
            fragrance prices jump next quarter, last quarter&apos;s numbers
            stay exactly as you filed them.
          </p>
        </div>
      </section>

      {/* Pricing */}
      <section className="max-w-[1100px] mx-auto px-4 sm:px-8 py-12 sm:py-16">
        <div className="text-center mb-8">
          <h2 className="font-serif text-2xl sm:text-3xl font-semibold text-forest m-0 mb-2">
            Priced for a candle studio, not a factory
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
            Find your best-margin scent
          </h2>
          <p className="text-base text-bark m-0 mb-6 max-w-xl mx-auto">
            14-day free trial. Add a recipe, log a pour, connect your shops,
            and see real per-candle margin in your first afternoon.
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
