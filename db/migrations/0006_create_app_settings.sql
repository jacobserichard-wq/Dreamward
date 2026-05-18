-- 0006_create_app_settings.sql
-- Phase 5 (Profitability Dashboard) — app-level settings table. Designed
-- in session-notes/phase-5-profitability-design.md §4. The IRS standard
-- mileage rate is federal (not per-client), so it lives here, not on
-- clients or client_settings.
--
-- Schema: a generic key/value store. One row per setting. value stored
-- as TEXT (parsed by callers as the appropriate type — numeric for
-- irs_mileage_rate, boolean for future feature flags, etc.).
--
-- Seeded values:
--   irs_mileage_rate = '0.70'  — the 2025 IRS standard mileage rate
--                                for business use. Per the Phase 5
--                                design's build-time guidance, the
--                                current 2026 rate hasn't been
--                                announced as a change from 2025, so
--                                this seed is the most recent
--                                authoritative figure. Users can
--                                update it via the commit-8 Settings
--                                affordance when the IRS revises.
--
-- ON CONFLICT (key) DO NOTHING on the seed insert — idempotent
-- re-runs don't clobber a value the user may have already edited.
--
-- Apply on Railway via the Node migration runner:
--   node scripts/run-migration.mjs db/migrations/0006_create_app_settings.sql
-- (NOT Railway's web query console — sub-session 16 verified it's
-- unreliable for multi-statement DDL.)
--
-- Verify with:
--   \d app_settings
--   SELECT * FROM app_settings;
-- Expected: one row, key='irs_mileage_rate', value='0.70'.
--
-- Ordering hazard: commit 5 (/api/profitability) reads from this
-- table to derive per-event mileage cost. Commit 8 (Settings IRS-rate
-- indicator + edit) reads + writes. Apply this migration on Railway
-- BEFORE pushing commit 5 to production. Commits 1-4 ship before
-- this without depending on app_settings.

CREATE TABLE IF NOT EXISTS app_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO app_settings (key, value)
VALUES ('irs_mileage_rate', '0.70')
ON CONFLICT (key) DO NOTHING;
