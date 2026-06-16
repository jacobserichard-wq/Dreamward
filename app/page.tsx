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
import PriceSlider from "./components/PriceSlider";
import { TESTIMONIALS } from "@/lib/testimonials";
import { PLAN_FEATURE_GROUPS } from "@/lib/plans";

export const metadata = {
  title: "Dreamward — Gross margin tracking + Schedule-C P&L for small business",
  description:
    "Track real gross margin per product across Shopify, Wix, Square, and Etsy. Effective-date COGS — your historical margins never silently rewrite when a cost changes today. Schedule-C-ready P&L for your CPA, receipts attached.",
  openGraph: {
    title: "Dreamward — Gross margin tracking that doesn't lie",
    description:
      "Per-SKU COGS, per-channel margin, audit-trail on every number, Schedule-C P&L. Built for makers + small business who outgrew spreadsheets but don't need a $500/mo ERP.",
    type: "website",
  },
};

export default async function MarketingLandingPage() {
  // Locked decision #8: server-side auth check + redirect.
  // Bookmarks pointing at godreamward.com/ keep working — logged-in
  // users never see the marketing page after their first session.
  const session = await getServerSession(authOptions);
  if (session) {
    redirect("/dashboard");
  }

  return (
    <div className="min-h-screen bg-oat font-sans text-forest">
      {/* Header band — minimal nav for the public landing */}
      <header className="border-b border-sand/70">
        <div className="max-w-[1100px] mx-auto px-4 sm:px-8 py-5 flex justify-between items-center">
          <h1 className="m-0 text-xl sm:text-2xl font-semibold font-serif text-forest flex items-center gap-2">
            <SproutMark className="w-6 h-6 sm:w-7 sm:h-7 text-eucalyptus" />
            Dreamward
          </h1>
          {/* Desktop nav — visible links read as an intentional nav
              bar (Pricing was easy to miss as a lone right-side
              link). */}
          <nav className="hidden sm:flex items-center gap-7">
            <Link
              href="/pricing"
              className="text-sm font-medium text-bark hover:text-forest no-underline"
            >
              Pricing
            </Link>
            <Link
              href="/compare"
              className="text-sm font-medium text-bark hover:text-forest no-underline"
            >
              Compare
            </Link>
            <Link
              href="/signin"
              className="text-sm font-medium text-bark hover:text-forest no-underline"
            >
              Sign in
            </Link>
          </nav>

          {/* Mobile menu — hamburger only below sm, where space runs
              out. Pure <details> so the landing stays a server
              component (no client JS). */}
          <details className="sm:hidden relative">
            <summary
              className="list-none [&::-webkit-details-marker]:hidden cursor-pointer p-1.5 text-forest"
              aria-label="Menu"
            >
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M4 7h16M4 12h16M4 17h16"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              </svg>
            </summary>
            <div className="absolute right-0 mt-2 w-44 bg-cream border border-sand rounded-xl shadow-sm py-1.5 z-20 flex flex-col">
              <Link
                href="/pricing"
                className="px-4 py-2 text-sm text-bark hover:bg-oat hover:text-forest no-underline"
              >
                Pricing
              </Link>
              <Link
                href="/compare"
                className="px-4 py-2 text-sm text-bark hover:bg-oat hover:text-forest no-underline"
              >
                Compare
              </Link>
              <Link
                href="/signin"
                className="px-4 py-2 text-sm text-bark hover:bg-oat hover:text-forest no-underline"
              >
                Sign in
              </Link>
            </div>
          </details>
        </div>

        {/* Hero. Sub-session 32 marketing refresh: leads with the
            gross-margin + audit-trail differentiation shipped in
            Phase 12 (COGS) + Phase 13 (Schedule-C P&L). Sage & Rose
            redesign: airy warm hero, Lora display headline. */}
        <div className="max-w-[1100px] mx-auto px-4 sm:px-8 pt-14 sm:pt-24 pb-16 sm:pb-24 text-center">
          <h2 className="font-serif text-4xl sm:text-6xl font-semibold m-0 mb-5 leading-[1.08] text-forest tracking-tight">
            Built for people.
            <br />
            Priced for people.
          </h2>
          <p className="text-lg sm:text-2xl font-semibold text-eucalyptus-dark m-0 mb-3 leading-snug">
            Real gross margin. Per product. Per channel. Per period.
          </p>
          <p className="text-base text-bark max-w-2xl mx-auto m-0 mb-9 leading-relaxed">
            Dreamward tracks the actual cost behind every sale — so when
            wholesale prices change, your historical margins{" "}
            <em>stay historical</em>. Built for makers and small
            businesses who outgrew spreadsheets but don&apos;t need a
            $500/month ERP.
          </p>
          <SignInButton label="Go dreamward &rarr;" />
          <p className="text-xs text-stone mt-4">
            14-day free trial. No credit card required.
          </p>
          <p className="text-[11px] uppercase tracking-widest text-stone mt-6">
            Syncs with Shopify {"\u{00B7}"} Etsy {"\u{00B7}"} Square {"\u{00B7}"} Wix
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
          <h3 className="font-serif text-2xl sm:text-3xl font-semibold text-forest m-0 mb-2">
            Where your money moves
          </h3>
          <p className="text-sm sm:text-base text-bark m-0">
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
        <p className="text-center text-xs text-bark mt-6">
          <strong className="text-forest">Also supported:</strong>{" "}
          CSV/XLSX from QuickBooks/Stripe/anything · Manual entry with
          drag-drop receipt attachments
          <br />
          <span className="text-stone">
            <strong className="text-bark">Coming next:</strong>{" "}
            WooCommerce · Stripe Connect
          </span>
        </p>

        {/* Testimonials — renders ONLY when lib/testimonials.ts has
            real quotes (house rule: never fabricated). Positioned
            above the compare pill + pricing so social proof lands
            before the price tag. While the array is empty this whole
            block is invisible. */}
        {TESTIMONIALS.length > 0 && (
          <div className="mt-12">
            <h3 className="text-center font-serif text-2xl sm:text-3xl font-semibold text-forest m-0 mb-8">
              From people building their dream
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {TESTIMONIALS.map((t, i) => (
                <figure
                  key={i}
                  className="bg-cream border border-sand rounded-2xl p-5 m-0 flex flex-col"
                >
                  <blockquote className="text-sm text-bark leading-relaxed m-0 mb-4 flex-1">
                    {"\u{201C}"}
                    {t.quote}
                    {"\u{201D}"}
                  </blockquote>
                  <figcaption className="text-xs">
                    <span className="font-semibold text-forest block">
                      {t.name}
                    </span>
                    <span className="text-stone">
                      {[t.business, t.location].filter(Boolean).join(" · ")}
                    </span>
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        )}

        {/* Sub-session 32 marketing commit 2: link to the head-to-head
            page. Positioned right above pricing — visitors comparing
            tools see it before they see the price tag. Subtle pill so
            it doesn't compete with the primary CTA. */}
        <div className="text-center mt-8">
          <Link
            href="/compare"
            className="inline-flex items-center gap-2 text-sm font-medium text-eucalyptus-dark bg-cream border border-sand rounded-full px-4 py-2 no-underline hover:border-eucalyptus hover:text-forest"
          >
            <span>{"\u{2696}\u{FE0F}"}</span>
            <span>Why makers switch to Dreamward</span>
            <span className="text-eucalyptus">{"\u{2192}"}</span>
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
      <section className="bg-eucalyptus-soft/50 border-y border-sand py-12 sm:py-20">
        <div className="max-w-[1100px] mx-auto px-4 sm:px-8">
          <div className="text-center mb-3">
            <span className="text-[11px] font-bold uppercase tracking-wider text-rose-dark bg-rose-soft px-3 py-1 rounded-full">
              Built for people. Priced for people.
            </span>
          </div>
          <div className="text-center mb-10">
            <h3 className="font-serif text-2xl sm:text-3xl font-semibold text-forest m-0 mb-2">
              Pricing that grows with you. Not against you.
            </h3>
            <p className="text-sm sm:text-base text-bark m-0 max-w-2xl mx-auto leading-relaxed">
              Every tier includes every feature. We charge based on
              your business size, not which tools you&apos;re allowed
              to use. As your revenue grows, your tier auto-updates —
              no upsell calls, no &ldquo;upgrade to unlock&rdquo;
              walls.
            </p>
          </div>

          {/* "Find your price" slider replaces the coarse tiles —
              price climbs gently with revenue (no $5k→$50k cliff),
              and it's revenue-driven so there's no "most popular"
              choice to make. Full feature list below. */}
          <PriceSlider />

          {/* Everything-included — the real product list, grouped so
              it's scannable. This is where features live now (off the
              tiles), reinforcing that price = revenue, not features.
              Market finder ("find markets near you") added. */}
          <div className="mt-10 bg-cream border border-sand rounded-2xl p-6 sm:p-8">
            <p className="text-center font-serif text-xl font-semibold text-forest m-0 mb-1">
              Every plan includes everything
            </p>
            <p className="text-center text-sm text-bark m-0 mb-6">
              No locked features, no &ldquo;upgrade to unlock.&rdquo; All
              of it, on every tier — even $10 Dream.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
              {PLAN_FEATURE_GROUPS.map((group) => (
                <div key={group.group}>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-eucalyptus-dark m-0 mb-3">
                    {group.group}
                  </h4>
                  <ul className="m-0 p-0 list-none space-y-2 text-sm text-bark">
                    {group.items.map((item) => (
                      <li key={item} className="flex items-start gap-1.5">
                        <span className="text-eucalyptus mt-0.5 flex-shrink-0">
                          {"\u{2713}"}
                        </span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>

          <p className="text-center text-xs text-stone mt-6">
            All tiers start with a 14-day free trial. No credit card
            required. Cancel anytime — your data exports cleanly to
            CSV. As your tracked revenue grows, your tier auto-bumps
            on a calendar-month boundary; no surprise charges.
          </p>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-sand py-6 text-center text-xs text-stone">
        <Link href="/privacy" className="text-bark no-underline mx-2 hover:text-forest">
          Privacy
        </Link>
        <span className="text-sand">{"\u{00B7}"}</span>
        <Link href="/terms" className="text-bark no-underline mx-2 hover:text-forest">
          Terms
        </Link>
        <p className="m-0 mt-2 flex items-center justify-center gap-1.5">
          <SproutMark className="w-3.5 h-3.5 text-eucalyptus" />
          {"\u{00A9}"} {new Date().getFullYear()} Dreamward
        </p>
      </footer>
    </div>
  );
}

// ─── Section helpers (server-component-safe) ─────────────────────────────────

// Dreamward sprout — the brand mark. A two-leaf sprout on a stem,
// replacing the old lightning bolt for the earthy/handmade identity.
// Inherits color via currentColor; size via the className's w/h.
function SproutMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <path
        d="M12 22V10"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M12 13c-3.3 0-6-2.7-6-6 3.3 0 6 2.7 6 6Z"
        fill="currentColor"
      />
      <path
        d="M12 11c0-3.3 2.7-6 6-6 0 3.3-2.7 6-6 6Z"
        fill="currentColor"
      />
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
      <h4 className="font-serif text-base font-semibold text-forest m-0 mb-2">
        {title}
      </h4>
      <p className="text-sm text-bark m-0 leading-relaxed">{body}</p>
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
    <div className="bg-cream rounded-xl border border-sand p-4 text-center">
      <div className="text-2xl mb-2">{icon}</div>
      <div className="text-sm font-semibold text-forest mb-1">{label}</div>
      <div className="text-xs text-bark leading-snug">{blurb}</div>
    </div>
  );
}

