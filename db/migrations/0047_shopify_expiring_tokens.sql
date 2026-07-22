-- 0047: expiring offline access tokens for Shopify (Spring '26 mandate).
--
-- Shopify rejects non-expiring Admin API tokens for public apps —
-- enforcement began for this app the moment Public distribution was
-- chosen (2026-07-21): "Non-expiring access tokens are no longer
-- accepted for the Admin API." New grants return a 1-hour access
-- token + 90-day refresh token (exchange param expiring=1).
--
-- Mirrors square_connections' expiring-token columns. All nullable:
-- a legacy row (pre-migration token) has NULLs and simply can't be
-- refreshed — the fix for those is a reconnect, which mints an
-- expiring token and fills these in.

ALTER TABLE shopify_connections
  ADD COLUMN refresh_token_ciphertext bytea,
  ADD COLUMN refresh_token_iv bytea,
  ADD COLUMN refresh_token_auth_tag bytea,
  ADD COLUMN access_token_expires_at timestamptz,
  ADD COLUMN refresh_token_expires_at timestamptz;
