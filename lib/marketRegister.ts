// lib/marketRegister.ts
//
// Dreamward Market Register — a curated directory of recurring
// vendor/farmers markets in Northwest Indiana (Lake / Porter /
// LaPorte counties). Powers the /markets discovery page, where a
// vendor can browse markets near them and one-click "Add to my
// events" to start tracking one.
//
// DATA HONESTY (important — see [[feedback_silent_fallbacks]]):
//   - These are RECURRING markets whose day-of-week + season are
//     stable year to year. We deliberately do NOT hardcode specific
//     calendar dates, booth fees, or anything that drifts — every
//     entry carries a sourceUrl so the vendor verifies current
//     details before showing up. The page says so plainly.
//   - Compiled June 2026 from public listings (South Shore CVA,
//     Indiana Dunes tourism, NWI Times, town/market sites). If a
//     market moves or closes, fix it here — this is the single
//     source of truth for the register.
//   - One-off seasonal craft & holiday fairs change every year, so
//     we point to live aggregators (CRAFT_FAIR_SOURCES) instead of
//     freezing dates we can't keep current.

// 2026-07-08 build-out: the register grew past NWI, so "county"
// became "region". The three NWI counties keep county-style labels;
// new regions are broader buckets. Add a region here + entries below
// + it appears as a filter pill automatically.
export type MarketRegion =
  | "Lake"
  | "Porter"
  | "LaPorte"
  | "Chicagoland"
  | "Greater Indiana";

/** Filter-pill label. NWI counties read as counties; regions as-is. */
export function regionLabel(r: MarketRegion): string {
  return r === "Lake" || r === "Porter" || r === "LaPorte"
    ? `${r} County`
    : r;
}

export interface MarketEntry {
  id: string;
  name: string;
  city: string;
  region: MarketRegion;
  /** Two-letter state — the register now crosses into Illinois. */
  state: "IN" | "IL";
  /** Day(s) + time, e.g. "Saturdays, 8am–2pm". Verify at source. */
  schedule: string;
  /** Active season, e.g. "May–October". */
  season: string;
  /** Venue/address when published — used to prefill the event form
   *  and shown on the card. null when the source didn't give one. */
  venue: string | null;
  /** Short, durable note (not dates/fees). */
  note?: string;
  sourceName: string;
  sourceUrl: string;
  // ── Vendor application (researched per market, June 2026) ───────
  // Only set when a real "become a vendor / apply" page was found.
  // Omitted (undefined) when the market only takes applications by
  // contact or none could be confirmed — we never link a guessed
  // apply button (see [[feedback_silent_fallbacks]]).
  applyUrl?: string;
  /** Email or phone to apply when there's no online form. */
  vendorContact?: string;
  /** Durable vendor note — juried? booth-fee ballpark? — kept free
   *  of specific dates that drift. */
  vendorNote?: string;
}

