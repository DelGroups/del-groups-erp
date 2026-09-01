-- Finance: source_type linkage, additional expenses schema, and ERP event RPCs
-- Consolidated from types/universal-finance-migration.sql, account-mutations (post_cash_transaction),
-- types/erp-events-migration.sql, and types/finance-integration-fix-migration.sql

-- Universal financial linkage: transaction source provenance + document additional expenses
-- Run AFTER account-mutations.sql, journal-engine-migration.sql, erp-events-migration.sql

-- â”€â”€â”€ Transaction source linkage â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS source_type TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS source_id UUID;

CREATE INDEX IF NOT EXISTS idx_transactions_source
  ON transactions (source_type, source_id)
  WHERE source_type IS NOT NULL;

-- â”€â”€â”€ Document additional expenses (landed costs) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

ALTER TABLE sales ADD COLUMN IF NOT EXISTS additional_expenses JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS additional_expenses_total NUMERIC NOT NULL DEFAULT 0;

ALTER TABLE purchases ADD COLUMN IF NOT EXISTS additional_expenses JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS additional_expenses_total NUMERIC NOT NULL DEFAULT 0;

ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS advance_account_id UUID REFERENCES accounts(id);
ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS additional_expenses JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS additional_expenses_total NUMERIC NOT NULL DEFAULT 0;

-- Polywood line detail (optional columns on sale_items)
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS polywood_width_m NUMERIC;
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS polywood_pieces NUMERIC;
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS polywood_total_area_m2 NUMERIC;
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS polywood_cutting_option TEXT;
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS polywood_edge_option TEXT;

-- â”€â”€â”€ Post paid additional expenses and return total â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

