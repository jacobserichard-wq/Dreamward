-- 0012_add_processed_items_notes.sql
-- Phase 9.3 follow-up. The /api/expenses POST + GET routes reference
-- a `processed_items.notes` column that I assumed existed when
-- building Phase 9.3 but doesn't. Adding it now so the /expenses
-- form's "Notes (optional)" field has somewhere to land.
--
-- Distinct from the existing `summary` column (which holds AI-
-- generated 1-sentence summaries from the email extraction path):
--   - summary  = "what does the AI think this is?" (system-generated)
--   - notes    = "what does the user want to remember?" (user-entered)
--
-- Apply via:
--   node --env-file=.env.local scripts/run-migration.mjs \
--     db/migrations/0012_add_processed_items_notes.sql
--
-- Verify with:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'processed_items' AND column_name = 'notes';
-- Expected: 1 row.
--
-- Rollback (safe — column is nullable, no data dependency):
--   ALTER TABLE processed_items DROP COLUMN IF EXISTS notes;
--
-- Idempotent (ADD COLUMN IF NOT EXISTS).

ALTER TABLE processed_items
  ADD COLUMN IF NOT EXISTS notes TEXT;
