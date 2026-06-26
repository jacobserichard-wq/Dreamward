// lib/stripeConnect.ts
//
// Stripe CONNECT — read a Dreamward customer's OWN Stripe account so the
// charges they collect from their buyers flow in as income (channel
// 'stripe'). Entirely separate from the platform BILLING Stripe
// (lib/stripe.ts, subscriptions). We use Connect Standard OAUTH: the
// customer authorizes read access to their existing account; we then read
// their charges with the PLATFORM key + the `Stripe-Account` header.
//
// Connect Standard access tokens DON'T expire (unlike Square's 30-day
// tokens), so there's no refresh machinery — connect once, read until the
// customer deauthorizes.
//
// Requires env STRIPE_CONNECT_CLIENT_ID (ca_…) — the platform's Connect
// OAuth client id, set up in the Stripe Dashboard → Connect. Reuses the
// platform STRIPE_SECRET_KEY (the existing `stripe` client) for the code
// exchange + reads, so test-vs-live follows that key.

import type Stripe from "stripe";
import { stripe } from "./stripe";
import type { InternalLineItem } from "./cogs/lineItems";

const CONNECT_CLIENT_ID = process.env.STRIPE_CONNECT_CLIENT_ID;

/** Build the Connect OAuth authorize URL the customer is sent to. `state`
 *  is the CSRF/identity token we verify on the callback.
 *
 *  Scope is `read_write` because Stripe doesn't grant the `read_only` scope
 *  without per-platform approval ("Please use the read_write scope…"). We
 *  only ever READ charges — the integration never writes to the customer's
 *  account — but the OAuth grant has to request read_write to connect. */
export function buildConnectAuthorizeUrl(opts: {
  state: string;
  redirectUri: string;
}): string {
  if (!CONNECT_CLIENT_ID) {
    throw new Error("STRIPE_CONNECT_CLIENT_ID not configured");
  }
  const params = new URLSearchParams({
    response_type: "code",
    client_id: CONNECT_CLIENT_ID,
    scope: "read_write",
    redirect_uri: opts.redirectUri,
    state: opts.state,
  });
  return `https://connect.stripe.com/oauth/authorize?${params.toString()}`;
}

export interface ConnectTokenResult {
  stripeAccountId: string; // acct_… — the connected account
  accessToken: string; // long-lived; stored encrypted for deauthorize/fallback
  scope: string | null;
  livemode: boolean;
}

/** Exchange the OAuth `code` from the callback for the connected account's
 *  identity + access token. */
export async function exchangeConnectCode(
  code: string
): Promise<ConnectTokenResult> {
  const resp = await stripe.oauth.token({
    grant_type: "authorization_code",
    code,
  });
  if (!resp.stripe_user_id || !resp.access_token) {
    throw new Error("Stripe OAuth token response missing account id / token");
  }
  return {
    stripeAccountId: resp.stripe_user_id,
    accessToken: resp.access_token,
    scope: resp.scope ?? null,
    livemode: resp.livemode ?? false,
  };
}

/** Revoke our access to a connected account (the disconnect path). */
export async function deauthorizeConnect(accountId: string): Promise<void> {
  if (!CONNECT_CLIENT_ID) {
    throw new Error("STRIPE_CONNECT_CLIENT_ID not configured");
  }
  await stripe.oauth.deauthorize({
    client_id: CONNECT_CLIENT_ID,
    stripe_user_id: accountId,
  });
}

/** The connected account's display name, for the connection card. Best-
 *  effort — returns null on failure (the card falls back to the acct id). */
export async function fetchConnectedAccountName(
  accountId: string
): Promise<string | null> {
  try {
    const acct = await stripe.accounts.retrieve(accountId);
    return (
      acct.business_profile?.name ||
      acct.settings?.dashboard?.display_name ||
      acct.email ||
      null
    );
  } catch {
    return null;
  }
}

/** One page of charges for a connected account, newest-first. Reads via the
 *  platform key + Stripe-Account header. `startingAfter` is the previous
 *  page's last charge id (Stripe cursor pagination); `createdGte` limits to
 *  charges on/after a unix timestamp (incremental sync). */
