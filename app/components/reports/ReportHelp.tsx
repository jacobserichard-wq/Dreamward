// app/components/reports/ReportHelp.tsx
//
// Small "?" help icon shown next to each report's title. Clicking it
// pops a plain-English explanation of what the report shows — written
// for makers with no accounting/finance background (no jargon, or
// jargon explained in plain words). All the copy lives in HELP here so
// it's easy to tune in one place.

"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

const HELP: Record<string, { what: string; why: ReactNode }> = {
  tax: {
    what: "A tidy year-end summary for your accountant.",
    why: "Pick a year and Dreamward totals your income and expenses the way the IRS Schedule C form expects. Download the PDF/CSV or email it straight to your CPA — tax time becomes a one-click handoff.",
  },
  pnl: {
    what: "Did you actually make money?",
    why: "This walks from your sales down to what you keep: Sales − the cost of your products (COGS) = Gross profit, then minus your other expenses = Net profit. Choose “All channels” for the whole business, or one channel (like Etsy) to see just that.",
  },
  "channel-mix": {
    what: "Where your money comes from.",
    why: "Shows how much each place you sell — markets, Etsy, direct, etc. — brought in, and what share of your total sales that is. Handy for seeing which channels matter most and which aren’t worth the effort.",
  },
  products: {
    what: "Which products make you money.",
    why: "For each product: what it sold for, what it cost you (COGS), and the profit left over (margin). Anything flagged “selling below cost” is losing you money. The Total ties to the Profit-margin card on your dashboard.",
  },
  trend: {
    what: "Are you growing?",
    why: "Your sales month by month, plus a side-by-side with the same months a year ago — so you can tell at a glance whether you’re up or down compared to last year.",
  },
  markets: {
    what: "Which markets are worth your time.",
    why: "For each market/event it adds up what you sold and subtracts the real costs — booth fee, gas/mileage, supplies — to show the profit you actually made there, ranked best to worst.",
  },
  ar: {
    what: "Who owes you money.",
    why: "“Aging” groups unpaid invoices by how overdue they are (current, 1–30 days, 31–60, and so on) and lists customers by how much they owe — so you know who to chase first.",
  },
  refunds: {
    what: "How much you’ve given back.",
    why: "Your total refunds and your refund rate (refunds as a % of sales), broken down by channel. A channel with a high rate can be a sign of a product or quality issue worth looking into.",
  },
  inventory: {
    what: "What your stock is worth, and the cost of what you sold.",
    why: "Inventory value = the stock you have on hand, priced at cost. COGS = the cost of the products you sold this period. Your accountant needs both for your tax return — this puts them in one place.",
  },
};

export default function ReportHelp({ reportId }: { reportId: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const info = HELP[reportId];

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!info) return null;

  return (
    <span className="relative inline-block align-middle" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="What does this report show?"
        title="What does this report show?"
        className={`w-[18px] h-[18px] inline-flex items-center justify-center rounded-full text-[11px] font-bold cursor-pointer border transition-colors ${
          open
            ? "bg-blue-500 text-white border-blue-500"
            : "bg-slate-100 text-slate-500 border-slate-200 hover:bg-blue-50 hover:text-blue-600 hover:border-blue-200"
        }`}
      >
        ?
      </button>
      {open && (
        <div className="absolute z-30 left-0 top-full mt-1.5 w-72 bg-white border border-slate-200 rounded-lg shadow-xl p-3 text-left normal-case font-normal">
          <p className="text-sm font-semibold text-slate-900 m-0 mb-1">
            {info.what}
          </p>
          <p className="text-xs text-slate-600 leading-relaxed m-0">{info.why}</p>
        </div>
      )}
    </span>
  );
}
