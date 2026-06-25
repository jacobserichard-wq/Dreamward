-- db/migrations/0038_add_labor_cost.sql
--
-- Optional labor cost as a PRICING / margin aid — informational only.
--
--   clients.labor_hourly_rate      — one rate per maker ("what my time is
--                                     worth"), used to value product labor.
--   skus.labor_minutes_per_unit    — how long one unit takes to make.
--
-- labor cost per unit = labor_minutes_per_unit / 60 × labor_hourly_rate,
-- computed at DISPLAY time. It feeds a "fully-loaded cost / margin after
-- labor" view ONLY.
--
-- IMPORTANT — never enters tax numbers: a sole proprietor's own labor is
-- NOT deductible and NOT part of COGS, so this is deliberately kept out of
-- sku_cost_history, cogs_amount, the FIFO layers, Net Profit, and the tax
-- pack. It is a managerial pricing lens, nothing more. Both columns
-- nullable; absence = "not tracked", which shows as no labor line.
--
-- Idempotent. Rollback:
--   ALTER TABLE clients DROP COLUMN IF EXISTS labor_hourly_rate;
--   ALTER TABLE skus    DROP COLUMN IF EXISTS labor_minutes_per_unit;

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS labor_hourly_rate NUMERIC(10,2);

ALTER TABLE skus
  ADD COLUMN IF NOT EXISTS labor_minutes_per_unit NUMERIC(10,2);
