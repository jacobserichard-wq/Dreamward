// app/api/plaid/link-token/route.ts
//
// POST /api/plaid/link-token
// Creates a short-lived Plaid Link token for the signed-in client. The
// browser hands this to Plaid Link (react-plaid-link) to open the
// connect flow. Returns 503 when Plaid creds aren't configured so the
// UI can show a clean "not set up yet" state instead of a 500.

import { NextResponse } from "next/server";
import { getSessionClient } from "@/lib/getClient";
import { createLinkToken, isPlaidConfigured } from "@/lib/plaid";

export async function POST() {
  try {
    const client = await getSessionClient();
    if (!client) {
      return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    }
    if (!isPlaidConfigured()) {
      return NextResponse.json(
        { error: "Bank connections aren't set up yet." },
        { status: 503 }
      );
    }
    const linkToken = await createLinkToken(client.id);
    return NextResponse.json({ linkToken });
  } catch (error) {
    console.error("Plaid link-token error:", error);
    return NextResponse.json(
      { error: "Couldn't start the bank connection." },
      { status: 500 }
    );
  }
}
