-- scripts/fifo-backfill.sql
--
-- One-time FIFO adoption backfill. Idempotent (safe to re-run). Apply:
--   node --env-file=.env.local scripts/run-migration.mjs scripts/fifo-backfill.sql
--
-- Strategy (Option B — FIFO from an opening position, the standard way a
-- business adopts FIFO):
--   1. Seed ONE opening cost layer per SKU that has positive stock today,
--      valued at its best-known current cost. This is the cost basis of
--      stock on hand at adoption; future receipts add their own dated
--      layers, so the old-price-then-new-price FIFO behaviour applies to
--      everything going forward.
--   2. Freeze historical COGS: stamp every already-sold matched line item
--      with the SAME number the prior date-effective engine produced, so
--      past-period margins do NOT move when compute.ts switches to summing
--      cogs_amount. Sales with no cost basis (none in the prior system
--      either) are stamped 0 and flagged estimated — honest, not silent.
--
-- Negative-stock SKUs get no opening layer (can't have a negative layer);
-- their future sales will be flagged estimated until stock is received.
--
-- Does NOT delete anything and is tenant-agnostic (applies to every
-- client, including other real users — purely additive).

BEGIN;

-- 1. Opening layers from current positive stock.
INSERT INTO cost_layers
  (client_id, sku_id, source, acquired_at, original_qty, remaining_qty, unit_cost, notes)
SELECT s.client_id, s.id, 'opening', CURRENT_DATE,
       s.quantity_on_hand, s.quantity_on_hand,
       COALESCE(oc.cost, 0),
       'Opening balance at FIFO adoption'
  FROM skus s
  LEFT JOIN LATERAL (
    SELECT cost FROM sku_cost_history
     WHERE sku_id = s.id AND effective_date <= CURRENT_DATE
     ORDER BY effective_date DESC LIMIT 1
  ) oc ON true
 WHERE s.quantity_on_hand > 0
   AND s.active
   AND NOT EXISTS (SELECT 1 FROM cost_layers cl WHERE cl.sku_id = s.id);

-- 2. Freeze historical COGS at the prior date-effective cost.
UPDATE processed_item_line_items pili
   SET cogs_amount = pili.quantity * COALESCE((
         SELECT ch.cost FROM sku_cost_history ch
          WHERE ch.sku_id = pili.matched_sku_id
            AND ch.effective_date <= pili.sold_at
          ORDER BY ch.effective_date DESC LIMIT 1), 0),
       cogs_is_estimated = NOT EXISTS (
         SELECT 1 FROM sku_cost_history ch
          WHERE ch.sku_id = pili.matched_sku_id
            AND ch.effective_date <= pili.sold_at)
 WHERE pili.matched_sku_id IS NOT NULL
   AND pili.cogs_amount IS NULL;

COMMIT;

-- Post-apply summary.
SELECT
  (SELECT COUNT(*) FROM cost_layers WHERE source = 'opening')::int          AS opening_layers,
  (SELECT COALESCE(SUM(remaining_qty * unit_cost), 0)::text
     FROM cost_layers WHERE source = 'opening')                             AS opening_value,
  (SELECT COUNT(*) FROM processed_item_line_items
     WHERE cogs_amount IS NOT NULL)::int                                    AS stamped_line_items,
  (SELECT COUNT(*) FROM processed_item_line_items
     WHERE cogs_is_estimated)::int                                          AS estimated_line_items;
