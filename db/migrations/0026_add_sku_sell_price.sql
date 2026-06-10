-- 0026_add_sku_sell_price.sql
--
-- Market-day mode (design: session-notes/design-market-day-mode.md,
-- decision D2). SKUs gain an optional default SELLING price — what
-- the customer pays at the booth — distinct from sku_cost_history,
-- which tracks what the merchant pays (COGS input).
--
-- Used by /market-day tap-to-sell tiles: tap = log one sale at this
-- price. NULL = no price set yet; the UI prompts on first tap and
-- persists here. NUMERIC(10,2) matches the events money columns.
--
-- Railway quirk reminder: run the ALTER alone in one paste-only run;
-- run the verify SELECT separately.

ALTER TABLE skus ADD COLUMN default_sell_price NUMERIC(10,2);

-- Verify (run separately):
--   SELECT column_name, data_type, numeric_precision, numeric_scale
--     FROM information_schema.columns
--    WHERE table_name = 'skus' AND column_name = 'default_sell_price';
-- Expect one row: default_sell_price | numeric | 10 | 2
