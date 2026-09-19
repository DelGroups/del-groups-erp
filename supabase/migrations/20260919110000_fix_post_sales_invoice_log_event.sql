-- ============================================================================
-- Restore sales-invoice posting.
--
-- Verified on production 2026-09-19: pressing "Təsdiqlə və Keçir" on a sales
-- invoice always failed with
--   function public.log_erp_event(unknown, unknown, uuid, unknown, jsonb, uuid)
--   does not exist
-- The document was left as a draft (QARALAMA) with no journal entry, no stock
-- movement and no receivable. Every sales invoice in the system was affected.
--
-- Cause: migration 20260912180000_phase4_rls_inventory_trigger.sql redefined
-- post_sales_invoice_draft and rewrote its log_erp_event call with six
-- arguments in the wrong order. Migration 20260911120000 had called it
-- correctly with seven. Purchase posting was not touched and is unaffected.
--
-- This migration re-creates the phase-4 function unchanged except for that call.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.post_sales_invoice_draft(p_sale_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale RECORD;
  v_items JSONB := '[]'::jsonb;
  v_payments JSONB;
  v_stock_demand JSONB := '{}'::jsonb;
  v_pay JSONB;
  v_pay_amount NUMERIC;
  v_account_id UUID;
  v_pay_method TEXT;
  v_journal_id UUID;
  v_cogs_result JSONB;
  v_total_cogs NUMERIC := 0;
  v_cogs_journal_id UUID;
  v_add_exp_total NUMERIC;
  v_idempotency TEXT;
  v_result JSONB;
  v_event_id UUID;
BEGIN
  IF p_sale_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload'
      USING ERRCODE = '22023',
            MESSAGE = 'Satış ID göndərilməyib';
  END IF;

  IF NOT (
    public.require_permission('can_edit_sales')
    OR public.require_permission('can_create_invoice')
    OR public.require_permission('can_manage_finance')
  ) THEN
    RAISE EXCEPTION 'forbidden'
      USING ERRCODE = '42501',
            MESSAGE = 'Satış təsdiqləmək üçün icazəniz yoxdur';
  END IF;

  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'sale_not_found'
      USING ERRCODE = 'P0002',
            MESSAGE = 'Satış sənədi tapılmadı';
  END IF;

  IF v_sale.status = 'posted' THEN
    RAISE EXCEPTION 'already_posted'
      USING ERRCODE = '22023',
            MESSAGE = 'Sənəd artıq təsdiqlənib';
  END IF;

  IF v_sale.status IN ('cancelled', 'void', 'voided') THEN
    RAISE EXCEPTION 'cancelled_document'
      USING ERRCODE = '22023',
            MESSAGE = 'Ləğv edilmiş sənəd təsdiqlənə bilməz';
  END IF;

  IF COALESCE(v_sale.total_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'invalid_total_amount'
      USING ERRCODE = '22023',
            MESSAGE = 'Satış məbləği sıfırdan böyük olmalıdır';
  END IF;

  IF COALESCE(v_sale.paid_amount, 0) > COALESCE(v_sale.total_amount, 0) + 0.0001 THEN
    RAISE EXCEPTION 'overpaid'
      USING ERRCODE = '22023',
            MESSAGE = 'Ödənilən məbləğ ümumi məbləğdən böyük ola bilməz';
  END IF;

  SELECT COALESCE(jsonb_agg(item_json ORDER BY ord), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT
      row_number() OVER (ORDER BY id) AS ord,
      jsonb_build_object(
        'product_id', product_id,
        'quantity', quantity,
        'warehouse_id', warehouse_id,
        'polywood_sale_mode', polywood_sale_mode,
        'polywood_length_m', polywood_length_m,
        'skip_stock', (polywood_sale_mode IS NOT NULL AND btrim(polywood_sale_mode) <> '')
      ) AS item_json
    FROM sale_items
    WHERE sale_id = p_sale_id
  ) lined;

  IF jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'items_required'
      USING ERRCODE = '22023',
            MESSAGE = 'Ən azı bir satış sətri tələb olunur';
  END IF;

  -- Stock deduction is handled by trg_sales_posted_inventory when status becomes posted.
  -- Pre-validate demand so posting fails before side effects if stock is insufficient.
  PERFORM public.build_and_validate_sale_stock_demand(v_items);

  v_idempotency := 'sale_invoice:' || p_sale_id::text;
  v_cogs_result := public.process_sale_fifo_cogs(
    p_sale_id,
    v_sale.doc_no,
    v_idempotency || ':cogs'
  );
  v_total_cogs := COALESCE((v_cogs_result->>'total_cogs')::numeric, 0);
  v_cogs_journal_id := NULLIF(v_cogs_result->>'cogs_journal_entry_id', '')::uuid;

  v_payments := COALESCE(v_sale.payments, '[]'::jsonb);
  IF jsonb_typeof(v_payments) = 'array' THEN
    FOR v_pay IN SELECT value FROM jsonb_array_elements(v_payments)
    LOOP
      v_pay_amount := COALESCE(NULLIF(v_pay->>'amount', '')::numeric, 0);
      IF v_pay_amount <= 0 THEN
        CONTINUE;
      END IF;

      v_account_id := NULLIF(v_pay->>'account_id', '')::uuid;
      IF v_account_id IS NULL THEN
        RAISE EXCEPTION 'account_required'
          USING ERRCODE = '22023',
                MESSAGE = 'Ödəniş üçün kassa/bank hesabı seçilməlidir';
      END IF;

      PERFORM id FROM accounts WHERE id = v_account_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'account_not_found'
          USING ERRCODE = 'P0002',
                MESSAGE = 'Seçilmiş kassa/bank hesabı tapılmadı';
      END IF;

      v_pay_method := COALESCE(NULLIF(trim(v_pay->>'method'), ''), 'Ödəniş');
      PERFORM public.post_cash_transaction(
        v_account_id,
        'Mədaxil',
        v_pay_amount,
        'Satış Ödənişi',
        format('Satış fakturası %s — %s', v_sale.doc_no, v_pay_method),
        NULL,
        'sale',
        p_sale_id
      );
    END LOOP;
  END IF;

  v_add_exp_total := public.apply_document_additional_expenses(
    COALESCE(v_sale.additional_expenses, '[]'::jsonb),
    'sale',
    p_sale_id,
    v_sale.doc_no
  );

  v_journal_id := public.post_sale_invoice_gl_journal(
    p_sale_id,
    v_sale.doc_no,
    v_sale.total_amount,
    v_sale.customer_id,
    v_idempotency
  );

  UPDATE sales
  SET status = 'posted',
      posted_at = NOW(),
      additional_expenses_total = v_add_exp_total
  WHERE id = p_sale_id;

  PERFORM public.refresh_customer_ar_balance(v_sale.customer_id);

  v_result := jsonb_build_object(
    'success', true,
    'event_type', 'sales_invoice_post',
    'sale_id', p_sale_id,
    'doc_no', v_sale.doc_no,
    'status', 'posted',
    'journal_entry_id', v_journal_id,
    'cogs_journal_entry_id', v_cogs_journal_id,
    'total_cogs', v_total_cogs,
    'total_amount', v_sale.total_amount,
    'paid_amount', v_sale.paid_amount,
    'remaining_balance', v_sale.remaining_balance
  );

  -- log_erp_event takes seven arguments:
  --   (p_event_type TEXT, p_source_table TEXT, p_source_id UUID, p_payload JSONB,
  --    p_journal_entry_id UUID, p_idempotency_key TEXT, p_result JSONB)
  -- The phase-4 rewrite passed six in the wrong order, so every attempt to post a
  -- sales invoice failed with:
  --   function public.log_erp_event(unknown, unknown, uuid, unknown, jsonb, uuid) does not exist
  -- PL/pgSQL resolves the call only when it runs, which is why this shipped.
  v_event_id := public.log_erp_event(
    'sales_invoice',
    'sales',
    p_sale_id,
    jsonb_build_object('sale_id', p_sale_id, 'posted_from', 'draft', 'posted_by', auth.uid()),
    COALESCE(v_cogs_journal_id, v_journal_id),
    v_idempotency,
    v_result
  );

  RETURN v_result || jsonb_build_object('event_id', v_event_id);
END;
$$;

NOTIFY pgrst, 'reload schema';
