-- db/migrations/0037_add_fifo_cost_layers.sql
--
-- FIFO (first-in, first-out) perpetual inventory costing.
--
-- Replaces the date-effective cost lookup (sku_cost_history +
-- effective_date <= sold_at) with tracked cost LAYERS that drain oldest-
-- first. The cost of a sale follows the actual units consumed, so old
-- stock is costed at its real purchase price until depleted, then the
-- next purchase's price takes over. A consumption that spans two layers
-- (e.g. 30 units left at the old price + 20 at the new) blends them.
--
-- Two tables + two line-item columns:
--   cost_layers       — one row per batch acquired at a known unit cost,
--                       with a remaining_qty drawn down FIFO.
--   cost_consumptions — every draw-down: which layer, how much, what cost,
--                       and why. Gives an audit trail + clean reversibility
--                       for production-run reversal / sale voids.
--   processed_item_line_items.cogs_amount / cogs_is_estimated
--                     — FIFO COGS stamped onto the line item at sale/match
--                       time. compute.ts sums this instead of recomputing.
--
-- SCOPE: feeds the margin view + ending-inventory valuation only. Cash-
-- basis Net Profit (Total Sales − Total Expenses, purchases expensed when
-- bought) is unchanged — no double-count.
--
-- Idempotent: CREATE TABLE / CREATE INDEX / ADD COLUMN are all IF NOT
-- EXISTS, so re-running is safe.
--
-- Verify:
--   SELECT table_name FROM information_schema.tables
--    WHERE table_name IN ('cost_layers','cost_consumptions');
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name='processed_item_line_items'
--      AND column_name IN ('cogs_amount','cogs_is_estimated');
--
-- Rollback:
--   ALTER TABLE processed_item_line_items
--     DROP COLUMN IF EXISTS cogs_amount,
--     DROP COLUMN IF EXISTS cogs_is_estimated;
--   DROP TABLE IF EXISTS cost_consumptions;
--   DROP TABLE IF EXISTS cost_layers;

-- ── cost_layers ───────────────────────────────────────────────
-- A batch of stock acquired at one known unit cost. remaining_qty is
-- decremented as the layer is consumed; a layer with remaining_qty = 0
-- is fully drained but kept for history. FIFO order = (acquired_at, id).
CREATE TABLE IF NOT EXISTS cost_layers (
  id            BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  client_id     INTEGER NOT NULL REFERENCES clients(id),
  sku_id        INTEGER NOT NULL REFERENCES skus(id) ON DELETE CASCADE,
  -- where the layer came from:
  --   receive    — a purchase received into a component's stock
  --   production  — a finished-good batch (cost = FIFO sum of components)
  --   opening     — seeded from existing stock at migration time
  --   manual      — a manual positive stock adjustment with a cost
  source        TEXT NOT NULL
                  CHECK (source IN ('receive','production','opening','manual')),
  source_ref_id INTEGER,                              -- processed_item / production_run id
  acquired_at   DATE NOT NULL,                        -- FIFO ordering key (tiebreak: id)
  original_qty  NUMERIC(14,4) NOT NULL CHECK (original_qty > 0),
  remaining_qty NUMERIC(14,4) NOT NULL CHECK (remaining_qty >= 0),
  unit_cost     NUMERIC(14,6) NOT NULL CHECK (unit_cost >= 0),
  notes         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fast FIFO scan: only open layers, in draw-down order, per SKU.
CREATE INDEX IF NOT EXISTS idx_cost_layers_fifo
  ON cost_layers (sku_id, acquired_at, id)
  WHERE remaining_qty > 0;

CREATE INDEX IF NOT EXISTS idx_cost_layers_client
  ON cost_layers (client_id, sku_id);

-- ── cost_consumptions ─────────────────────────────────────────
-- One row per (layer, draw-down event). consumed_qty came out of layer_id
-- at unit_cost. reason + the two nullable refs say what caused it. On
-- reversal we read these back to restore remaining_qty exactly.
CREATE TABLE IF NOT EXISTS cost_consumptions (
  id                BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  layer_id          BIGINT NOT NULL REFERENCES cost_layers(id) ON DELETE CASCADE,
  sku_id            INTEGER NOT NULL REFERENCES skus(id) ON DELETE CASCADE,
  consumed_qty      NUMERIC(14,4) NOT NULL CHECK (consumed_qty > 0),
  unit_cost         NUMERIC(14,6) NOT NULL CHECK (unit_cost >= 0),  -- snapshot of layer cost
  reason            TEXT NOT NULL
                      CHECK (reason IN ('production_out','sale','manual_out','correction')),
  production_run_id INTEGER REFERENCES production_runs(id) ON DELETE SET NULL,
  line_item_id      INTEGER REFERENCES processed_item_line_items(id) ON DELETE SET NULL,
  -- true when the draw-down out-ran available layers (negative stock) and
  -- the cost is a fallback (last-known unit_cost, or 0). Never silently
  -- zeroed — surfaced in the UI.
  is_estimated      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cost_consumptions_run
  ON cost_consumptions (production_run_id);
CREATE INDEX IF NOT EXISTS idx_cost_consumptions_line_item
  ON cost_consumptions (line_item_id);
CREATE INDEX IF NOT EXISTS idx_cost_consumptions_layer
  ON cost_consumptions (layer_id);

-- ── processed_item_line_items: stamped FIFO COGS ──────────────
-- COGS is recorded at sale/match time (FIFO can't be recomputed lazily).
-- compute.ts sums cogs_amount instead of running the date-effective cost
-- subquery. cogs_amount NULL = not yet costed (unmatched, or pre-FIFO row
-- awaiting backfill). cogs_is_estimated = at least one consumed layer was
-- a negative-stock fallback.
ALTER TABLE processed_item_line_items
  ADD COLUMN IF NOT EXISTS cogs_amount       NUMERIC(14,4),
  ADD COLUMN IF NOT EXISTS cogs_is_estimated BOOLEAN NOT NULL DEFAULT FALSE;
