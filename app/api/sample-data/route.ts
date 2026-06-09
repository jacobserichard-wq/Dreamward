import { NextResponse } from "next/server";
import { getSessionClient } from "@/lib/getClient";
import { saveProcessedItem } from "@/lib/db";
import pool from "@/lib/db";
import { getSampleData } from "@/lib/sampleData";
import { isPayingTier } from "@/lib/plans";

export async function POST() {
  try {
    const client = await getSessionClient();
    if (!client) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    if (!isPayingTier(client.plan)) {
      return NextResponse.json({ error: "Pro plan required" }, { status: 403 });
    }

    const items = getSampleData(client.industry || "other");
    let inserted = 0;
    for (const item of items) {
      await saveProcessedItem({ ...item, source: "sample" }, client.id);
      inserted++;
    }

    return NextResponse.json({ inserted });
  } catch (error) {
    console.error("Sample data load error:", error);
    return NextResponse.json({ error: "Failed to load sample data" }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const client = await getSessionClient();
    if (!client) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const result = await pool.query(
      "DELETE FROM processed_items WHERE client_id = $1 AND source = 'sample' RETURNING id",
      [client.id]
    );

    return NextResponse.json({ deleted: result.rowCount || 0 });
  } catch (error) {
    console.error("Sample data delete error:", error);
    return NextResponse.json({ error: "Failed to clear sample data" }, { status: 500 });
  }
}
