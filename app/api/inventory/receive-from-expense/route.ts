// app/api/inventory/receive-from-expense/route.ts
//
// Bridge between the bank/expense feed and component inventory. Given a
// purchase (expense processed_item) + a component SKU + the quantity that
// purchase bought, it:
//   1. adds that quantity to the component's stock (a "receive" adjustment),
//   2. sets the component's per-unit cost = amount / quantity (effective the
//      purchase date) so per-unit COGS/margin reflects what was paid,
//   3. refreshes the rolled-up cost of any products using this component,
//   4. links the expense (received_sku_id) so it can't be received twice.
//
// PURELY inventory/margin-side: the expense itself is untouched, so it still
// counts as the cash-basis cost in Total Sales − Total Expenses = Net Profit.
// No double-count — the per-unit cost feeds the margin view only.
//
// POST { transactionId, skuId, quantity } → { quantityOnHand, unitCost }

import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getSessionClient } from "@/lib/getClient";
import { isPayingTier } from "@/lib/plans";
import { receiveExpenseIntoInventory } from "@/lib/inventory/receiveFromExpense";

interface Body {
  transactionId?: unknown;
  skuId?: unknown;
  quantity?: unknown;
}

export async function POST(req: NextRequest) {
  try {
    const client = await getSessionClient();
    if (!client) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    if (!isPayingTier(client.plan)) {
      return NextResponse.json(
        { error: "This feature requires an active subscription." },
        { status: 403 }
      );
    }

    const body = (await req.json().catch(() => null)) as Body | null;
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const transactionId = Number(body.transactionId);
    const skuId = Number(body.skuId);
    const quantity = Number(body.quantity);
    if (!Number.isInteger(transactionId) || transactionId <= 0) {
      return NextResponse.json({ error: "Invalid transaction" }, { status: 400 });
    }
    if (!Number.isInteger(skuId) || skuId <= 0) {
      return NextResponse.json({ error: "Pick a component" }, { status: 400 });
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return NextResponse.json(
        { error: "Quantity must be a positive number" },
        { status: 400 }
      );
    }

    // Load the purchase row (tenant-scoped) + guard against double-receive.
    const txn = await pool.query<{
      amount: string;
      vendor: string | null;
      due_date: string;
      received_sku_id: number | null;
    }>(
      `SELECT amount, vendor, due_date::text AS due_date, received_sku_id
         FROM processed_items
        WHERE id = $1 AND client_id = $2`,
      [transactionId, client.id]
    );
    if (txn.rowCount === 0) {
      return NextResponse.json({ error: "Transaction not found" }, { status: 404 });
    }
    if (txn.rows[0].received_sku_id != null) {
      return NextResponse.json(
        { error: "This transaction is already received into inventory." },
        { status: 409 }
      );
    }

    // Validate the component belongs to this client.
    const sku = await pool.query<{ id: number }>(
      `SELECT id FROM skus WHERE id = $1 AND client_id = $2`,
      [skuId, client.id]
    );
    if (sku.rowCount === 0) {
      return NextResponse.json({ error: "Component not found" }, { status: 400 });
    }

    const amount = Number(txn.rows[0].amount) || 0;
    const effectiveDate = txn.rows[0].due_date;
    const vendor = txn.rows[0].vendor || "purchase";

    // Receive + set cost + relink, all in one transaction so a crash can't
    // half-apply (stock up but no cost, or vice versa).
    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      const result = await receiveExpenseIntoInventory({
        dbClient: db,
        clientId: client.id,
        processedItemId: transactionId,
        skuId,
        quantity,
        amount,
        vendor,
        effectiveDate,
      });
      await db.query("COMMIT");
      return NextResponse.json(result);
    } catch (txErr) {
      await db.query("ROLLBACK").catch(() => {});
      throw txErr;
    } finally {
      db.release();
    }
  } catch (err) {
    console.error("Receive-from-expense error:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error ? err.message : "Failed to receive into inventory",
      },
      { status: 500 }
    );
  }
}
