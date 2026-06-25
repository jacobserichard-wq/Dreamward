"use client";

// app/markets/page.tsx
//
// The Dreamward Market Register. Two tiers:
//   1. NATIONAL finder — search any US zip via the USDA Local Food
//      Portal directory (lib/usdaMarkets + /api/markets/search).
//      Location + website only; national datasets have no
//      vendor-application links, so national cards link to each
//      market's own site.
//   2. VERIFIED regional set — hand-researched Northwest Indiana
//      markets (lib/marketRegister) WITH real "apply to vend" links.
//
// Honest by design: only the verified set gets apply buttons; the
// national set links to source/site (see [[feedback_silent_fallbacks]]).

import { useState } from "react";
import Link from "next/link";
import AppHeader from "../components/AppHeader";
import PageHeader from "../components/PageHeader";
import { SUPPORT_EMAIL } from "@/lib/support";
import {
  MARKET_REGISTER,
  CRAFT_FAIR_SOURCES,
  MARKET_COUNTIES,
  type MarketCounty,
} from "@/lib/marketRegister";
import type { UsdaMarket } from "@/lib/usdaMarkets";

type CountyFilter = MarketCounty | "all";

function eventHref(opts: {
  name: string;
  venue?: string | null;
  address?: string | null;
}): string {
  let href = `/events?new=1&name=${encodeURIComponent(opts.name)}`;
  if (opts.venue) href += `&venue=${encodeURIComponent(opts.venue)}`;
  if (opts.address) href += `&address=${encodeURIComponent(opts.address)}`;
  return href;
}

