import { NextRequest, NextResponse } from "next/server";
import { getSessionClient } from "@/lib/getClient";
import { saveProcessedItem } from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    const client = await getSessionClient();
    if (!client) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { rows } = await req.json();
    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: "No rows to import" }, { status: 400 });
    }

    const results = [];
    for (const row of rows) {
      const saved = await saveProcessedItem(
        {
          vendor: row.vendor || "Unknown",
          invoice_number: row.invoice_number || null,
          amount: row.amount || 0,
          due_date: row.due_date || null,
          status: "needs_review",
          category: row.category || "expense",
          confidence: row.confidence || 0,
          summary: row.description || null,
          raw_email_id: null,
          extracted_data: null,
          source: "csv_import",
        },
        client.id
      );
      if (saved.rows?.[0]) results.push(saved.rows[0]);
    }

    return NextResponse.json({
      success: true,
      imported: results.length,
    });
  } catch (error) {
    console.error("Import confirm error:", error);
    return NextResponse.json(
      { error: "Import failed" },
      { status: 500 }
    );
  }
}