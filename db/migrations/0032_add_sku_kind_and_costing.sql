-- 0032_add_sku_kind_and_costing.sql
-- Inventory simplification (June 2026): make the finished-good vs material
-- distinction explicit, and let a product cost be a flat estimate OR built
-- from components.
--
-- Two additive columns on skus:
--   - kind: 'product' (finished good you sell) | 'component' (material that
--     goes into a product). Today the distinction is only implicit (via
--     bom_components parent/child). This makes it a first-class field so the
--     catalog can split into Finished Goods + Components.
--   - costing_method: 'estimated' (flat per-unit cost from sku_cost_history,
--     the simple default) | 'components' (cost rolled up from the BOM). Lets
--     a maker give a product a fixed cost without ever building a recipe.
--
-- Backfill (idempotent):
--   - kind='component' for SKUs used ONLY as a recipe component (never a
--     parent); everything else stays 'product'.
--   - costing_method='components' for SKUs that have a recipe (are a BOM
--     parent); everything else stays 'estimated'.
--
-- Apply via:
--   node --env-file=.env.local scripts/run-migration.mjs \
--     db/migrations/0032_add_sku_kind_and_costing.sql
--
-- Rollback (additive, safe):
--   ALTER TABLE skus DROP COLUMN IF EXISTS kind;
--   ALTER TABLE skus DROP COLUMN IF EXISTS costing_method;
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + the UPDATEs are deterministic.

ALTER TABLE skus
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'product'
    CHECK (kind IN ('product', 'component'));

ALTER TABLE skus
  ADD COLUMN IF NOT EXISTS costing_method TEXT NOT NULL DEFAULT 'estimated'
    CHECK (costing_method IN ('estimated', 'components'));

-- Used as a component somewhere, and never a recipe parent → it's a material.
UPDATE skus s
   SET kind = 'component'
 WHERE EXISTS (
         SELECT 1 FROM bom_components b WHERE b.component_sku_id = s.id
       )
   AND NOT EXISTS (
         SELECT 1 FROM bom_components b2 WHERE b2.parent_sku_id = s.id
       );

-- Has a recipe (is a BOM parent) → its cost is built from components.
UPDATE skus s
   SET costing_method = 'components'
 WHERE EXISTS (
         SELECT 1 FROM bom_components b WHERE b.parent_sku_id = s.id
       );
