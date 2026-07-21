-- 0046: allow PENDING Shopify connections (App Store install flow).
--
-- App-Store-initiated installs reach us with no Dreamward session:
-- the merchant clicks Install on Shopify's side, OAuth completes, and
-- only THEN do they sign in / sign up. The token from that handshake
-- must be stored before any client exists to own it.
--
-- A pending connection is a row with client_id IS NULL. It is claimed
-- ("bound") by POST /api/shopify/bind after the merchant signs in —
-- session authorizes the claim, mirroring the Wix bind pattern.
--
-- UNIQUE(client_id) is unaffected: Postgres UNIQUE ignores NULLs, so
-- any number of pending installs can coexist while each client still
-- holds at most one bound connection. UNIQUE(shop_domain) already
-- guarantees one row per shop, making re-installs an upsert.

ALTER TABLE shopify_connections
  ALTER COLUMN client_id DROP NOT NULL;
