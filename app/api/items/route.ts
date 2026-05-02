import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const view = searchParams.get("view");

    if (view === "dashboard") {
      const stats = await pool.query(
        "SELECT category, status, " +
        "COUNT(*) as count, " +
        "SUM(amount) as total " +
        "FROM processed_items " +
        "GROUP BY category, status " +
        "ORDER BY category, status"
      );
      const totals = await pool.query(
        "SELECT COUNT(*) as total_items, " +
        "COALESCE(SUM(amount), 0) as total_amount " +
        "FROM processed_items"
      );
      return NextResponse.json({
        summary: stats.rows,
        totalItems: parseInt(totals.rows[0].total_items),
        totalAmount: parseFloat(totals.rows[0].total_amount),
      });
    }

    const status = searchParams.get("status");
    const category = searchParams.get("category");
    let query = "SELECT * FROM processed_items";
    const conditions: string[] = [];
    const values: string[] = [];

    if (status) {
      conditions.push("status = $" + (values.length + 1));
      values.push(status);
    }
    if (category) {
      conditions.push("category = $" + (values.length + 1));
      values.push(category);
    }
    if (conditions.length > 0) {
      query = query + " WHERE " + conditions.join(" AND ");
    }
    query = query + " ORDER BY processed_at DESC";

    const result = await pool.query(query, values);
    return NextResponse.json({ items: result.rows });
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
    const body = await request.json();
    const { id, status } = body;

    if (!id || !status) {
      return NextResponse.json(
        { error: "Missing required fields: id, status" },
        { status: 400 }
      );
    }

    const valid = ["needs_review", "approved", "rejected", "paid", "pending"];
    if (!valid.includes(status)) {
      return NextResponse.json(
        { error: "Invalid status" },
        { status: 400 }
      );
    }

    const result = await pool.query(
      "UPDATE processed_items " +
      "SET status = $1, updated_at = NOW() " +
      "WHERE id = $2 RETURNING *",
      [status, id]
    );

    if (result.rows.length === 0) {
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
