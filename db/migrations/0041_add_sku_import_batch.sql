-- 0041_add_sku_import_batch.sql
-- Tags SKUs created by a single bulk import (catalog or paste) with a
-- shared import_batch_id, so the SKUs tab can offer a one-click "Undo
-- last import" (delete/archive every row from that batch). Manual SKUs
-- have NULL. Nullable, no default → instant, idempotent.
--
-- Apply:
--   node --env-file=.env.local scripts/run-migration.mjs \
--     db/migrations/0041_add_sku_import_batch.sql
-- Rollback (safe):
--   DROP INDEX IF EXISTS idx_skus_import_batch;
--   ALTER TABLE skus DROP COLUMN IF EXISTS import_batch_id;

ALTER TABLE skus ADD COLUMN IF NOT EXISTS import_batch_id TEXT;

CREATE INDEX IF NOT EXISTS idx_skus_import_batch
  ON skus (client_id, import_batch_id)
  WHERE import_batch_id IS NOT NULL;

SELECT column_name, data_type
  FROM information_schema.columns
 WHERE table_name = 'skus' AND column_name = 'import_batch_id';
