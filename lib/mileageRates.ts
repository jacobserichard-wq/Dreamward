// lib/mileageRates.ts
//
// Two distinct mileage rates with two distinct purposes:
//
//   1. OPERATING RATE — gas price ÷ MPG. The honest cash cost of
//      driving one mile (fuel only). Used on PROFITABILITY surfaces
//      (/profitability, dashboard Channels, per-event P&L) where the
//      question is "what did this drive actually cost me?".
//
//   2. IRS RATE — the IRS standard mileage rate (~$0.70/mi for 2025).
//      Includes gas + maintenance + insurance + depreciation. Used
//      on TAX surfaces (/reports, Schedule C summary, quarterly
//      estimates) where the question is "how much can I deduct?".
//      Lives in app_settings.irs_mileage_rate (global, one row).
//
// This file owns the OPERATING rate path. The IRS rate path lives
// in app_settings reads in lib/reports/aggregate.ts and the two
// /api/profitability endpoints (which now read BOTH rates and apply
// the operating one to profitability math).
//
// Why a separate helper file instead of dropping into channels.ts:
// the IRS rate is shared with multiple consumers; the operating
// rate will be too once we add quarterly forecasts (Phase 9.3+).
// Keeping the rate math in one place makes future audits easier.

/** Default US national average gas price ($/gallon) used when the
 *  user hasn't set a custom value. Per EIA published data around
 *  the time Jacob raised the issue (May 2026). Reasonable to bump
 *  this default every few quarters. */
export const DEFAULT_GAS_PRICE_PER_GALLON = 3.67;

/** Default vehicle MPG used when the user hasn't set a custom value.
 *  30 MPG covers the most common consumer-car efficiency. Trucks +
 *  vans typically get 18-22; hybrids/EVs 40+. Per-user override
 *  lives in client_settings.preferences.vehicle.mpg. */
export const DEFAULT_MPG = 30;

/** Shape we expect the preferences.vehicle sub-key to take. Both
 *  fields optional — missing values fall back to defaults. */
export interface VehiclePreferences {
  gas_price_per_gallon?: number | null;
  mpg?: number | null;
}

/** Compute the operating rate in $/mile from gas price + MPG.
 *  Defensive: clamps inputs to sane ranges so a user typo can't
 *  produce $1000/mi or $0/mi values that downstream math chokes on.
 *  - gas price: clamped to [0.50, 20.00] (covers historical lows +
 *    catastrophic spikes, rejects negative + nonsensical)
 *  - MPG: clamped to [5, 200] (semi-truck low end to EV high end) */
export function computeOperatingRate(opts: {
  gasPrice: number;
  mpg: number;
}): number {
  const gas = Math.max(0.5, Math.min(20, opts.gasPrice));
  const mpg = Math.max(5, Math.min(200, opts.mpg));
  return gas / mpg;
}

/** Load the operating rate from a client_settings preferences row.
 *  Reads preferences.vehicle.{gas_price_per_gallon, mpg}; missing
 *  fields default to the constants above.
 *
 *  Returns BOTH the computed rate + a source flag so consumers can
 *  honestly label their UI ("using your $3.67/gal × 30mpg" vs
 *  "using default $3.67/gal × 30mpg"). */
export function loadOperatingRateFromPrefs(
  preferences: Record<string, unknown> | null | undefined
): {
  rate: number;
  gasPrice: number;
  mpg: number;
  source: "config" | "default";
} {
  const vehicle =
    preferences &&
    typeof preferences === "object" &&
    typeof preferences.vehicle === "object" &&
    preferences.vehicle !== null
      ? (preferences.vehicle as VehiclePreferences)
      : null;

  const rawGas =
    typeof vehicle?.gas_price_per_gallon === "number"
      ? vehicle.gas_price_per_gallon
      : null;
  const rawMpg =
    typeof vehicle?.mpg === "number" ? vehicle.mpg : null;

  const gasPrice =
    rawGas !== null && Number.isFinite(rawGas) && rawGas > 0
      ? rawGas
      : DEFAULT_GAS_PRICE_PER_GALLON;
  const mpg =
    rawMpg !== null && Number.isFinite(rawMpg) && rawMpg > 0
      ? rawMpg
      : DEFAULT_MPG;

  // Source flag — "config" only if BOTH user values are present + valid
  const source: "config" | "default" =
    rawGas !== null && rawMpg !== null && rawGas > 0 && rawMpg > 0
      ? "config"
      : "default";

  return {
    rate: computeOperatingRate({ gasPrice, mpg }),
    gasPrice,
    mpg,
    source,
  };
}
