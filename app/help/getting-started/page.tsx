// app/help/getting-started/page.tsx
//
// Sub-session 32 polish: the canonical "start here" user guide.
// Walks a new user from sign-in through generating a Schedule-C
// report. Linear narrative (not reference manual) — designed to be
// read end-to-end in ~15 minutes.
//
// Deliberately excludes Gmail content pending the deprecation
// decision (see session-notes/audit-gmail-deprecation-and-video-
// tutorials.md). When that decision lands, either add a Gmail
// section here or update the deprecation comms.
//
// Server component, no auth gate — public help content.
//
// Internal structure:
//   - PageHeader at top
//   - Table of contents (anchor links to H2 ids)
//   - 10 H2 sections, each with sub-paragraphs and inline callouts
//   - Closing "next steps" with links to reference guides

import Link from "next/link";
import PageHeader from "../../components/PageHeader";

export const metadata = {
  title: "Getting started",
  description:
    "A complete walkthrough of FlowWork — from your first sign-in to generating a Schedule-C P&L for your accountant.",
};

interface SectionProps {
  id: string;
  title: string;
  children: React.ReactNode;
}

function Section({ id, title, children }: SectionProps) {
  return (
    <section id={id} className="mb-10 scroll-mt-6">
      <h2 className="text-2xl font-bold text-slate-900 mb-4 pb-2 border-b border-slate-200">
        {title}
      </h2>
      <div className="text-base text-slate-700 leading-relaxed space-y-4">
        {children}
      </div>
    </section>
  );
}

function Callout({
  variant = "info",
  children,
}: {
  variant?: "info" | "warn" | "tip";
  children: React.ReactNode;
}) {
  const styles =
    variant === "warn"
      ? "bg-amber-50 border-amber-200 text-amber-900"
      : variant === "tip"
        ? "bg-emerald-50 border-emerald-200 text-emerald-900"
        : "bg-blue-50 border-blue-200 text-blue-900";
  const label = variant === "warn" ? "Heads up" : variant === "tip" ? "Tip" : "Why this matters";
  return (
    <div className={`rounded-lg border px-4 py-3 my-4 text-sm ${styles}`}>
      <div className="font-semibold mb-1">{label}</div>
      <div className="leading-relaxed">{children}</div>
    </div>
  );
}

