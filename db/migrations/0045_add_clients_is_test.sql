-- 0045_add_clients_is_test.sql
--
-- Test/internal account flag. Lets outbound nudge emails (trial-expiry,
-- COGS daily digest) exclude internal + seed accounts so they only ever
-- reach real customers — the prerequisite for re-enabling those emails.
--
-- Default false. Flag specific accounts manually
-- (UPDATE clients SET is_test = true WHERE ...) — intentionally NOT set
-- here, so no existing customer row is modified by this migration.
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS is_test BOOLEAN NOT NULL DEFAULT false;
