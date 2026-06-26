-- db/migrations/0039_add_stripe_connections.sql
--
-- Stripe CONNECT as a sales channel — a Dreamward customer (a maker)
-- connects THEIR own Stripe account so the charges they collect from
-- their buyers flow into Dreamward as income (channel = 'stripe'). This
-- is entirely separate from the platform's BILLING Stripe (subscriptions,
-- lib/stripe.ts) — different account relationship, different routes
-- (/api/stripe-connect/*), different webhook.
--
-- Mirrors square_connections (0016) but simpler: Stripe Connect Standard
-- OAuth access tokens DON'T expire, so there's no 30/90-day refresh dance.
-- We also read primarily via the platform key + `Stripe-Account` header;
-- the stored access token is kept for deauthorize + as a fallback.
--
-- The 'stripe' channel itself needs no schema change — processed_items.channel
-- is free-text TEXT (0011); it's registered in lib/profitability/channels.ts.
--
-- Verify:
--   SELECT table_name FROM information_schema.tables
--    WHERE table_name = 'stripe_connections';
-- Rollback (additive, safe):
--   DROP INDEX IF EXISTS idx_stripe_connections_account;
--   DROP INDEX IF EXISTS idx_stripe_connections_client;
--   DROP TABLE IF EXISTS stripe_connections;
--
-- Idempotent: CREATE TABLE / CREATE INDEX all IF NOT EXISTS.

CREATE TABLE IF NOT EXISTS stripe_connections (
  id                         INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  client_id                  INTEGER NOT NULL REFERENCES clients(id),

  -- The connected Stripe account (OAuth `stripe_user_id`, acct_...).
  -- Webhooks carry this in their top-level `account` field, so it's the
  -- lookup key from a Connect event back to a Dreamward client.
  stripe_account_id          TEXT NOT NULL,
  business_name              TEXT,                   -- business_profile.name, for the card UI

  -- Encrypted Connect access token (Standard OAuth; long-lived, no expiry).
  -- Reads use the platform key + Stripe-Account header; this is stored so we
  -- can deauthorize and as a fallback.
  access_token_ciphertext    BYTEA NOT NULL,
  access_token_iv            BYTEA NOT NULL,
  access_token_auth_tag      BYTEA NOT NULL,

  scope                      TEXT,                   -- OAuth scope ('read_only' / 'read_write')
  -- true = a LIVE Stripe account, false = a test-mode account. Lets one
  -- Dreamward user connect a test account during dev without collisions.
  livemode                   BOOLEAN NOT NULL DEFAULT FALSE,

  -- Sync state
  connected_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_sync_at               TIMESTAMPTZ,
  last_sync_status           TEXT,                   -- 'success' | 'partial' | 'failed' | 'in_progress' | NULL
  last_sync_error            TEXT,
  webhook_event_types        TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    -- populated with event-type names as each kind first arrives (same
    -- pattern as Square/Wix). Non-empty = "Live sync active" on the card.

  -- Initial backfill state
  backfill_started_at        TIMESTAMPTZ,
  backfill_completed_at      TIMESTAMPTZ,
  backfill_cursor            TEXT,                   -- last charge id (Stripe list pagination)
  backfill_charges_imported  INTEGER NOT NULL DEFAULT 0,

  updated_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One connection per client in practice; index (not unique) so a dev can
-- reconnect / swap test↔live without a UNIQUE collision (the callback
-- guards against duplicates in code, like Square).
CREATE INDEX IF NOT EXISTS idx_stripe_connections_client
  ON stripe_connections (client_id);

-- Webhook lookup: Connect event.account → connection.
CREATE INDEX IF NOT EXISTS idx_stripe_connections_account
  ON stripe_connections (stripe_account_id);
