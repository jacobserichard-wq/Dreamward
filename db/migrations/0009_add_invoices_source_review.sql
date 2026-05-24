-- 0009_add_invoices_source_review.sql
-- Phase 6.5 (AR Auto-Detect from Gmail). Designed in
-- session-notes/phase-6.5-design.md §2. Sub-session 24 commit 1 of 8.
--
-- Three additive columns on `invoices` to support email auto-ingestion:
--
--   source              — 'manual' (default) | 'email-auto' | future
--                         'csv-import', 'qbo-sync', etc. Lets the
--                         /invoices UI badge auto-detected rows and
--                         lets reports differentiate ingestion paths.
--   gmail_message_id    — source email id when source='email-auto'.
--                         NULL for manual rows. Drives both the
--                         dedup constraint and the "view original"
--                         deep-link on the detail page.
--   needs_review        — true for fresh auto-detected rows until the
--                         user approves them. Defaults to false so
--                         existing manual rows are not retroactively
--                         flagged. Cleared via PATCH
--                         /api/invoices/[id]/review { action: 'approve' }.
--
-- Two indexes:
--
--   idx_invoices_gmail_msg — PARTIAL UNIQUE on (client_id, gmail_message_id)
--                            WHERE gmail_message_id IS NOT NULL. Makes
--                            re-running the ingest endpoint idempotent
--                            (the same Gmail message id never creates
--                            two invoice rows for the same tenant) while
--                            still allowing many NULL rows for manual
--                            entries.
--
--   idx_invoices_client_needs_review — PARTIAL on (client_id)
--                                      WHERE needs_review = true. Tiny
--                                      index (only flagged rows) — feeds
--                                      the "Needs review" filter chip
--                                      on /invoices.
--
-- Apply via:
--   node --env-file=.env.local scripts/run-migration.mjs \
--     db/migrations/0009_add_invoices_source_review.sql
-- (NOT Railway's web query console — multi-statement DDL is unreliable
-- there per sub-session 16.)
--
-- Verify with:
--   \d invoices
--   SELECT indexname FROM pg_indexes
--    WHERE tablename = 'invoices'
--      AND indexname IN ('idx_invoices_gmail_msg',
--                        'idx_invoices_client_needs_review');
-- Expected: three new columns present, two new indexes present.
--
-- Ordering hazard: commits 3, 5, 6 (ingest route + review route + UI
-- read of source / needs_review) all expect these columns. Apply this
-- migration on Railway BEFORE pushing those commits to production.
-- Commits 2 + 4 (lib/invoiceIngest.ts pure helper + lib/invoices.ts
-- additions that reference but don't INSERT/SELECT the new columns) are
-- deploy-safe without the migration applied.
--
-- Rollback (additive, safe to reverse):
--   DROP INDEX IF EXISTS idx_invoices_client_needs_review;
--   DROP INDEX IF EXISTS idx_invoices_gmail_msg;
--   ALTER TABLE invoices
--     DROP COLUMN IF EXISTS needs_review,
--     DROP COLUMN IF EXISTS gmail_message_id,
--     DROP COLUMN IF EXISTS source;
--
-- Idempotency: every ALTER + CREATE uses IF NOT EXISTS, matching the
-- 0001-0008 convention. Re-running this migration is safe.

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual',
  ADD COLUMN IF NOT EXISTS gmail_message_id TEXT,
  ADD COLUMN IF NOT EXISTS needs_review BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_gmail_msg
  ON invoices(client_id, gmail_message_id)
  WHERE gmail_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_client_needs_review
  ON invoices(client_id)
  WHERE needs_review = true;