export default function MarketsPage() {
  const [county, setCounty] = useState<CountyFilter>("all");

  // National USDA search state.
  const [zip, setZip] = useState("");
  const [radius, setRadius] = useState(30);
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<UsdaMarket[] | null>(null);
  const [near, setNear] = useState<{ place: string; state: string } | null>(
    null
  );
  const [searchError, setSearchError] = useState<string | null>(null);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);

  const visible =
    county === "all"
      ? MARKET_REGISTER
      : MARKET_REGISTER.filter((m) => m.county === county);

  async function runSearch(e: React.FormEvent) {
    e.preventDefault();
    setSearchError(null);
    setFallbackUrl(null);
    setResults(null);
    setNear(null);
    if (!/^\d{5}$/.test(zip.trim())) {
      setSearchError("Enter a 5-digit US zip code.");
      return;
    }
    setSearching(true);
    try {
      const res = await fetch(
        `/api/markets/search?zip=${zip.trim()}&radius=${radius}`
      );
      const data = await res.json();
      if (!res.ok) {
        setSearchError(data.error || "Search failed. Try again.");
        return;
      }
      if (data.configured === false) {
        setFallbackUrl(data.fallbackUrl as string);
        return;
      }
      setResults(data.markets as UsdaMarket[]);
      setNear(data.near);
    } catch {
      setSearchError("Couldn't reach the market search. Try again.");
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="min-h-screen bg-oat font-sans text-forest">
      <AppHeader />
      <div className="max-w-[900px] mx-auto py-8 px-4 sm:px-6">
        <Link
          href="/events"
          className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline mb-4"
        >
          {"\u{2190}"} Back to events
        </Link>
        <PageHeader
          title="Find your next market"
          subtitle="Search farmers & vendor markets anywhere in the US, then track the ones you work in your events."
        />

        {/* ── National finder ──────────────────────────────────── */}
        <section className="bg-cream border border-sand rounded-2xl p-5 mb-8">
          <h2 className="font-serif text-xl font-semibold text-forest m-0 mb-1">
            Markets anywhere in the US
          </h2>
          <p className="text-sm text-bark m-0 mb-4">
            Powered by the USDA National Farmers Market Directory — 7,800+
            markets across all 50 states. Enter your zip to find markets
            near you.
          </p>
          <form
            onSubmit={runSearch}
            className="flex items-end gap-2 flex-wrap mb-2"
          >
            <div>
              <label
                htmlFor="zip"
                className="block text-xs font-medium text-bark mb-1"
              >
                Zip code
              </label>
              <input
                id="zip"
                type="text"
                inputMode="numeric"
                value={zip}
                onChange={(e) => setZip(e.target.value)}
                placeholder="46303"
                maxLength={5}
                className="w-28 py-2 px-3 text-sm border border-sand rounded-lg bg-white outline-none focus:ring-2 focus:ring-eucalyptus/30 focus:border-eucalyptus"
              />
            </div>
            <div>
              <label
                htmlFor="radius"
                className="block text-xs font-medium text-bark mb-1"
              >
                Within
              </label>
              <select
                id="radius"
                value={radius}
                onChange={(e) => setRadius(Number(e.target.value))}
                className="py-2 px-3 text-sm border border-sand rounded-lg bg-white outline-none focus:ring-2 focus:ring-eucalyptus/30 focus:border-eucalyptus"
              >
                <option value={10}>10 miles</option>
                <option value={30}>30 miles</option>
                <option value={50}>50 miles</option>
                <option value={100}>100 miles</option>
              </select>
            </div>
            <button
              type="submit"
              disabled={searching}
              className="py-2 px-5 rounded-full bg-eucalyptus text-cream text-sm font-semibold cursor-pointer border-0 hover:bg-eucalyptus-dark disabled:opacity-60"
            >
              {searching ? "Searching…" : "Search"}
            </button>
          </form>

          {searchError && (
            <p className="text-sm text-rose-dark m-0 mt-2">{searchError}</p>
          )}

          {/* Key not granted yet → link out to the USDA directory. */}
          {fallbackUrl && (
            <p className="text-sm text-bark m-0 mt-2">
              National in-app search is being set up. For now, browse the{" "}
              <a
                href={fallbackUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-eucalyptus-dark font-medium hover:underline"
              >
                USDA market directory {"\u{2197}"}
              </a>{" "}
              for your area.
            </p>
          )}

          {results && (
            <div className="mt-4">
              <p className="text-xs text-stone m-0 mb-3">
                {results.length > 0
                  ? `${results.length} market${results.length === 1 ? "" : "s"} within ${radius} miles${
                      near ? ` of ${near.place}, ${near.state}` : ""
                    }`
                  : `No markets found within ${radius} miles${
                      near ? ` of ${near.place}, ${near.state}` : ""
                    }. Try a wider radius.`}
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {results.map((m) => (
                  <div
                    key={m.id}
                    className="bg-white border border-sand rounded-xl p-4 flex flex-col"
                  >
                    <h3 className="text-sm font-semibold text-forest m-0 mb-1">
                      {m.name}
                    </h3>
                    {(m.city || m.state) && (
                      <p className="text-xs text-stone m-0 mb-1">
                        {[m.city, m.state].filter(Boolean).join(", ")}
                      </p>
                    )}
                    {m.address && (
                      <p className="text-xs text-bark m-0 mb-3">{m.address}</p>
                    )}
                    <div className="mt-auto flex items-center gap-3 flex-wrap pt-2 border-t border-sand">
                      <Link
                        href={eventHref({
                          name: m.name,
                          venue:
                            m.city && m.state ? `${m.city}, ${m.state}` : null,
                          address: m.address,
                        })}
                        className="py-1.5 px-3 rounded-full border border-eucalyptus text-eucalyptus-dark text-xs font-semibold no-underline hover:bg-eucalyptus-soft"
                      >
                        + Add to my events
                      </Link>
                      {m.website && (
                        <a
                          href={m.website}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-eucalyptus-dark hover:underline"
                        >
                          Market site {"\u{2197}"}
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <p className="text-[11px] text-stone m-0 mt-3">
                To vend, check each market&apos;s own site for its vendor
                application — national listings don&apos;t include apply links.
              </p>
            </div>
          )}
        </section>

        {/* ── Verified regional set (apply links) ──────────────── */}
        <div className="flex items-baseline justify-between gap-3 flex-wrap mb-2">
          <h2 className="font-serif text-xl font-semibold text-forest m-0">
            Verified markets — apply directly
          </h2>
          <span className="text-xs text-stone">Northwest Indiana</span>
        </div>
        <div className="bg-honey/15 border border-honey/40 rounded-2xl px-4 py-3 mb-5 text-sm text-bark">
          Hand-researched markets with a real{" "}
          <strong>&ldquo;Apply to vend&rdquo;</strong> link where we could
          confirm one. Always double-check current dates, fees, and deadlines
          on the application — markets adjust every season.
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

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {visible.map((m) => {
            const addHref = eventHref({
              name: m.name,
              venue: `${m.city}, IN`,
              address: m.venue,
            });
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
                    <dd className="m-0 font-medium text-forest">
                      {m.schedule}
                    </dd>
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
                  <p className="text-xs text-bark italic m-0 mb-2">{m.note}</p>
                )}

                <div className="mt-auto pt-3 border-t border-sand">
                  {m.vendorNote && (
                    <p className="text-xs text-bark m-0 mb-2.5">
                      <span className="font-medium text-forest">To vend:</span>{" "}
                      {m.vendorNote}
                    </p>
                  )}
                  <div className="flex items-center gap-2 flex-wrap">
                    {m.applyUrl ? (
                      <a
                        href={m.applyUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="py-1.5 px-3.5 rounded-full bg-eucalyptus text-cream text-xs font-semibold no-underline hover:bg-eucalyptus-dark"
                      >
                        Apply to vend {"\u{2197}"}
                      </a>
                    ) : m.vendorContact ? (
                      <a
                        href={`mailto:${m.vendorContact}`}
                        className="py-1.5 px-3.5 rounded-full bg-eucalyptus text-cream text-xs font-semibold no-underline hover:bg-eucalyptus-dark"
                      >
                        Email to apply {"\u{2197}"}
                      </a>
                    ) : null}
                    <Link
                      href={addHref}
                      className="py-1.5 px-3.5 rounded-full border border-eucalyptus text-eucalyptus-dark text-xs font-semibold no-underline hover:bg-eucalyptus-soft"
                    >
                      + Add to my events
                    </Link>
                    <a
                      href={m.sourceUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-stone hover:underline"
                    >
                      Info {"\u{2197}"}
                    </a>
                  </div>
                  {m.applyUrl && m.vendorContact && (
                    <p className="text-[11px] text-stone m-0 mt-1.5">
                      Questions?{" "}
                      <a
                        href={`mailto:${m.vendorContact}`}
                        className="text-eucalyptus-dark hover:underline"
                      >
                        {m.vendorContact}
                      </a>
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Seasonal craft & holiday fairs ───────────────────── */}
        <div className="mt-10">
          <h2 className="font-serif text-xl font-semibold text-forest m-0 mb-1">
            Seasonal craft &amp; holiday fairs
          </h2>
          <p className="text-sm text-bark m-0 mb-4">
            Craft/artisan fairs aren&apos;t in any national registry — they
            live on promoter sites and these live calendars:
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
          Know a market we should verify?{" "}
          <a
            href={`mailto:${SUPPORT_EMAIL}?subject=Market%20to%20add`}
            className="text-eucalyptus-dark hover:underline"
          >
            Tell us
          </a>{" "}
          and we&apos;ll research it.
        </p>
      </div>
    </div>
  );
}
