-- db/migrations/0035_add_square_service_discount.sql
--
-- Complete the per-sale money breakdown started in 0034. Service charges
-- (shipping/handling/service fees the seller adds) are income — they stay
-- in revenue, but we capture them so a sale reconciles exactly:
--   gross (amount) = line-item subtotal - discount + service + tax + tip
-- Both nullable; null = not broken out (legacy / non-Square rows).

ALTER TABLE processed_items
  ADD COLUMN IF NOT EXISTS service_charge_amount NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS discount_amount       NUMERIC(12,2);
