-- 0019_add_expense_attachments.sql
-- Phase 9.4 (Receipt attachments on expenses). One new table
-- holding metadata about receipt files stored in Vercel Blob.
--
-- The actual file bytes live in Vercel Blob (private store);
-- this table stores the URL + pathname + display metadata so
-- the merchant can list, preview, and re-download attachments
-- without round-tripping through Blob's API for every render.
--
-- Schema notes:
--   - processed_item_id references processed_items(id) with
--     ON DELETE CASCADE so deleting an expense automatically
--     cleans up its attachment rows. The Blob storage cleanup
--     side is handled by the DELETE /api/expenses/[id] route
--     which calls del(blob_pathname) BEFORE the row deletion
--     (so cascade doesn't orphan storage we forgot about).
--   - client_id duplicated from the parent for tenant-scoped
--     queries that don't need to JOIN through processed_items
--     (e.g., the Trial 10-attachment cap counts client-wide).
--   - blob_pathname stored separately from blob_url because
--     Vercel Blob's del() takes the pathname, not the full URL.
--     The URL alone would require re-deriving the pathname every
--     deletion which is brittle if Vercel changes URL format.
--   - size_bytes used both for display ("2.3 MB") and server-
--     side enforcement of the per-file size cap (10 MB) — kept
--     even though the file is already in Blob so we can sum
--     storage usage without listing Blob objects.
--
-- Apply via:
--   node --env-file=.env.local scripts/run-migration.mjs \
--     db/migrations/0019_add_expense_attachments.sql
--
-- Verify with:
--   SELECT column_name, data_type
--     FROM information_schema.columns
--    WHERE table_name = 'expense_attachments'
--    ORDER BY ordinal_position;
-- Expected: 9 columns.
--
-- Rollback (additive, safe):
--   DROP INDEX IF EXISTS idx_expense_attachments_client;
--   DROP INDEX IF EXISTS idx_expense_attachments_processed_item;
--   DROP TABLE IF EXISTS expense_attachments;
--
-- Idempotency: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT
-- EXISTS throughout. Re-running is safe.

CREATE TABLE IF NOT EXISTS expense_attachments (
  id                INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  processed_item_id INTEGER NOT NULL REFERENCES processed_items(id) ON DELETE CASCADE,
  client_id         INTEGER NOT NULL REFERENCES clients(id),
  filename          TEXT NOT NULL,       -- user-visible name on download
  mime_type         TEXT NOT NULL,       -- 'image/jpeg', 'application/pdf', etc.
  size_bytes        INTEGER NOT NULL,    -- enforced 10 MB cap server-side
  blob_url          TEXT NOT NULL,       -- Vercel Blob public URL (private store still gets URLs; reads require token)
  blob_pathname     TEXT NOT NULL,       -- pathname argument for del() during attachment deletion
  uploaded_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_expense_attachments_processed_item
  ON expense_attachments (processed_item_id);
CREATE INDEX IF NOT EXISTS idx_expense_attachments_client
  ON expense_attachments (client_id);
