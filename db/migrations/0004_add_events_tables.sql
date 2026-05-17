-- 0004_add_events_tables.sql
-- Phase 3 (Sales & Event Logging) schema. Adds two new tables (events and
-- event_items) plus a nullable event_id FK on processed_items so uploaded
-- transactions can auto-code to events.
--
-- Designed in session-notes/phase-3-events-design.md. Sub-session 16
-- commit 1 of 5.
--
-- Three changes:
--   events table — one row per market day or multi-day fair, client_id-
--     scoped, carries name + date range + venue + optional booth_fee +
--     optional manual revenue + notes.
--   event_items table — optional product sales log; line items belong to
--     an event (ON DELETE CASCADE), denormalized client_id so item
--     queries can scope by client without joining events.
--   processed_items.event_id column — nullable FK to events(id); NULL for
--     legacy rows + any transaction not associated with an event. The FK
--     does NOT cascade on event delete; the DELETE /api/events/[id]
--     handler explicitly nulls these to preserve the transactions
--     themselves (vendors mis-enter and need a recovery path — design
--     §8.5).
--
-- Plan gating: Events is a Growth-and-Pro feature per the pricing table.
-- API routes return 403 for plan='starter'; this migration does not
-- enforce that (no DB-level role separation) — the application layer is
-- the enforcement point.
--
-- Types match existing convention (verified via Section 2 recon):
--   - INTEGER PKs / FKs (matches clients.id and processed_items.id;
--     GENERATED ALWAYS AS IDENTITY is the modern equivalent of SERIAL).
--   - NUMERIC(10,2) for money (matches processed_items.amount).
--   - DATE for event dates (matches processed_items.due_date — the
--     transaction-date column that per-row event auto-matching keys off).
--   - TIMESTAMPTZ for created_at / updated_at (matches every prior
--     timestamp column in 0001-0003).
--
-- Indexes:
--   - events (client_id, start_date DESC) drives the history list.
--   - events (client_id, start_date, end_date) drives the per-row date-
--     range match query on upload.
--   - event_items (event_id) for the line-item editor.
--   - processed_items (event_id) for the "linked transactions for event X"
--     summary on the detail page.
--
-- All CREATE statements use IF NOT EXISTS for idempotent re-runs (matches
-- the 0001/0002/0003 ADD COLUMN IF NOT EXISTS pattern).
--
-- Apply on Railway: open the PostgreSQL service → Data tab and execute
-- the statements below. Verify with:
--   \d events
--   \d event_items
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'processed_items' AND column_name = 'event_id';
-- Three new objects should appear: events table, event_items table, and
-- processed_items.event_id column.
--
-- Ordering hazard: commit 2 (app/api/events/route.ts) reads from these
-- tables; deploying that code before this migration runs causes 500 on
-- every /api/events request. Apply this migration on Railway BEFORE
-- pushing commit 2 to production. Commit 1 itself (just the .sql file
-- landing in version control) is safe to deploy anytime — no runtime
-- code depends on the new tables yet.

CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  client_id   INTEGER NOT NULL REFERENCES clients(id),
  name        TEXT NOT NULL,
  start_date  DATE NOT NULL,
  end_date    DATE NOT NULL,
  venue       TEXT,
  revenue     NUMERIC(10,2),
  booth_fee   NUMERIC(10,2) NOT NULL DEFAULT 0,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_events_client_start ON events (client_id, start_date DESC);
CREATE INDEX IF NOT EXISTS idx_events_client_range ON events (client_id, start_date, end_date);

CREATE TABLE IF NOT EXISTS event_items (
  id           INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  event_id     INTEGER NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  client_id    INTEGER NOT NULL REFERENCES clients(id),
  product_name TEXT NOT NULL,
  quantity     INTEGER NOT NULL DEFAULT 1,
  unit_price   NUMERIC(10,2) NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_event_items_event ON event_items (event_id);

ALTER TABLE processed_items
  ADD COLUMN IF NOT EXISTS event_id INTEGER REFERENCES events(id);
CREATE INDEX IF NOT EXISTS idx_processed_items_event ON processed_items (event_id);
