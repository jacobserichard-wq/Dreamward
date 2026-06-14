// app/components/PriceSlider.tsx
//
// "Find your price" revenue slider — the marketing pricing UI.
// Replaces the coarse 4-tier tiles: drag across revenue bands and
// the monthly price updates, so pricing reads as a gentle climb that
// fits exactly where the business is (vs. the old $5k-to-$50k cliff).
//
// Display-only preview: bands come from PRICE_LADDER (lib/plans).
// Actual billing still runs on TIER_DISPLAY until Stripe is updated.

"use client";

import { useState } from "react";
import SignInButton from "./SignInButton";
import { PRICE_LADDER } from "@/lib/plans";

export default function PriceSlider() {
  // Default to the $5k–$15k band — where a typical graduating maker
  // lands, so the first thing you see isn't the cheapest edge.
  const [i, setI] = useState(1);
  const band = PRICE_LADDER[i];
  const lastIndex = PRICE_LADDER.length - 1;

  return (
    <div className="bg-cream border border-sand rounded-2xl p-6 sm:p-8 max-w-2xl mx-auto">
      <p className="text-center text-xs font-bold uppercase tracking-wider text-eucalyptus-dark m-0 mb-1">
        Find your price
      </p>
      <p className="text-center text-sm text-bark m-0 mb-6">
        Your plan is set by your business&apos;s annual revenue — drag to
        find yours.
      </p>

      {/* Live price readout */}
      <div className="text-center mb-6">
        <div className="text-forest">
          <span className="font-serif text-5xl font-semibold tabular-nums">
            ${band.price}
          </span>
          <span className="text-base text-stone ml-1">/month</span>
        </div>
        <p className="text-sm text-bark m-0 mt-2">
          for businesses doing{" "}
          <span className="font-semibold text-forest">{band.range}</span> a year
          in revenue
        </p>
      </div>

      {/* Slider */}
      <input
        type="range"
        min={0}
        max={lastIndex}
        step={1}
        value={i}
        onChange={(e) => setI(Number(e.target.value))}
        className="w-full accent-eucalyptus cursor-pointer"
        aria-label="Your annual revenue band"
        aria-valuetext={`${band.range} a year — $${band.price} per month`}
      />
      <div className="flex justify-between mt-1.5 text-[10px] text-stone">
        <span>Under $5k</span>
        <span>$300k+</span>
      </div>

      {/* All bands — quick-select + full-ladder transparency */}
      <div className="flex flex-wrap justify-center gap-1.5 mt-5">
        {PRICE_LADDER.map((b, idx) => (
          <button
            key={b.range}
            type="button"
            onClick={() => setI(idx)}
            title={`${b.range} a year`}
            className={`text-[11px] px-2.5 py-1 rounded-full border cursor-pointer transition-colors tabular-nums ${
              idx === i
                ? "bg-eucalyptus text-cream border-eucalyptus"
                : "bg-oat text-bark border-sand hover:border-eucalyptus"
            }`}
          >
            ${b.price}
          </button>
        ))}
      </div>

      <div className="text-center mt-7">
        <SignInButton label="Go dreamward &rarr;" />
        <p className="text-xs text-stone mt-3 m-0 max-w-sm mx-auto leading-relaxed">
          14-day free trial, no credit card. Your tier adjusts automatically
          as you grow — you&apos;re always on the band that fits, never a
          surprise jump.
        </p>
      </div>
    </div>
  );
}
