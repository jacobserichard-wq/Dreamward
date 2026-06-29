-- 0044_add_processed_stripe_events.sql
--
-- Idempotency guard for the Stripe webhooks. Stripe delivers at-least-once
-- and replays on any non-2xx response, so the same event.id can arrive
-- more than once. We record each processed event id and skip duplicates,
-- so replays don't re-run side effects (re-arming a Shopify backfill,
-- re-sending payment emails, restarting the past-due grace clock, etc.).
--
-- Shared by both the platform webhook and the Connect webhook (event ids
-- are globally unique across them).
CREATE TABLE IF NOT EXISTS processed_stripe_events (
  event_id     TEXT PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
