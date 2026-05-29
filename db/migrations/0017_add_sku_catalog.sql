-- 0017_add_sku_catalog.sql
-- Phase 12a (COGS System — SKU catalog layer). Three new tables
-- that together model the FlowWork SKU registry:
--
--   skus              — one row per merchant-defined SKU.
--                       The "stock keeping unit" the merchant
--                       cares about (e.g., "CB1" → Coffee Beans 1lb).
--
--   sku_cost_history  — point-in-time cost per SKU. Multiple rows
--                       per SKU, each with an effective_date. Cost
--                       on a given date = newest row with
--                       effective_date <= that date. This is what
--                       lets historical sales keep their historical
--                       cost when the merchant later changes price.
--
--   sku_aliases       — mapping from external platform identifiers
--                       (Shopify variant ID, Wix product ID, Square
--                       catalog item variation ID) to a FlowWork SKU.
--                       One FlowWork SKU can have many aliases
--                       (same product sold across platforms); each
--                       external ID belongs to at most one FlowWork
--                       SKU (enforced by UNIQUE (platform, external_id)).
--
-- The next migration (0018) adds processed_item_line_items —
-- the bridge between sales and these SKUs. This migration is
-- standalone and can ship first; the SKU catalog UI (Phase 12b)
-- depends only on these three tables.
--
-- Apply via:
--   node --env-file=.env.local scripts/run-migration.mjs \
--     db/migrations/0017_add_sku_catalog.sql
--
-- Verify with:
--   SELECT table_name
--     FROM information_schema.tables
--    WHERE table_name IN ('skus','sku_cost_history','sku_aliases')
--    ORDER BY table_name;
-- Expected: 3 rows.
--
-- Rollback (additive, safe):
--   DROP INDEX IF EXISTS idx_sku_aliases_lookup;
--   DROP INDEX IF EXISTS idx_sku_cost_history_sku_date;
--   DROP TABLE IF EXISTS sku_aliases;
--   DROP TABLE IF EXISTS sku_cost_history;
--   DROP TABLE IF EXISTS skus;
--
-- Idempotency: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT
-- EXISTS throughout. Re-running is safe.

-- ── skus ──────────────────────────────────────────────────────
-- One row per merchant-defined SKU. `code` is the merchant's
-- short identifier ("CB1"); `name` is the human label. UNIQUE
-- (client_id, code) prevents the same code from being created
-- twice for one client, but different clients can reuse codes.
CREATE TABLE IF NOT EXISTS skus (
  id            INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  client_id     INTEGER NOT NULL REFERENCES clients(id),
  code          TEXT NOT NULL,             -- merchant-defined short code
  name          TEXT NOT NULL,             -- display name
  description   TEXT,
  active        BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (client_id, code)
);

-- ── sku_cost_history ──────────────────────────────────────────
-- Tracks the per-unit cost of a SKU over time. Each row is
-- "this SKU costs $X starting on this date." Lookup pattern:
--
--   SELECT cost FROM sku_cost_history
--    WHERE sku_id = $1 AND effective_date <= $2
--    ORDER BY effective_date DESC LIMIT 1;
--
-- The descending index on (sku_id, effective_date) makes the
-- LIMIT 1 lookup O(log n) per line item.
--
-- UNIQUE (sku_id, effective_date) prevents two cost rows for
-- the same SKU on the same date; if the merchant edits a date
-- they have to delete the older row first or the editor in
-- Phase 12b can do an upsert.
CREATE TABLE IF NOT EXISTS sku_cost_history (
  id              INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  sku_id          INTEGER NOT NULL REFERENCES skus(id) ON DELETE CASCADE,
  cost            NUMERIC(12,4) NOT NULL,    -- per-unit cost
  currency        TEXT NOT NULL DEFAULT 'USD',
  effective_date  DATE NOT NULL,             -- when this cost begins applying
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (sku_id, effective_date)
);

CREATE INDEX IF NOT EXISTS idx_sku_cost_history_sku_date
  ON sku_cost_history (sku_id, effective_date DESC);

-- ── sku_aliases ───────────────────────────────────────────────
-- Maps a platform-side identifier to a FlowWork SKU. external_id
-- is whatever stable identifier the platform issues for the item
-- variation:
--   - Shopify: variant ID (numeric, but stored as TEXT for
--     consistency with the rest of the FlowWork schema)
--   - Wix:     catalogReference.catalogItemId (UUID)
--   - Square:  catalog_object_id of the item variation
--
-- external_sku is the platform-side SKU code (display string)
-- when the platform exposes one — handy for the bulk-import UI
-- to show "Shopify SKU CB1" next to "FlowWork SKU CB1" so the
-- merchant can confirm the match without leaving FlowWork.
--
-- UNIQUE (platform, external_id) — one external item maps to
-- exactly one FlowWork SKU. Trying to remap requires deleting
-- the old alias first.
CREATE TABLE IF NOT EXISTS sku_aliases (
  id            INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  sku_id        INTEGER NOT NULL REFERENCES skus(id) ON DELETE CASCADE,
  platform      TEXT NOT NULL,               -- 'shopify' | 'wix' | 'square'
  external_id   TEXT NOT NULL,               -- platform's item-variation ID
  external_sku  TEXT,                        -- platform's SKU code (display)
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (platform, external_id)
);

CREATE INDEX IF NOT EXISTS idx_sku_aliases_lookup
  ON sku_aliases (platform, external_id);
