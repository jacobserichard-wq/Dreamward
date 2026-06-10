-- 0025_fix_etsy_connections_token_columns.sql
-- Corrective follow-up to 0024, applied minutes after it. 0024
-- stored the OAuth tokens as single TEXT columns, but the house
-- pattern (shopify_connections, square_connections) and the
-- lib/crypto helpers (encryptForDb/decryptFromDb) use a 3-part
-- AES-256-GCM blob per token: ciphertext + iv + auth_tag as BYTEA.
-- Diverging would have forced one-off serialization code for Etsy
-- only.
--
-- The table is EMPTY (created by 0024 in this same session, no
-- connection rows yet), so DROP + recreate is a zero-data-loss
-- correction.
--
-- Apply via:
--   node --env-file=.env.local scripts/run-migration.mjs \
--     db/migrations/0025_fix_etsy_connections_token_columns.sql
--
-- Verify with:
--   SELECT table_name, COUNT(*) FROM information_schema.columns
--    WHERE table_name = 'etsy_connections' GROUP BY table_name;
--   -- expected: etsy_connections = 16
--
-- Idempotency: DROP IF EXISTS + CREATE — re-running is safe (and
-- destroys nothing once real connections exist? NO — re-running
-- after launch WOULD drop real tokens. This migration is one-shot
-- by design; it's safe today because the table is empty. Do not
-- re-run after Etsy connections go live.)

DROP TABLE IF EXISTS etsy_connections;

CREATE TABLE etsy_connections (
  id                          INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  -- One Etsy shop per client, same as the other platforms.
  client_id                   INTEGER NOT NULL UNIQUE REFERENCES clients(id) ON DELETE CASCADE,
  shop_id                     TEXT NOT NULL,
  shop_name                   TEXT,
  -- Access token (1-hour life) — AES-256-GCM blob.
  access_token_ciphertext     BYTEA NOT NULL,
  access_token_iv             BYTEA NOT NULL,
  access_token_auth_tag       BYTEA NOT NULL,
  access_token_expires_at     TIMESTAMPTZ NOT NULL,
  -- Refresh token (90-day life, rotates on every refresh) — blob.
  refresh_token_ciphertext    BYTEA NOT NULL,
  refresh_token_iv            BYTEA NOT NULL,
  refresh_token_auth_tag      BYTEA NOT NULL,
  refresh_token_obtained_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Chunked-backfill resumption (getShopReceipts offset).
  backfill_cursor             INTEGER,
  backfill_done               BOOLEAN NOT NULL DEFAULT FALSE,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
