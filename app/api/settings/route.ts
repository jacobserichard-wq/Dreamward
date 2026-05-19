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

    // Phase 5 commit 8: parallel-fetch the per-client settings row AND the
    // global app_settings row for the IRS mileage rate. rateSource is the
    // honesty flag — same one /api/profitability returns — so the Settings
    // UI can render the "default rate" indicator next to the edit field
    // when migration 0006's seed is missing.
    const [settingsResult, appSettingResult] = await Promise.all([
      pool.query(
        `SELECT active_modules, custom_categories, preferences FROM client_settings WHERE client_id = $1`,
        [client.id]
      ),
      pool.query<{ value: string }>(
        `SELECT value FROM app_settings WHERE key = 'irs_mileage_rate'`
      ),
    ]);

    const industry = (client.industry ?? "other") as Industry;
    const industryDefaults = getCategoryNamesForIndustry(industry);

    const irsRateRaw = appSettingResult.rows[0]?.value;
    const parsedRate = irsRateRaw == null ? NaN : Number(irsRateRaw);
    const hasConfiguredRate = Number.isFinite(parsedRate) && parsedRate > 0;
    const irsMileageRate = hasConfiguredRate ? parsedRate : 0.7;
    const rateSource: "config" | "fallback" = hasConfiguredRate
      ? "config"
      : "fallback";

    return NextResponse.json({
      settings: settingsResult.rows[0] || { active_modules: null, custom_categories: null, preferences: null },
      plan: client.plan,
      industry: client.industry,
      businessName: client.business_name,
      industryDefaults,
      // Phase 4: home address lives on clients (not client_settings) since
      // it's a client attribute, not a per-feature preference. Returned
      // here so the Settings UI has a single GET to load all its fields.
      homeAddress: client.home_address ?? null,
      irsMileageRate,
      rateSource,
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
    const { activeModules, customCategories, preferences, homeAddress, irsMileageRate } = body;

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

    // Phase 5 commit 8: IRS mileage rate edit. The rate is federal (not
    // per-client), so writes hit the global app_settings table. Any user
    // changing it affects all clients — by design (the IRS publishes one
    // figure per year). Defensive validation: must be a positive finite
    // number under $10/mi (sanity ceiling — the IRS rate has historically
    // been $0.50–$0.75/mi, and a 100× bigger value almost certainly means
    // the user typed cents instead of dollars).
    if (irsMileageRate !== undefined) {
      const rate = Number(irsMileageRate);
      if (!Number.isFinite(rate) || rate <= 0 || rate > 10) {
        return NextResponse.json(
          { error: "IRS mileage rate must be a positive number (dollars per mile)" },
          { status: 400 }
        );
      }
      await pool.query(
        `INSERT INTO app_settings (key, value, updated_at)
              VALUES ('irs_mileage_rate', $1, NOW())
         ON CONFLICT (key) DO UPDATE
              SET value = EXCLUDED.value, updated_at = NOW()`,
        [rate.toFixed(4)]
      );
    }

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