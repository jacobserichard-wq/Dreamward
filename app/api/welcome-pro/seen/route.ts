import { NextResponse } from "next/server";
import { getSessionClient } from "@/lib/getClient";
import pool from "@/lib/db";

export async function POST() {
  try {
    const client = await getSessionClient();
    if (!client) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    await pool.query(
      "UPDATE clients SET welcome_pro_seen = true, updated_at = NOW() WHERE id = $1",
      [client.id]
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("welcome-pro seen error:", error);
    return NextResponse.json({ error: "Failed to record visit" }, { status: 500 });
  }
}
