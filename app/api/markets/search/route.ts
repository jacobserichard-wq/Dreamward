// app/api/markets/search/route.ts
//
// National farmers-market search for the /markets page. Proxies the
// USDA Local Food Portal directory (see lib/usdaMarkets). Public —
// the /markets page is a public discovery surface.
//
// GET /api/markets/search?zip=46303&radius=30
//   → { configured: true, markets: UsdaMarket[], near, radius }
//   → { configured: false, fallbackUrl } when USDA_API_KEY isn't set
//     yet (key is requested from USDA — the UI links out meanwhile)

import { NextRequest, NextResponse } from "next/server";
import { searchUsdaMarkets, isUsdaConfigured } from "@/lib/usdaMarkets";

// USDA directory front-end — where the UI sends people until the API
// key is configured (and as a "see all" escape hatch).
const USDA_DIRECTORY =
  "https://www.usdalocalfoodportal.com/fe/fdirectory_farmersmarket/";

export async function GET(req: NextRequest) {
  const zip = (req.nextUrl.searchParams.get("zip") ?? "").trim();
  const radiusRaw = req.nextUrl.searchParams.get("radius");
  const radius = radiusRaw
    ? Math.min(100, Math.max(5, Number(radiusRaw) || 30))
    : 30;

  if (!/^\d{5}$/.test(zip)) {
    return NextResponse.json(
      { error: "Enter a 5-digit US zip code." },
      { status: 400 }
    );
  }

  // Key not granted yet → tell the UI to link out to the USDA
  // directory so the feature is useful immediately.
  if (!isUsdaConfigured()) {
    return NextResponse.json({
      configured: false,
      fallbackUrl: USDA_DIRECTORY,
    });
  }

  try {
    const { markets, near } = await searchUsdaMarkets({ zip, radius });
    return NextResponse.json({ configured: true, markets, near, radius });
  } catch (err) {
    console.error("USDA market search error:", err);
    return NextResponse.json(
      {
        error:
          "Couldn't reach the USDA market directory right now. Try again in a moment.",
      },
      { status: 502 }
    );
  }
}
