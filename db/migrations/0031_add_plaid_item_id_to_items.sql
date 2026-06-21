-- 0031_add_plaid_item_id_to_items.sql
-- Tag each bank-imported transaction with the Plaid item (connection) it
-- came from, so a disconnect can optionally remove that bank's imported
-- rows ("delete a wrong import and redo it") and so re-connecting the same
-- bank doesn't pile up duplicates.
--
-- processed_items already has plaid_transaction_id (dedup key, migration
-- 0029) and plaid_account_id. This adds plaid_item_id = the institution
-- login the rows belong to.
--
-- Apply via:
--   node --env-file=.env.local scripts/run-migration.mjs \
--     db/migrations/0031_add_plaid_item_id_to_items.sql
--
-- Rollback (additive, safe):
--   DROP INDEX IF EXISTS idx_processed_items_plaid_item;
--   ALTER TABLE processed_items DROP COLUMN IF EXISTS plaid_item_id;
--
-- Idempotent: IF NOT EXISTS throughout.

ALTER TABLE processed_items
  ADD COLUMN IF NOT EXISTS plaid_item_id TEXT;

-- Speeds the per-item purge on disconnect. Partial: only bank rows.
CREATE INDEX IF NOT EXISTS idx_processed_items_plaid_item
  ON processed_items (client_id, plaid_item_id)
  WHERE plaid_item_id IS NOT NULL;