CREATE OR REPLACE FUNCTION public.apply_document_additional_expenses(
  p_expenses JSONB,
  p_source_type TEXT,
  p_source_id UUID,
  p_doc_ref TEXT
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exp JSONB;
  v_amount NUMERIC;
  v_total NUMERIC := 0;
  v_account_id UUID;
  v_label TEXT;
  v_paid BOOLEAN;
BEGIN
  IF p_expenses IS NULL OR jsonb_typeof(p_expenses) <> 'array' THEN
    RETURN 0;
  END IF;

  FOR v_exp IN SELECT value FROM jsonb_array_elements(p_expenses)
  LOOP
    v_amount := COALESCE(NULLIF(v_exp->>'amount', '')::numeric, 0);
    IF v_amount <= 0 THEN
      CONTINUE;
    END IF;
    v_total := v_total + v_amount;
    v_paid := COALESCE((v_exp->>'paid_immediately')::boolean, false);
    IF NOT v_paid THEN
      CONTINUE;
    END IF;

    v_account_id := NULLIF(v_exp->>'account_id', '')::uuid;
    IF v_account_id IS NULL THEN
      RAISE EXCEPTION 'account_required_for_expense'
        USING ERRCODE = '22023',
              MESSAGE = 'Ã–dÉ™nilÉ™n É™lavÉ™ xÉ™rc Ã¼Ã§Ã¼n kassa/bank hesabÄ± seÃ§ilmÉ™lidir';
    END IF;

    v_label := COALESCE(NULLIF(trim(v_exp->>'label'), ''), 'ÆlavÉ™ xÉ™rc');

    PERFORM public.post_cash_transaction(
      v_account_id,
      'MÉ™xaric',
      v_amount,
      'ÆlavÉ™ XÉ™rc',
      format('%s â€” %s', p_doc_ref, v_label),
      NULL,
      p_source_type,
      p_source_id
    );
  END LOOP;

  RETURN v_total;
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_document_additional_expenses(JSONB, TEXT, UUID, TEXT) TO authenticated;
DROP FUNCTION IF EXISTS public.post_cash_transaction(UUID, TEXT, NUMERIC, TEXT, TEXT, UUID);
DROP FUNCTION IF EXISTS public.post_cash_transaction(UUID, TEXT, NUMERIC, TEXT, TEXT, UUID, TEXT, UUID);

CREATE OR REPLACE FUNCTION public.post_cash_transaction(
  p_account_id UUID,
  p_type TEXT,
  p_amount NUMERIC,
  p_category TEXT,
  p_notes TEXT DEFAULT NULL,
  p_production_order_id UUID DEFAULT NULL,
  p_source_type TEXT DEFAULT NULL,
  p_source_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance NUMERIC;
  v_tx_id UUID;
  v_type TEXT;
  v_category TEXT;
  v_journal_id UUID;
  v_counter_coa TEXT;
  v_memo TEXT;
BEGIN
  IF p_account_id IS NULL THEN
    RAISE EXCEPTION 'account_id_required'
      USING ERRCODE = '22023',
            MESSAGE = 'Kassa/bank hesabÄ± mÃ¼tlÉ™qdir';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'invalid_amount'
      USING ERRCODE = '22023',
            MESSAGE = 'MÉ™blÉ™ÄŸ sÄ±fÄ±rdan bÃ¶yÃ¼k olmalÄ±dÄ±r';
  END IF;

  v_type := trim(COALESCE(p_type, ''));
  IF v_type IS DISTINCT FROM 'MÉ™daxil' AND v_type IS DISTINCT FROM 'MÉ™xaric' THEN
    RAISE EXCEPTION 'invalid_transaction_type'
      USING ERRCODE = '22023',
            MESSAGE = 'ÆmÉ™liyyat nÃ¶vÃ¼ MÉ™daxil vÉ™ ya MÉ™xaric olmalÄ±dÄ±r';
  END IF;

  v_category := COALESCE(NULLIF(trim(p_category), ''), 'DigÉ™r');
  v_memo := COALESCE(NULLIF(trim(p_notes), ''), v_category);

  IF public.resolve_coa_id('1100') IS NULL THEN
    RAISE EXCEPTION 'coa_not_found'
      USING ERRCODE = 'P0002',
            MESSAGE = 'Hesab planÄ±nda 1100 (Kassa/Bank) tapÄ±lmadÄ± â€” chart-of-accounts miqrasiyasÄ±nÄ± yoxlayÄ±n';
  END IF;

  SELECT balance INTO v_balance
  FROM accounts
  WHERE id = p_account_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_not_found'
      USING ERRCODE = 'P0002',
            MESSAGE = 'Kassa/bank hesabÄ± tapÄ±lmadÄ±';
  END IF;

  IF v_type = 'MÉ™xaric' AND COALESCE(v_balance, 0) + 0.0001 < p_amount THEN
    RAISE EXCEPTION 'insufficient_balance'
      USING ERRCODE = '22023',
            MESSAGE = 'Kassa/bank balansÄ± kifayÉ™t etmir';
  END IF;

  INSERT INTO transactions (account_id, type, amount, category, notes, production_order_id, source_type, source_id)
  VALUES (
    p_account_id,
    v_type,
    p_amount,
    v_category,
    NULLIF(trim(p_notes), ''),
    p_production_order_id,
    NULLIF(trim(p_source_type), ''),
    p_source_id
  )
  RETURNING id INTO v_tx_id;

  IF v_type = 'MÉ™daxil' THEN
    UPDATE accounts
    SET balance = COALESCE(v_balance, 0) + p_amount
    WHERE id = p_account_id;

    v_counter_coa := public.coa_credit_for_cash_in(v_category);
    v_journal_id := public.post_journal_entry(
      jsonb_build_object(
        'source_type', 'cash_transaction',
        'source_id', v_tx_id,
        'idempotency_key', 'cash_tx:' || v_tx_id::text,
        'memo', v_memo,
        'lines', jsonb_build_array(
          jsonb_build_object(
            'coa_code', '1100',
            'debit', p_amount,
            'credit', 0,
            'account_id', p_account_id,
            'line_memo', v_memo
          ),
          jsonb_build_object(
            'coa_code', v_counter_coa,
            'debit', 0,
            'credit', p_amount,
            'line_memo', v_category
          )
        )
      )
    );
  ELSE
    UPDATE accounts
    SET balance = COALESCE(v_balance, 0) - p_amount
    WHERE id = p_account_id;

    v_counter_coa := public.coa_debit_for_cash_out(v_category);
    v_journal_id := public.post_journal_entry(
      jsonb_build_object(
        'source_type', 'cash_transaction',
        'source_id', v_tx_id,
        'idempotency_key', 'cash_tx:' || v_tx_id::text,
        'memo', v_memo,
        'lines', jsonb_build_array(
          jsonb_build_object(
            'coa_code', v_counter_coa,
            'debit', p_amount,
            'credit', 0,
            'line_memo', v_category
          ),
          jsonb_build_object(
            'coa_code', '1100',
            'debit', 0,
            'credit', p_amount,
            'account_id', p_account_id,
            'line_memo', v_memo
          )
        )
      )
    );
  END IF;

  UPDATE transactions
  SET journal_entry_id = v_journal_id
  WHERE id = v_tx_id;

  RETURN v_tx_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.post_cash_transaction(UUID, TEXT, NUMERIC, TEXT, TEXT, UUID, TEXT, UUID) TO authenticated;
-- Del Groups ERP â€” Phase 2 atomic event processors
-- Prerequisites: rbac-migration, schema, chart-of-accounts-migration, journal-engine-migration,
-- account-mutations, customer-ar-mutations, sale/purchase/payment mutations (reference logic).

-- Ensure optional polywood columns exist before event processors reference them.
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS polywood_sale_mode TEXT;
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS polywood_length_m NUMERIC;
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS polywood_cut_details JSONB;

-- Requires types/universal-finance-migration.sql for apply_document_additional_expenses + transaction source columns.

-- â”€â”€â”€ Audit log â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

CREATE TABLE IF NOT EXISTS public.erp_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  source_table TEXT,
  source_id UUID,
  idempotency_key TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB,
  journal_entry_id UUID REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_erp_events_idempotency
  ON public.erp_events (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_erp_events_source
  ON public.erp_events (source_table, source_id);

CREATE INDEX IF NOT EXISTS idx_erp_events_type_created
  ON public.erp_events (event_type, created_at DESC);

-- â”€â”€â”€ Supplier AP sync (mirror customer AR pattern) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

CREATE OR REPLACE FUNCTION public.compute_supplier_open_ap(p_supplier_id UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(SUM(GREATEST(COALESCE(debt_amount, 0), 0)), 0)
  FROM public.purchases
  WHERE supplier_id = p_supplier_id;
$$;

CREATE OR REPLACE FUNCTION public.refresh_supplier_ap_balance(p_supplier_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_open_ap NUMERIC;
BEGIN
  IF p_supplier_id IS NULL THEN
    RETURN 0;
  END IF;

  v_open_ap := public.compute_supplier_open_ap(p_supplier_id);

  UPDATE public.suppliers
  SET balance = COALESCE(v_open_ap, 0)
  WHERE id = p_supplier_id;

  RETURN COALESCE(v_open_ap, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.compute_supplier_open_ap(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_supplier_ap_balance(UUID) TO authenticated;

-- â”€â”€â”€ Event logging helper â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

CREATE OR REPLACE FUNCTION public.log_erp_event(
  p_event_type TEXT,
  p_source_table TEXT,
  p_source_id UUID,
  p_payload JSONB,
  p_journal_entry_id UUID,
  p_idempotency_key TEXT,
  p_result JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_id UUID;
BEGIN
  INSERT INTO public.erp_events (
    event_type,
    source_table,
    source_id,
    idempotency_key,
    payload,
    result,
    journal_entry_id
  )
  VALUES (
    p_event_type,
    p_source_table,
    p_source_id,
    NULLIF(trim(p_idempotency_key), ''),
    COALESCE(p_payload, '{}'::jsonb),
    p_result,
    p_journal_entry_id
  )
  RETURNING id INTO v_event_id;

  RETURN v_event_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_erp_event(TEXT, TEXT, UUID, JSONB, UUID, TEXT, JSONB) TO authenticated;

CREATE OR REPLACE FUNCTION public.find_erp_event_by_idempotency(p_key TEXT)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.erp_events%ROWTYPE;
BEGIN
  IF p_key IS NULL OR trim(p_key) = '' THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_row
  FROM public.erp_events
  WHERE idempotency_key = trim(p_key)
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  RETURN jsonb_build_object(
    'event_id', v_row.id,
    'event_type', v_row.event_type,
    'source_table', v_row.source_table,
    'source_id', v_row.source_id,
    'journal_entry_id', v_row.journal_entry_id,
    'result', COALESCE(v_row.result, '{}'::jsonb),
    'already_processed', true
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.find_erp_event_by_idempotency(TEXT) TO authenticated;

-- â”€â”€â”€ A. Sales invoice event â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

DROP FUNCTION IF EXISTS public.process_sales_invoice_event(JSONB);

CREATE OR REPLACE FUNCTION public.process_sales_invoice_event(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_idempotency TEXT;
  v_cached JSONB;
  v_header JSONB;
  v_items JSONB;
  v_payments JSONB;
  v_decrement_stock BOOLEAN := true;
  v_customer_id UUID;
  v_customer_name TEXT;
  v_sale_id UUID;
  v_doc_no TEXT;
  v_total_amount NUMERIC;
  v_paid_amount NUMERIC;
  v_remaining NUMERIC;
  v_item JSONB;
  v_pay JSONB;
  v_product_id UUID;
  v_qty NUMERIC;
  v_stock NUMERIC;
  v_account_id UUID;
  v_pay_amount NUMERIC;
  v_pay_method TEXT;
  v_skip_stock BOOLEAN;
  v_polywood_mode TEXT;
  v_polywood_sale_mode TEXT;
  v_polywood_length_m NUMERIC;
  v_item_ids JSONB := '[]'::jsonb;
  v_item_id UUID;
  v_idx INT := 0;
  v_stock_demand JSONB := '{}'::jsonb;
  v_key TEXT;
  v_journal_id UUID;
  v_event_id UUID;
  v_result JSONB;
  v_add_exp_total NUMERIC;
BEGIN
  IF p_payload IS NULL THEN
    RAISE EXCEPTION 'invalid_payload'
      USING ERRCODE = '22023',
            MESSAGE = 'SatÄ±ÅŸ event payload gÃ¶ndÉ™rilmÉ™yib';
  END IF;

  v_idempotency := NULLIF(trim(p_payload->>'idempotency_key'), '');
  IF v_idempotency IS NOT NULL THEN
    v_cached := public.find_erp_event_by_idempotency(v_idempotency);
    IF v_cached IS NOT NULL THEN
      RETURN v_cached->'result';
    END IF;
  END IF;

  IF NOT (
    public.require_permission('can_edit_sales')
    OR public.require_permission('can_create_invoice')
    OR public.require_permission('can_manage_finance')
  ) THEN
    RAISE EXCEPTION 'forbidden'
      USING ERRCODE = '42501',
            MESSAGE = 'SatÄ±ÅŸ yaratmaq Ã¼Ã§Ã¼n icazÉ™niz yoxdur';
  END IF;

  v_header := COALESCE(p_payload->'header', '{}'::jsonb);
  v_items := COALESCE(p_payload->'items', '[]'::jsonb);
  v_payments := COALESCE(p_payload->'payments', '[]'::jsonb);

  IF jsonb_typeof(v_items) <> 'array' OR jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'items_required'
      USING ERRCODE = '22023',
            MESSAGE = 'Æn azÄ± bir satÄ±ÅŸ sÉ™tri tÉ™lÉ™b olunur';
  END IF;

  IF (p_payload ? 'decrement_stock') THEN
    v_decrement_stock := COALESCE((p_payload->>'decrement_stock')::boolean, true);
  END IF;

  v_customer_id := NULLIF(v_header->>'customer_id', '')::uuid;
  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'customer_required'
      USING ERRCODE = '22023',
            MESSAGE = 'MÃ¼ÅŸtÉ™ri seÃ§ilmÉ™lidir';
  END IF;

  SELECT COALESCE(NULLIF(trim(full_name), ''), NULLIF(trim(name), ''), NULLIF(trim(company_name), ''), '')
  INTO v_customer_name
  FROM customers
  WHERE id = v_customer_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'customer_not_found'
      USING ERRCODE = 'P0002',
            MESSAGE = 'MÃ¼ÅŸtÉ™ri tapÄ±lmadÄ±';
  END IF;

  v_total_amount := COALESCE(NULLIF(v_header->>'total_amount', '')::numeric, 0);
  v_paid_amount := COALESCE(NULLIF(v_header->>'paid_amount', '')::numeric, 0);
  v_remaining := GREATEST(
    COALESCE(NULLIF(v_header->>'remaining_balance', '')::numeric, v_total_amount - v_paid_amount),
    0
  );

  IF v_total_amount <= 0 THEN
    RAISE EXCEPTION 'invalid_total_amount'
      USING ERRCODE = '22023',
            MESSAGE = 'SatÄ±ÅŸ mÉ™blÉ™ÄŸi sÄ±fÄ±rdan bÃ¶yÃ¼k olmalÄ±dÄ±r';
  END IF;

  IF v_paid_amount > v_total_amount + 0.0001 THEN
    RAISE EXCEPTION 'overpaid'
      USING ERRCODE = '22023',
            MESSAGE = 'Ã–dÉ™nilÉ™n mÉ™blÉ™ÄŸ Ã¼mumi mÉ™blÉ™ÄŸdÉ™n bÃ¶yÃ¼k ola bilmÉ™z';
  END IF;

  IF v_decrement_stock THEN
    FOR v_item IN SELECT value FROM jsonb_array_elements(v_items)
    LOOP
      v_product_id := NULLIF(v_item->>'product_id', '')::uuid;
      v_qty := COALESCE(NULLIF(v_item->>'quantity', '')::numeric, 0);
      v_polywood_mode := NULLIF(trim(v_item->>'polywood_sale_mode'), '');
      v_skip_stock := COALESCE((v_item->>'skip_stock')::boolean, false);

      IF v_product_id IS NULL OR v_qty <= 0 OR v_polywood_mode IS NOT NULL OR v_skip_stock THEN
        CONTINUE;
      END IF;

      v_key := v_product_id::text;
      v_stock_demand := jsonb_set(
        v_stock_demand,
        ARRAY[v_key],
        to_jsonb(COALESCE((v_stock_demand->>v_key)::numeric, 0) + v_qty),
        true
      );
    END LOOP;

    FOR v_key IN SELECT jsonb_object_keys(v_stock_demand)
    LOOP
      v_product_id := v_key::uuid;
      v_qty := COALESCE((v_stock_demand->>v_key)::numeric, 0);

      SELECT stock INTO v_stock
      FROM products
      WHERE id = v_product_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'product_not_found'
          USING ERRCODE = 'P0002',
                MESSAGE = 'MÉ™hsul tapÄ±lmadÄ±: ' || v_key;
      END IF;

      IF COALESCE(v_stock, 0) + 0.000001 < v_qty THEN
        RAISE EXCEPTION 'insufficient_stock'
          USING ERRCODE = '22023',
                MESSAGE = format(
                  'Stok kifayÉ™t etmir (mÉ™hsul %s, tÉ™lÉ™b: %s, mÃ¶vcud: %s)',
                  v_key,
                  trim(to_char(v_qty, 'FM999999990.00')),
                  trim(to_char(COALESCE(v_stock, 0), 'FM999999990.00'))
                );
      END IF;
    END LOOP;
  END IF;

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
                MESSAGE = 'Ã–dÉ™niÅŸ Ã¼Ã§Ã¼n kassa/bank hesabÄ± seÃ§ilmÉ™lidir';
      END IF;

      PERFORM id FROM accounts WHERE id = v_account_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'account_not_found'
          USING ERRCODE = 'P0002',
                MESSAGE = 'SeÃ§ilmiÅŸ kassa/bank hesabÄ± tapÄ±lmadÄ±';
      END IF;
    END LOOP;
  END IF;

  v_doc_no := NULLIF(trim(v_header->>'doc_no'), '');
  IF v_doc_no IS NULL THEN
    v_doc_no := 'SF-' || to_char(CURRENT_DATE, 'YYYY') || '-' || floor(10000 + random() * 90000)::int;
  END IF;

  INSERT INTO sales (
    doc_no, invoice_number, doc_date, customer_id, customer_name,
    seller_id, seller_name, warehouse_name, subtotal, discount_total, vat_total,
    total_amount, paid_amount, remaining_balance, delivery_address, delivery_type,
    delivery_fee, note, notes, payments, created_at
  )
  VALUES (
    v_doc_no,
    COALESCE(NULLIF(trim(v_header->>'invoice_number'), ''), v_doc_no),
    COALESCE(NULLIF(v_header->>'doc_date', '')::date, CURRENT_DATE),
    v_customer_id,
    COALESCE(NULLIF(trim(v_header->>'customer_name'), ''), v_customer_name),
    NULLIF(v_header->>'seller_id', '')::uuid,
    NULLIF(trim(v_header->>'seller_name'), ''),
    NULLIF(trim(v_header->>'warehouse_name'), ''),
    COALESCE(NULLIF(v_header->>'subtotal', '')::numeric, 0),
    COALESCE(NULLIF(v_header->>'discount_total', '')::numeric, 0),
    COALESCE(NULLIF(v_header->>'vat_total', '')::numeric, 0),
    v_total_amount,
    v_paid_amount,
    v_remaining,
    NULLIF(trim(v_header->>'delivery_address'), ''),
    COALESCE(NULLIF(trim(v_header->>'delivery_type'), ''), 'free'),
    COALESCE(NULLIF(v_header->>'delivery_fee', '')::numeric, 0),
    NULLIF(trim(v_header->>'note'), ''),
    NULLIF(trim(v_header->>'notes'), ''),
    COALESCE(v_header->'payments', v_payments, '[]'::jsonb),
    COALESCE(NULLIF(v_header->>'created_at', '')::timestamptz, NOW())
  )
  RETURNING id INTO v_sale_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_items)
  LOOP
    v_polywood_sale_mode := CASE
      WHEN v_item ? 'polywood_sale_mode'
      THEN NULLIF(trim(v_item->>'polywood_sale_mode'), '')
      ELSE NULL
    END;

    v_polywood_length_m := NULL;
    IF v_item ? 'polywood_length_m' THEN
      BEGIN
        v_polywood_length_m := NULLIF(trim(v_item->>'polywood_length_m'), '')::numeric;
      EXCEPTION
        WHEN OTHERS THEN
          v_polywood_length_m := NULL;
      END;
    END IF;

    INSERT INTO sale_items (
      sale_id, product_id, product_code, product_name, warehouse_id, warehouse_name,
      quantity, unit, unit_price, discount_percent, vat_rate, line_total, extra_info,
      polywood_sale_mode, polywood_length_m
    )
    VALUES (
      v_sale_id,
      NULLIF(v_item->>'product_id', '')::uuid,
      NULLIF(trim(v_item->>'product_code'), ''),
      NULLIF(trim(v_item->>'product_name'), ''),
      NULLIF(v_item->>'warehouse_id', '')::uuid,
      NULLIF(trim(v_item->>'warehouse_name'), ''),
      COALESCE(NULLIF(v_item->>'quantity', '')::numeric, 0),
      COALESCE(NULLIF(trim(v_item->>'unit'), ''), 'ÆdÉ™d'),
      COALESCE(NULLIF(v_item->>'unit_price', '')::numeric, 0),
      COALESCE(NULLIF(v_item->>'discount_percent', '')::numeric, 0),
      COALESCE(NULLIF(v_item->>'vat_rate', '')::numeric, 0),
      COALESCE(NULLIF(v_item->>'line_total', '')::numeric, NULLIF(v_item->>'total', '')::numeric, 0),
      NULLIF(trim(v_item->>'extra_info'), ''),
      v_polywood_sale_mode,
      v_polywood_length_m
    )
    RETURNING id INTO v_item_id;

    v_item_ids := v_item_ids || jsonb_build_array(
      jsonb_build_object(
        'index', v_idx,
        'id', v_item_id,
        'product_id', NULLIF(v_item->>'product_id', '')::uuid,
        'polywood_sale_mode', v_polywood_sale_mode
      )
    );
    v_idx := v_idx + 1;
  END LOOP;

  IF v_decrement_stock THEN
    FOR v_key IN SELECT jsonb_object_keys(v_stock_demand)
    LOOP
      v_product_id := v_key::uuid;
      v_qty := COALESCE((v_stock_demand->>v_key)::numeric, 0);

      UPDATE products
      SET stock = COALESCE(stock, 0) - v_qty
      WHERE id = v_product_id;
    END LOOP;
  END IF;

  IF jsonb_typeof(v_payments) = 'array' THEN
    FOR v_pay IN SELECT value FROM jsonb_array_elements(v_payments)
    LOOP
      v_pay_amount := COALESCE(NULLIF(v_pay->>'amount', '')::numeric, 0);
      IF v_pay_amount <= 0 THEN
        CONTINUE;
      END IF;

      v_account_id := NULLIF(v_pay->>'account_id', '')::uuid;
      v_pay_method := COALESCE(NULLIF(trim(v_pay->>'method'), ''), 'Ã–dÉ™niÅŸ');

      PERFORM public.post_cash_transaction(
        v_account_id,
        'MÉ™daxil',
        v_pay_amount,
        'SatÄ±ÅŸ Ã–dÉ™niÅŸi',
        format('SatÄ±ÅŸ fakturasÄ± %s â€” %s', v_doc_no, v_pay_method),
        NULL,
        'sale',
        v_sale_id
      );
    END LOOP;
  END IF;

  v_add_exp_total := public.apply_document_additional_expenses(
    COALESCE(p_payload->'additional_expenses', '[]'::jsonb),
    'sale',
    v_sale_id,
    v_doc_no
  );

  UPDATE sales
  SET additional_expenses = COALESCE(p_payload->'additional_expenses', '[]'::jsonb),
      additional_expenses_total = v_add_exp_total
  WHERE id = v_sale_id;

  v_journal_id := public.post_journal_entry(
    jsonb_build_object(
      'source_type', 'sale',
      'source_id', v_sale_id,
      'idempotency_key', COALESCE(v_idempotency, 'sale_invoice:' || v_sale_id::text),
      'memo', format('SatÄ±ÅŸ fakturasÄ± %s', v_doc_no),
      'lines', jsonb_build_array(
        jsonb_build_object(
          'coa_code', '1200',
          'debit', v_total_amount,
          'credit', 0,
          'partner_type', 'customer',
          'partner_id', v_customer_id,
          'line_memo', 'AR â€” ' || v_doc_no
        ),
        jsonb_build_object(
          'coa_code', '4100',
          'debit', 0,
          'credit', v_total_amount,
          'line_memo', 'SatÄ±ÅŸ gÉ™liri â€” ' || v_doc_no
        )
      )
    )
  );

  PERFORM public.refresh_customer_ar_balance(v_customer_id);

  v_result := jsonb_build_object(
    'success', true,
    'event_type', 'sales_invoice',
    'sale_id', v_sale_id,
    'doc_no', v_doc_no,
    'items', v_item_ids,
    'journal_entry_id', v_journal_id,
    'total_amount', v_total_amount,
    'paid_amount', v_paid_amount,
    'remaining_balance', v_remaining
  );

  v_event_id := public.log_erp_event(
    'sales_invoice',
    'sales',
    v_sale_id,
    p_payload,
    v_journal_id,
    v_idempotency,
    v_result
  );

  v_result := v_result || jsonb_build_object('event_id', v_event_id);
  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_sales_invoice_event(JSONB) TO authenticated;

-- â”€â”€â”€ B. Invoice payment event (sales + purchases) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

DROP FUNCTION IF EXISTS public.process_invoice_payment_event(JSONB);

CREATE OR REPLACE FUNCTION public.process_invoice_payment_event(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_idempotency TEXT;
  v_cached JSONB;
  v_document_type TEXT;
  v_document_id UUID;
  v_amount NUMERIC;
  v_account_id UUID;
  v_method TEXT;
  v_notes TEXT;
  v_payment_id TEXT;
  v_total_amount NUMERIC;
  v_paid_amount NUMERIC;
  v_remaining NUMERIC;
  v_debt_amount NUMERIC;
  v_new_paid NUMERIC;
  v_new_remaining NUMERIC;
  v_new_debt NUMERIC;
  v_customer_id UUID;
  v_supplier_id UUID;
  v_doc_label TEXT;
  v_payments JSONB;
  v_new_payment JSONB;
  v_status TEXT;
  v_tx_id UUID;
  v_journal_id UUID;
  v_event_id UUID;
  v_result JSONB;
  v_event_type TEXT;
  v_source_table TEXT;
BEGIN
  IF p_payload IS NULL THEN
    RAISE EXCEPTION 'invalid_payload'
      USING ERRCODE = '22023',
            MESSAGE = 'Ã–dÉ™niÅŸ event payload gÃ¶ndÉ™rilmÉ™yib';
  END IF;

  v_idempotency := NULLIF(trim(p_payload->>'idempotency_key'), '');
  IF v_idempotency IS NOT NULL THEN
    v_cached := public.find_erp_event_by_idempotency(v_idempotency);
    IF v_cached IS NOT NULL THEN
      RETURN v_cached->'result';
    END IF;
  END IF;

  v_document_type := lower(trim(COALESCE(p_payload->>'document_type', '')));
  v_document_id := NULLIF(p_payload->>'document_id', '')::uuid;
  v_amount := COALESCE(NULLIF(p_payload->>'amount', '')::numeric, 0);
  v_account_id := NULLIF(p_payload->>'account_id', '')::uuid;
  v_method := COALESCE(NULLIF(trim(p_payload->>'method'), ''), 'Ã–dÉ™niÅŸ');
  v_notes := NULLIF(trim(p_payload->>'notes'), '');
  v_payment_id := COALESCE(NULLIF(trim(p_payload->>'payment_id'), ''), gen_random_uuid()::text);

  IF v_document_id IS NULL THEN
    RAISE EXCEPTION 'document_required'
      USING ERRCODE = '22023',
            MESSAGE = 'SÉ™nÉ™d identifikatoru tÉ™lÉ™b olunur';
  END IF;

  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'invalid_amount'
      USING ERRCODE = '22023',
            MESSAGE = 'MÉ™blÉ™ÄŸ sÄ±fÄ±rdan bÃ¶yÃ¼k olmalÄ±dÄ±r';
  END IF;

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'account_required'
      USING ERRCODE = '22023',
            MESSAGE = 'Kassa/bank hesabÄ± seÃ§ilmÉ™lidir';
  END IF;

  PERFORM id FROM accounts WHERE id = v_account_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_not_found'
      USING ERRCODE = 'P0002',
            MESSAGE = 'SeÃ§ilmiÅŸ kassa/bank hesabÄ± tapÄ±lmadÄ±';
  END IF;

  IF v_document_type = 'sale' THEN
    IF NOT (
      public.require_permission('can_edit_sales')
      OR public.require_permission('can_create_invoice')
      OR public.require_permission('can_manage_finance')
    ) THEN
      RAISE EXCEPTION 'forbidden'
        USING ERRCODE = '42501',
              MESSAGE = 'SatÄ±ÅŸ Ã¶dÉ™niÅŸi Ã¼Ã§Ã¼n icazÉ™niz yoxdur';
    END IF;

    SELECT total_amount, paid_amount, remaining_balance, customer_id, doc_no, payments
    INTO v_total_amount, v_paid_amount, v_remaining, v_customer_id, v_doc_label, v_payments
    FROM sales
    WHERE id = v_document_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'sale_not_found'
        USING ERRCODE = 'P0002',
              MESSAGE = 'SatÄ±ÅŸ fakturasÄ± tapÄ±lmadÄ±';
    END IF;

    v_total_amount := COALESCE(v_total_amount, 0);
    v_paid_amount := COALESCE(v_paid_amount, 0);
    v_remaining := GREATEST(COALESCE(v_remaining, v_total_amount - v_paid_amount), 0);

    IF v_amount > v_remaining + 0.0001 THEN
      RAISE EXCEPTION 'overpayment'
        USING ERRCODE = '22023',
              MESSAGE = format('Qalan borc: %s AZN', trim(to_char(v_remaining, 'FM999999990.00')));
    END IF;

    v_new_paid := v_paid_amount + v_amount;
    v_new_remaining := GREATEST(v_total_amount - v_new_paid, 0);

    v_new_payment := jsonb_build_object(
      'id', v_payment_id,
      'account_id', v_account_id::text,
      'method', v_method,
      'amount', v_amount
    );
    v_payments := COALESCE(v_payments, '[]'::jsonb) || jsonb_build_array(v_new_payment);

    UPDATE sales
    SET paid_amount = v_new_paid,
        remaining_balance = v_new_remaining,
        payments = v_payments
    WHERE id = v_document_id;

    v_tx_id := public.post_cash_transaction(
      v_account_id,
      'MÉ™daxil',
      v_amount,
      'SatÄ±ÅŸ Ã–dÉ™niÅŸi',
      COALESCE(v_notes, format('SatÄ±ÅŸ fakturasÄ± %s â€” %s', COALESCE(v_doc_label, v_document_id::text), v_method)),
      NULL,
      'sale',
      v_document_id
    );

    SELECT journal_entry_id INTO v_journal_id
    FROM transactions
    WHERE id = v_tx_id;

    IF v_customer_id IS NOT NULL THEN
      PERFORM public.refresh_customer_ar_balance(v_customer_id);
    END IF;

    v_event_type := 'invoice_payment_sale';
    v_source_table := 'sales';

    v_result := jsonb_build_object(
      'success', true,
      'event_type', v_event_type,
      'document_type', 'sale',
      'document_id', v_document_id,
      'transaction_id', v_tx_id,
      'journal_entry_id', v_journal_id,
      'paid_amount', v_new_paid,
      'remaining_balance', v_new_remaining
    );
  ELSIF v_document_type = 'purchase' THEN
    IF NOT (
      public.require_permission('can_edit_purchases')
      OR public.require_permission('can_create_purchase')
      OR public.require_permission('can_manage_finance')
    ) THEN
      RAISE EXCEPTION 'forbidden'
        USING ERRCODE = '42501',
              MESSAGE = 'AlÄ±ÅŸ Ã¶dÉ™niÅŸi Ã¼Ã§Ã¼n icazÉ™niz yoxdur';
    END IF;

    SELECT total_amount, paid_amount, debt_amount, supplier_id, invoice_number
    INTO v_total_amount, v_paid_amount, v_debt_amount, v_supplier_id, v_doc_label
    FROM purchases
    WHERE id = v_document_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'purchase_not_found'
        USING ERRCODE = 'P0002',
              MESSAGE = 'AlÄ±ÅŸ fakturasÄ± tapÄ±lmadÄ±';
    END IF;

    v_total_amount := COALESCE(v_total_amount, 0);
    v_paid_amount := COALESCE(v_paid_amount, 0);
    v_debt_amount := GREATEST(COALESCE(v_debt_amount, v_total_amount - v_paid_amount), 0);

    IF v_amount > v_debt_amount + 0.0001 THEN
      RAISE EXCEPTION 'overpayment'
        USING ERRCODE = '22023',
              MESSAGE = format('Qalan borc: %s AZN', trim(to_char(v_debt_amount, 'FM999999990.00')));
    END IF;

    v_new_paid := v_paid_amount + v_amount;
    v_new_debt := GREATEST(v_total_amount - v_new_paid, 0);
    v_status := CASE WHEN v_new_debt > 0.0001 THEN 'Borclu' ELSE 'Ã–dÉ™nilib' END;

    UPDATE purchases
    SET paid_amount = v_new_paid,
        debt_amount = v_new_debt,
        status = v_status
    WHERE id = v_document_id;

    v_tx_id := public.post_cash_transaction(
      v_account_id,
      'MÉ™xaric',
      v_amount,
      'AlÄ±ÅŸ Ã–dÉ™niÅŸi',
      COALESCE(v_notes, format('AlÄ±ÅŸ fakturasÄ± %s â€” %s', COALESCE(v_doc_label, v_document_id::text), v_method)),
      NULL,
      'purchase',
      v_document_id
    );

    SELECT journal_entry_id INTO v_journal_id
    FROM transactions
    WHERE id = v_tx_id;

    IF v_supplier_id IS NOT NULL THEN
      PERFORM public.refresh_supplier_ap_balance(v_supplier_id);
    END IF;

    v_event_type := 'invoice_payment_purchase';
    v_source_table := 'purchases';

    v_result := jsonb_build_object(
      'success', true,
      'event_type', v_event_type,
      'document_type', 'purchase',
      'document_id', v_document_id,
      'transaction_id', v_tx_id,
      'journal_entry_id', v_journal_id,
      'paid_amount', v_new_paid,
      'debt_amount', v_new_debt,
      'status', v_status
    );
  ELSE
    RAISE EXCEPTION 'invalid_document_type'
      USING ERRCODE = '22023',
            MESSAGE = 'document_type Â«saleÂ» vÉ™ ya Â«purchaseÂ» olmalÄ±dÄ±r';
  END IF;

  v_event_id := public.log_erp_event(
    v_event_type,
    v_source_table,
    v_document_id,
    p_payload,
    v_journal_id,
    v_idempotency,
    v_result
  );

  RETURN v_result || jsonb_build_object('event_id', v_event_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_invoice_payment_event(JSONB) TO authenticated;

-- â”€â”€â”€ C. Purchase receipt event â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

DROP FUNCTION IF EXISTS public.process_purchase_receipt_event(JSONB);

CREATE OR REPLACE FUNCTION public.process_purchase_receipt_event(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_idempotency TEXT;
  v_cached JSONB;
  v_header JSONB;
  v_items JSONB;
  v_payments JSONB;
  v_supplier_id UUID;
  v_purchase_id UUID;
  v_invoice_number TEXT;
  v_total_amount NUMERIC;
  v_paid_amount NUMERIC;
  v_debt_amount NUMERIC;
  v_item JSONB;
  v_pay JSONB;
  v_product_id UUID;
  v_qty NUMERIC;
  v_unit_price NUMERIC;
  v_stock NUMERIC;
  v_account_id UUID;
  v_pay_amount NUMERIC;
  v_account_name TEXT;
  v_pay_note TEXT;
  v_stock_demand JSONB := '{}'::jsonb;
  v_price_map JSONB := '{}'::jsonb;
  v_key TEXT;
  v_journal_id UUID;
  v_event_id UUID;
  v_result JSONB;
  v_add_exp_total NUMERIC;
BEGIN
  IF p_payload IS NULL THEN
    RAISE EXCEPTION 'invalid_payload'
      USING ERRCODE = '22023',
            MESSAGE = 'AlÄ±ÅŸ event payload gÃ¶ndÉ™rilmÉ™yib';
  END IF;

  v_idempotency := NULLIF(trim(p_payload->>'idempotency_key'), '');
  IF v_idempotency IS NOT NULL THEN
    v_cached := public.find_erp_event_by_idempotency(v_idempotency);
    IF v_cached IS NOT NULL THEN
      RETURN v_cached->'result';
    END IF;
  END IF;

  IF NOT (
    public.require_permission('can_edit_purchases')
    OR public.require_permission('can_create_purchase')
    OR public.require_permission('can_manage_finance')
  ) THEN
    RAISE EXCEPTION 'forbidden'
      USING ERRCODE = '42501',
            MESSAGE = 'AlÄ±ÅŸ yaratmaq Ã¼Ã§Ã¼n icazÉ™niz yoxdur';
  END IF;

  v_header := COALESCE(p_payload->'header', '{}'::jsonb);
  v_items := COALESCE(p_payload->'items', '[]'::jsonb);
  v_payments := COALESCE(p_payload->'payments', '[]'::jsonb);

  IF jsonb_typeof(v_items) <> 'array' OR jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'items_required'
      USING ERRCODE = '22023',
            MESSAGE = 'Æn azÄ± bir mÉ™hsul tÉ™lÉ™b olunur';
  END IF;

  v_supplier_id := NULLIF(v_header->>'supplier_id', '')::uuid;
  IF v_supplier_id IS NULL THEN
    RAISE EXCEPTION 'supplier_required'
      USING ERRCODE = '22023',
            MESSAGE = 'TÉ™chizatÃ§Ä± seÃ§ilmÉ™lidir';
  END IF;

  PERFORM id FROM suppliers WHERE id = v_supplier_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'supplier_not_found'
      USING ERRCODE = 'P0002',
            MESSAGE = 'TÉ™chizatÃ§Ä± tapÄ±lmadÄ±';
  END IF;

  v_total_amount := COALESCE(NULLIF(v_header->>'total_amount', '')::numeric, 0);
  v_paid_amount := COALESCE(NULLIF(v_header->>'paid_amount', '')::numeric, 0);
  v_debt_amount := COALESCE(
    NULLIF(v_header->>'debt_amount', '')::numeric,
    GREATEST(v_total_amount - v_paid_amount, 0)
  );

  IF v_total_amount <= 0 THEN
    RAISE EXCEPTION 'invalid_total_amount'
      USING ERRCODE = '22023',
            MESSAGE = 'AlÄ±ÅŸ mÉ™blÉ™ÄŸi sÄ±fÄ±rdan bÃ¶yÃ¼k olmalÄ±dÄ±r';
  END IF;

  IF v_paid_amount > v_total_amount + 0.0001 THEN
    RAISE EXCEPTION 'overpaid'
      USING ERRCODE = '22023',
            MESSAGE = 'Ã–dÉ™nilÉ™n mÉ™blÉ™ÄŸ Ã¼mumi mÉ™blÉ™ÄŸdÉ™n bÃ¶yÃ¼k ola bilmÉ™z';
  END IF;

  IF abs((v_paid_amount + v_debt_amount) - v_total_amount) > 0.01 THEN
    RAISE EXCEPTION 'amount_mismatch'
      USING ERRCODE = '22023',
            MESSAGE = 'Ã–dÉ™nilÉ™n vÉ™ borc mÉ™blÉ™ÄŸlÉ™rinin cÉ™mi Ã¼mumi mÉ™blÉ™ÄŸÉ™ bÉ™rabÉ™r olmalÄ±dÄ±r';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_items)
  LOOP
    v_product_id := NULLIF(v_item->>'product_id', '')::uuid;
    v_qty := COALESCE(NULLIF(v_item->>'quantity', '')::numeric, 0);
    v_unit_price := COALESCE(NULLIF(v_item->>'unit_price', '')::numeric, 0);

    IF v_product_id IS NULL OR v_qty <= 0 OR v_unit_price <= 0 THEN
      RAISE EXCEPTION 'invalid_item'
        USING ERRCODE = '22023',
              MESSAGE = 'HÉ™r sÉ™tirdÉ™ mÉ™hsul, miqdar vÉ™ qiymÉ™t tÉ™lÉ™b olunur';
    END IF;

    v_key := v_product_id::text;
    v_stock_demand := jsonb_set(
      v_stock_demand,
      ARRAY[v_key],
      to_jsonb(COALESCE((v_stock_demand->>v_key)::numeric, 0) + v_qty),
      true
    );
    v_price_map := jsonb_set(v_price_map, ARRAY[v_key], to_jsonb(v_unit_price), true);
  END LOOP;

  FOR v_key IN SELECT jsonb_object_keys(v_stock_demand)
  LOOP
    PERFORM id FROM products WHERE id = v_key::uuid;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'product_not_found'
        USING ERRCODE = 'P0002',
              MESSAGE = 'MÉ™hsul tapÄ±lmadÄ±: ' || v_key;
    END IF;
  END LOOP;

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
                MESSAGE = 'Ã–dÉ™niÅŸ Ã¼Ã§Ã¼n kassa/bank hesabÄ± seÃ§ilmÉ™lidir';
      END IF;

      PERFORM id FROM accounts WHERE id = v_account_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'account_not_found'
          USING ERRCODE = 'P0002',
                MESSAGE = 'SeÃ§ilmiÅŸ kassa/bank hesabÄ± tapÄ±lmadÄ±';
      END IF;
    END LOOP;
  END IF;

  v_invoice_number := COALESCE(
    NULLIF(trim(v_header->>'invoice_number'), ''),
    NULLIF(trim(p_payload->>'invoice_number'), ''),
    'PUR-' || to_char(CURRENT_DATE, 'YYYY') || '-' || floor(10000 + random() * 90000)::int
  );

  INSERT INTO purchases (
    invoice_number, supplier_id, warehouse_id, doc_date, responsible_id, responsible_name,
    total_amount, paid_amount, debt_amount, status, notes
  )
  VALUES (
    v_invoice_number,
    v_supplier_id,
    NULLIF(v_header->>'warehouse_id', '')::uuid,
    COALESCE(NULLIF(v_header->>'doc_date', '')::date, CURRENT_DATE),
    NULLIF(v_header->>'responsible_id', '')::uuid,
    NULLIF(trim(v_header->>'responsible_name'), ''),
    v_total_amount,
    v_paid_amount,
    v_debt_amount,
    COALESCE(
      NULLIF(trim(v_header->>'status'), ''),
      CASE WHEN v_debt_amount > 0.0001 THEN 'Borclu' ELSE 'Ã–dÉ™nilib' END
    ),
    NULLIF(trim(v_header->>'notes'), '')
  )
  RETURNING id INTO v_purchase_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_items)
  LOOP
    INSERT INTO purchase_items (
      purchase_id, product_id, product_code, product_name, quantity, unit, unit_price, total_price
    )
    VALUES (
      v_purchase_id,
      NULLIF(v_item->>'product_id', '')::uuid,
      NULLIF(trim(v_item->>'product_code'), ''),
      NULLIF(trim(v_item->>'product_name'), ''),
      COALESCE(NULLIF(v_item->>'quantity', '')::numeric, 0),
      COALESCE(NULLIF(trim(v_item->>'unit'), ''), 'ÆdÉ™d'),
      COALESCE(NULLIF(v_item->>'unit_price', '')::numeric, 0),
      COALESCE(
        NULLIF(v_item->>'total_price', '')::numeric,
        NULLIF(v_item->>'total', '')::numeric,
        0
      )
    );
  END LOOP;

  FOR v_key IN SELECT jsonb_object_keys(v_stock_demand)
  LOOP
    v_product_id := v_key::uuid;
    v_qty := COALESCE((v_stock_demand->>v_key)::numeric, 0);
    v_unit_price := COALESCE((v_price_map->>v_key)::numeric, 0);

    SELECT stock INTO v_stock
    FROM products
    WHERE id = v_product_id
    FOR UPDATE;

    UPDATE products
    SET stock = COALESCE(v_stock, 0) + v_qty,
        buy_price = v_unit_price
    WHERE id = v_product_id;
  END LOOP;

  IF jsonb_typeof(v_payments) = 'array' THEN
    FOR v_pay IN SELECT value FROM jsonb_array_elements(v_payments)
    LOOP
      v_pay_amount := COALESCE(NULLIF(v_pay->>'amount', '')::numeric, 0);
      IF v_pay_amount <= 0 THEN
        CONTINUE;
      END IF;

      v_account_id := NULLIF(v_pay->>'account_id', '')::uuid;

      SELECT name INTO v_account_name
      FROM accounts
      WHERE id = v_account_id;

      v_pay_note := COALESCE(
        NULLIF(trim(v_pay->>'note'), ''),
        format('AlÄ±ÅŸ fakturasÄ± %s', v_invoice_number)
      );
      IF NULLIF(trim(v_pay->>'payment_date'), '') IS NOT NULL THEN
        v_pay_note := trim(v_pay->>'payment_date') || ' â€” ' || v_pay_note;
      END IF;
      IF v_account_name IS NOT NULL THEN
        v_pay_note := v_pay_note || ' â€” ' || v_account_name;
      END IF;

      PERFORM public.post_cash_transaction(
        v_account_id,
        'MÉ™xaric',
        v_pay_amount,
        'AlÄ±ÅŸ Ã–dÉ™niÅŸi',
        v_pay_note,
        NULL,
        'purchase',
        v_purchase_id
      );
    END LOOP;
  END IF;

  v_add_exp_total := public.apply_document_additional_expenses(
    COALESCE(p_payload->'additional_expenses', '[]'::jsonb),
    'purchase',
    v_purchase_id,
    v_invoice_number
  );

  UPDATE purchases
  SET additional_expenses = COALESCE(p_payload->'additional_expenses', '[]'::jsonb),
      additional_expenses_total = v_add_exp_total
  WHERE id = v_purchase_id;

  v_journal_id := public.post_journal_entry(
    jsonb_build_object(
      'source_type', 'purchase',
      'source_id', v_purchase_id,
      'idempotency_key', COALESCE(v_idempotency, 'purchase_receipt:' || v_purchase_id::text),
      'memo', format('AlÄ±ÅŸ fakturasÄ± %s', v_invoice_number),
      'lines', jsonb_build_array(
        jsonb_build_object(
          'coa_code', '1300',
          'debit', v_total_amount,
          'credit', 0,
          'line_memo', 'Inventar â€” ' || v_invoice_number
        ),
        jsonb_build_object(
          'coa_code', '2100',
          'debit', 0,
          'credit', v_total_amount,
          'partner_type', 'supplier',
          'partner_id', v_supplier_id,
          'line_memo', 'AP â€” ' || v_invoice_number
        )
      )
    )
  );

  PERFORM public.refresh_supplier_ap_balance(v_supplier_id);

  v_result := jsonb_build_object(
    'success', true,
    'event_type', 'purchase_receipt',
    'purchase_id', v_purchase_id,
    'invoice_number', v_invoice_number,
    'journal_entry_id', v_journal_id,
    'total_amount', v_total_amount,
    'paid_amount', v_paid_amount,
    'debt_amount', v_debt_amount
  );

  v_event_id := public.log_erp_event(
    'purchase_receipt',
    'purchases',
    v_purchase_id,
    p_payload,
    v_journal_id,
    v_idempotency,
    v_result
  );

  RETURN v_result || jsonb_build_object('event_id', v_event_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_purchase_receipt_event(JSONB) TO authenticated;

NOTIFY pgrst, 'reload schema';
-- Finance integration fix â€” run in Supabase SQL Editor AFTER rbac + account-mutations + erp-events
-- Fixes: User role can create invoices/payments; cashiers can read accounts/transactions;
--        production expenses post through journal engine.

-- â”€â”€â”€ Operational read access for invoice/purchase/production users â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

DROP POLICY IF EXISTS accounts_select ON public.accounts;
CREATE POLICY accounts_select ON public.accounts
  FOR SELECT TO authenticated
  USING (
    public.is_active_user()
    AND (
      public.has_permission('can_view_finance')
      OR public.has_permission('can_create_invoice')
      OR public.has_permission('can_create_purchase')
      OR public.has_permission('can_manage_production')
      OR public.has_permission('can_manage_finance')
    )
  );

DROP POLICY IF EXISTS transactions_select ON public.transactions;
CREATE POLICY transactions_select ON public.transactions
  FOR SELECT TO authenticated
  USING (
    public.is_active_user()
    AND (
      public.has_permission('can_view_finance')
      OR public.has_permission('can_create_invoice')
      OR public.has_permission('can_create_purchase')
      OR public.has_permission('can_manage_production')
      OR public.has_permission('can_manage_finance')
    )
  );

-- â”€â”€â”€ Production expense â†’ post_cash_transaction (journal + source linkage) â”€â”€â”€â”€

CREATE OR REPLACE FUNCTION public.create_production_expense_atomic(
  p_production_order_id UUID,
  p_code TEXT,
  p_category TEXT,
  p_description TEXT,
  p_amount NUMERIC,
  p_expense_date DATE,
  p_account_id UUID,
  p_account_name TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_actor_name TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tx_id UUID;
  v_finance_expense_id UUID;
  v_production_expense_id UUID;
  v_memo TEXT;
BEGIN
  IF NOT public.user_has_permission('can_manage_production') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'invalid_amount' USING ERRCODE = '22023';
  END IF;
  IF p_category NOT IN ('transport', 'delivery', 'installation', 'tools', 'other') THEN
    RAISE EXCEPTION 'invalid_category' USING ERRCODE = '22023';
  END IF;
  IF p_account_id IS NULL THEN
    RAISE EXCEPTION 'account_required' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM production_orders WHERE id = p_production_order_id) THEN
    RAISE EXCEPTION 'production_order_not_found' USING ERRCODE = 'P0002';
  END IF;

  v_memo := COALESCE(
    NULLIF(trim(p_notes), ''),
    format('Ä°stehsalat: %s', trim(p_description))
  );

  v_tx_id := public.post_cash_transaction(
    p_account_id,
    'MÉ™xaric',
    p_amount,
    'DigÉ™r',
    v_memo,
    p_production_order_id,
    'production',
    p_production_order_id
  );

  INSERT INTO expenses (code, category, amount, account_id, production_order_id, notes)
  VALUES (
    trim(p_code),
    'DigÉ™r',
    p_amount,
    p_account_id,
    p_production_order_id,
    NULLIF(trim(p_notes), '')
  )
  RETURNING id INTO v_finance_expense_id;

  INSERT INTO production_expenses (
    production_order_id, category, description, amount, expense_date,
    account_id, account_name, finance_expense_id, notes, created_by, created_by_name
  )
  VALUES (
    p_production_order_id, p_category, trim(p_description), p_amount,
    COALESCE(p_expense_date, CURRENT_DATE), p_account_id, NULLIF(trim(p_account_name), ''),
    v_finance_expense_id, NULLIF(trim(p_notes), ''), auth.uid(), NULLIF(trim(p_actor_name), '')
  )
  RETURNING id INTO v_production_expense_id;

  RETURN v_production_expense_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_production_expense_atomic(
  UUID, TEXT, TEXT, TEXT, NUMERIC, DATE, UUID, TEXT, TEXT, TEXT
) TO authenticated;

-- NOTE: Re-run types/erp-events-migration.sql (permission blocks updated) so User role
-- with can_create_invoice can submit sales and record payments.
