// lib/plaid.ts
//
// Plaid bank-feed (Phase 1). Thin wrapper around the Plaid Node SDK +
// the plaid_items table (migration 0028). Holds the connect-flow
// helpers: create a Link token, exchange a public token, and
// store/list/disconnect a connected item.
//
// Token handling mirrors the other integrations: the Plaid access
// token is encrypted at rest with lib/crypto.ts (AES-256-GCM) and the
// three components live in plaid_items.access_token_{ciphertext,iv,
// auth_tag}. Plaid access tokens are long-lived (no refresh / expiry).
//
// Env vars (set by the operator — sandbox first):
//   PLAID_CLIENT_ID, PLAID_SECRET, PLAID_ENV ("sandbox" | "production").
//
// Phase 2 will add transaction sync (/transactions/sync, debits-only)
// on top of this — getPlaidClient() + the stored token are the seams.

import {
  Configuration,
  PlaidApi,
  PlaidEnvironments,
  Products,
  CountryCode,
} from "plaid";
import pool from "@/lib/db";
import { encryptForDb, decryptFromDb } from "@/lib/crypto";

export type PlaidEnv = "sandbox" | "production";

/** Resolve PLAID_ENV, defaulting to sandbox. Throws on an unknown value
 *  rather than silently falling back (avoids pointing sandbox creds at
 *  production or vice-versa). */
export function plaidEnv(): PlaidEnv {
  const raw = (process.env.PLAID_ENV ?? "sandbox").toLowerCase();
  if (raw !== "sandbox" && raw !== "production") {
    throw new Error(
      `PLAID_ENV must be "sandbox" or "production" (got "${raw}").`
    );
  }
  return raw;
}

/** True when the Plaid credentials are present. Routes use this to
 *  return a clean "not configured" error instead of a 500. */
export function isPlaidConfigured(): boolean {
  return Boolean(process.env.PLAID_CLIENT_ID && process.env.PLAID_SECRET);
}

/** Build a Plaid API client from env. Fresh each call so a credential
 *  rotation takes effect without a redeploy (cheap — just an axios
 *  wrapper). Throws a clear config error if creds are missing. */
export function getPlaidClient(): PlaidApi {
  const clientId = process.env.PLAID_CLIENT_ID;
  const secret = process.env.PLAID_SECRET;
  if (!clientId || !secret) {
    throw new Error(
      "Plaid is not configured. Set PLAID_CLIENT_ID and PLAID_SECRET " +
        "(and optionally PLAID_ENV) in the environment."
    );
  }
  const configuration = new Configuration({
    basePath: PlaidEnvironments[plaidEnv()],
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": clientId,
        "PLAID-SECRET": secret,
      },
    },
  });
  return new PlaidApi(configuration);
}

/** Create a short-lived Link token for the Plaid Link flow. We only
 *  request the Transactions product — the bank feed is the use case. */
export async function createLinkToken(clientId: number): Promise<string> {
  const resp = await getPlaidClient().linkTokenCreate({
    user: { client_user_id: String(clientId) },
    client_name: "Dreamward",
    products: [Products.Transactions],
    country_codes: [CountryCode.Us],
    language: "en",
  });
  return resp.data.link_token;
}

/** Exchange the one-time public_token (from Link's onSuccess) for the
 *  long-lived access token + the item_id. */
export async function exchangePublicToken(
  publicToken: string
): Promise<{ accessToken: string; itemId: string }> {
  const resp = await getPlaidClient().itemPublicTokenExchange({
    public_token: publicToken,
  });
  return { accessToken: resp.data.access_token, itemId: resp.data.item_id };
}

/** Encrypt + upsert a connected item. Institution name/id come from
 *  Link's onSuccess metadata (no extra Plaid call). Upsert on item_id
 *  makes a re-link of the same item idempotent. */
export async function storePlaidItem(opts: {
  clientId: number;
  itemId: string;
  accessToken: string;
  institutionId: string | null;
  institutionName: string | null;
}): Promise<void> {
  const { ciphertext, iv, authTag } = encryptForDb(opts.accessToken);
  await pool.query(
    `INSERT INTO plaid_items
       (client_id, item_id, institution_id, institution_name,
        access_token_ciphertext, access_token_iv, access_token_auth_tag,
        environment, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active')
     ON CONFLICT (item_id) DO UPDATE SET
       client_id               = EXCLUDED.client_id,
       institution_id          = EXCLUDED.institution_id,
       institution_name        = EXCLUDED.institution_name,
       access_token_ciphertext = EXCLUDED.access_token_ciphertext,
       access_token_iv         = EXCLUDED.access_token_iv,
       access_token_auth_tag   = EXCLUDED.access_token_auth_tag,
       environment             = EXCLUDED.environment,
       status                  = 'active',
       updated_at              = NOW()`,
    [
      opts.clientId,
      opts.itemId,
      opts.institutionId,
      opts.institutionName,
      ciphertext,
      iv,
      authTag,
      plaidEnv(),
    ]
  );
}

export interface PlaidItemSummary {
  id: number;
  itemId: string;
  institutionName: string | null;
  status: string;
  lastSyncAt: string | null;
  lastSyncStatus: string | null;
  connectedAt: string;
  environment: string;
}

/** List a client's connected items for the integrations UI. Never
 *  returns the token columns. */
export async function listPlaidItems(
  clientId: number
): Promise<PlaidItemSummary[]> {
  const res = await pool.query(
    `SELECT id, item_id, institution_name, status, last_sync_at,
            last_sync_status, connected_at, environment
       FROM plaid_items
      WHERE client_id = $1
      ORDER BY connected_at DESC`,
    [clientId]
  );
  return res.rows.map((r) => ({
    id: r.id,
    itemId: r.item_id,
    institutionName: r.institution_name,
    status: r.status,
    lastSyncAt: r.last_sync_at,
    lastSyncStatus: r.last_sync_status,
    connectedAt: r.connected_at,
    environment: r.environment,
  }));
}

/** Disconnect an item: tell Plaid to invalidate it (best-effort), then
 *  delete the local row. Tenant-scoped on client_id so a user can only
 *  remove their own items. */
export async function disconnectPlaidItem(
  clientId: number,
  itemId: string
): Promise<void> {
  const res = await pool.query(
    `SELECT access_token_ciphertext, access_token_iv, access_token_auth_tag
       FROM plaid_items
      WHERE client_id = $1 AND item_id = $2`,
    [clientId, itemId]
  );
  const row = res.rows[0];
  if (!row) return; // nothing to disconnect

  try {
    const accessToken = decryptFromDb({
      ciphertext: row.access_token_ciphertext,
      iv: row.access_token_iv,
      authTag: row.access_token_auth_tag,
    });
    await getPlaidClient().itemRemove({ access_token: accessToken });
  } catch {
    // Plaid removal failed (already gone, bad token, Plaid down) — still
    // delete the local row so the user can re-connect cleanly.
  }

  await pool.query(
    `DELETE FROM plaid_items WHERE client_id = $1 AND item_id = $2`,
    [clientId, itemId]
  );
}
