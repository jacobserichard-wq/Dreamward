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
    await disconnectPlaidItem(client.id, itemId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Plaid items DELETE error:", error);
    return NextResponse.json(
      { error: "Couldn't disconnect that bank." },
      { status: 500 }
    );
  }
}
