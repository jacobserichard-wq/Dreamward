-- 0008_add_invoices_tables.sql
-- Phase 6 (AR Aging & Follow-ups). Designed in
-- session-notes/phase-6-ar-design.md. Sub-session 20 commit 1 of 9.
--
-- Two new tables (invoices, invoice_payments) plus a nullable invoice_id
-- FK on processed_items mirroring the Phase 3 event_id precedent.
--
-- Notes:
--   - Customer is freeform on the invoice row, not a separate table
--     (design §1 #2). customer_name NOT NULL; customer_email nullable
--     (required only at send-reminder time, per design §1 #3).
--   - amount_paid is denormalized — kept in sync by the API layer via
--     transaction-wrapped writes in lib/invoices.ts. SUM-the-payments
--     would be cleaner but every list page would pay a join cost.
--   - status values: open | partial | paid | written_off. NOT the same
--     vocabulary as processed_items.status (pending/overdue/needs_review/
--     paid) — intentional: aging bucket is derived (design §1 #7), and
--     'open' is a fresh-issued invoice that isn't overdue yet.
--   - DATE type for invoice_date + due_date matches events.start_date.
--     IMPORTANT: lib/db.ts already overrides the pg DATE type parser
--     (OID 1082 → YYYY-MM-DD string) from sub-session 19's fix; do not
--     re-cast or re-Date()-wrap when reading these columns.
--   - reminder_count + last_reminder_sent_at carry the rate-limit state
--     for POST /api/invoices/[id]/reminder (design commit 8).
--
-- Plan gating: NOT enforced at the DB layer. Every API route checks
-- getPlanFeatures(client.plan).modules.includes("ar") and 403s if false.
-- The "ar" module is already present in growth.modules + pro.modules
-- in lib/plans.ts, absent from trial/starter — no plans.ts change needed
-- for Phase 6.
--
-- Apply via:
--   node --env-file=.env.local scripts/run-migration.mjs \
--     db/migrations/0008_add_invoices_tables.sql
-- (NOT Railway's web query console — multi-statement DDL is unreliable
-- there per sub-session 16.)
--
-- Verify with:
--   \d invoices
--   \d invoice_payments
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'processed_items' AND column_name = 'invoice_id';
-- Expected: two new tables present, processed_items.invoice_id column
-- added.
--
-- Ordering hazard: commit 3 (app/api/invoices/route.ts) reads from these
-- tables. Apply this migration on Railway BEFORE pushing commit 3 to
-- production. Commits 1 and 2 are safe to deploy anytime — neither has
-- runtime code that hits the new tables.
--
-- Idempotency: every CREATE / ADD COLUMN uses IF NOT EXISTS, matching
-- the 0001-0007 convention. Re-running this migration is safe.

CREATE TABLE IF NOT EXISTS invoices (
  id              INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  client_id       INTEGER NOT NULL REFERENCES clients(id),
  customer_name   TEXT NOT NULL,
  customer_email  TEXT,
  invoice_number  TEXT,
  invoice_date    DATE NOT NULL,
  due_date        DATE NOT NULL,
  amount_total    NUMERIC(10,2) NOT NULL,
  amount_paid     NUMERIC(10,2) NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'open',
  notes           TEXT,
  last_reminder_sent_at TIMESTAMPTZ,
  reminder_count  INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_invoices_client_due       ON invoices (client_id, due_date);
CREATE INDEX IF NOT EXISTS idx_invoices_client_status    ON invoices (client_id, status);
CREATE INDEX IF NOT EXISTS idx_invoices_client_customer  ON invoices (client_id, customer_name);

CREATE TABLE IF NOT EXISTS invoice_payments (
  id           INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  invoice_id   INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  client_id    INTEGER NOT NULL REFERENCES clients(id),
  amount       NUMERIC(10,2) NOT NULL,
  paid_at      DATE NOT NULL,
  method       TEXT,
  reference    TEXT,
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice    ON invoice_payments (invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_payments_client_paid ON invoice_payments (client_id, paid_at DESC);

ALTER TABLE processed_items
  ADD COLUMN IF NOT EXISTS invoice_id INTEGER REFERENCES invoices(id);
CREATE INDEX IF NOT EXISTS idx_processed_items_invoice ON processed_items (invoice_id);
