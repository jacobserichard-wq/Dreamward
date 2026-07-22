// app/api/shopify/bind/route.ts
//
// App Store install claim step (2026-07-21). POST endpoint that links
// a PENDING Shopify connection (client_id NULL — created by the OAuth
// callback when a merchant installed from Shopify with no Dreamward
// session) to the signed-in Dreamward account.
//
// Mirrors app/api/wix/bind: the SESSION authorizes the claim — never
// the shop's say-so alone. The flow that gets here:
//   Shopify Install → /api/shopify/install → OAuth → callback stores
//   pending row → /signin?callbackUrl=/integrations?shopify_pending=X
//   → /integrations auto-POSTs here with {shop: X}.
//
// On success: binds the row, registers webhooks (needs the decrypted
// token), and fire-and-forgets the backfill kickoff — the same
// post-connect work the warm callback path does.
//
// Conflicts:
//   - shop pending? → bind it (the normal case)
//   - shop already bound to THIS client → idempotent success
//   - shop bound to a DIFFERENT client → 409
//   - this client already has a different store (UNIQUE client_id) → 409

import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { getSessionClient } from "@/lib/getClient";
import {
  normalizeShopDomain,
  subscribeWebhook,
  SHOPIFY_WEBHOOK_TOPICS,
} from "@/lib/shopify";
import { getShopifyAccessToken } from "@/lib/shopifyToken";
import { isPayingTier } from "@/lib/plans";
import { normalizeImportStartDate } from "@/lib/importRange";

interface PendingRow {
  id: number;
  client_id: number | null;
}

export async function POST(req: NextRequest) {
  const client = await getSessionClient();
  if (!client) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  if (!isPayingTier(client.plan)) {
    return NextResponse.json(
      { error: "Shopify integration is a Pro feature." },
      { status: 403 }
    );
  }

  // ── Parse input ───────────────────────────────────────────────
  let shopDomain: string | null = null;
  let importStartDate: string | null = null;
  try {
    const body = (await req.json()) as {
      shop?: unknown;
      importStartDate?: unknown;
    };
    shopDomain = normalizeShopDomain(
      typeof body.shop === "string" ? body.shop : ""
    );
    importStartDate = normalizeImportStartDate(body.importStartDate);
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!shopDomain) {
    return NextResponse.json(
      { error: "Missing or invalid shop domain" },
      { status: 400 }
    );
  }

  // ── Locate the pending row + conflict checks ──────────────────
  const found = await pool.query<PendingRow>(
    `SELECT id, client_id
       FROM shopify_connections WHERE shop_domain = $1`,
    [shopDomain]
  );
  if (found.rows.length === 0) {
    return NextResponse.json(
      {
        error:
          "No install found for that store. Install Dreamward from your Shopify admin first.",
      },
      { status: 404 }
    );
  }
  const row = found.rows[0];
  if (row.client_id === client.id) {
    return NextResponse.json({ bound: true, alreadyBound: true });
  }
  if (row.client_id !== null) {
    return NextResponse.json(
      {
        error:
          "That Shopify store is already connected to a different Dreamward account.",
      },
      { status: 409 }
    );
  }

  // ── Claim it ──────────────────────────────────────────────────
  try {
    await pool.query(
      `UPDATE shopify_connections
          SET client_id = $1,
              import_start_date = COALESCE($2, import_start_date),
              updated_at = NOW()
        WHERE id = $3 AND client_id IS NULL`,
      [client.id, importStartDate, row.id]
    );
  } catch (err) {
    // Most likely UNIQUE(client_id): this account already has a store.
    console.error("Shopify bind: claim failed:", err);
    const msg =
      err instanceof Error && err.message.includes("unique")
        ? "You already have a Shopify store connected. Disconnect it first."
        : "Couldn't link the store. Please try again.";
    return NextResponse.json({ error: msg }, { status: 409 });
  }

  // ── Post-bind work: webhooks + backfill (mirrors warm callback) ─
  // Best-effort — failures logged, never block the bind. Daily
  // reconciliation cron compensates for missed webhooks.
  try {
    const accessToken = await getShopifyAccessToken(row.id);
    const webhookAddress = new URL("/api/shopify/webhook", req.url).toString();
    const webhookIds: string[] = [];
    for (const topic of SHOPIFY_WEBHOOK_TOPICS) {
      try {
        const { id } = await subscribeWebhook({
          shopDomain,
          accessToken,
          topic,
          address: webhookAddress,
        });
        webhookIds.push(id);
      } catch (err) {
        console.warn(`Bind: webhook subscribe failed for ${topic}:`, err);
      }
    }
    if (webhookIds.length > 0) {
      await pool.query(
        `UPDATE shopify_connections
            SET webhook_subscription_ids = $1, updated_at = NOW()
          WHERE id = $2`,
        [webhookIds, row.id]
      );
    }
  } catch (err) {
    console.warn("Bind: webhook registration block failed:", err);
  }

  try {
    const backfillUrl = new URL("/api/shopify/backfill", req.url);
    const cookieHeader = req.headers.get("cookie") ?? "";
    fetch(backfillUrl.toString(), {
      method: "POST",
      headers: { cookie: cookieHeader },
    }).catch((err) =>
      console.warn("Bind: backfill kickoff failed (UI will retry):", err)
    );
  } catch (err) {
    console.warn("Bind: backfill kickoff exception:", err);
  }

  return NextResponse.json({ bound: true, shop: shopDomain });
}
