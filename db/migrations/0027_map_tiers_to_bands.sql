-- 0027_map_tiers_to_bands.sql
-- Pricing pivot → 7-band revenue ladder. Maps the legacy 4-tier plan
-- values on clients.plan to the new band ids so client.plan stays in
-- sync with the code-side model (lib/plans.ts BANDS).
--
-- Mapping (legacy revenue range → starting band):
--   dream  (<$5k)        -> band1  ($10)   same floor
--   maker  ($5k–$50k)    -> band2  ($15)   lowest band in the old range
--   growth ($50k–$500k)  -> band5  ($48)   mid-low band in the old range
--   pro    ($500k+)      -> band7  ($99)   top band
--
-- These are STARTING bands. The monthly reconcile cron
-- (lib/revenueTier.ts) recomputes each client's band from their actual
-- trailing-12-month revenue on the 1st and corrects any row that the
-- coarse mapping placed too high or too low. Mapping to the lower end
-- of each old range avoids over-charging anyone before that correction.
--
-- Access is unaffected: every band grants full feature access (same as
-- every legacy tier did), so this is never a feature downgrade. trial
-- and canceled rows are intentionally left untouched.
--
-- Idempotency: WHERE clauses key on the legacy values, so re-running is
-- safe — rows already on a band are not matched.
--
-- Apply via:
--   node --env-file=.env.local scripts/run-migration.mjs \
--     db/migrations/0027_map_tiers_to_bands.sql
--
-- Verify with:
--   SELECT plan, COUNT(*) FROM clients GROUP BY plan ORDER BY plan;
--   -- Expected: no rows where plan IN ('dream','maker','growth','pro')
--
-- Rollback (strategic reversal — best-effort, loses exact original
-- sub-tier for growth since two old tiers can't be recovered from one
-- band):
--   UPDATE clients SET plan='dream'  WHERE plan='band1';
--   UPDATE clients SET plan='maker'  WHERE plan='band2';
--   UPDATE clients SET plan='growth' WHERE plan='band5';
--   UPDATE clients SET plan='pro'    WHERE plan='band7';

UPDATE clients SET plan = 'band1', updated_at = NOW() WHERE plan = 'dream';
UPDATE clients SET plan = 'band2', updated_at = NOW() WHERE plan = 'maker';
UPDATE clients SET plan = 'band5', updated_at = NOW() WHERE plan = 'growth';
UPDATE clients SET plan = 'band7', updated_at = NOW() WHERE plan = 'pro';
