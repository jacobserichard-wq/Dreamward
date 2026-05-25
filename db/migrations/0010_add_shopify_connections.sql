-- 0010_add_shopify_connections.sql
-- Phase 8a (Shopify Integration). Designed in
-- session-notes/phase-8-shopify-design.md §2. Sub-session 24
-- commit 1 of (5 in 8a + ~15 across the rest of Phase 8).
--
-- One new table (shopify_connections) holding the encrypted access
-- token per FlowWork client + sync state + backfill bookkeeping +
-- the $99 paid-upgrade marker.
--
-- One additive column on processed_items (source_ref_id) + a partial
-- unique index for cross-source dedup (Shopify webhook + cron +
-- manual re-trigger can all try to insert the same order; the index
-- guarantees we never duplicate).
--
-- Notes:
--   - Token storage is AES-256-GCM ciphertext + 12-byte IV +
--     16-byte auth tag. All BYTEA so we store raw bytes (no hex /
--     base64 round-trips). Encryption key lives in
--     SHOPIFY_TOKEN_ENCRYPTION_KEY env var. See lib/crypto.ts (commit 2).
--   - UNIQUE(client_id) enforces "one Shopify store per FlowWork
--     client" (design §1 decision 4.2 / v1 scope). Multi-store is v2.
--   - UNIQUE(shop_domain) prevents the same Shopify store from being
--     connected to two different FlowWork accounts simultaneously
--     (would cause double-counted revenue).
--   - webhook_subscription_ids is the array of Shopify webhook IDs
--     we registered at connect time; the disconnect flow (commit 8b)
--     iterates this list to clean up Shopify-side webhooks before
--     deleting the connection row.
--   - backfill_capped_at_30k = true when the user's store has > 30k
--     orders and we stopped after pulling the most recent 30k. The
--     /integrations page surfaces a paid-upgrade prompt for these
--     rows. backfill_extended_paid_at flips to NOW() when the user
--     completes the $99 Stripe one-time charge (handler in 8c).
--   - stripe_payment_intent_id is the audit trail / dedup key for
--     the Stripe webhook handler that grants the extended backfill.
--
-- Apply via:
--   node --env-file=.env.local scripts/run-migration.mjs \
--     db/migrations/0010_add_shopify_connections.sql
--
-- Verify with:
--   \d shopify_connections
--   \d processed_items
--   SELECT indexname FROM pg_indexes
--    WHERE indexname IN ('idx_shopify_connections_shop_domain',
--                        'idx_processed_items_source_ref');
-- Expected: new table present with two UNIQUE constraints, two
-- indexes present, processed_items.source_ref_id column added.
--
-- Ordering hazard: every commit in sub-phase 8a (lib/crypto.ts,
-- lib/shopify.ts, /api/shopify/oauth/* routes) requires this
-- migration applied first. Apply on Railway BEFORE pushing
-- subsequent commits to production.
--
-- Rollback (additive, safe):
--   DROP INDEX IF EXISTS idx_processed_items_source_ref;
--   ALTER TABLE processed_items DROP COLUMN IF EXISTS source_ref_id;
--   DROP INDEX IF EXISTS idx_shopify_connections_shop_domain;
--   DROP TABLE IF EXISTS shopify_connections;
--
-- Idempotency: every CREATE / ADD uses IF NOT EXISTS, matching the
-- 0001-0009 convention. Re-running this migration is safe.

CREATE TABLE IF NOT EXISTS shopify_connections (
  id                          INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  client_id                   INTEGER NOT NULL REFERENCES clients(id),

  -- Identity of the connected store
  shop_domain                 TEXT NOT NULL,

  -- Encrypted access token (AES-256-GCM). See lib/crypto.ts.
  access_token_ciphertext     BYTEA NOT NULL,
  access_token_iv             BYTEA NOT NULL,           -- 12 bytes (GCM standard)
  access_token_auth_tag       BYTEA NOT NULL,           -- 16 bytes (GCM standard)
  scopes                      TEXT[] NOT NULL,          -- e.g. ARRAY['read_orders']

  -- Sync state
  connected_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_sync_at                TIMESTAMPTZ,
  last_sync_status            TEXT,                     -- 'success' | 'partial' | 'failed' | NULL
  last_sync_error             TEXT,
  webhook_subscription_ids    TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],

  -- Initial backfill state
  backfill_started_at         TIMESTAMPTZ,
  backfill_completed_at       TIMESTAMPTZ,
  backfill_total_orders       INTEGER,
  backfill_orders_imported    INTEGER NOT NULL DEFAULT 0,
  backfill_capped_at_30k      BOOLEAN NOT NULL DEFAULT false,

  -- Extended backfill (paid $99 upgrade)
  backfill_extended_paid_at   TIMESTAMPTZ,
  stripe_payment_intent_id    TEXT,

  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- v1: one Shopify store per FlowWork client (locked decision 4.2)
  UNIQUE (client_id),
  -- Same Shopify store can't be connected to two FlowWork accounts
  UNIQUE (shop_domain)
);

CREATE INDEX IF NOT EXISTS idx_shopify_connections_shop_domain
  ON shopify_connections (shop_domain);

-- Dedup key for processed_items. Lets us safely receive the same
-- Shopify order via webhook + cron + manual re-trigger without
-- creating duplicate rows. Partial unique index excludes legacy
-- rows that have no source ref (most pre-Phase-8 rows).
ALTER TABLE processed_items
  ADD COLUMN IF NOT EXISTS source_ref_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_processed_items_source_ref
  ON processed_items (client_id, source, source_ref_id)
  WHERE source_ref_id IS NOT NULL;
