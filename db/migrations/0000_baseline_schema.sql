-- 0000_baseline_schema.sql
--
-- BASELINE for the three core tables (clients, client_settings,
-- processed_items). These predate this migration folder — they were created
-- directly on the database before migrations were tracked, so there was no
-- CREATE TABLE for them in version control. A fresh environment (new Railway
-- DB, a restored backup, a teammate's copy) therefore could NOT be stood up
-- from this repo alone. This file closes that gap.
--
-- It captures their CURRENT live structure (columns, types, defaults,
-- NOT NULL, primary keys, indexes) as of 2026-06-29, generated from the
-- production schema. Everything is IF NOT EXISTS, so it is a NO-OP on any
-- database where these tables already exist (including prod) — it only does
-- real work on a brand-new database, where it must run FIRST (hence 0000).
-- The later migrations (0001+) then ALTER these tables; their
-- ADD COLUMN IF NOT EXISTS statements become no-ops because the columns
-- already exist here.
--
-- NOTE: foreign-key constraints are intentionally not reproduced — the app
-- runs on the column structure, and FKs are integrity guards. The goal here
-- is reproducibility of a WORKING schema, not a byte-exact dump.

CREATE TABLE IF NOT EXISTS clients (
  id SERIAL NOT NULL,
  email VARCHAR(255) NOT NULL,
  business_name VARCHAR(255),
  industry VARCHAR(100),
  plan VARCHAR(20) DEFAULT 'trial'::character varying NOT NULL,
  stripe_customer_id VARCHAR(255),
  stripe_subscription_id VARCHAR(255),
  trial_ends_at TIMESTAMPTZ DEFAULT (now() + '14 days'::interval),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  onboarding_completed BOOLEAN DEFAULT false,
  welcome_pro_seen BOOLEAN DEFAULT false NOT NULL,
  pro_call_booked_at TIMESTAMPTZ,
  pro_call_scheduled_for TIMESTAMPTZ,
  calendly_event_uri TEXT,
  pro_call_reminder_sent_at TIMESTAMPTZ,
  home_address TEXT,
  labor_hourly_rate NUMERIC(10,2),
  cached_trailing_revenue NUMERIC(14,2),
  cached_would_be_band TEXT,
  revenue_cached_at TIMESTAMPTZ,
  past_due_since TIMESTAMPTZ,
  is_test BOOLEAN DEFAULT false NOT NULL,
  PRIMARY KEY (id)
);

CREATE UNIQUE INDEX IF NOT EXISTS clients_email_key ON clients USING btree (email);

CREATE TABLE IF NOT EXISTS client_settings (
  id SERIAL NOT NULL,
  client_id INTEGER NOT NULL,
  active_modules JSONB DEFAULT '["invoices", "expenses", "ar"]'::jsonb,
  custom_categories JSONB DEFAULT '["Supplies", "Booth Fees", "Travel/Gas", "Packaging", "Marketing", "Other"]'::jsonb,
  preferences JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE UNIQUE INDEX IF NOT EXISTS client_settings_client_id_key ON client_settings USING btree (client_id);

CREATE TABLE IF NOT EXISTS processed_items (
  id SERIAL NOT NULL,
  vendor VARCHAR(255) NOT NULL,
  invoice_number VARCHAR(100),
  amount NUMERIC(12,2) DEFAULT 0,
  due_date DATE,
  status TEXT DEFAULT 'needs_review'::character varying NOT NULL,
  category TEXT NOT NULL,
  confidence INTEGER DEFAULT 0,
  summary TEXT,
  raw_email_id VARCHAR(255),
  extracted_data JSONB,
  processed_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  client_id INTEGER,
  source TEXT DEFAULT 'email'::character varying,
  ai_classified_at TIMESTAMPTZ,
  ai_model TEXT,
  original_ai_category TEXT,
  event_id INTEGER,
  invoice_id INTEGER,
  source_ref_id TEXT,
  channel TEXT,
  notes TEXT,
  plaid_transaction_id TEXT,
  plaid_account_id TEXT,
  plaid_item_id TEXT,
  tax_amount NUMERIC(12,2),
  tip_amount NUMERIC(12,2),
  service_charge_amount NUMERIC(12,2),
  discount_amount NUMERIC(12,2),
  received_sku_id INTEGER,
  received_quantity NUMERIC(12,4),
  PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS idx_processed_items_event ON processed_items USING btree (event_id);
CREATE INDEX IF NOT EXISTS idx_processed_items_invoice ON processed_items USING btree (invoice_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_processed_items_source_ref ON processed_items USING btree (client_id, source, source_ref_id) WHERE (source_ref_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_processed_items_client_channel ON processed_items USING btree (client_id, channel) WHERE (channel IS NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS idx_processed_items_plaid_txn ON processed_items USING btree (client_id, plaid_transaction_id) WHERE (plaid_transaction_id IS NOT NULL);
CREATE INDEX IF NOT EXISTS idx_processed_items_plaid_item ON processed_items USING btree (client_id, plaid_item_id) WHERE (plaid_item_id IS NOT NULL);
