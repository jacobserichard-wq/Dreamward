-- scripts/wipe-client-data.sql
--
-- Sub-session 24: ops utility for wiping a single client's data from
-- FlowWork end-to-end. Used to:
--   - Test the signup/onboarding flow as a true first-time user
--     (delete your dev account, re-sign-up to walk through the redesign)
--   - Honor a customer's right-to-erasure request (GDPR / CCPA)
--   - Clean up an internal test account before a demo
--
-- IRREVERSIBLE. No backup, no audit trail (DELETE removes the rows;
-- nothing logs them elsewhere). Run only when you're 100% sure.
--
-- ──────────────────────────────────────────────────────────────────────
-- BEFORE RUNNING — check Stripe
-- ──────────────────────────────────────────────────────────────────────
--
-- If the target client has an active Stripe subscription, deleting their
-- clients row leaves a Stripe customer that keeps billing the card on
-- file. Verify first:
--
--   SELECT id, email, plan, stripe_customer_id, stripe_subscription_id
--     FROM clients
--    WHERE email = 'TARGET_EMAIL@example.com';
--
-- If stripe_subscription_id IS NOT NULL, cancel the subscription via the
-- customer's /billing page (Stripe portal) OR the Stripe dashboard
-- directly BEFORE running the wipe. A canceled / never-paid subscription
-- is safe to leave — only active billing matters.
--
-- ──────────────────────────────────────────────────────────────────────
-- USAGE
-- ──────────────────────────────────────────────────────────────────────
--
-- 1. EDIT the target_email value below (search for "EDIT THIS")
-- 2. Paste the whole file into Railway's query console
-- 3. Read the NOTICE output to confirm the right client_id was wiped
-- 4. Run the verification block at the bottom to confirm zero rows
--
-- Single transaction — if any DELETE fails, nothing changes.

BEGIN;

DO $$
DECLARE
  -- Pin the client_id once so concurrent re-signup can't race us.
  -- If no row matches, target_client_id stays NULL and every DELETE
  -- below is a no-op (safe).
  target_client_id INTEGER;
  -- ↓↓↓ EDIT THIS BEFORE RUNNING ↓↓↓
  target_email     TEXT := 'TARGET_EMAIL@example.com';
  -- ↑↑↑ EDIT THIS BEFORE RUNNING ↑↑↑
BEGIN
  SELECT id INTO target_client_id
    FROM clients
   WHERE email = target_email;

  IF target_client_id IS NULL THEN
    RAISE NOTICE 'No client found for % — nothing to delete.', target_email;
    RETURN;
  END IF;

  RAISE NOTICE 'Wiping data for client_id = % (email: %)', target_client_id, target_email;

  -- Order matters: children before parents (FK constraints).
  --
  -- invoice_payments / event_items have ON DELETE CASCADE on their
  -- event_id / invoice_id FKs — but a separate non-cascading client_id
  -- FK that requires the clients row to still exist. So child-first
  -- deletion of these two tables is what makes the transaction order
  -- safe (and explicit DELETE is what the cascade would do anyway).
  --
  -- processed_items has nullable FKs to events + invoices; deleting it
  -- before those two parents is required because there's no cascade.
  DELETE FROM invoice_payments  WHERE client_id = target_client_id;
  DELETE FROM event_items        WHERE client_id = target_client_id;
  DELETE FROM processed_items    WHERE client_id = target_client_id;
  DELETE FROM invoices           WHERE client_id = target_client_id;
  DELETE FROM events             WHERE client_id = target_client_id;
  DELETE FROM usage_logs         WHERE client_id = target_client_id;
  DELETE FROM client_settings    WHERE client_id = target_client_id;
  DELETE FROM clients            WHERE id        = target_client_id;

  RAISE NOTICE 'Wipe complete for client_id = %', target_client_id;
END $$;

COMMIT;

-- ──────────────────────────────────────────────────────────────────────
-- VERIFICATION
-- ──────────────────────────────────────────────────────────────────────
-- Run this block separately AFTER the BEGIN/COMMIT above. Every row
-- should return 0. Re-edit the email literal below to match the target.
--
-- SELECT 'clients' AS tbl, COUNT(*) FROM clients
--    WHERE email = 'TARGET_EMAIL@example.com'
-- UNION ALL SELECT 'client_settings', COUNT(*) FROM client_settings cs
--    JOIN clients c ON cs.client_id = c.id WHERE c.email = 'TARGET_EMAIL@example.com'
-- UNION ALL SELECT 'processed_items', COUNT(*) FROM processed_items pi
--    JOIN clients c ON pi.client_id = c.id WHERE c.email = 'TARGET_EMAIL@example.com'
-- UNION ALL SELECT 'events', COUNT(*) FROM events e
--    JOIN clients c ON e.client_id = c.id WHERE c.email = 'TARGET_EMAIL@example.com'
-- UNION ALL SELECT 'invoices', COUNT(*) FROM invoices i
--    JOIN clients c ON i.client_id = c.id WHERE c.email = 'TARGET_EMAIL@example.com'
-- UNION ALL SELECT 'usage_logs', COUNT(*) FROM usage_logs ul
--    JOIN clients c ON ul.client_id = c.id WHERE c.email = 'TARGET_EMAIL@example.com';
