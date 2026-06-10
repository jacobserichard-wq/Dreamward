-- 0013_add_wix_connections.sql
-- Phase 10a (Wix Stores Integration). Sub-session 25 follow-up
-- commit 1 of ~5 in 10a.
--
-- One new table (wix_connections) holding the encrypted OAuth
-- tokens per Dreamward client + sync state + backfill bookkeeping.
-- Mirrors the Phase 8 shopify_connections schema with a few Wix-
-- specific differences:
--
--   - Wix uses OAuth 2.0 with REFRESH TOKENS (Shopify tokens are
--     permanent). We store BOTH access_token (short-lived ~5min)
--     and refresh_token (long-lived) encrypted; access_token_expires_at
--     drives the refresh-before-use logic in lib/wix.ts.
--   - Wix identifies sites by an `instance_id` UUID rather than a
--     domain. site_display_name is for the UI (e.g., "Acme Shop").
--   - Otherwise: same backfill bookkeeping pattern + same webhook
--     subscription tracking + same disconnect cleanup pattern.
--
-- Notes:
--   - Token storage uses the same AES-256-GCM scheme + the same
--     SHOPIFY_TOKEN_ENCRYPTION_KEY env var (the var name is a misnomer
--     now that we have multi-integration tokens; renaming would
--     require a key-rotation script. Defer to a future sub-session
--     when we add Etsy/Square.)
--   - UNIQUE(client_id) enforces "one Wix site per Dreamward client"
--     in v1 (multi-site is v2; matches Phase 8 decision 4.2).
--   - UNIQUE(instance_id) prevents the same Wix site from being
--     connected to two Dreamward accounts simultaneously.
--   - Plan gating: NOT enforced at DB layer. API routes will gate
--     on client.plan === 'pro' (matches Shopify Pro-gating).
--
-- Apply via:
--   node --env-file=.env.local scripts/run-migration.mjs \
--     db/migrations/0013_add_wix_connections.sql
--
-- Verify with:
--   SELECT column_name, data_type
--     FROM information_schema.columns
--    WHERE table_name = 'wix_connections'
--    ORDER BY ordinal_position;
-- Expected: ~18-20 columns.
--
-- Rollback (additive, safe):
--   DROP INDEX IF EXISTS idx_wix_connections_instance;
--   DROP TABLE IF EXISTS wix_connections;
--
-- Idempotency: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT
-- EXISTS throughout. Re-running is safe.

CREATE TABLE IF NOT EXISTS wix_connections (
  id                              INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  client_id                       INTEGER NOT NULL REFERENCES clients(id),

  -- Identity of the connected Wix site
  instance_id                     TEXT NOT NULL,         -- Wix App Instance UUID
  site_display_name               TEXT,                  -- friendly name shown in UI

  -- Encrypted access token (short-lived, ~5 min per Wix docs)
  access_token_ciphertext         BYTEA NOT NULL,
  access_token_iv                 BYTEA NOT NULL,
  access_token_auth_tag           BYTEA NOT NULL,
  access_token_expires_at         TIMESTAMPTZ,           -- when to refresh

  -- Encrypted refresh token (long-lived, used to mint new access tokens)
  refresh_token_ciphertext        BYTEA NOT NULL,
  refresh_token_iv                BYTEA NOT NULL,
  refresh_token_auth_tag          BYTEA NOT NULL,

  scopes                          TEXT[] NOT NULL,       -- granted permissions list

  -- Sync state
  connected_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_sync_at                    TIMESTAMPTZ,
  last_sync_status                TEXT,                  -- 'success' | 'partial' | 'failed' | NULL
  last_sync_error                 TEXT,
  webhook_subscription_ids        TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],

  -- Initial backfill state
  backfill_started_at             TIMESTAMPTZ,
  backfill_completed_at           TIMESTAMPTZ,
  backfill_total_orders           INTEGER,
  backfill_orders_imported        INTEGER NOT NULL DEFAULT 0,

  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- v1: one Wix site per Dreamward client (matches Phase 8 / Shopify pattern)
  UNIQUE (client_id),
  -- Same Wix site can't be connected to two Dreamward accounts
  UNIQUE (instance_id)
);

CREATE INDEX IF NOT EXISTS idx_wix_connections_instance
  ON wix_connections (instance_id);
