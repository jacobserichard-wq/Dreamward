// lib/usdaMarkets.ts
//
// National farmers-market search via the USDA Local Food Portal API
// (the authoritative national directory — 7,800+ markets, all 50
// states, self-reported by market managers).
//
// Two hops, both server-side:
//   1. Geocode the user's zip → lat/long via zippopotam.us (free,
//      no key, US zips).
//   2. Query the USDA farmersmarket endpoint by x (lon) / y (lat) /
//      radius. Needs USDA_API_KEY (request one at
//      usdalocalfoodportal.com/fe/fregisterpublicapi/).
//
// Honesty note: the USDA directory gives location + website, NOT
// vendor-application links (those don't exist in any national
// dataset). National results link to each market's own site, where
// vendor info lives — we never fabricate an "apply" link. The
// hand-verified apply links only exist for the curated regional set
// in lib/marketRegister.ts.

const USDA_ENDPOINT =
  "https://www.usdalocalfoodportal.com/api/farmersmarket/";
const ZIP_GEOCODE = "https://api.zippopotam.us/us/";

export interface UsdaMarket {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  website: string | null;
  lat: number | null;
  lng: number | null;
}

/** True when the USDA key is configured. The search route falls back
 *  to a directory link-out when this is false (key not yet granted). */
export function isUsdaConfigured(): boolean {
  return Boolean(process.env.USDA_API_KEY);
}

interface ZippoResponse {
  places?: Array<{
    latitude: string;
    longitude: string;
    "place name": string;
    "state abbreviation": string;
  }>;
}

export async function geocodeZip(
  zip: string
): Promise<{ lat: number; lng: number; place: string; state: string } | null> {
  const res = await fetch(`${ZIP_GEOCODE}${encodeURIComponent(zip)}`);
  if (!res.ok) return null;
  const data = (await res.json()) as ZippoResponse;
  const p = data.places?.[0];
  if (!p) return null;
  const lat = Number(p.latitude);
  const lng = Number(p.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    lat,
    lng,
    place: p["place name"],
    state: p["state abbreviation"],
  };
}

// USDA field names per their docs. Parsed defensively — the directory
// is self-reported so any field can be missing or oddly typed.
interface UsdaRawMarket {
  listing_id?: string | number;
  listing_name?: string;
  location_address?: string;
  location_city?: string;
  location_state?: string;
  location_zipcode?: string;
  media_website?: string;
  location_x?: string | number; // longitude
  location_y?: string | number; // latitude
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}
function num(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export async function searchUsdaMarkets(opts: {
  zip: string;
  radius?: number;
}): Promise<{
  markets: UsdaMarket[];
  near: { place: string; state: string } | null;
}> {
  const apikey = process.env.USDA_API_KEY;
  if (!apikey) throw new Error("USDA_API_KEY not set");

  const geo = await geocodeZip(opts.zip);
  if (!geo) return { markets: [], near: null };

  const url = new URL(USDA_ENDPOINT);
  url.searchParams.set("apikey", apikey);
  url.searchParams.set("x", String(geo.lng));
  url.searchParams.set("y", String(geo.lat));
  url.searchParams.set("radius", String(opts.radius ?? 30));

  // USDA's WAF 403s non-browser user agents (Node's default "node"
  // UA gets an HTML 403, which parsed as zero markets). The standard
  // "compatible" product UA passes while still identifying us
  // honestly. Found 2026-07-08 when the first live search returned
  // empty despite a valid key.
  const res = await fetch(url.toString(), {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; Dreamward/1.0; +https://godreamward.com)",
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `USDA market search failed (${res.status}): ${text.slice(0, 200)}`
    );
  }
  const json = (await res.json()) as unknown;
  // The endpoint has returned both a bare array and a { data: [...] }
  // wrapper across versions — handle both.
  const raw: UsdaRawMarket[] = Array.isArray(json)
    ? (json as UsdaRawMarket[])
    : Array.isArray((json as { data?: unknown })?.data)
      ? ((json as { data: UsdaRawMarket[] }).data)
      : [];

  const markets = raw.map(
    (m, i): UsdaMarket => ({
      id: String(m.listing_id ?? i),
      name: str(m.listing_name) ?? "Farmers market",
      address: str(m.location_address),
      city: str(m.location_city),
      state: str(m.location_state),
      zip: str(m.location_zipcode),
      website: str(m.media_website),
      lat: num(m.location_y),
      lng: num(m.location_x),
    })
  );

  return { markets, near: { place: geo.place, state: geo.state } };
}
