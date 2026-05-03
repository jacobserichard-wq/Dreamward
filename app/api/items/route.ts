import { NextRequest, NextResponse } from "next/server";
import { getItems, updateItemStatus, getDashboardSummary } from "@/lib/db";

// TODO: Replace with session-based client lookup
const CLIENT_ID = 1;

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const view = searchParams.get("view");

    if (view === "dashboard") {
      const stats = await getDashboardSummary(CLIENT_ID);
      return NextResponse.json({ stats: stats.rows });
    }

    const category = searchParams.get("category");
    const result = await getItems(CLIENT_ID, category || undefined);
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
        { error: "Missing id or status" },
        { status: 400 }
      );
    }

    const result = await updateItemStatus(id, status, CLIENT_ID);

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