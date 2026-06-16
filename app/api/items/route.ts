import { NextRequest, NextResponse } from "next/server";
import { getItems, updateItemStatus, getDashboardSummary } from "@/lib/db";
import { getSessionClient } from "@/lib/getClient";
import pool from "@/lib/db";
import { CANONICAL_CHANNELS } from "@/lib/profitability/channels";

const VALID_CHANNEL_IDS = new Set(CANONICAL_CHANNELS.map((c) => c.id));

export async function GET(request: NextRequest) {
  try {
    const client = await getSessionClient();
    if (!client) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const searchParams = request.nextUrl.searchParams;
    const view = searchParams.get("view");
    if (view === "dashboard") {
      const stats = await getDashboardSummary(client.id);
      return NextResponse.json({ stats: stats.rows });
    }
    const category = searchParams.get("category");
    const result = await getItems(client.id, category || undefined);
    const items = result.rows;
    // Attach receipt/invoice files (id + filename) so the Transactions
    // cards can offer a download. One extra query keyed on the returned
    // item ids; items with none get an empty array.
    if (items.length > 0) {
      const ids = items.map((r) => r.id);
      const att = await pool.query(
        `SELECT id, processed_item_id, filename, mime_type
           FROM expense_attachments
          WHERE client_id = $1 AND processed_item_id = ANY($2)
          ORDER BY uploaded_at ASC, id ASC`,
        [client.id, ids]
      );
      const byItem = new Map<number, { id: number; filename: string; mimeType: string }[]>();
      for (const a of att.rows) {
        const list = byItem.get(a.processed_item_id) ?? [];
        list.push({ id: a.id, filename: a.filename, mimeType: a.mime_type });
        byItem.set(a.processed_item_id, list);
      }
      for (const it of items) it.attachments = byItem.get(it.id) ?? [];
    }
    return NextResponse.json({ items });
  } catch (error) {
    console.error("Error fetching items:", error);
    return NextResponse.json(
      { error: "Failed to fetch items" },
      { status: 500 }
    );
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const client = await getSessionClient();
    if (!client) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const body = await request.json();
    const { id, status, channel } = body;
    if (!id) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }

    // Status-only path delegates to the existing helper (preserves
    // legacy behavior for the dashboard's Pending/Paid/Overdue
    // status toggles).
    if (status !== undefined && channel === undefined) {
      const result = await updateItemStatus(id, status, client.id);
      if (result.rows.length === 0) {
        return NextResponse.json(
          { error: "Item not found" },
          { status: 404 }
        );
      }
      return NextResponse.json({ item: result.rows[0] });
    }

    // Phase 13: channel reclassify path (and optionally combined
    // status + channel). Builds a dynamic SET clause so callers
    // can update one or both fields in a single request.
    const updates: string[] = [];
    const values: unknown[] = [];
    let p = 1;

    if (status !== undefined) {
      updates.push(`status = $${p++}`);
      values.push(status);
    }
    if (channel !== undefined) {
      // Allow null to "clear" the explicit channel and let the
      // classifier re-derive on next read. Otherwise validate
      // against the canonical list — an unknown channel id would
      // route to the "Uncategorized" bucket on the dashboard
      // (technically harmless, but worth surfacing as 400 so
      // the caller knows).
      if (channel === null) {
        updates.push(`channel = NULL`);
      } else {
        if (typeof channel !== "string" || !VALID_CHANNEL_IDS.has(channel as never)) {
          return NextResponse.json(
            { error: "Invalid channel" },
            { status: 400 }
          );
        }
        updates.push(`channel = $${p++}`);
        values.push(channel);
      }
    }

    if (updates.length === 0) {
      return NextResponse.json(
        { error: "No fields to update (provide status and/or channel)" },
        { status: 400 }
      );
    }

    updates.push(`updated_at = NOW()`);

    const result = await pool.query(
      `UPDATE processed_items
          SET ${updates.join(", ")}
        WHERE id = $${p++} AND client_id = $${p++}
        RETURNING id, vendor, amount, status, channel, category`,
      [...values, id, client.id]
    );

    if (result.rowCount === 0) {
      return NextResponse.json(
        { error: "Item not found" },
        { status: 404 }
      );
    }
    return NextResponse.json({ item: result.rows[0] });
  } catch (error) {
    console.error("Error updating item:", error);
    return NextResponse.json(
      { error: "Failed to update item" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const client = await getSessionClient();
    if (!client) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const { id } = await request.json();
    if (!id) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }
    const result = await pool.query(
      "DELETE FROM processed_items WHERE id = $1 AND client_id = $2 RETURNING id",
      [id, client.id]
    );
    if (result.rows.length === 0) {
      return NextResponse.json({ error: "Item not found" }, { status: 404 });
    }
    return NextResponse.json({ deleted: true });
  } catch (error) {
    console.error("Error deleting item:", error);
    return NextResponse.json(
      { error: "Failed to delete item" },
      { status: 500 }
    );
  }
}