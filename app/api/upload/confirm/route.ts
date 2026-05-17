import { NextRequest, NextResponse } from "next/server";
import { getSessionClient } from "@/lib/getClient";
import pool, { saveProcessedItem } from "@/lib/db";

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

    // Phase 3 sub-session 17: defense-in-depth event-id verification.
    // /api/upload already verifies any incoming eventId belongs to this
    // client and the CsvReviewModal dropdown (commit 8) only lists this
    // client's events. But the request body is user-controllable, so
    // batch-verify here too before inserting — any row.event_id that
    // doesn't belong to this client is silently nulled out. Starter
    // clients have event_id nulled regardless (Events is plan-gated;
    // design §6).
    const isStarterGated = client.plan === "starter";
    const validEventIds = new Set<number>();
    if (!isStarterGated) {
      const distinctEventIds = new Set<number>();
      for (const row of rows) {
        if (
          typeof row.event_id === "number" &&
          Number.isInteger(row.event_id) &&
          row.event_id > 0
        ) {
          distinctEventIds.add(row.event_id);
        }
      }
      if (distinctEventIds.size > 0) {
        const verify = await pool.query<{ id: number }>(
          `SELECT id FROM events WHERE id = ANY($1) AND client_id = $2`,
          [Array.from(distinctEventIds), client.id]
        );
        for (const r of verify.rows) validEventIds.add(r.id);
      }
    }

    const results = [];
    for (const row of rows) {
      const eventId =
        !isStarterGated && validEventIds.has(row.event_id)
          ? row.event_id
          : null;
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
          ai_classified_at: new Date(),
          ai_model: "claude-sonnet-4-20250514",
          event_id: eventId,
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