export async function listConnectedCharges(opts: {
  accountId: string;
  startingAfter?: string | null;
  limit?: number;
  createdGte?: number;
}): Promise<{ charges: Stripe.Charge[]; hasMore: boolean }> {
  const res = await stripe.charges.list(
    {
      limit: Math.min(opts.limit ?? 100, 100),
      ...(opts.startingAfter ? { starting_after: opts.startingAfter } : {}),
      ...(opts.createdGte ? { created: { gte: opts.createdGte } } : {}),
    },
    { stripeAccount: opts.accountId }
  );
  return { charges: res.data, hasMore: res.has_more };
}

/** True when a charge is real income we should ingest: succeeded + paid +
 *  not fully refunded. */
export function isIngestibleCharge(charge: Stripe.Charge): boolean {
  return (
    charge.status === "succeeded" &&
    charge.paid === true &&
    (charge.amount_captured ?? charge.amount) - (charge.amount_refunded ?? 0) > 0
  );
}

/** Map a Stripe charge → one Dreamward income line item. A charge has no
 *  itemization (line items live on checkout sessions/invoices), so each
 *  charge is a single line item — net of any refunds, in major units. It
 *  carries no SKU, so it lands unmatched (the maker can map it later). */
export function chargeToLineItem(charge: Stripe.Charge): InternalLineItem {
  const captured = charge.amount_captured ?? charge.amount ?? 0;
  const net = (captured - (charge.amount_refunded ?? 0)) / 100;
  const name =
    charge.description ||
    charge.calculated_statement_descriptor ||
    charge.statement_descriptor ||
    "Stripe charge";
  return {
    externalId: charge.id,
    externalItemId: null,
    externalSku: null,
    name,
    quantity: 1,
    unitPrice: net,
    currency: (charge.currency || "usd").toUpperCase(),
  };
}

/** Unix-seconds created timestamp → ISO date, for the parent transaction's
 *  sold/recognized date. */
export function chargeSoldAtIso(charge: Stripe.Charge): string {
  return new Date((charge.created ?? 0) * 1000).toISOString();
}

export interface MappedStripeChargeRow {
  vendor: string;
  invoice_number: string;
  amount: number;
  due_date: string; // YYYY-MM-DD
  status: string; // 'paid'
  category: string; // 'Sales' (recognized as income by the classifier)
  source: string; // 'stripe'
  source_ref_id: string; // charge id — dedup key with (client_id, source)
  channel: string; // 'stripe'
  confidence: number;
  summary: string;
  extracted_data: Record<string, unknown>;
}

/** Map a Stripe charge → the processed_items (parent transaction) row.
 *  Mirrors mapPaymentToProcessedItem (Square). Only called for ingestible
 *  charges, so status is always 'paid'. Amount is net of refunds. */
export function chargeToProcessedItem(charge: Stripe.Charge): MappedStripeChargeRow {
  const card = charge.payment_method_details?.card;
  let vendor = "Stripe customer";
  if (charge.billing_details?.email) vendor = charge.billing_details.email;
  else if (charge.receipt_email) vendor = charge.receipt_email;
  else if (card?.last4) vendor = `${card.brand ?? "Card"} ending in ${card.last4}`;

  const dueDate = chargeSoldAtIso(charge).slice(0, 10);
  const captured = charge.amount_captured ?? charge.amount ?? 0;
  const net = (captured - (charge.amount_refunded ?? 0)) / 100;
  const currency = (charge.currency || "usd").toUpperCase();
  const invoiceNumber = charge.receipt_number
    ? `#${charge.receipt_number}`
    : `#${charge.id.slice(-8)}`;

  return {
    vendor,
    invoice_number: invoiceNumber,
    amount: net,
    due_date: dueDate,
    status: "paid",
    category: "Sales",
    source: "stripe",
    source_ref_id: charge.id,
    channel: "stripe",
    confidence: 100,
    summary: `Stripe charge ${invoiceNumber} — ${currency} ${net.toFixed(2)}`,
    extracted_data: {
      stripe_charge_id: charge.id,
      receipt_number: charge.receipt_number ?? null,
      receipt_url: charge.receipt_url ?? null,
      currency,
      amount_cents: charge.amount ?? 0,
      amount_captured_cents: captured,
      amount_refunded_cents: charge.amount_refunded ?? 0,
      stripe_status: charge.status,
      payment_intent:
        typeof charge.payment_intent === "string" ? charge.payment_intent : null,
      customer: typeof charge.customer === "string" ? charge.customer : null,
      billing_email: charge.billing_details?.email ?? null,
      card_brand: card?.brand ?? null,
      card_last4: card?.last4 ?? null,
      description: charge.description ?? null,
    },
  };
}
