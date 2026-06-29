import { NextRequest, NextResponse } from "next/server";
import { getSessionClient } from "@/lib/getClient";
import pool, { saveProcessedItem } from "@/lib/db";
import { deriveStorageChannel } from "@/lib/profitability/channels";
import { isPayingTier } from "@/lib/plans";
import { AI_MODEL } from "@/lib/aiModel";

export async function POST(req: NextRequest) {
  try {
    const client = await getSessionClient();
    if (!client) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }

    const { rows, source: importSource } = await req.json();
    if (!rows || !Array.isArray(rows) || rows.length === 0) {
      return NextResponse.json({ error: "No rows to import" }, { status: 400 });
    }
    // Where these rows came from — tabular CSV/XLSX vs PDF invoice
    // extraction. Stamped on each saved row's `source` for telemetry +
    // future filtering. Defaults to csv_import for back-compat.
    const source = importSource === "pdf_import" ? "pdf_import" : "csv_import";

    // Phase 3 sub-session 17: defense-in-depth event-id verification.
    // /api/upload already verifies any incoming eventId belongs to this
    // client and the CsvReviewModal dropdown (commit 8) only lists this
    // client's events. But the request body is user-controllable, so
    // batch-verify here too before inserting — any row.event_id that
    // doesn't belong to this client is silently nulled out.
    // Sub-session 33 pricing pivot: every paying tier gets Events,
    // so only non-paying (canceled) users have event_id nulled.
    const eventsGated = !isPayingTier(client.plan);
    const validEventIds = new Set<number>();
    if (!eventsGated) {
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
        !eventsGated && validEventIds.has(row.event_id)
          ? row.event_id
          : null;
      // Sub-session 32 polish: pre-derive the channel from category
      // + event_id so the Processed-tab card UI matches the dashboard
      // rollup. Without this, every CSV row inserts with channel=null
      // and displays "Uncategorized" even when the classifier already
      // routes it to Markets/Wholesale/etc. behind the scenes.
      const category = row.category || "expense";
      const derivedChannel = deriveStorageChannel({
        category,
        event_id: eventId,
      });
      const saved = await saveProcessedItem(
        {
          vendor: row.vendor || "Unknown",
          invoice_number: row.invoice_number || null,
          amount: row.amount || 0,
          due_date: row.due_date || null,
          status: "needs_review",
          category,
          confidence: row.confidence || 0,
          summary: row.description || null,
          raw_email_id: null,
          extracted_data: null,
          source,
          ai_classified_at: new Date(),
          ai_model: AI_MODEL,
          event_id: eventId,
          channel: derivedChannel,
        },
        client.id
      );
      if (saved.rows?.[0]) results.push(saved.rows[0]);
    }

    return NextResponse.json({
      success: true,
      imported: results.length,
      // Created row ids in insert order — the PDF-upload client uses
      // ids[0] to attach the original invoice file to its transaction.
      ids: results.map((r) => r.id),
    });
  } catch (error) {
    console.error("Import confirm error:", error);
    return NextResponse.json(
      { error: "Import failed" },
      { status: 500 }
    );
  }
}