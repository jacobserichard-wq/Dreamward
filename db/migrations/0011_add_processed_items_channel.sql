-- 0011_add_processed_items_channel.sql
-- Phase 9.3 (Expenses Page + Channel Tagging). Sub-session 25
-- commit 1 of ~8.
--
-- Adds explicit `channel` column to processed_items so users can
-- tag a new expense (or income row) to a specific revenue channel
-- at entry time, instead of relying purely on derived classification
-- from source / category / event_id.
--
-- Why explicit:
--   - User mental model is "this expense is for Shopify" or "for the
--     Broad Ripple Fair event". The current channel derivation infers
--     this from indirect signals (source='shopify', event_id IS NOT
--     NULL, category names) — which works for ingested data but feels
--     fuzzy when the user is manually entering an expense.
--   - The new /expenses page (commit 6) presents channel as a first-
--     class dropdown at entry time. Saving the choice as an explicit
--     column makes the rollup math obvious + makes the row auditable.
--
-- Backfill strategy: derive from existing signals so the rollup totals
-- don't change for existing rows. New rows from the /expenses page will
-- set channel explicitly. Channels classifier (lib/profitability/
-- channels.ts) gets updated in commit 2 to prefer explicit > derived.
--
-- Apply via:
--   node --env-file=.env.local scripts/run-migration.mjs \
--     db/migrations/0011_add_processed_items_channel.sql
--
-- Verify with:
--   \d processed_items
--   SELECT channel, COUNT(*) FROM processed_items
--    WHERE channel IS NOT NULL
--    GROUP BY channel
--    ORDER BY 2 DESC;
-- Expected: new column present, backfill counts roughly match
-- existing distribution of source/event_id signals.
--
-- Rollback (additive, safe):
--   DROP INDEX IF EXISTS idx_processed_items_client_channel;
--   ALTER TABLE processed_items DROP COLUMN IF EXISTS channel;
--
-- Idempotency: every CREATE / ADD uses IF NOT EXISTS. Backfill
-- UPDATEs include `AND channel IS NULL` so re-running doesn't
-- overwrite later user changes.

ALTER TABLE processed_items
  ADD COLUMN IF NOT EXISTS channel TEXT;

-- Partial index for channel-filtered queries (excludes null-channel
-- rows which are the majority of legacy data). Drives the new
-- /api/expenses?channel=X filter + the explicit-channel branch of
-- the channels rollup classifier.
CREATE INDEX IF NOT EXISTS idx_processed_items_client_channel
  ON processed_items (client_id, channel)
  WHERE channel IS NOT NULL;

-- ── Backfill existing rows from derived signals ────────────────────
-- Order matters: most-specific wins. Event-linked beats source which
-- beats category which beats "uploads" fallback.

-- 1. Event-linked rows → markets (Phase 4 events table tie)
UPDATE processed_items
   SET channel = 'markets'
 WHERE event_id IS NOT NULL
   AND channel IS NULL;

-- 2. Shopify-source rows → shopify (Phase 8 backfill + webhook)
UPDATE processed_items
   SET channel = 'shopify'
 WHERE source = 'shopify'
   AND channel IS NULL;

-- 3. Gmail-source rows → gmail (Phase 1 OAuth fetch path)
UPDATE processed_items
   SET channel = 'gmail'
 WHERE source IN ('gmail', 'email')
   AND channel IS NULL;

-- Note: we intentionally leave manual / sample rows with channel
-- NULL — they'll fall through to the classifier's derivation
-- (which routes them to 'uploads' / category-based mapping). No
-- need to mass-assign 'uploads' to manual rows; that's just the
-- "I don't know" bucket and shouldn't be authoritative as an
-- explicit user choice.
