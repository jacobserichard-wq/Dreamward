// app/components/OnboardingFlow.tsx
//
// The setup flow shown at the top of /onboarding so a new user sees how
// Dreamward fits together before working the checklist below. Five
// stages: the first three are things YOU set up (and map to the checklist
// items); the last two happen automatically as you work. Same visual
// language as HowItWorks — numbered pills, cards, chevron arrows, the
// Sage & Rose palette.

import { Fragment } from "react";
import Link from "next/link";

interface Stage {
  n: number;
  icon: string;
  title: string;
  desc: string;
  pill: string; // number-pill bg
  accent: string; // card left-border
  auto?: boolean; // happens automatically (not a checklist step)
}

const STAGES: Stage[] = [
  {
    n: 1,
    icon: "\u{1F50C}", // 🔌
    title: "Bring in your sales",
    desc: "Connect a store (Shopify, Wix, Square, Etsy) and orders sync in automatically — or add a sale by hand, upload a CSV, or log a market day.",
    pill: "bg-eucalyptus",
    accent: "border-l-eucalyptus",
  },
  {
    n: 2,
    icon: "\u{1F3F7}\u{FE0F}", // 🏷️
    title: "Build your catalog",
    desc: "Turn what you sell into SKUs & Components. Import your products in one click, paste a list, or map them as they sell. Makers: add a recipe so a product knows the materials it's made of.",
    pill: "bg-emerald-600",
    accent: "border-l-emerald-600",
  },
  {
    n: 3,
    icon: "\u{1F4B5}", // 💵
    title: "Give them costs",
    desc: "Receive a purchase into inventory to record what you paid — the accurate path, costed FIFO — or set a flat estimated cost for the quick path. This is what unlocks gross margin.",
    pill: "bg-honey-dark",
    accent: "border-l-honey",
  },
  {
    n: 4,
    icon: "\u{1F504}", // 🔄
    title: "Sell & make",
    desc: "As you sell, Dreamward drains your oldest stock first (FIFO), so each sale's cost is what you actually paid. Log a production run and it draws down materials and prices the batch for you.",
    pill: "bg-rose-dark",
    accent: "border-l-rose",
    auto: true,
  },
  {
    n: 5,
    icon: "\u{1F4CA}", // 📊
    title: "See your money",
    desc: "Your dashboard shows sales, expenses, net profit, and margin per channel and per product. At tax time, generate a Schedule-C P&L for your CPA in one click.",
    pill: "bg-forest",
    accent: "border-l-forest",
    auto: true,
  },
];

export default function OnboardingFlow() {
  return (
    <section className="bg-white border border-sand rounded-2xl p-5 sm:p-6 mb-6">
      <div className="mb-5">
        <span className="text-[11px] font-bold uppercase tracking-wider text-eucalyptus-dark bg-eucalyptus-soft px-3 py-1 rounded-full">
          How Dreamward works
        </span>
        <h2 className="font-serif text-xl sm:text-2xl font-semibold text-forest m-0 mt-3 mb-1 tracking-tight">
          From your first sale to a tax-ready number
        </h2>
        <p className="text-sm text-bark m-0">
          Five steps. You set up the first three — that&apos;s the checklist
          below — and the last two run on their own as you work.
        </p>
      </div>

      <div>
        {STAGES.map((stage, i) => (
          <Fragment key={stage.n}>
            {/* Labeled divider where "you set up" hands off to "automatic". */}
            {stage.n === 4 && (
              <div className="flex items-center gap-2 my-3" aria-hidden="true">
                <div className="h-px bg-sand flex-1" />
                <span className="text-[11px] font-semibold uppercase tracking-wide text-stone whitespace-nowrap">
                  then, automatically
                </span>
                <div className="h-px bg-sand flex-1" />
              </div>
            )}
            <div
              className={`bg-oat border border-sand ${stage.accent} border-l-4 rounded-xl p-4 flex gap-3 items-start`}
            >
              <span
                className={`flex-shrink-0 w-7 h-7 rounded-full ${stage.pill} text-white text-sm font-bold inline-flex items-center justify-center`}
              >
                {stage.n}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-bold text-forest m-0 mb-0.5">
                  <span className="mr-1.5">{stage.icon}</span>
                  {stage.title}
                  {stage.auto && (
                    <span className="ml-2 align-middle text-[10px] font-semibold uppercase tracking-wide text-honey-dark bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded-full">
                      Automatic
                    </span>
                  )}
                </p>
                <p className="text-[13px] text-bark leading-relaxed m-0">
                  {stage.desc}
                </p>
              </div>
            </div>
            {/* Chevron between cards, except where the divider already sits
                (before step 4) and after the last card. */}
            {i < STAGES.length - 1 && stage.n !== 3 && (
              <div className="flex justify-center py-2" aria-hidden="true">
                <svg
                  viewBox="0 0 16 11"
                  className="w-3.5 h-2.5 text-eucalyptus"
                  fill="currentColor"
                >
                  <polygon points="1,0 15,0 8,11" />
                </svg>
              </div>
            )}
          </Fragment>
        ))}
      </div>

      <p className="text-xs text-bark m-0 mt-5 pt-4 border-t border-sand">
        Want the deep version?{" "}
        <Link
          href="/help/getting-started"
          className="text-eucalyptus-dark font-semibold no-underline hover:underline"
        >
          Read the full getting-started guide
        </Link>{" "}
        — about 15 minutes, start to finish.
      </p>
    </section>
  );
}
