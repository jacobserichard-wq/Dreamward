-- 0042_add_invoice_channel.sql
--
-- AR income (invoice payments) was invisible to the dashboard channel
-- rollup + SalesBanner — only the annual tax report counted it. To route
-- a paid invoice into the right channel card (Wholesale vs Service work),
-- the invoice needs to carry which channel it belongs to.
--
-- Nullable: existing invoices have no tag; the rollup treats NULL as
-- 'wholesale' (the typical B2B invoice) via COALESCE. New invoices pick
-- the type at creation. Allowed values: 'wholesale' | 'service'
-- (the two invoice-fed channel ids in CANONICAL_CHANNELS).
ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS channel TEXT;
