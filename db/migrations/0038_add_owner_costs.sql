-- db/migrations/0038_add_owner_costs.sql
--
-- Owner/founder operating costs for the /admin owner dashboard. These are
-- DREAMWARD'S OWN costs (Vercel, Railway, Stripe fees, Resend, Anthropic,
-- domain, etc.) — NOT a client's expenses. Global (no client_id): there's
-- one owner. The owner page sums these into a monthly operating cost and
-- shows MRR − costs = net.
--
-- cadence lets annual costs (e.g. the domain) be entered once and rolled
-- up to a monthly figure (amount / 12) without the owner doing the math.
--
-- Idempotent: CREATE TABLE IF NOT EXISTS.
--
-- Verify:
--   SELECT label, amount, cadence FROM owner_costs ORDER BY id;
-- Rollback:
--   DROP TABLE IF EXISTS owner_costs;

CREATE TABLE IF NOT EXISTS owner_costs (
  id          BIGINT PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
  label       TEXT NOT NULL,
  amount      NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
  cadence     TEXT NOT NULL DEFAULT 'monthly'
                CHECK (cadence IN ('monthly', 'annual')),
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
