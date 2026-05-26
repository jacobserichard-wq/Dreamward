-- 0014_wix_connections_client_credentials.sql
-- Phase 10 architecture pivot — see session-notes/phase-10-wix-architecture-pivot.md
--
-- Wix's "Custom Authentication" (OAuth 2.0 with redirects, refresh tokens,
-- encrypted token storage) is deprecated and no longer available for new
-- apps. The supported pattern for new apps is **Client Credentials**:
--   POST /oauth2/token  body: { app_id, app_secret, instance_id,
--                               grant_type: 'client_credentials' }
--   → short-lived access token; no refresh, no storage.
--
-- This migration pivots wix_connections accordingly:
--   - DROP the 7 access/refresh token columns (no token storage anymore).
--   - ADD installed_at to capture the Wix-side install timestamp from
--     the webhook/redirect (vs connected_at which is the row insert ts).
--
-- The `scopes` column is left intact — scopes are pre-configured in Wix
-- Dev Center for Client Credentials apps; the column may stay empty for
-- now but could be hydrated from a Dev Center API lookup later if we
-- want to display granted permissions on the connection card.
--
-- Apply via:
--   node --env-file=.env.local scripts/run-migration.mjs \
--     db/migrations/0014_wix_connections_client_credentials.sql
--
-- Verify with:
--   SELECT column_name, data_type
--     FROM information_schema.columns
--    WHERE table_name = 'wix_connections'
--    ORDER BY ordinal_position;
-- Expected:
--   - access_token_*, refresh_token_*, access_token_expires_at all gone
--   - installed_at present, NOT NULL, defaulting to NOW()
--
-- Rollback (re-add columns; tokens NOT recoverable since the
-- encryption-key references are gone — only useful immediately after
-- this migration before any new code lands):
--   ALTER TABLE wix_connections
--     ADD COLUMN access_token_ciphertext BYTEA,
--     ADD COLUMN access_token_iv BYTEA,
--     ADD COLUMN access_token_auth_tag BYTEA,
--     ADD COLUMN access_token_expires_at TIMESTAMPTZ,
--     ADD COLUMN refresh_token_ciphertext BYTEA,
--     ADD COLUMN refresh_token_iv BYTEA,
--     ADD COLUMN refresh_token_auth_tag BYTEA,
--     DROP COLUMN installed_at;
--
-- Data impact: no rows currently exist in prod (no real installs
-- completed during the deprecated-pattern attempt). If smoke testing
-- created any test rows, they will be invalidated by this migration
-- — fine since they had no working tokens anyway.

ALTER TABLE wix_connections
  DROP COLUMN access_token_ciphertext,
  DROP COLUMN access_token_iv,
  DROP COLUMN access_token_auth_tag,
  DROP COLUMN access_token_expires_at,
  DROP COLUMN refresh_token_ciphertext,
  DROP COLUMN refresh_token_iv,
  DROP COLUMN refresh_token_auth_tag;

ALTER TABLE wix_connections
  ADD COLUMN installed_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
