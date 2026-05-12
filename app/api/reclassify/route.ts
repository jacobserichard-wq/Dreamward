import { NextResponse } from "next/server";
import { getSessionClient } from "@/lib/getClient";
import { reclassifyClientItems } from "@/lib/reclassify";
import { type Industry } from "@/lib/categories";

export async function POST() {
  try {
    const client = await getSessionClient();
    if (!client) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const industry = (client.industry ?? "other") as Industry;
    const result = await reclassifyClientItems(client.id, industry);
    return NextResponse.json({
      reclassified: result.reclassified,
      remaining: result.remaining,
      total: result.total,
    });
  } catch (error: unknown) {
    console.error("Reclassify error:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Reclassify failed: ${errorMessage}` },
      { status: 500 }
    );
  }
}
