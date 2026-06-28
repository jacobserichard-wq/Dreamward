-- 0040_add_invoice_sent_at.sql
-- Tracks when an invoice was last EMAILED to the customer via the
-- "Send invoice" action (POST /api/invoices/[id]/send) — distinct from
-- last_reminder_sent_at (the overdue-reminder rate-limit clock). Powers
-- the "Sent <when>" indicator on the AR list + invoice detail so the
-- user can see at a glance which invoices they've sent.
--
-- Nullable, no default → instant (no table rewrite), idempotent.
--
-- Apply via:
--   node --env-file=.env.local scripts/run-migration.mjs \
--     db/migrations/0040_add_invoice_sent_at.sql
--
-- Verify:
--   SELECT column_name, data_type FROM information_schema.columns
--    WHERE table_name = 'invoices' AND column_name = 'invoice_sent_at';
--
-- Rollback (safe): ALTER TABLE invoices DROP COLUMN IF EXISTS invoice_sent_at;

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS invoice_sent_at TIMESTAMPTZ;

SELECT column_name, data_type
  FROM information_schema.columns
 WHERE table_name = 'invoices' AND column_name = 'invoice_sent_at';
