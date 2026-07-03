// app/help/page.tsx
//
// Sub-session 32 polish: /help hub. Lists every help guide we
// publish so users have one URL to land on when they get stuck.
// Future per-feature reference pages (/help/cogs, /help/events,
// etc.) get added to the "Reference guides" section as we ship
// them — for now those slots show "Coming soon" placeholders so
// users see the roadmap without us promising every page today.
//
// Server component. No data fetching, no auth gate — help content
// should be public (good for SEO + prospect evaluation).

import Link from "next/link";
import PageHeader from "../components/PageHeader";
import AppHeader from "../components/AppHeader";
import { SUPPORT_EMAIL } from "@/lib/support";

export const metadata = {
  title: "Help & guides",
  description:
    "Step-by-step walkthroughs for every part of Dreamward — getting started, COGS, events, reports, and more.",
};

interface GuideCardProps {
  href: string;
  title: string;
  description: string;
  badge?: "new" | "popular" | "coming-soon";
}

function GuideCard({ href, title, description, badge }: GuideCardProps) {
  const isComingSoon = badge === "coming-soon";
  const cardClasses = isComingSoon
    ? "block bg-slate-50 rounded-xl border border-slate-200 p-5 no-underline opacity-60 cursor-not-allowed"
    : "block bg-white rounded-xl border border-slate-200 p-5 no-underline hover:border-blue-500 hover:shadow-md transition-all duration-150";

  const inner = (
    <>
      <div className="flex items-start justify-between gap-3 mb-2">
        <h3 className="text-base font-semibold text-slate-900 m-0">{title}</h3>
        {badge === "new" && (
          <span className="text-[10px] font-bold uppercase tracking-wider bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full">
            New
          </span>
        )}
        {badge === "popular" && (
          <span className="text-[10px] font-bold uppercase tracking-wider bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">
            Start here
          </span>
        )}
        {badge === "coming-soon" && (
          <span className="text-[10px] font-bold uppercase tracking-wider bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full">
            Coming soon
          </span>
        )}
      </div>
      <p className="text-sm text-slate-600 m-0 leading-relaxed">{description}</p>
    </>
  );

  if (isComingSoon) {
    return <div className={cardClasses}>{inner}</div>;
  }
  return (
    <Link href={href} className={cardClasses}>
      {inner}
    </Link>
  );
}

export default function HelpHubPage() {
  return (
    <div className="min-h-screen bg-slate-50">
      <AppHeader />
      <div className="max-w-[900px] mx-auto px-4 sm:px-8 py-10">
        <PageHeader
          backHref="/dashboard"
          backLabel="Dashboard"
          title="Help & guides"
          subtitle="Step-by-step walkthroughs for every part of Dreamward. Stuck? Start with the getting-started guide below."
        />

        {/* Featured */}
        <section className="mb-10">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500 mb-3">
            Start here
          </h2>
          <GuideCard
            href="/help/getting-started"
            title="Getting started with Dreamward"
            description="A complete walkthrough from your first sign-in to generating a Schedule-C P&L for your accountant. About 15 minutes to read end-to-end."
            badge="popular"
          />
        </section>

        {/* Reference guides */}
        <section className="mb-10">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500 mb-3">
            Reference guides
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <GuideCard
              href="/help/cogs"
              title="Tracking COGS &amp; gross margin"
              description="How FIFO costing works (your oldest stock drains first), setting costs by receiving purchases into inventory, recipes &amp; production runs, and reading the COGS dashboard."
              badge="coming-soon"
            />
            <GuideCard
              href="/help/events"
              title="Logging market days &amp; events"
              description="Booth fees, mileage, batch-tagging CSV uploads to an event, and how event revenue flows into the Markets channel."
              badge="coming-soon"
            />
            <GuideCard
              href="/help/integrations"
              title="Connecting Shopify, Wix, and Square"
              description="OAuth setup, what data each integration pulls, how line items become per-SKU COGS, and what to do when an order looks wrong."
              badge="coming-soon"
            />
            <GuideCard
              href="/help/reports"
              title="Schedule-C reports for your CPA"
              description="What the annual P&L includes, how Revenue, COGS, Gross Profit, and Operating Expenses are calculated, and how to send the PDF + CSV bundle."
              badge="coming-soon"
            />
            <GuideCard
              href="/help/expenses"
              title="Tracking expenses &amp; receipts"
              description="Manual expense entry, drag-drop receipt attachments, channel attribution, and the Receipt Vault for audit defense."
              badge="coming-soon"
            />
            <GuideCard
              href="/help/uploads"
              title="CSV &amp; XLSX uploads"
              description="What the template expects, when to use upload vs. integrations, batch-tagging to an event, and the review-modal flow."
              badge="coming-soon"
            />
          </div>
        </section>

        {/* Other resources */}
        <section>
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500 mb-3">
            Other resources
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Link
              href="/templates/dreamward-sales-template.csv"
              className="block bg-white rounded-lg border border-slate-200 p-4 no-underline hover:border-slate-400"
            >
              <div className="text-sm font-semibold text-slate-900 mb-1">
                CSV template
              </div>
              <div className="text-xs text-slate-500">
                Download the sales-upload template with example rows
              </div>
            </Link>
            <Link
              href="/privacy"
              className="block bg-white rounded-lg border border-slate-200 p-4 no-underline hover:border-slate-400"
            >
              <div className="text-sm font-semibold text-slate-900 mb-1">
                Privacy policy
              </div>
              <div className="text-xs text-slate-500">
                What we store, what we don&apos;t, and who can see your data
              </div>
            </Link>
            <Link
              href="/terms"
              className="block bg-white rounded-lg border border-slate-200 p-4 no-underline hover:border-slate-400"
            >
              <div className="text-sm font-semibold text-slate-900 mb-1">
                Terms of service
              </div>
              <div className="text-xs text-slate-500">
                The legal stuff. Short and plain-English.
              </div>
            </Link>
          </div>
        </section>

        <p className="text-center text-xs text-slate-400 mt-12">
          Can&apos;t find what you need? Email us at{" "}
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="text-blue-600 no-underline hover:underline"
          >
            {SUPPORT_EMAIL}
          </a>{" "}
          and we&apos;ll write the guide you needed.
        </p>
      </div>
    </div>
  );
}
