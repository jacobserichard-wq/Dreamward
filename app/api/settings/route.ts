import { NextRequest, NextResponse } from "next/server";
import { getSessionClient } from "@/lib/getClient";
import pool from "@/lib/db";
import { getCategoryNamesForIndustry, type Industry } from "@/lib/categories";
import { computeRoundTripMiles } from "@/lib/distance";

export async function GET() {
  try {
    const client = await getSessionClient();
    if (!client) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const result = await pool.query(
      `SELECT active_modules, custom_categories, preferences FROM client_settings WHERE client_id = $1`,
      [client.id]
    );

    const industry = (client.industry ?? "other") as Industry;
    const industryDefaults = getCategoryNamesForIndustry(industry);

    return NextResponse.json({
      settings: result.rows[0] || { active_modules: null, custom_categories: null, preferences: null },
      plan: client.plan,
      industry: client.industry,
      businessName: client.business_name,
      industryDefaults,
      // Phase 4: home address lives on clients (not client_settings) since
      // it's a client attribute, not a per-feature preference. Returned
      // here so the Settings UI has a single GET to load all its fields.
      homeAddress: client.home_address ?? null,
    });
  } catch (error) {
    console.error("Settings GET error:", error);
    return NextResponse.json({ error: "Failed to load settings" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const client = await getSessionClient();
    if (!client) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const body = await req.json();
    const { activeModules, customCategories, preferences, homeAddress } = body;

    await pool.query(
      `INSERT INTO client_settings (client_id, active_modules, custom_categories, preferences)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (client_id)
       DO UPDATE SET
         active_modules = COALESCE($2, client_settings.active_modules),
         custom_categories = COALESCE($3, client_settings.custom_categories),
         preferences = COALESCE($4, client_settings.preferences)`,
      [
        client.id,
        activeModules ? JSON.stringify(activeModules) : null,
        customCategories ? JSON.stringify(customCategories) : null,
        preferences ? JSON.stringify(preferences) : null,
      ]
    );

    // Phase 4: home address change. Only handles the field when it's
    // explicitly in the body (undefined means "no change"). null/""
    // clears the address (and clears mileage on all events — they
    // can't be computed without a home address).
    let recomputedEventCount = 0;
    if (homeAddress !== undefined) {
      const newHomeAddress =
        typeof homeAddress === "string" && homeAddress.trim().length > 0
          ? homeAddress.trim()
          : null;
      await pool.query(
        `UPDATE clients SET home_address = $1, updated_at = NOW() WHERE id = $2`,
        [newHomeAddress, client.id]
      );

      // Recompute mileage for every one of this client's events that has
      // an address. Closes the events-before-address ordering gap (design
      // §5). Parallelize the maps API calls via Promise.all — bounded by
      // event count (typically <20 per active vendor), well within API
      // rate limits. When newHomeAddress is null, skip the API and just
      // null out round_trip_miles on every event (stale value cleared
      // since it can't be computed without a home).
      const eventsResult = await pool.query<{ id: number; address: string | null }>(
        `SELECT id, address FROM events
          WHERE client_id = $1 AND address IS NOT NULL AND address <> ''`,
        [client.id]
      );
      if (newHomeAddress === null) {
        // Clear mileage on all events — can't compute without home.
        if (eventsResult.rowCount && eventsResult.rowCount > 0) {
          await pool.query(
            `UPDATE events
                SET round_trip_miles = NULL, mileage_computed_at = NULL
              WHERE client_id = $1 AND address IS NOT NULL`,
            [client.id]
          );
          recomputedEventCount = eventsResult.rowCount;
        }
      } else {
        const computations = await Promise.all(
          eventsResult.rows.map(async (event) => ({
            id: event.id,
            miles: event.address
              ? await computeRoundTripMiles(newHomeAddress, event.address)
              : null,
          }))
        );
        const now = new Date();
        for (const { id, miles } of computations) {
          await pool.query(
            `UPDATE events
                SET round_trip_miles = $1, mileage_computed_at = $2
              WHERE id = $3 AND client_id = $4`,
            [miles, miles !== null ? now : null, id, client.id]
          );
        }
        recomputedEventCount = computations.length;
      }
    }

    return NextResponse.json({ success: true, recomputedEventCount });
  } catch (error) {
    console.error("Settings PATCH error:", error);
    return NextResponse.json({ error: "Failed to update settings" }, { status: 500 });
  }
}