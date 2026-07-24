// app/api/shopify/billing/confirm/route.ts
//
// Shopify App Pricing welcome link (configured per-plan in the
// Partner dashboard). After a merchant approves the plan charge on
// Shopify's hosted page, Shopify redirects them here with
// ?plan_handle=<handle>&shop=<domain>.
//
// PUBLIC route (left out of proxy.ts matcher): the merchant arrives
// from the Shopify admin and may have no Dreamward session. The URL
// params are UNTRUSTED (no HMAC on this redirect) — they only tell
// us which shop to check; the actual subscription state comes from
// the Partner API, which spoofed params can't influence. Worst case
// a stranger triggers a re-verification of a shop's real status.

import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { normalizeShopDomain } from "@/lib/shopify";
import { getShopifyAccessToken } from "@/lib/shopifyToken";
import {
  ensureShopGid,
  getActiveSubscription,
} from "@/lib/shopifyAppPricing";

export async function GET(req: NextRequest) {
  const shopDomain = normalizeShopDomain(
    req.nextUrl.searchParams.get("shop") ?? ""
  );
  const dest = new URL("/integrations", req.url);
  if (!shopDomain) {
    dest.searchParams.set("error", "Missing shop parameter on billing confirmation.");
    return NextResponse.redirect(dest);
  }

  try {
    const connRes = await pool.query<{ id: number; client_id: number | null }>(
      `SELECT id, client_id FROM shopify_connections WHERE shop_domain = $1`,
      [shopDomain]
    );
    const conn = connRes.rows[0];
    if (!conn || conn.client_id === null) {
      // Approved a plan before finishing the bind (shouldn't happen —
      // we only send merchants to the plan page after binding), but
      // route them into the normal pending flow rather than erroring.
      const signin = new URL("/signin", req.url);
      signin.searchParams.set(
        "callbackUrl",
        `/integrations?shopify_pending=${encodeURIComponent(shopDomain)}`
      );
      return NextResponse.redirect(signin);
    }

    const accessToken = await getShopifyAccessToken(conn.id);
    const shopGid = await ensureShopGid({
      connectionId: conn.id,
      shopDomain,
      accessToken,
    });
    const sub = await getActiveSubscription(shopGid);
    if (sub) {
      await pool.query(
        `UPDATE clients SET billing_source = 'shopify', plan = 'shopify' WHERE id = $1`,
        [conn.client_id]
      );
      await pool.query(
        `UPDATE shopify_connections
            SET subscription_plan_handle = $1,
                subscription_trial_ends_at = $2,
                subscription_checked_at = NOW(),
                updated_at = NOW()
          WHERE id = $3`,
        [sub.planHandle, sub.trialEndsAt, conn.id]
      );
      dest.searchParams.set("billing", "active");
    } else {
      // Redirected here but the Partner API says no active contract —
      // approval may still be settling; the cron re-check will catch
      // it. Send them on without claiming success.
      dest.searchParams.set("billing", "pending");
    }
  } catch (err) {
    console.error("Shopify billing confirm failed:", err);
    dest.searchParams.set(
      "error",
      "Couldn't verify your Shopify subscription yet — we'll re-check automatically."
    );
  }
  return NextResponse.redirect(dest);
}