export default function GettingStartedGuide() {
  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-[800px] mx-auto px-4 sm:px-8 py-10">
        <PageHeader
          backHref="/help"
          backLabel="Help"
          title="Getting started with FlowWork"
          subtitle="A complete walkthrough from sign-in to generating your first Schedule-C P&L. About 15 minutes end-to-end."
        />

        {/* Table of contents */}
        <nav className="bg-slate-50 border border-slate-200 rounded-xl p-5 mb-10">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500 m-0 mb-3">
            On this page
          </h2>
          <ol className="m-0 pl-5 space-y-1.5 text-sm">
            <li><a href="#what-flowwork-is" className="text-blue-600 no-underline hover:underline">What FlowWork is (and what it isn&apos;t)</a></li>
            <li><a href="#pick-your-path" className="text-blue-600 no-underline hover:underline">Pick your starting path</a></li>
            <li><a href="#connect-revenue-source" className="text-blue-600 no-underline hover:underline">Connect your first revenue source</a></li>
            <li><a href="#cogs-setup" className="text-blue-600 no-underline hover:underline">Set up SKUs and cost history</a></li>
            <li><a href="#log-market-day" className="text-blue-600 no-underline hover:underline">Log your first market day</a></li>
            <li><a href="#track-expenses" className="text-blue-600 no-underline hover:underline">Track expenses and attach receipts</a></li>
            <li><a href="#processed-inbox" className="text-blue-600 no-underline hover:underline">Understand the Processed inbox</a></li>
            <li><a href="#read-dashboard" className="text-blue-600 no-underline hover:underline">Read your Dashboard</a></li>
            <li><a href="#schedule-c-report" className="text-blue-600 no-underline hover:underline">Generate your Schedule-C report</a></li>
            <li><a href="#next-steps" className="text-blue-600 no-underline hover:underline">Where to go next</a></li>
          </ol>
        </nav>

        <Section id="what-flowwork-is" title="1. What FlowWork is (and what it isn&apos;t)">
          <p>
            FlowWork is gross-margin tracking and Schedule-C P&amp;L for small
            businesses that have outgrown spreadsheets. You connect the places
            your money actually moves — Shopify, Wix, Square, your event
            markets, your manual receipts — and FlowWork tells you what every
            sale was really worth after the cost of goods, and what your
            accountant needs at tax time.
          </p>
          <p>
            It is <strong>not</strong> a replacement for QuickBooks or Xero. It
            doesn&apos;t do payroll, it doesn&apos;t reconcile your bank, it
            doesn&apos;t cut checks. What it does do — and does well — is
            answer the question &ldquo;am I actually making money on this
            product, in this channel, this month?&rdquo; And it answers that
            question without making you re-enter every order by hand.
          </p>
          <Callout variant="info">
            FlowWork keeps your historical margins honest. If you raise a
            wholesale price today, last month&apos;s sales keep their old cost
            — they don&apos;t get retroactively rewritten the way most
            accounting tools handle a cost change. That&apos;s the
            single-biggest reason makers move here from spreadsheets or from
            other inventory tools.
          </Callout>
        </Section>

        <Section id="pick-your-path" title="2. Pick your starting path">
          <p>
            FlowWork works for several kinds of small business. The path you
            take through this guide depends on what you actually sell:
          </p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong>Online seller</strong> (Shopify, Wix, or Square Online):
              start by connecting your store — line items pull automatically
              and per-SKU margin appears once you set cost history.
            </li>
            <li>
              <strong>Market or event vendor</strong> (booth at the farmer&apos;s
              market, craft fairs, pop-ups): start by logging an event, then
              upload your day&apos;s sales as a CSV batch-tagged to that event.
            </li>
            <li>
              <strong>Wholesale or service business</strong> (B2B invoices,
              consulting, custom orders): start by creating an invoice — those
              roll into the Wholesale or Service channel automatically.
            </li>
            <li>
              <strong>Mixed</strong> (most makers): do all three. The Dashboard
              will show per-channel margin so you can see which line of business
              is actually carrying the others.
            </li>
          </ul>
          <p>
            If you&apos;re in &ldquo;just trying it&rdquo; mode, do the online
            path first — it&apos;s the fastest way to see real data flowing
            without typing anything in by hand.
          </p>
        </Section>

        <Section id="connect-revenue-source" title="3. Connect your first revenue source">
          <p>
            Open <Link href="/integrations" className="text-blue-600 no-underline hover:underline">Integrations</Link>{" "}
            from the header nav. You&apos;ll see cards for Shopify, Wix, and
            Square. Click &ldquo;Connect&rdquo; on the one you use. Each
            integration walks through an OAuth handoff — FlowWork redirects you
            to the platform, you authorize, they redirect you back.
          </p>
          <p>
            Once connected, FlowWork does two things in the background:
          </p>
          <ol className="list-decimal pl-6 space-y-2">
            <li>
              <strong>Backfills your last 90 days of orders.</strong> You can
              extend that window from the integration card if you want more
              history. The backfill runs server-side — close the tab if you
              want, it&apos;ll keep going.
            </li>
            <li>
              <strong>Subscribes to real-time webhooks.</strong> Every new
              order, refund, or fulfillment event hits FlowWork within a few
              seconds of happening on the platform. You don&apos;t click
              &ldquo;sync&rdquo; — it&apos;s already in sync.
            </li>
          </ol>
          <Callout variant="info">
            Each platform pulls slightly different data. Shopify and Wix give
            you line items by SKU, which is what powers per-product margin.
            Square gives you line items too, and pulls{" "}
            <code className="bg-slate-100 px-1.5 py-0.5 rounded text-sm">default_unit_cost</code>{" "}
            straight from your Square catalog — meaning if you set costs in
            Square, you don&apos;t have to re-enter them here.
          </Callout>
          <p>
            If you don&apos;t use any of those platforms — or you want to add
            historical data from one you used to use — skip ahead to{" "}
            <a href="#log-market-day" className="text-blue-600 no-underline hover:underline">section 5</a>{" "}
            on CSV upload.
          </p>
        </Section>

        <Section id="cogs-setup" title="4. Set up SKUs and cost history">
          <p>
            This is the section that makes FlowWork worth paying for. Open the{" "}
            <strong>COGS</strong> link in the header (Pro tier required). The
            page lists every SKU it has seen from your connected stores. Each
            row needs two things to produce gross margin: a cost, and an
            effective date.
          </p>
          <p>
            Click a SKU to open its detail page. You&apos;ll see a{" "}
            <strong>Cost history</strong> table. Click &ldquo;Add cost&rdquo;
            and enter:
          </p>
          <ul className="list-disc pl-6 space-y-1">
            <li><strong>Cost</strong>: what you pay your supplier per unit, all-in (materials + packaging + shipping inbound if you want it included)</li>
            <li><strong>Effective date</strong>: the date this cost started applying — usually the date you placed the wholesale order, or the date the new shipment arrived</li>
            <li><strong>Notes</strong> (optional): supplier name, PO number, anything you&apos;d want to see when reviewing later</li>
          </ul>
          <Callout variant="tip">
            The effective date is the magic. If you sold 12 units in March at a
            cost of $4.50 each, and then in April your supplier raised the
            price to $5.25, you add a second cost row dated April 1. March
            margin stays calculated with the $4.50 cost. April sales use $5.25.
            Your historical numbers are correct. This is what spreadsheets and
            most accounting tools get wrong.
          </Callout>
          <p>
            Repeat for any SKU you want margin on. You don&apos;t have to do
            every SKU at once — un-costed SKUs just show $0 margin until you
            fill them in. Most people start with their top 10 by revenue and
            work down.
          </p>
          <p>
            <strong>Editing a past cost?</strong> FlowWork warns you. Any
            change to a cost row dated in the past will silently rewrite the
            margin on every sale that used it — so you have to explicitly
            confirm you meant to do that. If you&apos;re fixing a typo, fine.
            If you&apos;re trying to back-rate a price increase, stop and add a
            new row with a future effective date instead.
          </p>
        </Section>

        <Section id="log-market-day" title="5. Log your first market day">
          <p>
            Selling at events is different from selling online — you don&apos;t
            have a webhook stream. You have a cash drawer, a Square reader, a
            Venmo handle, and a notebook. FlowWork handles this through the{" "}
            <strong>Events</strong> page.
          </p>
          <p>
            Click <Link href="/events" className="text-blue-600 no-underline hover:underline">Events</Link>{" "}
            in the header, then &ldquo;+ New event.&rdquo; Fill in:
          </p>
          <ul className="list-disc pl-6 space-y-1">
            <li><strong>Name</strong> (&ldquo;Sunday farmer&apos;s market&rdquo;)</li>
            <li><strong>Date</strong></li>
            <li><strong>Booth fee</strong> (auto-counted as a Markets channel expense)</li>
            <li><strong>Mileage</strong> (round-trip distance — FlowWork applies the current IRS rate automatically)</li>
          </ul>
          <p>
            Now you have an event to tag sales to. Two ways to log the day&apos;s
            revenue:
          </p>
          <ol className="list-decimal pl-6 space-y-2">
            <li>
              <strong>One-line summary</strong>: just enter the total revenue
              on the event itself (&ldquo;Sunday market — $485 in cash and
              Venmo&rdquo;). Fast, but you lose per-product breakdowns.
            </li>
            <li>
              <strong>CSV batch upload</strong> (recommended for any event over
              ~10 transactions): click the &ldquo;Upload&rdquo; button in the
              header, pick your CSV, and on the review screen choose your event
              from the dropdown. Every row gets batch-tagged to that event and
              flows into Markets channel.
            </li>
          </ol>
          <Callout variant="tip">
            Download the{" "}
            <a
              href="/templates/flowwork-sales-template.csv"
              className="text-blue-600 no-underline hover:underline"
            >
              CSV template
            </a>{" "}
            before your next market — the columns are Date, Customer/Vendor,
            Amount, Description, Category. Most makers keep a copy open on
            their phone during the day and fill it in as sales happen.
          </Callout>
        </Section>

        <Section id="track-expenses" title="6. Track expenses and attach receipts">
          <p>
            Expenses are what your business spends — supplies, packaging, SaaS
            subscriptions, vendor bills, rent on your studio. Open the{" "}
            <Link href="/expenses" className="text-blue-600 no-underline hover:underline">Expenses</Link>{" "}
            page.
          </p>
          <p>
            Click &ldquo;+ New expense&rdquo; and fill in vendor, amount, date,
            and category. The category determines whether this is a Cost of
            Goods Sold expense (raw materials, inventory) or an Operating
            Expense (rent, SaaS, marketing). FlowWork tags COGS categories
            automatically based on your industry preferences — Schedule-C will
            split them correctly.
          </p>
          <p>
            <strong>Attaching a receipt:</strong> every expense row has a
            drag-drop file area. Drop in the PDF, JPG, or PNG. It uploads to a
            private storage bucket (encrypted at rest, only visible to you) and
            attaches to the expense permanently. This is your audit defense —
            the IRS wants a receipt for any expense over $75, and FlowWork
            keeps them organized by year and category so you can find one in
            seconds.
          </p>
          <Callout variant="info">
            The Receipt Vault matters most for businesses that get audited or
            that need to substantiate a deduction during a CPA review. Even if
            you never need it, it&apos;s nice to have your 2026 office-supplies
            receipts in one place instead of scattered across email,
            Dropbox, and a shoebox.
          </Callout>
        </Section>

        <Section id="processed-inbox" title="7. Understand the Processed inbox">
          <p>
            The <strong>Processed</strong> tab on the Dashboard is your work
            queue. Anything that came in from a connected store, a CSV upload,
            or manual entry lands here in card form until you&apos;ve told
            FlowWork what to do with it.
          </p>
          <p>Each card has four status buttons at the bottom:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li><strong>Pending</strong> — invoice or expense awaiting payment</li>
            <li><strong>Paid</strong> — done, money has moved</li>
            <li><strong>Overdue</strong> — past due date, needs follow-up</li>
            <li><strong>Needs review</strong> — something looks wrong, defer until you can check it</li>
          </ul>
          <p>
            Click the icon matching the row&apos;s actual state. By default,
            anything marked &ldquo;Paid&rdquo; disappears from the inbox view —
            the tab acts like an email inbox where settled items archive
            themselves. The tab counter at the top shows how many items still
            need attention, not how many you&apos;ve ever processed. If you
            need to find a paid item later, click &ldquo;Show settled&rdquo; on
            the tab.
          </p>
          <p>
            Each card also shows a <strong>Channel</strong> row — Shopify,
            Wix, Square, Markets, Wholesale, Service work, or Uncategorized.
            That tag determines which Dashboard rollup the row contributes to.
            If FlowWork guessed wrong (or couldn&apos;t guess), click the
            pencil icon next to the channel name and pick the right one. Your
            selection sticks across re-imports.
          </p>
          <Callout variant="tip">
            Uncategorized rows are usually CSV uploads that didn&apos;t carry
            an obvious tag. Spend a minute every week reclassifying them — it
            keeps the per-channel margin numbers honest.
          </Callout>
        </Section>

        <Section id="read-dashboard" title="8. Read your Dashboard">
          <p>
            The <Link href="/dashboard" className="text-blue-600 no-underline hover:underline">Dashboard</Link>{" "}
            tab is the answer to &ldquo;am I making money?&rdquo; The three big
            cards at the top — Total Sales, Total Expenses, Net Profit —
            cover the year to date. Most users glance at Net Profit first and
            move on if the number is green and growing.
          </p>
          <p>
            Below that, the <strong>Channels</strong> card is the real
            payoff. Each row is one of your revenue sources (Shopify, Markets,
            Wholesale, Service work, etc.) with its own Revenue, Direct
            Expenses, and Net. The bar on each row is scaled to the channel
            with the largest revenue, so you can see relative size at a
            glance. If your Markets row is twice as long as your Shopify row,
            event sales are carrying you.
          </p>
          <p>
            Click any populated channel card to drill into the rows backing
            those numbers — you land on the relevant page (Events for Markets,
            Integrations for Shopify, etc.) filtered to that channel.
          </p>
          <p>
            <strong>COGS &amp; Gross Margin</strong> (Pro tier) is the bottom
            section. It shows the last 30 days of mapped line items, grouped
            by SKU, with Revenue / COGS / Gross Margin per row. This is where
            the cost history you set in section 4 pays off — you can see
            which products have the fattest margins and which are barely
            breaking even.
          </p>
          <Callout variant="warn">
            If a SKU shows $0 COGS but real Revenue, you haven&apos;t added a
            cost row that covers the sale date. Go back to{" "}
            <Link href="/cogs" className="text-blue-600 no-underline hover:underline">COGS</Link>{" "}
            and add one with an effective date before the sale.
          </Callout>
        </Section>

        <Section id="schedule-c-report" title="9. Generate your Schedule-C report">
          <p>
            Open <Link href="/reports" className="text-blue-600 no-underline hover:underline">Reports</Link>{" "}
            (Pro tier). Pick a year, click &ldquo;Generate.&rdquo; You get a
            true Schedule-C-formatted P&amp;L:
          </p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Revenue (by channel)</li>
            <li>Cost of Goods Sold</li>
            <li>Gross Profit (Revenue minus COGS)</li>
            <li>Operating Expenses (by category — rent, SaaS, marketing, etc.)</li>
            <li>Net Profit</li>
          </ul>
          <p>
            This is the same structure your CPA will use to fill out the IRS
            Schedule C. The categories map directly to the IRS line items, so
            your accountant doesn&apos;t have to re-bucket anything.
          </p>
          <p>
            From the report page you can:
          </p>
          <ul className="list-disc pl-6 space-y-1">
            <li><strong>Download PDF</strong> — formatted for printing or emailing</li>
            <li><strong>Download CSV</strong> — for spreadsheets, or to import into your CPA&apos;s tax software</li>
            <li><strong>Email to your accountant</strong> — enter their email, FlowWork sends both files with a short cover note from your business name</li>
          </ul>
          <Callout variant="info">
            The report only includes data FlowWork can see. If you have
            expenses you paid out of a personal account that never made it
            into the Expenses page, they won&apos;t appear. Spend an hour
            before tax season scanning your bank statements and entering any
            business-expense charges that aren&apos;t already tracked.
          </Callout>
        </Section>

        <Section id="next-steps" title="10. Where to go next">
          <p>You&apos;ve hit the main loop. From here:</p>
          <ul className="list-disc pl-6 space-y-2">
            <li>
              <strong>Set a weekly habit</strong> — 10 minutes every Friday to
              reclassify any Uncategorized rows, mark settled invoices Paid,
              and skim the Dashboard. That&apos;s genuinely all the bookkeeping
              most makers need.
            </li>
            <li>
              <strong>Watch the COGS &amp; Gross Margin section</strong> — once
              you have 30+ days of data, you&apos;ll see which products are
              quietly losing money. Raise their prices or stop making them.
            </li>
            <li>
              <strong>Book your white-glove onboarding call</strong> if you
              haven&apos;t — Pro tier includes one. We&apos;ll go through your
              real data live and answer anything this guide didn&apos;t cover.
            </li>
            <li>
              <strong>Explore the reference guides</strong> back on the{" "}
              <Link href="/help" className="text-blue-600 no-underline hover:underline">Help hub</Link>{" "}
              for deeper dives into each section (most are still being
              written — check back).
            </li>
          </ul>
          <p>
            Stuck on something this guide didn&apos;t answer?{" "}
            <a
              href="mailto:support@flowworks.it.com"
              className="text-blue-600 no-underline hover:underline"
            >
              Email support
            </a>{" "}
            — every question becomes a guide section so the next person
            doesn&apos;t have to ask.
          </p>
        </Section>

        <div className="mt-12 pt-6 border-t border-slate-200 text-center">
          <Link
            href="/help"
            className="inline-block text-sm text-blue-600 no-underline hover:underline"
          >
            {"←"} Back to Help &amp; guides
          </Link>
        </div>
      </div>
    </div>
  );
}
