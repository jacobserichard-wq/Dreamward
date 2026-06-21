-- 0030_add_import_start_date.sql
-- "Import from" cutoff (Jacob's call: per-connection, all sources). Lets a
-- client choose how far back to import when connecting an outside source,
-- instead of always dumping the full history.
--
-- Adds a nullable import_start_date to every integration connection table.
-- Semantics: NULL = import all available history (the prior behavior, so
-- existing connections are unaffected). A date = import only transactions
-- dated on or after it. Honored by BOTH the initial backfill AND the
-- ongoing sync/reconcile, so older rows never appear later.
--
-- Apply via:
--   node --env-file=.env.local scripts/run-migration.mjs \
--     db/migrations/0030_add_import_start_date.sql
--
-- Verify with:
--   SELECT table_name FROM information_schema.columns
--    WHERE column_name = 'import_start_date' ORDER BY table_name;
--   -- expect: etsy_connections, plaid_items, shopify_connections,
--   --         square_connections, wix_connections
--
-- Rollback (additive, safe):
--   ALTER TABLE plaid_items         DROP COLUMN IF EXISTS import_start_date;
--   ALTER TABLE shopify_connections DROP COLUMN IF EXISTS import_start_date;
--   ALTER TABLE square_connections  DROP COLUMN IF EXISTS import_start_date;
--   ALTER TABLE etsy_connections    DROP COLUMN IF EXISTS import_start_date;
--   ALTER TABLE wix_connections     DROP COLUMN IF EXISTS import_start_date;
--
-- Idempotent: IF NOT EXISTS throughout. Re-running is safe.

ALTER TABLE plaid_items
  ADD COLUMN IF NOT EXISTS import_start_date DATE;

ALTER TABLE shopify_connections
  ADD COLUMN IF NOT EXISTS import_start_date DATE;

ALTER TABLE square_connections
  ADD COLUMN IF NOT EXISTS import_start_date DATE;

ALTER TABLE etsy_connections
  ADD COLUMN IF NOT EXISTS import_start_date DATE;

ALTER TABLE wix_connections
  ADD COLUMN IF NOT EXISTS import_start_date DATE;
