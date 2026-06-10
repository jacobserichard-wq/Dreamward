-- 0024_add_etsy_connections.sql
-- Etsy integration (the #1 competitive gap vs Craftybase/Inventora —
-- see session-notes/design-etsy-integration.md).
--
-- One row per client holding the OAuth 2.0 token pair + backfill
-- bookkeeping. Mirrors square_connections' shape with one Etsy
-- quirk: access tokens live ONE HOUR and refresh tokens live 90
-- days, so both are stored (AES-256-GCM encrypted via lib/crypto)
-- and the access token is refreshed on demand. The cron's
-- reconciliation pass also refreshes, keeping the 90-day refresh
-- token alive for idle shops.
--
-- Sync model: NO webhook endpoint in v1 — Etsy's webhook payloads
-- are minimal (a re-fetch is needed anyway), so the daily cron's
-- 25-hour-lookback polling pass (same pattern as Wix + Square)
-- covers ongoing sync, with the manual backfill button for catch-up.
--
-- backfill_cursor stores the getShopReceipts offset so a chunked
-- backfill resumes where it left off (the Shopify/Wix resumable
-- pattern).
--
-- Apply via:
--   node --env-file=.env.local scripts/run-migration.mjs \
--     db/migrations/0024_add_etsy_connections.sql
--
-- Verify with:
--   SELECT table_name, COUNT(*) FROM information_schema.columns
--    WHERE table_name = 'etsy_connections' GROUP BY table_name;
--   -- expected: etsy_connections = 12
--
-- Rollback (additive, safe):
--   DROP TABLE IF EXISTS etsy_connections;
--
-- Idempotency: CREATE TABLE IF NOT EXISTS — re-running is safe.

CREATE TABLE IF NOT EXISTS etsy_connections (
  id                        INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  -- One Etsy shop per client (UNIQUE). Multi-shop is out of scope
  -- for v1 — same constraint as the other platform connections.
  client_id                 INTEGER NOT NULL UNIQUE REFERENCES clients(id) ON DELETE CASCADE,
  shop_id                   TEXT NOT NULL,
  shop_name                 TEXT,
  access_token_encrypted    TEXT NOT NULL,
  refresh_token_encrypted   TEXT NOT NULL,
  -- When the (1-hour) access token expires; the API client refreshes
  -- when within 5 minutes of this.
  access_token_expires_at   TIMESTAMPTZ NOT NULL,
  -- When the current refresh token was minted (90-day life). The
  -- cron alerts/logs if a connection is approaching expiry without
  -- a successful refresh.
  refresh_token_obtained_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  backfill_cursor           INTEGER,
  backfill_done             BOOLEAN NOT NULL DEFAULT FALSE,
  created_at                TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
