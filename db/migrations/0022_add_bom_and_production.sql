-- 0022_add_bom_and_production.sql
-- Tier 2 inventory: Bill of Materials (recipes) + production runs.
-- Lets makers define what a finished product is made of, then log
-- "made a batch" events that draw down raw materials + add finished
-- stock automatically.
--
-- Decisions locked with Jacob (session-notes/design-tier2-bom.md):
--   D3  fractional stock  → YES. Widen Tier 1 stock columns to
--                           NUMERIC so 0.5 oz fragrance oil works.
--   D7  no-recipe run     → allow + warn (app-layer behavior; no
--                           schema impact).
--   naming                → "Recipe" in UI; tables keep bom_* for
--                           clarity in SQL.
--   roll-up costing       → deferred to Tier 2.5 (not in this
--                           migration).
--
-- ── DESTRUCTIVE NOTE ───────────────────────────────────────────
-- Section 1 changes the TYPE of two existing columns
-- (skus.quantity_on_hand + inventory_adjustments.delta) from INTEGER
-- to NUMERIC(14,4). This REWRITES both tables. Integer → NUMERIC is
-- a lossless cast. Tables are tiny today (test data only), so it's
-- fast. Everything else in this migration is additive (ADD COLUMN /
-- CREATE TABLE IF NOT EXISTS).
--
-- Apply via:
--   node --env-file=.env.local scripts/run-migration.mjs \
--     db/migrations/0022_add_bom_and_production.sql
--
-- Verify with:
--   -- types widened:
--   SELECT column_name, data_type, numeric_precision, numeric_scale
--     FROM information_schema.columns
--    WHERE (table_name='skus' AND column_name='quantity_on_hand')
--       OR (table_name='inventory_adjustments' AND column_name='delta');
--   -- expected: numeric, 14, 4 for both
--
--   -- skus.unit present:
--   SELECT column_name, column_default FROM information_schema.columns
--    WHERE table_name='skus' AND column_name='unit';   -- 'each'
--
--   -- new tables (expected column counts): bom_components = 8,
--   -- production_runs = 7
--   SELECT table_name, COUNT(*) FROM information_schema.columns
--    WHERE table_name IN ('bom_components','production_runs')
--    GROUP BY table_name;
--
--   -- reason enum accepts the new values:
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conname='inventory_adjustments_reason_check';
--   -- should list production_in + production_out
--
-- Rollback (additive parts safe to drop; the NUMERIC widening is
-- left in place on rollback — narrowing back to INTEGER would fail
-- on any fractional rows, and is not worth the risk):
--   DROP TABLE IF EXISTS production_runs CASCADE;
--   DROP TABLE IF EXISTS bom_components CASCADE;
--   ALTER TABLE inventory_adjustments DROP COLUMN IF EXISTS production_run_id;
--   ALTER TABLE skus DROP COLUMN IF EXISTS unit;
--   -- (reason CHECK keeps the extra values — harmless if unused.)
--
-- Idempotency: ALTER COLUMN TYPE to the same type is a safe no-op;
-- ADD COLUMN / CREATE TABLE / CREATE INDEX use IF NOT EXISTS; the
-- CHECK constraint is DROP IF EXISTS then ADD. Re-running is safe.

-- ── 1. Widen Tier 1 stock columns to NUMERIC (D3) ──────────────
-- Fractional stock + fractional component quantities. NUMERIC(14,4):
-- up to 10 integer digits + 4 decimal places.
ALTER TABLE skus
  ALTER COLUMN quantity_on_hand TYPE NUMERIC(14,4)
  USING quantity_on_hand::numeric;

ALTER TABLE skus
  ALTER COLUMN quantity_on_hand SET DEFAULT 0;

ALTER TABLE inventory_adjustments
  ALTER COLUMN delta TYPE NUMERIC(14,4)
  USING delta::numeric;

-- ── 2. skus.unit (D4 — display-only unit label) ────────────────
-- "oz", "each", "g", "ft", etc. No conversion engine — purely a
-- label shown next to quantities. DEFAULT 'each' for existing rows.
ALTER TABLE skus
  ADD COLUMN IF NOT EXISTS unit TEXT NOT NULL DEFAULT 'each';

-- ── 3. bom_components — the recipes ────────────────────────────
-- One row per (finished good, component). quantity_per_unit is how
-- many component units go into ONE finished good. Single-level only
-- in v1 (a component can technically reference any SKU, but the
-- production engine deducts one level deep).
CREATE TABLE IF NOT EXISTS bom_components (
  id                  INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  client_id           INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  parent_sku_id       INTEGER NOT NULL REFERENCES skus(id) ON DELETE CASCADE,
  component_sku_id    INTEGER NOT NULL REFERENCES skus(id) ON DELETE CASCADE,
  quantity_per_unit   NUMERIC(14,4) NOT NULL CHECK (quantity_per_unit > 0),
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- One component row per recipe; editing qty updates in place.
  UNIQUE (parent_sku_id, component_sku_id)
);
-- Note: the "a SKU can't be its own component" rule is enforced in
-- application code, not here (a cheap CHECK can't compare the two
-- FK columns cleanly across all PG versions without a trigger).

CREATE INDEX IF NOT EXISTS idx_bom_parent
  ON bom_components (parent_sku_id);
CREATE INDEX IF NOT EXISTS idx_bom_component
  ON bom_components (component_sku_id);

-- ── 4. production_runs — the "made a batch" events ─────────────
CREATE TABLE IF NOT EXISTS production_runs (
  id                  INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  client_id           INTEGER NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  finished_sku_id     INTEGER NOT NULL REFERENCES skus(id) ON DELETE CASCADE,
  quantity_produced   NUMERIC(14,4) NOT NULL CHECK (quantity_produced > 0),
  run_date            DATE NOT NULL,
  notes               TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_production_runs_finished
  ON production_runs (finished_sku_id, run_date DESC);

-- ── 5. Link the ledger to production runs ──────────────────────
-- Extend the reason enum with the two production movements, and add
-- a nullable FK so every stock move a run causes is traceable back
-- to (and reversible by) that run.
ALTER TABLE inventory_adjustments
  DROP CONSTRAINT IF EXISTS inventory_adjustments_reason_check;
ALTER TABLE inventory_adjustments
  ADD CONSTRAINT inventory_adjustments_reason_check
  CHECK (reason IN ('sale','receive','manual','recount','correction',
                    'production_in','production_out'));

ALTER TABLE inventory_adjustments
  ADD COLUMN IF NOT EXISTS production_run_id INTEGER
    REFERENCES production_runs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_adj_production_run
  ON inventory_adjustments (production_run_id)
  WHERE production_run_id IS NOT NULL;
