// app/api/plaid/items/route.ts
//
// GET    /api/plaid/items            — list the client's connected banks
// DELETE /api/plaid/items?itemId=... — disconnect one (Plaid item/remove
//                                       + delete the local row)
//
// Tenant-scoped on the session client throughout.

import { NextRequest, NextResponse } from "next/server";
import { getSessionClient } from "@/lib/getClient";
import { listPlaidItems, disconnectPlaidItem } from "@/lib/plaid";

export async function GET() {
  try {
    const client = await getSessionClient();
    if (!client) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const items = await listPlaidItems(client.id);
    return NextResponse.json({ items });
  } catch (error) {
    // Before migration 0028 runs (e.g. a deploy that lands ahead of the
    // migration), the plaid_items table doesn't exist. Degrade to "no
    // banks connected" instead of a 500 so the Integrations page still
    // renders cleanly. 42P01 = undefined_table.
    if (
      error &&
      typeof error === "object" &&
      (error as { code?: string }).code === "42P01"
    ) {
      return NextResponse.json({ items: [] });
    }
    console.error("Plaid items GET error:", error);
    return NextResponse.json(
      { error: "Couldn't load connected banks." },
      { status: 500 }
    );
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const client = await getSessionClient();
    if (!client) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    const itemId = req.nextUrl.searchParams.get("itemId");
    if (!itemId) {
      return NextResponse.json({ error: "Missing itemId" }, { status: 400 });
    }
    // ?purge=true also removes the transactions this bank imported (for
    // "delete a wrong import and redo it"). Default keeps them.
    const purge = req.nextUrl.searchParams.get("purge") === "true";
    const { purged } = await disconnectPlaidItem(client.id, itemId, purge);
    return NextResponse.json({ ok: true, purged });
  } catch (error) {
    console.error("Plaid items DELETE error:", error);
    return NextResponse.json(
      { error: "Couldn't disconnect that bank." },
      { status: 500 }
    );
  }
}
