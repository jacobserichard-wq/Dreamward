// app/api/plaid/exchange/route.ts
//
// POST /api/plaid/exchange
// Body: { publicToken, institutionId?, institutionName? }
// Exchanges the one-time public_token (from Plaid Link's onSuccess) for
// the long-lived access token, then encrypts + stores it in plaid_items.
// Institution name/id come from Link's onSuccess metadata so we don't
// need an extra Plaid call.

import { NextRequest, NextResponse } from "next/server";
import { getSessionClient } from "@/lib/getClient";
import {
  exchangePublicToken,
  storePlaidItem,
  isPlaidConfigured,
} from "@/lib/plaid";

interface ExchangeBody {
  publicToken?: unknown;
  institutionId?: unknown;
  institutionName?: unknown;
}

export async function POST(req: NextRequest) {
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

    const body = (await req.json().catch(() => null)) as ExchangeBody | null;
    const publicToken =
      typeof body?.publicToken === "string" ? body.publicToken : null;
    if (!publicToken) {
      return NextResponse.json(
        { error: "Missing publicToken" },
        { status: 400 }
      );
    }
    const institutionId =
      typeof body?.institutionId === "string" ? body.institutionId : null;
    const institutionName =
      typeof body?.institutionName === "string" ? body.institutionName : null;

    const { accessToken, itemId } = await exchangePublicToken(publicToken);
    await storePlaidItem({
      clientId: client.id,
      itemId,
      accessToken,
      institutionId,
      institutionName,
    });

    return NextResponse.json({ ok: true, itemId, institutionName });
  } catch (error) {
    console.error("Plaid exchange error:", error);
    return NextResponse.json(
      { error: "Couldn't finish connecting your bank." },
      { status: 500 }
    );
  }
}
