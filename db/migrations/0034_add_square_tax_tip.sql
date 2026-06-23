-- db/migrations/0034_add_square_tax_tip.sql
--
-- Capture sales tax + tips separately on processed_items so revenue can be
-- reported tax-accurately. Sales tax collected is a pass-through liability
-- (excluded from income); tips are taxable income (kept in). Both columns
-- are nullable: null means "not broken out" (legacy rows, non-Square rows,
-- or payments without an itemized order). `amount` stays the GROSS total —
-- callers compute taxable revenue as amount - COALESCE(tax_amount, 0).

ALTER TABLE processed_items
  ADD COLUMN IF NOT EXISTS tax_amount NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS tip_amount NUMERIC(12,2);
