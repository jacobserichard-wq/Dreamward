-- db/migrations/0036_add_received_sku.sql
--
-- "Receive into inventory" link: marks a purchase (expense) row as having
-- been received into a component's stock, so it can't be received twice and
-- the Transactions card can show the linked state. Purely inventory-side —
-- the expense still counts as the cash-basis cost in Net Profit; receiving
-- only adds stock + sets the component's per-unit cost (for the margin view
-- and the ending-inventory tax number). Both columns nullable.

ALTER TABLE processed_items
  ADD COLUMN IF NOT EXISTS received_sku_id   INTEGER REFERENCES skus(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS received_quantity NUMERIC(12,4);
