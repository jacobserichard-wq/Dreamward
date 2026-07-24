-- 0048: Shopify App Pricing (App Store billing requirement 1.2).
--
-- Merchants acquired through the App Store must be billed through
-- Shopify, not Stripe. Shopify hosts the plan-selection page and
-- charges the merchant; we verify subscription state via the Partner
-- API activeSubscription query (no webhooks in this system — verify
-- on the welcome-link redirect + daily cron re-check).
--
-- clients.billing_source: 'stripe' (default — direct signups, all
-- existing users) | 'shopify' (App-Store-acquired). A shopify-billed
-- client gets plan='shopify' while their subscription is active and
-- the existing 'canceled' plan on cancellation. Stripe surfaces are
-- hidden for shopify-billed clients (no double-charging, ever).
--
-- shopify_connections.shop_gid: gid://shopify/Shop/N, fetched once at
-- connect — the Partner API keys subscriptions by shop GID, not domain.
-- subscription_* columns cache the last verification result.

ALTER TABLE clients
  ADD COLUMN billing_source text NOT NULL DEFAULT 'stripe';

ALTER TABLE shopify_connections
  ADD COLUMN shop_gid text,
  ADD COLUMN subscription_plan_handle text,
  ADD COLUMN subscription_trial_ends_at timestamptz,
  ADD COLUMN subscription_checked_at timestamptz;
