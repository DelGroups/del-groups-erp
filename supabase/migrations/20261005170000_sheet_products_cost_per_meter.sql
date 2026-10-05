-- Sheet products (MDF / plywood) were valued per sheet but counted per metre.
--
-- Del confirmed 2026-10-05: 115 AZN is the purchase price of one 4 m sheet.
-- These products keep stock in metres (polywood pieces), and every FIFO batch
-- is valued as remaining_qty (m) × unit_cost, so unit_cost must be per metre.
--
-- Verified on production 2026-10-05: 46 sheet products (price card: buy price
-- per "piece") got their opening batches at the per-sheet price:
--   45 bulk-import batches (opening_balance)   90,469.76 → 22,646.00
--   1 batch from IQ-2026-0001 (MAHIA MATT 12 m)  1,380.00 →    345.00
-- None of these batches has been consumed yet.
--
-- This migration:
--   1. divides unit_cost of those batches by the sheet length
--      (full_sheet_length_m, else base_length, else 4 m);
--   2. corrects the IQ document lines and total the same way;
--   3. reverses the IQ documents' journal entries (storno) and posts them
--      again at the corrected value through post_initial_balance_journal.
-- The bulk-import batches have no journal entry yet; the next migration
-- (20261005171000) posts them at the corrected value.
--
-- Safe to run twice: a batch already at the per-metre price no longer matches
-- the per-sheet card price and is left alone.

BEGIN;

CREATE TEMP TABLE _sheet_batch_fix ON COMMIT DROP AS
WITH sheet_products AS (
  SELECT p.id,
         COALESCE(NULLIF(p.full_sheet_length_m, 0), NULLIF(p.base_length, 0), 4)::numeric AS sheet_m,
         CASE
           WHEN p.extra_info LIKE '@@PRICE_ROWS@@{%'
           THEN (split_part(substr(p.extra_info, length('@@PRICE_ROWS@@') + 1), E'\n', 1))::jsonb -> 'buy' -> 0
         END AS first_buy_row
  FROM public.products p
  WHERE p.inventory_mode = 'polywood'
     OR p.is_dimensional IS TRUE
)
SELECT b.id AS batch_id,
       b.product_id,
       b.document_id,
       b.document_type,
       b.unit_cost AS old_unit_cost,
       round(b.unit_cost / sp.sheet_m, 4) AS new_unit_cost,
       sp.sheet_m
FROM public.inventory_batches b
JOIN sheet_products sp ON sp.id = b.product_id
WHERE b.document_type IN ('opening_balance', 'initial_balance')
  AND sp.sheet_m > 1
  AND sp.first_buy_row ->> 'unit' = 'piece'
  AND abs(b.unit_cost - (sp.first_buy_row ->> 'price')::numeric) < 0.005;

DO $$
DECLARE
  v_consumed INTEGER;
  v_count    INTEGER;
  v_before   NUMERIC;
  v_after    NUMERIC;
BEGIN
  SELECT COUNT(*) INTO v_consumed
  FROM _sheet_batch_fix f
  WHERE EXISTS (SELECT 1 FROM public.inventory_batch_consumptions c WHERE c.batch_id = f.batch_id);

  IF v_consumed > 0 THEN
    RAISE EXCEPTION '% sheet batches were already consumed; their COGS needs a manual correction first', v_consumed;
  END IF;

  SELECT COUNT(*),
         round(SUM(b.initial_qty * f.old_unit_cost), 2),
         round(SUM(b.initial_qty * f.new_unit_cost), 2)
  INTO v_count, v_before, v_after
  FROM _sheet_batch_fix f
  JOIN public.inventory_batches b ON b.id = f.batch_id;

  RAISE NOTICE 'Sheet batches to fix: %, value % → %', v_count, COALESCE(v_before, 0), COALESCE(v_after, 0);
END;
$$;

-- 1. FIFO batches: per-metre cost.
UPDATE public.inventory_batches b
SET unit_cost = f.new_unit_cost
FROM _sheet_batch_fix f
WHERE b.id = f.batch_id;

-- 2. IQ document lines and totals.
UPDATE public.inventory_initial_balance_items i
SET unit_cost  = f.new_unit_cost,
    line_total = round(COALESCE(i.metric_total_meters, i.quantity, 0) * f.new_unit_cost, 2)
FROM _sheet_batch_fix f
WHERE f.document_type = 'initial_balance'
  AND i.document_id = f.document_id
  AND i.product_id = f.product_id
  AND i.is_metric IS TRUE
  AND abs(i.unit_cost - f.old_unit_cost) < 0.005;

UPDATE public.inventory_initial_balances d
SET total_amount = (
  SELECT round(COALESCE(SUM(i.line_total), 0), 2)
  FROM public.inventory_initial_balance_items i
  WHERE i.document_id = d.id
)
WHERE d.id IN (SELECT document_id FROM _sheet_batch_fix WHERE document_type = 'initial_balance');

-- 3. Re-post the IQ documents' ledger entries at the corrected value.
DO $$
DECLARE
  r        RECORD;
  v_storno INTEGER;
  v_entry  UUID;
BEGIN
  FOR r IN
    SELECT d.id, d.document_number
    FROM public.inventory_initial_balances d
    WHERE d.status = 'posted'
      AND d.id IN (SELECT document_id FROM _sheet_batch_fix WHERE document_type = 'initial_balance')
    ORDER BY d.doc_date, d.document_number
  LOOP
    v_storno := public.reverse_document_journals(r.id, 'Vərəq məhsulları: maya dəyəri metrə görə düzəldildi');
    v_entry := public.post_initial_balance_journal(r.id);
    RAISE NOTICE '%: % entry reversed, new journal %', r.document_number, v_storno, v_entry;
  END LOOP;
END;
$$;

COMMIT;
