-- 0029_add_plaid_transaction_fields.sql
-- Plaid bank-feed Phase 2 (transaction sync). Adds the Plaid identifiers
-- needed to dedup imported transactions idempotently across repeated
-- /transactions/sync runs.
--
-- processed_items already holds every transaction (uploads, manual entry,
-- channel syncs). Bank-imported rows (source = 'plaid') additionally carry:
--   - plaid_transaction_id: Plaid's stable id for the transaction. The
--     dedup / upsert key, so re-syncs don't create duplicates and Plaid
--     "modified" events update the existing row instead of inserting.
--   - plaid_account_id: which account within the item the transaction came
--     from (one Plaid item can expose several accounts).
--
-- The PARTIAL unique index enforces one row per (client, plaid txn) while
-- leaving all non-Plaid rows (NULL plaid_transaction_id) unconstrained, so
-- existing upload/manual rows are unaffected.
--
-- Apply via:
--   node --env-file=.env.local scripts/run-migration.mjs \
--     db/migrations/0029_add_plaid_transaction_fields.sql
--
-- Verify with:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'processed_items'
--      AND column_name IN ('plaid_transaction_id','plaid_account_id');
--
-- Rollback (additive, safe):
--   DROP INDEX IF EXISTS idx_processed_items_plaid_txn;
--   ALTER TABLE processed_items DROP COLUMN IF EXISTS plaid_transaction_id;
--   ALTER TABLE processed_items DROP COLUMN IF EXISTS plaid_account_id;
--
-- Idempotent: IF NOT EXISTS throughout. Re-running is safe.

ALTER TABLE processed_items
  ADD COLUMN IF NOT EXISTS plaid_transaction_id TEXT,
  ADD COLUMN IF NOT EXISTS plaid_account_id     TEXT;

-- One row per (client, Plaid transaction). Partial so it only applies to
-- bank-imported rows; enables ON CONFLICT (client_id, plaid_transaction_id)
-- WHERE plaid_transaction_id IS NOT NULL for idempotent upserts.
CREATE UNIQUE INDEX IF NOT EXISTS idx_processed_items_plaid_txn
  ON processed_items (client_id, plaid_transaction_id)
  WHERE plaid_transaction_id IS NOT NULL;
