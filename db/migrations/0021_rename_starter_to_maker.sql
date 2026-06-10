-- 0021_rename_starter_to_maker.sql
-- Sub-session 33 pricing pivot. Renames the legacy "starter" plan
-- value to "maker" on the clients table so client.plan stays in
-- sync with the code-side rename in lib/plans.ts (commit 1 of 8).
--
-- This is a value rename only — no schema change. Any row currently
-- holding plan='starter' had Starter-tier ($19/mo) access; the new
-- Maker tier has the same $19/mo price and now also full feature
-- access (per the "everyone gets every feature" strategic shift).
-- So existing customers transparently get an UPGRADE, never a
-- downgrade.
--
-- Idempotency: the WHERE clause means re-running is safe. Rows
-- already on maker stay on maker; rows that were never starter
-- aren't touched.
--
-- Apply via:
--   node --env-file=.env.local scripts/run-migration.mjs \
--     db/migrations/0021_rename_starter_to_maker.sql
--
-- Verify with:
--   SELECT plan, COUNT(*) FROM clients GROUP BY plan;
--   -- Expected: no rows where plan = 'starter'
--
-- Rollback (in case of strategic reversal):
--   UPDATE clients SET plan = 'starter' WHERE plan = 'maker'
--     AND updated_at >= '2026-06-03';   -- bound to recent renames
--
-- Stripe-subscription side: a follow-up commit updates checkout +
-- webhook to use new Stripe products. Any active subscription
-- created against the OLD Starter Stripe product keeps billing
-- $19/mo against that product — the rename here only affects what
-- Dreamward calls the plan internally. Stripe migration to the new
-- Maker product happens lazily on next subscription cycle or via
-- a one-time admin sweep later.

UPDATE clients
   SET plan = 'maker',
       updated_at = NOW()
 WHERE plan = 'starter';
