-- scripts/fifo-backfill-report.sql
-- READ-ONLY preview of the FIFO backfill. Shows what the backfill WOULD
-- do without writing anything. Run:
--   node --env-file=.env.local scripts/run-migration.mjs scripts/fifo-backfill-report.sql

-- 1. SKUs that would get an OPENING layer (positive stock, no layers yet),
--    with the projected opening value at current best-known cost.
SELECT
  'opening_layers_to_seed' AS metric,
  COUNT(*)                 AS sku_count,
  COALESCE(SUM(s.quantity_on_hand), 0)::text AS total_units,
  COALESCE(SUM(s.quantity_on_hand * COALESCE(oc.cost, 0)), 0)::text AS projected_value
FROM skus s
LEFT JOIN LATERAL (
  SELECT cost FROM sku_cost_history
   WHERE sku_id = s.id AND effective_date <= CURRENT_DATE
   ORDER BY effective_date DESC LIMIT 1
) oc ON true
WHERE s.quantity_on_hand > 0
  AND s.active
  AND NOT EXISTS (SELECT 1 FROM cost_layers cl WHERE cl.sku_id = s.id);

-- 2. SKUs with negative stock (won't seed a layer — flagged, not errored).
SELECT
  'negative_stock_skus' AS metric,
  COUNT(*)              AS sku_count
FROM skus s
WHERE s.quantity_on_hand < 0 AND s.active;

-- 3. Matched line items needing a historical COGS stamp (frozen at the
--    old date-effective cost so past-period margins don't change), and how
--    many would be flagged estimated (no cost row on/before the sale date).
SELECT
  'line_items_to_stamp' AS metric,
  COUNT(*)              AS line_item_count,
  COALESCE(SUM(
    pili.quantity * COALESCE((
      SELECT ch.cost FROM sku_cost_history ch
       WHERE ch.sku_id = pili.matched_sku_id
         AND ch.effective_date <= pili.sold_at
       ORDER BY ch.effective_date DESC LIMIT 1), 0)
  ), 0)::text          AS projected_historical_cogs,
  COUNT(*) FILTER (WHERE NOT EXISTS (
    SELECT 1 FROM sku_cost_history ch
     WHERE ch.sku_id = pili.matched_sku_id
       AND ch.effective_date <= pili.sold_at))::int AS would_flag_estimated
FROM processed_item_line_items pili
WHERE pili.matched_sku_id IS NOT NULL
  AND pili.cogs_amount IS NULL;

-- 4. Sanity: totals of unmatched (stay NULL) + already-stamped line items.
SELECT
  'line_items_unmatched'      AS metric,
  COUNT(*) FILTER (WHERE matched_sku_id IS NULL)::int AS unmatched,
  COUNT(*) FILTER (WHERE cogs_amount IS NOT NULL)::int AS already_stamped,
  COUNT(*)::int               AS total_line_items
FROM processed_item_line_items;
