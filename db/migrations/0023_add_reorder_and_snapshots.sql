-- 0023_add_reorder_and_snapshots.sql
-- Inventory page feature: per-SKU reorder points + point-in-time
-- inventory valuation snapshots (for Schedule-C / Form 1125-A
-- beginning + ending inventory).
--
-- Decisions (session-notes/design-inventory-page.md):
--   - per-SKU reorder_point (low-stock threshold the maker sets)
--   - inventory_snapshots for tax-time beginning/ending inventory
--
-- Fully ADDITIVE — no destructive type changes. ADD COLUMN /
-- CREATE TABLE / CREATE INDEX all IF NOT EXISTS, so re-running is
-- safe.
--
-- Apply via:
--   node --env-file=.env.local scripts/run-migration.mjs \
--     db/migrations/0023_add_reorder_and_snapshots.sql
--
-- Verify with:
--   SELECT column_name, data_type, column_default
--     FROM information_schema.columns
--    WHERE table_name='skus' AND column_name='reorder_point';
--   -- expected: numeric, 0
--
--   SELECT table_name, COUNT(*) FROM information_schema.columns
--    WHERE table_name = 'inventory_snapshots' GROUP BY table_name;
--   -- expected: inventory_snapshots = 5
--
-- Rollback:
--   DROP TABLE IF EXISTS inventory_snapshots;
--   ALTER TABLE skus DROP COLUMN IF EXISTS reorder_point;

-- ── 1. Per-SKU reorder point ───────────────────────────────────
-- When quantity_on_hand <= reorder_point AND reorder_point > 0, the
-- SKU is flagged "low" on the inventory page. 0 = no threshold set
-- (the UI falls back to the <=10 heuristic for those).
ALTER TABLE skus
  ADD COLUMN IF NOT EXISTS reorder_point NUMERIC(14,4) NOT NULL DEFAULT 0;

-- ── 2. Inventory valuation snapshots ───────────────────────────
-- One row per client per snapshot_date capturing total inventory
-- value (SUM(quantity_on_hand * current_cost)) at that date. The
-- cron records these at month boundaries; the Schedule-C report
-- reads them for beginning (prior year-end) + ending (report
-- year-end) inventory. UNIQUE(client_id, snapshot_date) makes the
-- recording idempotent.
CREATE TABLE IF NOT EXISTS inventory_snapshots (
  id             INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  client_id      INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  snapshot_date  DATE NOT NULL,
  total_value    NUMERIC(14,2) NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (client_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_inv_snapshots_client_date
  ON inventory_snapshots (client_id, snapshot_date DESC);
