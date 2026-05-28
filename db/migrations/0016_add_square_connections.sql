-- 0016_add_square_connections.sql
-- Phase 11a (Square Integration). One new table holding encrypted
-- Square OAuth tokens per FlowWork client + sync state + backfill
-- bookkeeping.
--
-- Mirrors shopify_connections (migration 0010) and the post-pivot
-- wix_connections (0013 + 0014 + 0015) with Square-specific
-- adaptations:
--
--   - merchant_id is Square's unique identifier for a merchant
--     account. NOT a URL or domain like Shopify; it's an opaque
--     string Square issues at connection time.
--   - business_name is the human-friendly name from
--     /v2/merchants/{merchant_id} for the card UI.
--   - BOTH access + refresh tokens are encrypted (Square access
--     tokens have 30-day expiry; refresh tokens have 90-day expiry
--     and ROTATE on each refresh — must update both columns when
--     refreshing).
--   - access_token_expires_at drives the pre-emptive refresh
--     check in lib/square.withAccessToken.
--   - environment column ('sandbox' | 'production') lets us
--     support test accounts during dev. Without it, a merchant
--     who connected their sandbox account couldn't later
--     re-connect production (UNIQUE conflict).
--   - backfill_cursor stores Square's Payments API pagination
--     token (cursor pagination like Wix, not since_id like Shopify).
--
-- Apply via:
--   node --env-file=.env.local scripts/run-migration.mjs \
--     db/migrations/0016_add_square_connections.sql
--
-- Verify with:
--   SELECT column_name, data_type
--     FROM information_schema.columns
--    WHERE table_name = 'square_connections'
--    ORDER BY ordinal_position;
-- Expected: ~20 columns.
--
-- Rollback (additive, safe):
--   DROP INDEX IF EXISTS idx_square_connections_merchant;
--   DROP TABLE IF EXISTS square_connections;
--
-- Idempotency: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT
-- EXISTS throughout. Re-running is safe.

CREATE TABLE IF NOT EXISTS square_connections (
  id                              INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  client_id                       INTEGER NOT NULL REFERENCES clients(id),

  -- Identity of the connected Square merchant
  merchant_id                     TEXT NOT NULL,          -- Square merchant ID
  business_name                   TEXT,                   -- friendly name for UI

  -- Encrypted access token (30-day expiry per Square OAuth docs)
  access_token_ciphertext         BYTEA NOT NULL,
  access_token_iv                 BYTEA NOT NULL,
  access_token_auth_tag           BYTEA NOT NULL,
  access_token_expires_at         TIMESTAMPTZ NOT NULL,   -- pre-emptive refresh

  -- Encrypted refresh token (90-day expiry, rotates on every refresh)
  refresh_token_ciphertext        BYTEA NOT NULL,
  refresh_token_iv                BYTEA NOT NULL,
  refresh_token_auth_tag          BYTEA NOT NULL,

  scopes                          TEXT[] NOT NULL,        -- granted OAuth scopes

  -- Sync state
  connected_at                    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_sync_at                    TIMESTAMPTZ,
  last_sync_status                TEXT,                   -- 'success' | 'partial' | 'failed' | 'in_progress' | NULL
  last_sync_error                 TEXT,
  webhook_subscription_ids        TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    -- Phase 11d: populated with event-type names as we receive
    -- each kind of webhook for the first time (same pattern as
    -- Wix). Non-empty = "Live sync active" on the card UI.

  -- Initial backfill state
  backfill_started_at             TIMESTAMPTZ,
  backfill_completed_at           TIMESTAMPTZ,
  backfill_cursor                 TEXT,                   -- Square Payments API cursor
  backfill_payments_imported      INTEGER NOT NULL DEFAULT 0,

  -- Environment switch. 'sandbox' for Square's dev sandbox,
  -- 'production' for real money. Stored per-connection so a single
  -- FlowWork user can switch between dev + prod accounts during
  -- development without UNIQUE collisions.
  environment                     TEXT NOT NULL DEFAULT 'production',

  updated_at                      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- v1: one Square account per FlowWork client (matches Shopify +
  -- Wix patterns from earlier phases)
  UNIQUE (client_id),

  -- Same Square merchant can't be connected to two FlowWork
  -- accounts. environment is part of the unique key so a single
  -- merchant_id can exist once in sandbox AND once in production
  -- (rare but legal — same business has both a sandbox app
  -- connected during testing + production connected for real use).
  UNIQUE (merchant_id, environment)
);

CREATE INDEX IF NOT EXISTS idx_square_connections_merchant
  ON square_connections (merchant_id, environment);
