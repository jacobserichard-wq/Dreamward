"use client";

// app/markets/page.tsx
//
// The Dreamward Market Register — a discovery page listing recurring
// vendor/farmers markets in Northwest Indiana (data in
// lib/marketRegister.ts). A vendor browses markets near them, filters
// by county, and one-click "Add to my events" to start tracking one
// (prefills the /events create form via query params).
//
// Honest by design: schedules are day-of-week + season (stable year
// to year); every card links to its source so the vendor confirms
// current details. One-off craft/holiday fairs point to live
// aggregators rather than frozen dates.

import { useState } from "react";
import Link from "next/link";
import AppHeader from "../components/AppHeader";
import PageHeader from "../components/PageHeader";
import {
  MARKET_REGISTER,
  CRAFT_FAIR_SOURCES,
  MARKET_COUNTIES,
  type MarketCounty,
} from "@/lib/marketRegister";

type CountyFilter = MarketCounty | "all";

export default function MarketsPage() {
  const [county, setCounty] = useState<CountyFilter>("all");

  const visible =
    county === "all"
      ? MARKET_REGISTER
      : MARKET_REGISTER.filter((m) => m.county === county);

  return (
    <div className="min-h-screen bg-oat font-sans text-forest">
      <AppHeader />
      <div className="max-w-[900px] mx-auto py-8 px-4 sm:px-6">
        <PageHeader
          title="Markets near you"
          subtitle="Recurring farmers & vendor markets across Northwest Indiana — find your next booth."
        />

        {/* Honesty note */}
        <div className="bg-honey/15 border border-honey/40 rounded-2xl px-4 py-3 mb-6 text-sm text-bark">
          Curated from public listings (South Shore CVA, Indiana Dunes,
          Town Planner). Days &amp; seasons are stable year to year, but
          always confirm <strong>current dates, hours, and booth fees</strong>{" "}
          at each market&apos;s source link before you go.
        </div>

        {/* County filter */}
        <div className="flex gap-2 mb-6 flex-wrap">
          {(["all", ...MARKET_COUNTIES] as CountyFilter[]).map((c) => {
            const active = county === c;
            return (
              <button
                key={c}
                type="button"
                onClick={() => setCounty(c)}
                className={`py-1.5 px-4 rounded-full text-sm font-medium border cursor-pointer transition-colors ${
                  active
                    ? "bg-eucalyptus text-cream border-eucalyptus"
                    : "bg-cream text-bark border-sand hover:border-eucalyptus"
                }`}
              >
                {c === "all" ? "All counties" : `${c} County`}
              </button>
            );
          })}
        </div>

        {/* Market cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {visible.map((m) => {
            // Prefill the event form: name + a location (venue → address
            // so mileage can compute; city as the venue label).
            const addHref =
              `/events?new=1&name=${encodeURIComponent(m.name)}` +
              `&venue=${encodeURIComponent(m.city + ", IN")}` +
              (m.venue ? `&address=${encodeURIComponent(m.venue)}` : "");
            return (
              <div
                key={m.id}
                className="bg-cream border border-sand rounded-2xl p-5 flex flex-col"
              >
                <div className="flex items-start justify-between gap-2 mb-1">
                  <h3 className="font-serif text-lg font-semibold text-forest m-0">
                    {m.name}
                  </h3>
                  <span className="text-[11px] font-medium text-eucalyptus-dark bg-eucalyptus-soft rounded-full px-2 py-0.5 whitespace-nowrap">
                    {m.county}
                  </span>
                </div>
                <p className="text-xs text-stone m-0 mb-3">{m.city}, IN</p>

                <dl className="text-sm text-bark m-0 mb-3 space-y-1">
                  <div className="flex gap-2">
                    <dt className="text-stone w-16 flex-shrink-0">When</dt>
                    <dd className="m-0 font-medium text-forest">{m.schedule}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="text-stone w-16 flex-shrink-0">Season</dt>
                    <dd className="m-0">{m.season}</dd>
                  </div>
                  {m.venue && (
                    <div className="flex gap-2">
                      <dt className="text-stone w-16 flex-shrink-0">Where</dt>
                      <dd className="m-0">{m.venue}</dd>
                    </div>
                  )}
                </dl>

                {m.note && (
                  <p className="text-xs text-bark italic m-0 mb-3">{m.note}</p>
                )}

                <div className="mt-auto flex items-center gap-3 flex-wrap pt-2 border-t border-sand">
                  <Link
                    href={addHref}
                    className="py-1.5 px-3.5 rounded-full bg-eucalyptus text-cream text-xs font-semibold no-underline hover:bg-eucalyptus-dark"
                  >
                    + Add to my events
                  </Link>
                  <a
                    href={m.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-eucalyptus-dark hover:underline"
                  >
                    {m.sourceName} {"\u{2197}"}
                  </a>
                </div>
              </div>
            );
          })}
        </div>

        {/* Seasonal craft & holiday fairs */}
        <div className="mt-10">
          <h2 className="font-serif text-xl font-semibold text-forest m-0 mb-1">
            Seasonal craft &amp; holiday fairs
          </h2>
          <p className="text-sm text-bark m-0 mb-4">
            One-off fairs (Crown Point, Valparaiso, and more) change dates
            every year — these live calendars stay current:
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {CRAFT_FAIR_SOURCES.map((s) => (
              <a
                key={s.url}
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-cream border border-sand rounded-2xl p-4 no-underline hover:border-eucalyptus block"
              >
                <div className="text-sm font-semibold text-forest mb-1">
                  {s.name} {"\u{2197}"}
                </div>
                <div className="text-xs text-bark">{s.blurb}</div>
              </a>
            ))}
          </div>
        </div>

        <p className="text-xs text-stone mt-8 text-center">
          Know a market we&apos;re missing?{" "}
          <a
            href="mailto:hello@godreamward.com?subject=Market%20to%20add"
            className="text-eucalyptus-dark hover:underline"
          >
            Tell us
          </a>{" "}
          and we&apos;ll add it.
        </p>
      </div>
    </div>
  );
}
