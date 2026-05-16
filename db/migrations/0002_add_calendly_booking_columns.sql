-- 0002_add_calendly_booking_columns.sql
-- Adds Calendly onboarding-call booking columns to clients.
-- Schema for the Calendly webhook feature (Phase 1.7 Tier 2); designed in
-- session-notes/audit-calendly-webhook.md §3.
--
-- Three new nullable columns:
--   pro_call_booked_at      — when the booking was made (invitee.created
--                             event arrival time). Becomes the banner-gate
--                             signal: NULL = "show Book your call",
--                             non-NULL = "show Your call is scheduled".
--   pro_call_scheduled_for  — the actual datetime of the call (start_time
--                             from the Calendly event). Drives the "Your
--                             call is [date] at [time]" banner copy.
--   calendly_event_uri      — Calendly's unique URI for the scheduled
--                             event. Used so a later invitee.canceled
--                             webhook can find and clear the matching
--                             booking by URI rather than by client (a
--                             single client could in theory have multiple
--                             bookings over time).
--
-- All columns nullable, no defaults: legacy clients and not-yet-booked
-- clients all carry NULL across all three columns, which is the correct
-- "no call" state.
--
-- IF NOT EXISTS clauses make this migration idempotent.
--
-- Apply on Railway: open the PostgreSQL service → Data tab (psql terminal
-- or query runner) and execute the statements below. Confirm with:
--   \d clients
-- (or SELECT column_name, data_type FROM information_schema.columns
--  WHERE table_name = 'clients' AND column_name IN
--    ('pro_call_booked_at', 'pro_call_scheduled_for', 'calendly_event_uri');)
--
-- Ordering hazard: commit 14.2 (the /api/calendly/webhook endpoint) writes
-- to these columns. Apply this migration on Railway BEFORE that commit
-- deploys, or the first Calendly webhook will 500 on missing-column errors.

ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS pro_call_booked_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pro_call_scheduled_for TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS calendly_event_uri TEXT;
