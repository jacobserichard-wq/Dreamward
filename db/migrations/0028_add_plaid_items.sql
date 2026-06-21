-- 0028_add_plaid_items.sql
-- Plaid bank-feed (Phase 1). One row per connected Plaid "item" (a
-- single institution login, which may expose several accounts). Holds
-- the encrypted Plaid access token + /transactions/sync cursor + sync
-- bookkeeping per Dreamward client.
--
-- Mirrors the other integration connection tables (shopify 0010,
-- square 0016, etsy 0024) and reuses lib/crypto.ts (AES-256-GCM) for
-- the access token, with Plaid-specific differences:
--
--   - Plaid access tokens are LONG-LIVED: no refresh token, no
--     expiry. They stay valid until the item is removed or enters an
--     error state (e.g. ITEM_LOGIN_REQUIRED) that forces a re-link.
--     So: only one encrypted token, no *_expires_at / refresh columns.
--   - A client may connect MULTIPLE items (two different banks), so
--     we DON'T UNIQUE on client_id the way the single-account platform
--     integrations do. UNIQUE is on item_id (globally unique in Plaid),
--     which also enables idempotent upsert on re-exchange.
--   - sync_cursor stores the /transactions/sync pagination cursor
--     (NULL until the first sync; advanced after each successful page).
--   - environment ('sandbox' | 'development' | 'production') lets a
--     single Dreamward user connect a sandbox item during dev.
--
-- Apply via:
--   node --env-file=.env.local scripts/run-migration.mjs \
--     db/migrations/0028_add_plaid_items.sql
--
-- Verify with:
--   SELECT column_name, data_type
--     FROM information_schema.columns
--    WHERE table_name = 'plaid_items'
--    ORDER BY ordinal_position;
--
-- Rollback (additive, safe):
--   DROP INDEX IF EXISTS idx_plaid_items_client;
--   DROP TABLE IF EXISTS plaid_items;
--
-- Idempotency: CREATE TABLE/INDEX IF NOT EXISTS. Re-running is safe.

CREATE TABLE IF NOT EXISTS plaid_items (
  id                        INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  client_id                 INTEGER NOT NULL REFERENCES clients(id),

  -- Plaid identifiers for this connected item (one institution login)
  item_id                   TEXT NOT NULL,          -- Plaid item_id (globally unique)
  institution_id            TEXT,                   -- Plaid institution id
  institution_name          TEXT,                   -- friendly name for the card UI

  -- Encrypted Plaid access token. Long-lived (no expiry / refresh) —
  -- valid until the item is removed or errors and needs a re-link.
  access_token_ciphertext   BYTEA NOT NULL,
  access_token_iv           BYTEA NOT NULL,
  access_token_auth_tag     BYTEA NOT NULL,

  -- /transactions/sync pagination cursor. NULL until the first sync.
  sync_cursor               TEXT,

  -- Sync state (mirrors the other integrations)
  connected_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_sync_at              TIMESTAMPTZ,
  last_sync_status          TEXT,   -- 'success' | 'partial' | 'failed' | 'in_progress' | NULL
  last_sync_error           TEXT,

  -- Lifecycle: 'active' | 'error' (login required, etc.) | 'disconnected'
  status                    TEXT NOT NULL DEFAULT 'active',

  -- 'sandbox' | 'development' | 'production'
  environment               TEXT NOT NULL DEFAULT 'sandbox',

  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- A given Plaid item is connected once. Clients may have several
  -- items (different banks), so no UNIQUE(client_id) here.
  UNIQUE (item_id)
);

CREATE INDEX IF NOT EXISTS idx_plaid_items_client
  ON plaid_items (client_id);
