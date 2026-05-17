/**
 * Distance helper for Phase 4 mileage tracking.
 *
 * Wraps Google Maps Distance Matrix API — chosen over the modern Routes
 * API because it's the simplest endpoint that accepts plain address
 * strings and returns driving distance in one round-trip (no separate
 * geocoding step required). Comparable per-request cost for both;
 * Distance Matrix's response shape is friendlier for a one-origin-one-
 * destination lookup.
 *
 * Setup steps the user must do before this works in production
 * (documented in the sub-session report):
 *
 *   1. In the existing Google Cloud project, enable "Distance Matrix
 *      API" (Maps Platform → APIs).
 *   2. Create an API key restricted to the Distance Matrix API and to
 *      the server (IP restriction preferred — calls are server-side).
 *   3. Add GOOGLE_MAPS_API_KEY to Vercel (Production + Preview).
 *   4. Glance at current Google Maps Platform pricing — there's a
 *      monthly usage credit and per-request cost is small. The caching
 *      pattern (compute once per home/event pair, store on the event,
 *      never re-call unless an address changes) keeps real usage at a
 *      handful of calls per vendor per month.
 *
 * Until step 3 lands, this helper returns null for every call (the
 * missing-key branch). Events still save normally; round_trip_miles
 * stays null until the key is configured and the user hits the
 * Recalculate affordance or changes their home address.
 */

const METERS_PER_MILE = 1609.344;

interface DistanceMatrixElement {
  status?: string;
  distance?: {
    value?: number; // distance in meters
    text?: string;
  };
}

interface DistanceMatrixResponse {
  status?: string;
  rows?: Array<{
    elements?: DistanceMatrixElement[];
  }>;
}

/**
 * Compute the round-trip driving distance (home → event → home) in miles.
 *
 * The helper is intentionally unaware of `returns_home_nightly` and the
 * event's day count. It returns ONE round trip's distance; callers that
 * display or aggregate mileage apply the multi-day conditional per
 * design §8.2.
 *
 * Returns null on:
 *   - Missing GOOGLE_MAPS_API_KEY env var
 *   - Empty / blank address arguments
 *   - HTTP error from the API
 *   - API status !== "OK" (e.g., REQUEST_DENIED, OVER_QUERY_LIMIT)
 *   - Element-level status !== "OK" (e.g., NOT_FOUND, ZERO_RESULTS)
 *   - Any thrown error during the request
 *
 * Never throws. A failed distance lookup must not block an event save.
 */
export async function computeRoundTripMiles(
  homeAddress: string,
  eventAddress: string
): Promise<number | null> {
  if (!homeAddress?.trim() || !eventAddress?.trim()) return null;

  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    console.warn(
      "[distance] GOOGLE_MAPS_API_KEY not set — mileage stays null until configured"
    );
    return null;
  }

  // Distance Matrix API endpoint. units=imperial returns miles in the
  // text response; we still convert from meters in `distance.value` so
  // the precision is consistent regardless of locale.
  const url = new URL(
    "https://maps.googleapis.com/maps/api/distancematrix/json"
  );
  url.searchParams.set("origins", homeAddress.trim());
  url.searchParams.set("destinations", eventAddress.trim());
  url.searchParams.set("mode", "driving");
  url.searchParams.set("units", "imperial");
  url.searchParams.set("key", apiKey);

  try {
    const res = await fetch(url.toString(), {
      // Distance for an address pair doesn't change — cache aggressively
      // at the fetch layer in case anything else hits the same URL during
      // the same request lifecycle. The DB cache via round_trip_miles +
      // mileage_computed_at is the real cost-control.
      cache: "force-cache",
    });
    if (!res.ok) {
      console.warn(
        `[distance] Distance Matrix HTTP ${res.status} for "${homeAddress}" → "${eventAddress}"`
      );
      return null;
    }
    const data = (await res.json()) as DistanceMatrixResponse;
    if (data.status !== "OK") {
      console.warn(
        `[distance] Distance Matrix top-level status=${data.status} for "${homeAddress}" → "${eventAddress}"`
      );
      return null;
    }
    const element = data.rows?.[0]?.elements?.[0];
    if (!element || element.status !== "OK") {
      console.warn(
        `[distance] Distance Matrix element status=${element?.status ?? "missing"} for "${homeAddress}" → "${eventAddress}"`
      );
      return null;
    }
    const meters = element.distance?.value;
    if (typeof meters !== "number" || !Number.isFinite(meters) || meters < 0) {
      return null;
    }
    // One-way meters → miles, ×2 for round trip, rounded to 1 decimal
    // place (matches the NUMERIC(7,1) DB column shape — design §3).
    const roundTripMiles = (meters / METERS_PER_MILE) * 2;
    return Math.round(roundTripMiles * 10) / 10;
  } catch (err) {
    console.error("[distance] Distance Matrix call failed:", err);
    return null;
  }
}
