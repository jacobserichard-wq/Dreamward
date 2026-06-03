-- 0020_add_inventory_tracking.sql
-- Tier 1 inventory tracking (Sub-session 33). Adds a stock counter
-- to skus and a ledger table for every adjustment so the running
-- balance is reproducible from history.
--
-- Why two changes in one migration:
--   - quantity_on_hand on skus is the "current balance" cache —
--     fast lookups for the SKU list page without scanning the
--     ledger every render.
--   - inventory_adjustments is the source of truth — every change
--     (sale, manual receive, recount) is one row. quantity_on_hand
--     = SUM(delta) WHERE sku_id = X. We keep both in sync via
--     application code (Commit 2 adds the post-save hook) so a
--     bug in either layer is diagnosable by comparing.
--
-- Schema decisions:
--   - delta is INTEGER (positive or negative). Receives are +N,
--     sales are -N, recounts can be either depending on direction.
--   - reason is a CHECK-constrained TEXT enum:
--       'sale'       — auto-generated from a line-item insert
--       'receive'    — merchant marked stock as received (PO,
--                      production run, transfer in)
--       'manual'     — merchant adjustment with a free-text note
--                      (most common: setting initial stock)
--       'recount'    — periodic count revealed real stock differs
--                      from book stock; delta brings book to actual
--       'correction' — admin/support fixing a bad earlier entry
--   - source_line_item_id links sale-reason rows to the originating
--     line item. Partial UNIQUE index (where NOT NULL) guarantees
--     re-imports / webhook replays can't double-decrement. Manual
--     entries leave it NULL — no unique constraint on those.
--   - notes free-text. The Receive UI uses it for PO numbers or
--     supplier mentions; the Recount UI uses it for "took count
--     during Sunday market" type context.
--
-- Apply via:
--   node --env-file=.env.local scripts/run-migration.mjs \
--     db/migrations/0020_add_inventory_tracking.sql
--
-- Verify with:
--   SELECT column_name, data_type, column_default, is_nullable
--     FROM information_schema.columns
--    WHERE table_name = 'skus' AND column_name = 'quantity_on_hand';
--   -- Expected: integer, 0, NO
--
--   SELECT column_name, data_type FROM information_schema.columns
--    WHERE table_name = 'inventory_adjustments' ORDER BY ordinal_position;
--   -- Expected: 7 columns
--
--   SELECT indexname FROM pg_indexes WHERE tablename = 'inventory_adjustments';
--   -- Expected: 2 indexes (PK + source_line_item_id partial UNIQUE
--   --           + sku_id/created_at lookup)
--
-- Rollback (additive, safe):
--   DROP INDEX IF EXISTS idx_inventory_adj_source_unique;
--   DROP INDEX IF EXISTS idx_inventory_adj_sku_created;
--   DROP TABLE IF EXISTS inventory_adjustments;
--   ALTER TABLE skus DROP COLUMN IF EXISTS quantity_on_hand;
--
-- Idempotency: ADD COLUMN IF NOT EXISTS + CREATE TABLE IF NOT
-- EXISTS + CREATE INDEX IF NOT EXISTS throughout. Re-running is
-- safe. No backfill — existing SKUs default to quantity_on_hand=0
-- and merchants set initial stock via the Commit 3 UI.

-- ── skus.quantity_on_hand ─────────────────────────────────────
-- Current stock balance for the SKU. Maintained by the post-save
-- hook on processed_item_line_items (Commit 2) and by the manual
-- adjustment endpoint (Commit 3). DEFAULT 0 means SKUs that
-- existed before this migration start at zero — accurate, since
-- we don't know prior stock until the merchant counts it.
ALTER TABLE skus
  ADD COLUMN IF NOT EXISTS quantity_on_hand INTEGER NOT NULL DEFAULT 0;

-- ── inventory_adjustments ─────────────────────────────────────
-- Append-only ledger of every stock change. SUM(delta) per sku_id
-- reproduces quantity_on_hand — if they ever drift, the ledger
-- wins and the cache gets corrected.
CREATE TABLE IF NOT EXISTS inventory_adjustments (
  id                       INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  sku_id                   INTEGER NOT NULL REFERENCES skus(id) ON DELETE CASCADE,
  delta                    INTEGER NOT NULL,
  reason                   TEXT NOT NULL CHECK (reason IN ('sale','receive','manual','recount','correction')),
  source_line_item_id      INTEGER REFERENCES processed_item_line_items(id) ON DELETE SET NULL,
  notes                    TEXT,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Partial unique index: enforces one adjustment per line-item sale
-- (idempotency) while leaving manual entries free to repeat. Postgres
-- treats multiple NULLs as distinct so this index permits unlimited
-- NULL source_line_item_id rows.
CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_adj_source_unique
  ON inventory_adjustments (source_line_item_id)
  WHERE source_line_item_id IS NOT NULL;

-- Composite index for the SKU detail page's stock-history view
-- and for the quantity-reconciliation query that sums per SKU.
CREATE INDEX IF NOT EXISTS idx_inventory_adj_sku_created
  ON inventory_adjustments (sku_id, created_at DESC);
