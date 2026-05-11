import { NextRequest, NextResponse } from "next/server";
import { getSessionClient } from "@/lib/getClient";
import pool from "@/lib/db";
import { getCategoryNamesForIndustry, type Industry } from "@/lib/categories";

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

    const { activeModules, customCategories, preferences } = await req.json();

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

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Settings PATCH error:", error);
    return NextResponse.json({ error: "Failed to update settings" }, { status: 500 });
  }
}