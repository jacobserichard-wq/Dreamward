-- 0043_add_past_due_grace.sql
--
-- Past-due grace period. When a subscription's payment fails Stripe marks
-- it `past_due`. Instead of cutting access immediately, we keep the
-- customer's band for a 7-day grace window — the nightly cron sends daily
-- reminders and flips the account to read-only ('canceled') at the end.
--
-- This column is the grace clock: set when past_due first fires, cleared
-- when payment recovers (subscription back to active) or at cutoff.
ALTER TABLE clients
  ADD COLUMN IF NOT EXISTS past_due_since TIMESTAMPTZ;
