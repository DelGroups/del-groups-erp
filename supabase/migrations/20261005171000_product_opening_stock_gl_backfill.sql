-- P0-3 follow-up: post the bulk product import's opening stock to the ledger.
--
-- Verified on production 2026-10-05: 51 FIFO batches with
-- document_type = 'opening_balance' (document_id = product_id) were created on
-- 2026-09-16 by a one-off bulk product import ("İlkin Qalıq — toplu məhsul
-- idxalı"). That import wrote stock, stock_movements and FIFO batches but no
-- journal entry. 20261003120000 only covered IQ documents
-- (inventory_initial_balances), so these batches were never posted, and GL
-- 1300 Anbar is lower than the FIFO layers by exactly their value.
--
-- Run after 20261005170000, which corrects 45 of these batches from the
-- per-sheet to the per-metre price. Expected amount after that: 31,295.00
-- (99,118.76 before the correction).
--
-- Posts one entry, dated the import day, for the batches' original value:
--   Dr 1300 Anbar / Cr 3900 İlkin qalıq kapitalı   Σ(initial_qty × unit_cost)
-- The original value is used (not the remaining one) because the 3.00 already
-- consumed from these batches was credited to 1300 by the sales COGS entries.
--
-- Idempotent (fixed idempotency key) and atomic.

BEGIN;

DO $$
DECLARE
  v_amount  NUMERIC;
  v_count   INTEGER;
  v_date    DATE;
  v_entry   UUID;
  v_gl      NUMERIC;
  v_layers  NUMERIC;
BEGIN
  -- Sheet batches still at the per-sheet price mean 20261005170000 has not run.
  IF EXISTS (
    SELECT 1
    FROM public.inventory_batches b
    JOIN public.products p ON p.id = b.product_id
    CROSS JOIN LATERAL (
      SELECT CASE
               WHEN p.extra_info LIKE '@@PRICE_ROWS@@{%'
               THEN (split_part(substr(p.extra_info, length('@@PRICE_ROWS@@') + 1), E'\n', 1))::jsonb -> 'buy' -> 0
             END AS first_buy_row
    ) m
    WHERE b.document_type = 'opening_balance'
      AND b.document_id = b.product_id
      AND (p.inventory_mode = 'polywood' OR p.is_dimensional IS TRUE)
      AND COALESCE(NULLIF(p.full_sheet_length_m, 0), NULLIF(p.base_length, 0), 4) > 1
      AND m.first_buy_row ->> 'unit' = 'piece'
      AND abs(b.unit_cost - (m.first_buy_row ->> 'price')::numeric) < 0.005
  ) THEN
    RAISE EXCEPTION 'Run 20261005170000_sheet_products_cost_per_meter.sql first: sheet batches are still valued per sheet';
  END IF;

  SELECT round(SUM(b.initial_qty * b.unit_cost), 2), COUNT(*), MIN(b.created_at)::date
  INTO v_amount, v_count, v_date
  FROM public.inventory_batches b
  WHERE b.document_type = 'opening_balance'
    AND b.document_id = b.product_id;

  IF COALESCE(v_amount, 0) <= 0 THEN
    RAISE NOTICE 'No product-level opening batches to post';
    RETURN;
  END IF;

  v_entry := public.create_journal_entry(
    jsonb_build_object(
      'entry_date', v_date,
      'source_type', 'product_opening_stock',
      'document_type', 'product_opening_stock',
      'idempotency_key', 'product_opening_stock_import:2026-09-16',
      'memo', format('İlkin qalıq — toplu məhsul idxalı (%s məhsul)', v_count),
      'lines', jsonb_build_array(
        jsonb_build_object('coa_code', '1300', 'debit', v_amount, 'credit', 0,
                           'line_memo', 'Toplu məhsul idxalı'),
        jsonb_build_object('coa_code', '3900', 'debit', 0, 'credit', v_amount,
                           'line_memo', 'Toplu məhsul idxalı')
      )
    )
  );

  SELECT round(SUM(l.debit - l.credit), 2) INTO v_gl
  FROM public.journal_entry_lines l
  JOIN public.chart_of_accounts a ON a.id = l.coa_id
  WHERE a.code = '1300';

  SELECT round(SUM(remaining_qty * unit_cost), 2) INTO v_layers
  FROM public.inventory_batches;

  RAISE NOTICE 'Posted % AZN for % batches as journal %. GL 1300 = %, FIFO layers = %',
    v_amount, v_count, v_entry, v_gl, v_layers;
END;
$$;

COMMIT;
