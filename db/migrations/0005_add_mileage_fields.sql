-- 0005_add_mileage_fields.sql
-- Phase 4 (Expense Categories & Mileage) — mileage schema. Sub-session
-- commit 1 of 8. Designed in session-notes/phase-4-mileage-design.md.
--
-- Five additive columns, no rewrites:
--   clients.home_address          — the vendor's home/base address; the
--                                   maps API geocodes it as a string.
--   events.address                — event street address (distinct from
--                                   venue, which is a name). Drives the
--                                   maps-API destination.
--   events.returns_home_nightly   — whether the vendor drives home each
--                                   night of a multi-day event. NOT NULL
--                                   DEFAULT true; the dominant case for
--                                   day-trip market vendors. Total event
--                                   mileage derives from this + day_count
--                                   (design §8.2) — not stored.
--   events.round_trip_miles       — one home→event→home distance, in
--                                   miles. Null until computed. Phase 4
--                                   never multiplies this by day_count
--                                   in storage; the per-night/single
--                                   conditional is applied by callers
--                                   that display or aggregate mileage.
--   events.mileage_computed_at    — when the figure was last computed.
--                                   Drives the "freshness" affordance
--                                   on the event detail page and lets
--                                   the recompute-all skip rows whose
--                                   addresses are unchanged.
--
-- All ADD COLUMN IF NOT EXISTS for idempotent re-runs. The boolean
-- DEFAULT true on returns_home_nightly is a constant default — Postgres
-- treats it as metadata-only since v11, so the column add is fast even
-- on large tables.
--
-- Apply on Railway:
--   psql "<connection-string>" -f db/migrations/0005_add_mileage_fields.sql
-- NOT via the Railway web query console — it runs one statement at a
-- time and hides errors (verified in sub-session 16).
--
-- Verify with:
--   \d clients   (look for home_address)
--   \d events    (look for address, returns_home_nightly,
--                 round_trip_miles, mileage_computed_at)
-- or:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'events'
--      AND column_name IN ('address', 'returns_home_nightly',
--                          'round_trip_miles', 'mileage_computed_at');
--
-- Ordering hazard: commit 3 (POST + PATCH /api/events) reads and writes
-- these columns; deploying that code before this migration runs causes
-- 500 on every event POST/PATCH. Apply this migration BEFORE pushing
-- commit 3. Commit 1 itself (just the .sql file landing in git) is safe
-- to deploy anytime — no runtime code depends on the new columns yet.

ALTER TABLE clients ADD COLUMN IF NOT EXISTS home_address TEXT;

ALTER TABLE events ADD COLUMN IF NOT EXISTS address              TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS returns_home_nightly BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE events ADD COLUMN IF NOT EXISTS round_trip_miles     NUMERIC(7,1);
ALTER TABLE events ADD COLUMN IF NOT EXISTS mileage_computed_at  TIMESTAMPTZ;
