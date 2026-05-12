-- 0001_add_ai_telemetry.sql
-- Adds AI classification telemetry columns to processed_items.
-- Deferred from sub-session 11's audit plan (audit commit #5); logged as
-- loose end in commit 618fc14.
--
-- Three new nullable columns:
--   ai_classified_at      — when the AI classified this item
--   ai_model              — which model (e.g., claude-sonnet-4-20250514)
--   original_ai_category  — AI's original suggestion before any user
--                           correction. NULL when category still matches
--                           the AI's value. User-correction wire-up ships
--                           in a later commit.
--
-- The existing `confidence` column already serves the role the audit
-- recommended for `ai_confidence`; not duplicated here.
--
-- All columns nullable: legacy rows, manual entries, and the sample-data
-- preloader path continue to insert without these fields.
--
-- IF NOT EXISTS clauses make this migration idempotent.
--
-- Apply on Railway: open the PostgreSQL service → Data tab (psql terminal
-- or query runner) and execute the statements below. Confirm with:
--   \d processed_items
-- (or SELECT column_name FROM information_schema.columns WHERE table_name
-- = 'processed_items';)
--
-- This is the first checked-in migration for FlowWork. Future schema
-- changes should append numbered files in this directory (0002_..., etc.)
-- and be applied to Railway before the code that depends on them deploys.

ALTER TABLE processed_items
  ADD COLUMN IF NOT EXISTS ai_classified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ai_model TEXT,
  ADD COLUMN IF NOT EXISTS original_ai_category TEXT;
