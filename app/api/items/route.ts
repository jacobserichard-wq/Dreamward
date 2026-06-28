import { NextRequest, NextResponse } from "next/server";
import { getItems, updateItemStatus, getDashboardSummary } from "@/lib/db";
import { getSessionClient } from "@/lib/getClient";
import pool from "@/lib/db";
import { CANONICAL_CHANNELS } from "@/lib/profitability/channels";
import { reverseSaleAdjustments } from "@/lib/inventory/adjustments";

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

      // Attach the products (line items) sold on each transaction so the
      // cards can show what was sold + link to each SKU. Most rows have
      // none; sales with products get one entry per line.
      const li = await pool.query<{
        processed_item_id: number;
        name: string;
        quantity: string;
        unit_price: string;
        matched_sku_id: number | null;
        cogs_amount: string | null;
      }>(
        `SELECT processed_item_id, name, quantity, unit_price,
                matched_sku_id, cogs_amount
           FROM processed_item_line_items
          WHERE client_id = $1 AND processed_item_id = ANY($2)
          ORDER BY id ASC`,
        [client.id, ids]
      );
      const liByItem = new Map<
        number,
        {
          name: string;
          quantity: number;
          unitPrice: number;
          matchedSkuId: number | null;
          cogsAmount: number | null;
        }[]
      >();
      for (const r of li.rows) {
        const list = liByItem.get(r.processed_item_id) ?? [];
        list.push({
          name: r.name,
          quantity: Number(r.quantity),
          unitPrice: Number(r.unit_price),
          matchedSkuId: r.matched_sku_id,
          cogsAmount: r.cogs_amount != null ? Number(r.cogs_amount) : null,
        });
        liByItem.set(r.processed_item_id, list);
      }
      for (const it of items) it.lineItems = liByItem.get(it.id) ?? [];
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
    // Restore inventory for any sale line items BEFORE deleting. The FK
    // cascades line items away and SET-NULLs the ledger rows, which would
    // otherwise leave stock permanently drawn — reverseSaleAdjustments
    // credits qty back, restores the FIFO layers, and removes the ledger
    // rows. Wrapped in one transaction so the reverse + delete are atomic.
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      const liRes = await db.query<{ id: number }>(
        `SELECT id FROM processed_item_line_items
          WHERE processed_item_id = $1 AND client_id = $2`,
        [id, client.id]
      );
      const lineItemIds = liRes.rows.map((r) => r.id);
      if (lineItemIds.length > 0) {
        await reverseSaleAdjustments({ dbClient: db, lineItemIds });
      }
      const result = await db.query(
        "DELETE FROM processed_items WHERE id = $1 AND client_id = $2 RETURNING id",
        [id, client.id]
      );
      if (result.rows.length === 0) {
        await db.query("ROLLBACK");
        return NextResponse.json({ error: "Item not found" }, { status: 404 });
      }
      await db.query("COMMIT");
      return NextResponse.json({
        deleted: true,
        stockRestored: lineItemIds.length,
      });
    } catch (txErr) {
      await db.query("ROLLBACK").catch(() => {});
      throw txErr;
    } finally {
      db.release();
    }
  } catch (error) {
    console.error("Error deleting item:", error);
    return NextResponse.json(
      { error: "Failed to delete item" },
      { status: 500 }
    );
  }
}