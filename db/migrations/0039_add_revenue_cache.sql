-- db/migrations/0039_add_revenue_cache.sql
--
-- Cache each client's trailing-12-month revenue + would-be band on the
-- clients row, so the owner dashboard reads a stored value instead of
-- recomputing computeTrailingRevenue per account on every page load.
-- Refreshed nightly by the daily cron (cacheAllRevenue); a never-cached
-- account is computed read-through on first admin view.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS. All nullable (NULL = not yet
-- cached → read-through computes it).
--
-- Verify:
--   SELECT id, cached_trailing_revenue, cached_would_be_band, revenue_cached_at
--     FROM clients ORDER BY id;
-- Rollback:
--   ALTER TABLE clients
--     DROP COLUMN IF EXISTS cached_trailing_revenue,
--     DROP COLUMN IF EXISTS cached_would_be_band,
--     DROP COLUMN IF EXISTS revenue_cached_at;

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS cached_trailing_revenue NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS cached_would_be_band    TEXT,
  ADD COLUMN IF NOT EXISTS revenue_cached_at       TIMESTAMPTZ;
