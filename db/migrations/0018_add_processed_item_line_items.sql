-- 0018_add_processed_item_line_items.sql
-- Phase 12a (COGS System — sales-to-SKU bridge). One new table
-- that fans every line item of every processed_items sale row
-- out into its own row, so reports can compute revenue/COGS at
-- the SKU level instead of only at the order level.
--
-- Relationship to 0017:
--   processed_item_line_items.matched_sku_id → skus.id (nullable)
--   processed_items.id ← processed_item_line_items.processed_item_id
--
-- One processed_items row (an order or payment) → many
-- processed_item_line_items rows (one per item sold).
--
-- Why a separate table instead of just JSONB on processed_items?
--   - The platforms already put line items in extracted_data, but
--     extracted_data is opaque to reporting SQL. Pulling line
--     items into a real table unlocks GROUP BY sku, period filters,
--     and joins to sku_cost_history.
--   - Indexes on (matched_sku_id) and the partial index on
--     "unmatched" rows make the most common queries fast:
--       1. "What did SKU X sell over the last 90 days?"
--       2. "How many unmatched items does this client have?"
--   - A line item with no SKU mapping still gets a row (with
--     matched_sku_id = NULL). That's intentional: the Unmatched
--     Items UI in Phase 12d reads these rows directly.
--
-- Resolution flow:
--   1. Backfill/webhook inserts the parent processed_items row
--      (existing logic, unchanged).
--   2. Same write path fans extracted_data.line_items into rows
--      here. For each: lookup sku_aliases for (platform, external_item_id).
--   3. If hit → set matched_sku_id. If miss → leave NULL.
--   4. Later, when the merchant creates an alias mapping in the
--      Unmatched UI, a follow-up UPDATE sets matched_sku_id on
--      all the historical rows that match the new alias.
--
-- The denormalization (client_id, sold_at, platform on every row)
-- exists so COGS reports don't need a JOIN to processed_items
-- just to filter by date or client. Storage cost is small relative
-- to query speed; the source-of-truth is still the parent row.
--
-- Apply via:
--   node --env-file=.env.local scripts/run-migration.mjs \
--     db/migrations/0018_add_processed_item_line_items.sql
--
-- Verify with:
--   SELECT column_name, data_type
--     FROM information_schema.columns
--    WHERE table_name = 'processed_item_line_items'
--    ORDER BY ordinal_position;
-- Expected: 13 columns.
--
-- Rollback (additive, safe):
--   DROP INDEX IF EXISTS idx_processed_item_line_items_client_unmatched;
--   DROP INDEX IF EXISTS idx_processed_item_line_items_sku;
--   DROP INDEX IF EXISTS idx_processed_item_line_items_parent;
--   DROP TABLE IF EXISTS processed_item_line_items;
--
-- Idempotency: CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT
-- EXISTS throughout. Re-running is safe.

CREATE TABLE IF NOT EXISTS processed_item_line_items (
  id                  INTEGER PRIMARY KEY GENERATED ALWAYS AS IDENTITY,

  -- Parent sale row. ON DELETE CASCADE: if the merchant purges
  -- a connection's processed_items rows, the line items go too.
  processed_item_id   INTEGER NOT NULL REFERENCES processed_items(id) ON DELETE CASCADE,

  -- Denormalized from the parent so reporting queries don't need
  -- to JOIN processed_items just for filtering.
  client_id           INTEGER NOT NULL REFERENCES clients(id),
  platform            TEXT NOT NULL,           -- 'shopify' | 'wix' | 'square'

  -- Stable identifiers from the platform.
  --   external_id        — the line item's own ID inside the order
  --                        (Shopify line_item.id, Wix lineItem.id,
  --                        Square order line_item.uid). Stored so
  --                        idempotent re-ingestion can dedup.
  --   external_item_id   — the platform's product/variant/catalog
  --                        identifier. This is what sku_aliases
  --                        joins on (sku_aliases.external_id).
  --                        Nullable because some platforms allow
  --                        custom amount line items with no
  --                        catalog reference (e.g., "Custom item
  --                        $5" rung in at a Square POS).
  --   external_sku       — the platform-side SKU code string for
  --                        display only. Not used in matching.
  external_id         TEXT NOT NULL,
  external_item_id    TEXT,
  external_sku        TEXT,

  name                TEXT NOT NULL,           -- at-time-of-sale display name
  quantity            NUMERIC(12,4) NOT NULL,  -- supports fractional (weighed goods)
  unit_price          NUMERIC(12,4) NOT NULL,  -- at-time-of-sale per-unit price
  currency            TEXT NOT NULL,

  -- Denormalized from parent processed_items.date_received.
  -- Stored as DATE because sku_cost_history.effective_date is DATE;
  -- avoids timezone churn in the join.
  sold_at             DATE NOT NULL,

  -- Resolved lazily. NULL until either backfill finds a matching
  -- sku_aliases row at write time, OR the merchant creates an
  -- alias in the Unmatched UI and a follow-up UPDATE fills it in.
  matched_sku_id      INTEGER REFERENCES skus(id),

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Same (platform, processed_item_id, external_id) shouldn't
  -- appear twice. Lets re-ingestion of an already-imported order
  -- skip already-stored line items.
  UNIQUE (processed_item_id, external_id)
);

-- ── Indexes ───────────────────────────────────────────────────

-- Common parent-side lookup: "show me all line items for this sale"
CREATE INDEX IF NOT EXISTS idx_processed_item_line_items_parent
  ON processed_item_line_items (processed_item_id);

-- Per-SKU reporting: "what did SKU X sell over period P?"
-- Partial index skips NULL matched_sku_id rows since those
-- can't be aggregated by SKU anyway.
CREATE INDEX IF NOT EXISTS idx_processed_item_line_items_sku
  ON processed_item_line_items (matched_sku_id)
  WHERE matched_sku_id IS NOT NULL;

-- "How many unmatched line items does this client have?"
-- Powers the Unmatched UI badge + bulk-match page in Phase 12d.
CREATE INDEX IF NOT EXISTS idx_processed_item_line_items_client_unmatched
  ON processed_item_line_items (client_id)
  WHERE matched_sku_id IS NULL;
