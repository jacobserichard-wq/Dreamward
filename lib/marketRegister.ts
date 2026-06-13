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

export type MarketCounty = "Lake" | "Porter" | "LaPorte";

export interface MarketEntry {
  id: string;
  name: string;
  city: string;
  county: MarketCounty;
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
    county: "Lake",
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
    county: "Lake",
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
    county: "Lake",
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
    county: "Porter",
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
    county: "Porter",
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
    county: "Porter",
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
    county: "Porter",
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
    county: "Porter",
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
    county: "LaPorte",
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
    county: "LaPorte",
    schedule: "Saturdays, 8am–1pm",
    season: "May–September",
    venue: "Uptown Arts District (8th & Washington St), Michigan City, IN",
    sourceName: "Indiana Dunes",
    sourceUrl: "https://www.indianadunes.com/shopping/farmers-markets/",
    applyUrl: "https://www.facebook.com/farmersmarketmichigancity",
    vendorNote:
      "Producers-only — apply via the market's Facebook page (no public form found).",
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

export const MARKET_COUNTIES: readonly MarketCounty[] = [
  "Lake",
  "Porter",
  "LaPorte",
];
