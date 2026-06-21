-- 0033_costing_method_optin.sql
-- Inventory Pass 2 follow-up (June 2026): make component costing OPT-IN.
--
-- Migration 0032 backfilled costing_method='components' for every SKU
-- that had a recipe (was a bom_components parent). That conflated two
-- different things: recipes existed since Tier 2 for PRODUCTION
-- drawdown ("I made a batch -> deduct materials"), not necessarily to
-- drive the product's COST. Auto-treating those products as
-- component-costed means the Pass 2 rollup engine would silently
-- rewrite their COGS the next time any component's cost changed.
--
-- Decision (confirmed with the owner): component costing is a
-- deliberate, per-SKU choice made in the new "Advanced: build cost
-- from components" UI, where the maker sees the rolled-up preview
-- before switching. So reset every SKU back to the flat 'estimated'
-- default. Recipes are left untouched (production drawdown still works);
-- only the costing intent is reset.
--
-- This is safe to run because nothing other than 0032's backfill has
-- ever written costing_method='components' yet (the opt-in PATCH ships
-- alongside this). Idempotent: re-running is a no-op once everything is
-- 'estimated'.
--
-- Apply via:
--   node --env-file=.env.local scripts/run-migration.mjs \
--     db/migrations/0033_costing_method_optin.sql
--
-- Rollback: none needed -- this only relaxes a speculative backfill.
-- A maker re-enables component costing per-SKU through the UI.

UPDATE skus
   SET costing_method = 'estimated',
       updated_at = NOW()
 WHERE costing_method = 'components';

-- Verification (printed by the migration runner): should be 0 rows.
SELECT id, code, name, costing_method
  FROM skus
 WHERE costing_method = 'components';
