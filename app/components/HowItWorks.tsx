// app/components/HowItWorks.tsx
//
// Reusable "How Dreamward works" explainer — the four-stage flow from a
// sale to a tax-ready number, in plain English. Mirrors the PDF flow
// chart. Used as a section on the landing (#how-it-works) and on the
// standalone /how-it-works page (linked from onboarding). Self-contained
// section (own max-width + padding) so callers just drop <HowItWorks />.

import { Fragment } from "react";

interface Stage {
  n: number;
  label: string;
  pill: string; // bg color class for the step pill
  accent: string; // border-left color class for cards
  cols: string; // responsive grid columns
  items: [string, string][]; // [title, description]
}

const STAGES: Stage[] = [
  {
    n: 1,
    label: "Your sales & costs come in",
    pill: "bg-eucalyptus",
    accent: "border-l-eucalyptus",
    cols: "sm:grid-cols-2 lg:grid-cols-3",
    items: [
      ["Online stores", "Shopify, Square & Wix orders sync in automatically."],
      ["Markets", "Make an event, then tap each booth sale on your phone."],
      ["Direct sales", "Cash, Venmo, word-of-mouth — use “+ Add a sale.”"],
      ["Wholesale", "Send invoices and track who still owes you."],
      ["Upload", "Drop a CSV — or a PDF invoice we read for you."],
      ["Expenses", "Log supplies, booth fees, packaging and overhead."],
    ],
  },
  {
    n: 2,
    label: "Each transaction gets labeled",
    pill: "bg-emerald-600",
    accent: "border-l-emerald-600",
    cols: "sm:grid-cols-2",
    items: [
      ["Category = what it is", "Income vs. expense — and whether a cost is materials (COGS) or overhead. This is what makes your taxes correct."],
      ["Channel = where it came from", "Markets, Etsy, Direct, Wholesale… or Overhead for costs not tied to one. This powers your per-channel profit view."],
    ],
  },
  {
    n: 3,
    label: "Dreamward does the math",
    pill: "bg-honey-dark",
    accent: "border-l-honey",
    cols: "sm:grid-cols-2",
    items: [
      ["Real gross margin", "Your price minus the true cost of materials — per product and channel, with history that never rewrites itself."],
      ["Profit per channel", "See which channel actually makes money after its own costs."],
      ["Live inventory", "Stock counts and inventory value update as you sell."],
      ["Net profit", "What’s left after every cost — including booth fees and mileage."],
    ],
  },
  {
    n: 4,
    label: "You get clear answers",
    pill: "bg-rose-dark",
    accent: "border-l-rose",
    cols: "sm:grid-cols-3",
    items: [
      ["Dashboard", "Where your money comes from, at a glance."],
      ["Tax-ready reports", "Schedule-C P&L + inventory, net of refunds — hand it to your CPA."],
      ["Your fair price", "You pay by your size; your plan auto-adjusts as you grow."],
    ],
  },
];

export default function HowItWorks() {
  return (
    <section
      id="how-it-works"
      className="max-w-[1100px] mx-auto px-4 sm:px-8 py-12 sm:py-16 scroll-mt-20"
    >
      <div className="text-center mb-10">
        <span className="text-[11px] font-bold uppercase tracking-wider text-eucalyptus-dark bg-eucalyptus-soft px-3 py-1 rounded-full">
          How it works
        </span>
        <h2 className="font-serif text-2xl sm:text-4xl font-semibold text-forest m-0 mt-4 mb-2 tracking-tight">
          From a sale to a tax-ready number
        </h2>
        <p className="text-base text-bark max-w-xl mx-auto m-0">
          In plain English — four steps, start to finish.
        </p>
      </div>

      <div>
        {STAGES.map((stage, i) => (
          <Fragment key={stage.n}>
            <div>
              <div className="flex items-center gap-3 mb-4">
                <span className="flex-shrink-0 w-7 h-7 rounded-full bg-forest text-cream text-sm font-bold inline-flex items-center justify-center">
                  {stage.n}
                </span>
                <span
                  className={`${stage.pill} text-white text-sm font-semibold px-3 py-1 rounded-full`}
                >
                  {stage.label}
                </span>
              </div>
              <div className={`grid grid-cols-1 ${stage.cols} gap-3`}>
                {stage.items.map(([title, desc]) => (
                  <div
                    key={title}
                    className={`bg-cream border border-sand ${stage.accent} border-l-4 rounded-xl p-4`}
                  >
                    <p className="text-sm font-bold text-forest m-0 mb-1">{title}</p>
                    <p className="text-[13px] text-bark leading-relaxed m-0">{desc}</p>
                  </div>
                ))}
              </div>
            </div>
            {i < STAGES.length - 1 && (
              <div className="flex justify-center py-3" aria-hidden="true">
                <svg viewBox="0 0 16 11" className="w-4 h-3 text-eucalyptus" fill="currentColor">
                  <polygon points="1,0 15,0 8,11" />
                </svg>
              </div>
            )}
          </Fragment>
        ))}
      </div>
    </section>
  );
}