export const MARKET_REGISTER: readonly MarketEntry[] = [
  // ── Lake County (closest to Cedar Lake / Crown Point) ──────────
  {
    id: "highland-farmers",
    name: "Highland Farmers Market",
    city: "Highland",
    region: "Lake", state: "IN",
    schedule: "Weekly, afternoons (3–7:30pm)",
    season: "May–September",
    venue: "Municipal Parking Lot, 2730 Highway Ave, Highland, IN",
    sourceName: "South Shore CVA",
    sourceUrl:
      "https://www.southshorecva.com/things-to-do/farm-to-fork/farmers-markets/",
    vendorNote:
      "Run by Highland Parks & Recreation — no public application form found; contact the department to apply.",
  },
  {
    id: "hobart-summer-market",
    name: "Summer Market on the Lake",
    city: "Hobart",
    region: "Lake", state: "IN",
    schedule: "Thursdays, 4–9pm",
    season: "June–August",
    venue: "Festival Park, 111 E. Old Ridge Rd, Hobart, IN",
    note: "Evening market — good foot traffic after work.",
    sourceName: "South Shore CVA",
    sourceUrl:
      "https://www.southshorecva.com/things-to-do/farm-to-fork/farmers-markets/",
    applyUrl: "https://www.cityofhobart.org/207/Summer-Market-on-the-Lake",
    vendorContact: "hobartevents@cityofhobart.org",
    vendorNote:
      "Juried — submit a new application each year with product photos.",
  },
  {
    id: "merrillville-farms",
    name: "Merrillville Farms",
    city: "Hobart",
    region: "Lake", state: "IN",
    schedule: "Seasonal — see source for hours",
    season: "Summer–Fall",
    venue: "Hobart, IN",
    note: "Established produce farm stand serving Lake & Porter counties.",
    sourceName: "merrillvillefarms.com",
    sourceUrl: "https://merrillvillefarms.com/",
    vendorNote:
      "Farm stand selling its own produce — not a rent-a-booth vendor market.",
  },

  // ── Porter County ──────────────────────────────────────────────
  {
    id: "valparaiso-market",
    name: "Valparaiso Farmers Market",
    city: "Valparaiso",
    region: "Porter", state: "IN",
    schedule: "Tuesdays & Saturdays, 9am–1pm",
    season: "June–October",
    venue: "Urschel Pavilion, Central Park Plaza, 63 Lafayette St, Valparaiso, IN",
    sourceName: "South Shore CVA",
    sourceUrl:
      "https://www.southshorecva.com/things-to-do/farm-to-fork/farmers-markets/",
    applyUrl: "https://www.centralparkplazavalpo.com/2234/Valparaiso-Market",
    vendorContact: "market@valpo.us",
    vendorNote: "Apply through Valpo Parks — application emailed to the market.",
  },
  {
    id: "chesterton-european-market",
    name: "Chesterton European Market",
    city: "Chesterton",
    region: "Porter", state: "IN",
    schedule: "Saturdays, 8am–2pm",
    season: "May–October",
    venue: "Downtown Chesterton, IN",
    note: "Long-running, well-attended artisan + produce market.",
    sourceName: "Indiana Dunes",
    sourceUrl: "https://www.indianadunes.com/shopping/farmers-markets/",
    applyUrl: "https://www.dunelandchamber.org/european-market-applications/",
    vendorNote:
      "Juried — ballpark ~$50 per market for a 10×10 booth (confirm on the application).",
  },
  {
    id: "coffee-creek-market",
    name: "Coffee Creek Farmers Market",
    city: "Chesterton",
    region: "Porter", state: "IN",
    schedule: "Wednesdays, 3–7pm",
    season: "April–November",
    venue: "2300 Village Point, Chesterton, IN",
    sourceName: "Indiana Dunes",
    sourceUrl: "https://www.indianadunes.com/shopping/farmers-markets/",
    applyUrl: "https://www.coffeecreekfarmersmarket.org/vendor-application",
    vendorNote:
      "Separate application tracks for farms, artisans (1st/3rd/5th Wed), and wellness vendors.",
  },
  {
    id: "portage-market-on-the-square",
    name: "Market on the Square",
    city: "Portage",
    region: "Porter", state: "IN",
    schedule: "Fridays, 4–9pm",
    season: "June–September",
    venue: "Founders Square, 6300 W Main St, Portage, IN",
    note: "70+ artisans, farmers, and food trucks — busy evening market.",
    sourceName: "Town Planner NWI",
    sourceUrl: "https://www.townplanner.com/event/571922/",
    applyUrl:
      "https://www.inportageparks.com/492/Market-on-the-Square-Fridays-at-Founders",
    vendorNote:
      "Season pass ~$37/wk for craft, ~$52/wk for food when paid up front.",
  },
  {
    id: "edge-of-liberty-valpo",
    name: "Edge of Liberty Market",
    city: "Valparaiso",
    region: "Porter", state: "IN",
    schedule: "Sundays (every other), May–Halloween",
    season: "May–October",
    venue: "606 N Calumet Ave, Valparaiso, IN",
    note: "Craft fair + garden walk — handmade goods and farm-fresh products.",
    sourceName: "edge-of-liberty.com",
    sourceUrl: "https://edge-of-liberty.com/",
    applyUrl: "https://edge-of-liberty.com/craft-fairs",
    vendorContact: "theedgeoflibertyin@gmail.com",
  },

  // ── LaPorte County ─────────────────────────────────────────────
  {
    id: "laporte-farmers",
    name: "LaPorte Farmers Market (Farmed & Forged)",
    city: "LaPorte",
    region: "LaPorte", state: "IN",
    schedule: "Sundays, 11am–2pm",
    season: "May–September",
    venue: "Monroe St (Washington–Lincolnway), Downtown LaPorte, IN",
    note: "Rebranded as 'Farmed & Forged,' run by The Collective.",
    sourceName: "Indiana Dunes",
    sourceUrl: "https://www.indianadunes.com/shopping/farmers-markets/",
    applyUrl: "https://www.thecollectivein.com/fandf",
    vendorContact: "events@thecollectivein.com",
    vendorNote:
      "Producers/makers only — farmers, artisans, foragers, restaurants, breweries.",
  },
  {
    id: "michigan-city-farmers",
    name: "Michigan City Farmers Market",
    city: "Michigan City",
    region: "LaPorte", state: "IN",
    schedule: "Saturdays, 8am–1pm",
    season: "May–September",
    venue: "Uptown Arts District (8th & Washington St), Michigan City, IN",
    sourceName: "Indiana Dunes",
    sourceUrl: "https://www.indianadunes.com/shopping/farmers-markets/",
    applyUrl: "https://www.facebook.com/farmersmarketmichigancity",
    vendorNote:
      "Producers-only — apply via the market's Facebook page (no public form found).",
  },

  // ── Chicagoland (researched July 2026 — NWI vendors work these) ──
  {
    id: "frankfort-country-market",
    name: "Frankfort Country Market",
    city: "Frankfort",
    region: "Chicagoland", state: "IL",
    schedule: "Sundays, mornings–early afternoon",
    season: "Late April–October",
    venue: "Downtown Frankfort, IL (Breidert Green area)",
    note: "One of the south suburbs' largest Sunday markets.",
    sourceName: "Village of Frankfort",
    sourceUrl:
      "https://www.frankfortil.org/business/country_market/become_a_vendor.php",
    applyUrl:
      "https://www.frankfortil.org/business/country_market/become_a_vendor.php",
    vendorNote:
      "Application + insurance certificate + rules acceptance required; apply via the Village site.",
  },
  {
    id: "homewood-farmers-market",
    name: "Homewood Farmers Market",
    city: "Homewood",
    region: "Chicagoland", state: "IL",
    schedule: "Saturdays, mornings",
    season: "Late May–October",
    venue: "Downtown Homewood, IL (Martin Ave)",
    sourceName: "Village of Homewood",
    sourceUrl:
      "https://www.village.homewood.il.us/community/events/homewood-s-farmers-market",
    vendorNote:
      "Vendor applications open in winter and close early (2026's closed Feb 28) — plan a season ahead.",
  },
  {
    id: "orland-park-market",
    name: "Market at the Park",
    city: "Orland Park",
    region: "Chicagoland", state: "IL",
    schedule: "Thursdays, 4–8pm",
    season: "June–August",
    venue: "Centennial Park West, Orland Park, IL",
    note: "Evening market — after-work crowd.",
    sourceName: "LocalHarvest",
    sourceUrl: "https://www.localharvest.org/orland-park-il/farmers-markets",
    vendorNote:
      "No public application form found — contact the Village of Orland Park to vend.",
  },
  {
    id: "green-city-market",
    name: "Green City Market",
    city: "Chicago",
    region: "Chicagoland", state: "IL",
    schedule: "Wednesdays & Saturdays, mornings",
    season: "Year-round (outdoor Lincoln Park; indoor in winter)",
    venue: "Lincoln Park, Chicago, IL",
    note: "Chicago's flagship sustainable market — high traffic, juried.",
    sourceName: "Green City Market",
    sourceUrl: "https://www.greencitymarket.org/",
    applyUrl:
      "https://www.greencitymarket.org/visit-our-markets/become-a-vendor",
    vendorContact: "farmersupport@greencitymarket.org",
    vendorNote:
      "Producer-only + juried. Farmers need third-party certification; prepared-food makers are exempt from farm certification but must make everything themselves.",
  },
  {
    id: "chicago-city-markets",
    name: "Chicago Farmers Markets (citywide program)",
    city: "Chicago",
    region: "Chicagoland", state: "IL",
    schedule: "Multiple locations & days (Daley Plaza + neighborhoods)",
    season: "May–October",
    venue: "Various — see the city program page",
    note: "One application covers the city-run markets.",
    sourceName: "City of Chicago DCASE",
    sourceUrl:
      "https://www.chicago.gov/city/en/depts/dca/supp_info/markets2.html",
    applyUrl:
      "https://www.chicago.gov/city/en/depts/dca/supp_info/markets2.html",
    vendorNote:
      "Free to apply; open to farmers, food entrepreneurs, and artisans with locally made goods.",
  },

  // ── Greater Indiana anchors (researched July 2026) ───────────────
  {
    id: "broad-ripple-farmers",
    name: "Broad Ripple Farmers Market",
    city: "Indianapolis",
    region: "Greater Indiana", state: "IN",
    schedule: "Saturdays, 8am–noon (summer)",
    season: "Year-round (outdoor May–Oct; indoor Nov–Apr)",
    venue: "Broad Ripple, Indianapolis, IN",
    note: "Indiana's largest — 80+ vendors in summer.",
    sourceName: "Broad Ripple Cultural District",
    sourceUrl: "https://www.broadrippleindy.org/farmers-market/",
    applyUrl:
      "https://www.broadrippleindy.org/farmers-market-vendor-application/",
    vendorNote:
      "Food products only (human food). Summer market is often FULL — the inquiry form is a waitlist for vacancies.",
  },
  {
    id: "south-bend-farmers",
    name: "South Bend Farmers Market",
    city: "South Bend",
    region: "Greater Indiana", state: "IN",
    schedule: "Multiple days weekly (see source)",
    season: "Year-round (historic indoor market house)",
    venue: "1105 Northside Blvd, South Bend, IN",
    note: "Operating since 1911 — permanent indoor stalls.",
    sourceName: "South Bend Farmers Market",
    sourceUrl: "http://southbendfarmersmarket.com/vendors/",
    applyUrl: "http://southbendfarmersmarket.com/vendors/",
    vendorNote:
      "Permanent + daily stall options at the market house — see the vendors page for stall availability.",
  },
] as const;

