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
  /** "Import from" cutoff (YYYY-MM-DD) or null = all history. Honored by
   *  syncTransactions on both backfill and ongoing sync. */
  importStartDate?: string | null;
}): Promise<void> {
  const { ciphertext, iv, authTag } = encryptForDb(opts.accessToken);
  await pool.query(
    `INSERT INTO plaid_items
       (client_id, item_id, institution_id, institution_name,
        access_token_ciphertext, access_token_iv, access_token_auth_tag,
        environment, status, import_start_date)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active', $9)
     ON CONFLICT (item_id) DO UPDATE SET
       client_id               = EXCLUDED.client_id,
       institution_id          = EXCLUDED.institution_id,
       institution_name        = EXCLUDED.institution_name,
       access_token_ciphertext = EXCLUDED.access_token_ciphertext,
       access_token_iv         = EXCLUDED.access_token_iv,
       access_token_auth_tag   = EXCLUDED.access_token_auth_tag,
       environment             = EXCLUDED.environment,
       status                  = 'active',
       import_start_date       = EXCLUDED.import_start_date,
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
      opts.importStartDate ?? null,
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

export interface SyncResult {
  added: number;
  modified: number;
  removed: number;
  /** True if any new debit rows were inserted — the caller uses this to
   *  decide whether to kick off AI categorization afterward. */
  importedNew: boolean;
}

/**
 * Phase 2: pull new/changed transactions for one item via /transactions/
 * sync and reflect them into processed_items.
 *
 * Expenses-only by design (Jacob's call — avoids double-counting platform
 * payouts that also land as bank deposits): Plaid reports money LEAVING an
 * account as a POSITIVE amount, so we ingest `amount > 0` (debits) and skip
 * deposits entirely. Pending transactions are skipped — we import the
 * posted version when it lands (posted amounts are what bookkeeping needs).
 *
 * Idempotent: rows upsert on (client_id, plaid_transaction_id). A re-sync
 * never duplicates; a Plaid "modified" event refreshes the financial
 * fields but PRESERVES the user's category/status (so a reviewed row isn't
 * reset). "removed" deletes the local row.
 *
 * Imported rows land as category='expense' (umbrella) + status='needs_
 * review', with Plaid's own category in the summary as a hint — the
 * existing reclassifier (lib/reclassify.ts) then suggests the real
 * category, and the user confirms in Transactions.
 */
export async function syncTransactions(opts: {
  clientId: number;
  itemId: string;
}): Promise<SyncResult> {
  const { clientId, itemId } = opts;
  const res = await pool.query(
    `SELECT access_token_ciphertext, access_token_iv, access_token_auth_tag,
            sync_cursor, institution_name,
            import_start_date::text AS import_start_date
       FROM plaid_items
      WHERE client_id = $1 AND item_id = $2`,
    [clientId, itemId]
  );
  const row = res.rows[0];
  if (!row) throw new Error("Plaid item not found");

  const accessToken = decryptFromDb({
    ciphertext: row.access_token_ciphertext,
    iv: row.access_token_iv,
    authTag: row.access_token_auth_tag,
  });
  const institution: string = row.institution_name ?? "bank";
  // "Import from" cutoff: skip transactions dated before it. NULL/absent =
  // all history. Cast to text in SQL so it's a plain YYYY-MM-DD string,
  // comparable to txn.date lexicographically (= chronologically).
  const importStart: string | null = row.import_start_date ?? null;

  const client = getPlaidClient();
  let cursor: string | undefined = row.sync_cursor ?? undefined;
  let added = 0;
  let modified = 0;
  let removed = 0;
  let importedNew = false;

  try {
    // Page through until Plaid says there's nothing more.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const resp = await client.transactionsSync({
        access_token: accessToken,
        cursor,
        count: 250,
      });
      const data = resp.data;

      // added + modified: upsert posted debits; skip pending + deposits.
      for (const txn of [...data.added, ...data.modified]) {
        if (txn.pending) continue;
        if (typeof txn.amount !== "number" || txn.amount <= 0) continue; // deposits / zero
        if (importStart && txn.date < importStart) continue; // before the chosen cutoff
        const pfc = txn.personal_finance_category;
        const summary = `Bank import (${institution}) · Plaid: ${
          pfc ? `${pfc.primary} / ${pfc.detailed}` : "uncategorized"
        }`;
        const result = await pool.query(
          `INSERT INTO processed_items
             (client_id, vendor, amount, due_date, status, category,
              confidence, summary, source, channel,
              plaid_transaction_id, plaid_account_id, plaid_item_id,
              invoice_number, processed_at, updated_at)
           VALUES
             ($1, $2, $3, $4, 'needs_review', 'expense',
              0, $5, 'plaid', NULL,
              $6, $7, $8,
              '', NOW(), NOW())
           ON CONFLICT (client_id, plaid_transaction_id)
             WHERE plaid_transaction_id IS NOT NULL
           DO UPDATE SET
             vendor           = EXCLUDED.vendor,
             amount           = EXCLUDED.amount,
             due_date         = EXCLUDED.due_date,
             summary          = EXCLUDED.summary,
             plaid_account_id = EXCLUDED.plaid_account_id,
             plaid_item_id    = EXCLUDED.plaid_item_id,
             updated_at       = NOW()
           RETURNING (xmax = 0) AS inserted`,
          [
            clientId,
            txn.merchant_name || txn.name || "Unknown",
            txn.amount,
            txn.date,
            summary,
            txn.transaction_id,
            txn.account_id,
            itemId,
          ]
        );
        const wasInsert = result.rows[0]?.inserted === true;
        if (wasInsert) {
          added++;
          importedNew = true;
        } else {
          modified++;
        }
      }

      // removed: delete the local row (tenant-scoped).
      for (const rem of data.removed) {
        if (!rem.transaction_id) continue;
        const del = await pool.query(
          `DELETE FROM processed_items
            WHERE client_id = $1 AND plaid_transaction_id = $2`,
          [clientId, rem.transaction_id]
        );
        removed += del.rowCount ?? 0;
      }

      cursor = data.next_cursor;
      if (!data.has_more) break;
    }

    await pool.query(
      `UPDATE plaid_items
          SET sync_cursor = $1, last_sync_at = NOW(),
              last_sync_status = 'success', last_sync_error = NULL,
              status = 'active', updated_at = NOW()
        WHERE client_id = $2 AND item_id = $3`,
      [cursor ?? null, clientId, itemId]
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : "sync failed";
    await pool.query(
      `UPDATE plaid_items
          SET last_sync_at = NOW(), last_sync_status = 'failed',
              last_sync_error = $1, updated_at = NOW()
        WHERE client_id = $2 AND item_id = $3`,
      [msg.slice(0, 500), clientId, itemId]
    );
    throw err;
  }

  return { added, modified, removed, importedNew };
}

/** Disconnect an item: tell Plaid to invalidate it (best-effort), then
 *  delete the local row. Tenant-scoped on client_id so a user can only
 *  remove their own items. */
export async function disconnectPlaidItem(
  clientId: number,
  itemId: string,
  purgeTransactions = false
): Promise<{ purged: number }> {
  const res = await pool.query(
    `SELECT access_token_ciphertext, access_token_iv, access_token_auth_tag
       FROM plaid_items
      WHERE client_id = $1 AND item_id = $2`,
    [clientId, itemId]
  );
  const row = res.rows[0];
  if (!row) return { purged: 0 }; // nothing to disconnect

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

  // Optionally remove the transactions this bank imported ("delete a wrong
  // import and redo it" + prevents reconnect pileup). Scoped to this item.
  let purged = 0;
  if (purgeTransactions) {
    const del = await pool.query(
      `DELETE FROM processed_items
        WHERE client_id = $1 AND source = 'plaid' AND plaid_item_id = $2`,
      [clientId, itemId]
    );
    purged = del.rowCount ?? 0;
  }

  await pool.query(
    `DELETE FROM plaid_items WHERE client_id = $1 AND item_id = $2`,
    [clientId, itemId]
  );
  return { purged };
}