// One-off craft & holiday fairs (Crown Point, Valparaiso, etc.)
// change dates every year — point to live aggregators rather than
// freeze a list that goes stale. Shown as a "find seasonal fairs"
// strip on the register page.
export interface CraftFairSource {
  name: string;
  blurb: string;
  url: string;
}

export const CRAFT_FAIR_SOURCES: readonly CraftFairSource[] = [
  {
    name: "Town Planner — NWI Festivals & Fairs",
    blurb: "100+ festivals, craft shows, and vendor fairs across NW Indiana.",
    url: "https://www.townplanner.com/event/730107/",
  },
  {
    name: "PanoramaNOW — Art & Craft Shows",
    blurb: "Searchable craft-show calendar for the region.",
    url: "https://panoramanow.com/art-and-craft-shows/",
  },
  {
    name: "Eventbrite — Northwest Indiana",
    blurb: "Date-filterable listings — spot upcoming market dates.",
    url: "https://www.eventbrite.com/d/in--valparaiso/northwest-indiana/",
  },
  {
    name: "Indiana Grown — State Directory",
    blurb: "The state Dept. of Agriculture's official farmers-market registry.",
    url: "https://indianagrown.org/find-local-businesses/member-directory/?category=farmers+market",
  },
];

export const MARKET_REGIONS: readonly MarketRegion[] = [
  "Lake",
  "Porter",
  "LaPorte",
  "Chicagoland",
  "Greater Indiana",
];
