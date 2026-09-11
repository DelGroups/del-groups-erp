-- 1C-style sales document lifecycle: draft vs posted, payment terms, sequential numbers.
-- Does not rewrite process_sales_invoice_event; posting of drafts uses helper RPCs
-- that call the same stock / FIFO / cash / GL functions.

-- ─── Header metadata ─────────────────────────────────────────────────────────

ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS status TEXT;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS payment_type TEXT;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS due_date DATE;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'AZN';
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC NOT NULL DEFAULT 1;
ALTER TABLE public.sales ADD COLUMN IF NOT EXISTS posted_at TIMESTAMPTZ;

UPDATE public.sales
SET status = 'posted'
WHERE status IS NULL OR btrim(status) = '';

UPDATE public.sales
SET payment_type = 'cash'
WHERE payment_type IS NULL OR btrim(payment_type) = '';

UPDATE public.sales
SET currency = 'AZN'
WHERE currency IS NULL OR btrim(currency) = '';

ALTER TABLE public.sales
  ALTER COLUMN status SET DEFAULT 'draft';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sales_status_check'
  ) THEN
    ALTER TABLE public.sales
      ADD CONSTRAINT sales_status_check
      CHECK (status IN ('draft', 'posted', 'cancelled', 'void', 'voided'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sales_payment_type_check'
  ) THEN
    ALTER TABLE public.sales
      ADD CONSTRAINT sales_payment_type_check
      CHECK (payment_type IN ('cash', 'credit', 'bank_transfer'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sales_currency_check'
  ) THEN
    ALTER TABLE public.sales
      ADD CONSTRAINT sales_currency_check
      CHECK (currency IN ('AZN', 'USD', 'EUR'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_sales_status ON public.sales (status);
CREATE INDEX IF NOT EXISTS idx_sales_due_date ON public.sales (due_date);

-- Legacy invoices created by process_sales_invoice_event without status → posted
CREATE OR REPLACE FUNCTION public.sales_default_posted_when_blank()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IS NULL OR btrim(NEW.status) = '' THEN
    NEW.status := 'posted';
  END IF;
  IF NEW.payment_type IS NULL OR btrim(NEW.payment_type) = '' THEN
    NEW.payment_type := 'cash';
  END IF;
  IF NEW.currency IS NULL OR btrim(NEW.currency) = '' THEN
    NEW.currency := 'AZN';
  END IF;
  IF NEW.exchange_rate IS NULL OR NEW.exchange_rate <= 0 THEN
    NEW.exchange_rate := 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sales_default_posted_when_blank ON public.sales;
CREATE TRIGGER trg_sales_default_posted_when_blank
BEFORE INSERT ON public.sales
FOR EACH ROW
EXECUTE FUNCTION public.sales_default_posted_when_blank();

-- ─── Sequential document numbers SS-YYYY-00001 ───────────────────────────────

CREATE TABLE IF NOT EXISTS public.document_number_counters (
  doc_type TEXT NOT NULL,
  year INT NOT NULL,
  last_no INT NOT NULL DEFAULT 0,
  PRIMARY KEY (doc_type, year)
);

CREATE OR REPLACE FUNCTION public.next_sales_doc_no(p_prefix TEXT DEFAULT 'SS')
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year INT := EXTRACT(YEAR FROM CURRENT_DATE)::INT;
  v_no INT;
  v_prefix TEXT := COALESCE(NULLIF(trim(p_prefix), ''), 'SS');
BEGIN
  INSERT INTO public.document_number_counters (doc_type, year, last_no)
  VALUES ('sales_invoice', v_year, 1)
  ON CONFLICT (doc_type, year)
  DO UPDATE SET last_no = public.document_number_counters.last_no + 1
  RETURNING last_no INTO v_no;

  RETURN v_prefix || '-' || v_year::TEXT || '-' || lpad(v_no::TEXT, 5, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.peek_next_sales_doc_no(p_prefix TEXT DEFAULT 'SS')
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year INT := EXTRACT(YEAR FROM CURRENT_DATE)::INT;
  v_no INT;
  v_prefix TEXT := COALESCE(NULLIF(trim(p_prefix), ''), 'SS');
BEGIN
  SELECT last_no INTO v_no
  FROM public.document_number_counters
  WHERE doc_type = 'sales_invoice' AND year = v_year;

  RETURN v_prefix || '-' || v_year::TEXT || '-' || lpad((COALESCE(v_no, 0) + 1)::TEXT, 5, '0');
END;
$$;

GRANT EXECUTE ON FUNCTION public.next_sales_doc_no(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.peek_next_sales_doc_no(TEXT) TO authenticated, service_role;

-- ─── Save draft (no stock, no GL, no cash) ───────────────────────────────────

CREATE OR REPLACE FUNCTION public.save_sales_invoice_draft(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_header JSONB;
  v_items JSONB;
  v_payments JSONB;
  v_sale_id UUID;
  v_doc_no TEXT;
  v_customer_id UUID;
  v_customer_name TEXT;
  v_prefix TEXT;
  v_item JSONB;
  v_status TEXT;
  v_item_ids JSONB := '[]'::jsonb;
  v_item_id UUID;
  v_idx INT := 0;
  v_add_exp JSONB;
BEGIN
  IF p_payload IS NULL THEN
    RAISE EXCEPTION 'invalid_payload'
      USING ERRCODE = '22023',
            MESSAGE = 'Satış draft payload göndərilməyib';
  END IF;

  IF NOT (
    public.require_permission('can_edit_sales')
    OR public.require_permission('can_create_invoice')
    OR public.require_permission('can_manage_finance')
  ) THEN
    RAISE EXCEPTION 'forbidden'
      USING ERRCODE = '42501',
            MESSAGE = 'Satış yaratmaq üçün icazəniz yoxdur';
  END IF;

  v_header := COALESCE(p_payload->'header', '{}'::jsonb);
  v_items := COALESCE(p_payload->'items', '[]'::jsonb);
  v_payments := COALESCE(p_payload->'payments', '[]'::jsonb);
  v_add_exp := COALESCE(p_payload->'additional_expenses', '[]'::jsonb);
  v_sale_id := NULLIF(p_payload->>'sale_id', '')::uuid;
  IF v_sale_id IS NULL THEN
    v_sale_id := NULLIF(v_header->>'id', '')::uuid;
  END IF;

  IF jsonb_typeof(v_items) <> 'array' OR jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'items_required'
      USING ERRCODE = '22023',
            MESSAGE = 'Ən azı bir satış sətri tələb olunur';
  END IF;

  v_customer_id := NULLIF(v_header->>'customer_id', '')::uuid;
  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'customer_required'
      USING ERRCODE = '22023',
            MESSAGE = 'Müştəri seçilməlidir';
  END IF;

  SELECT COALESCE(NULLIF(trim(full_name), ''), NULLIF(trim(name), ''), NULLIF(trim(company_name), ''), '')
  INTO v_customer_name
  FROM customers
  WHERE id = v_customer_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'customer_not_found'
      USING ERRCODE = 'P0002',
            MESSAGE = 'Müştəri tapılmadı';
  END IF;

  IF v_sale_id IS NOT NULL THEN
    SELECT status, doc_no INTO v_status, v_doc_no
    FROM sales
    WHERE id = v_sale_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'sale_not_found'
        USING ERRCODE = 'P0002',
              MESSAGE = 'Satış sənədi tapılmadı';
    END IF;

    IF v_status = 'posted' THEN
      RAISE EXCEPTION 'already_posted'
        USING ERRCODE = '22023',
              MESSAGE = 'Təsdiqlənmiş sənəd redaktə edilə bilməz';
    END IF;

    IF v_status IN ('cancelled', 'void', 'voided') THEN
      RAISE EXCEPTION 'cancelled_document'
        USING ERRCODE = '22023',
              MESSAGE = 'Ləğv edilmiş sənəd redaktə edilə bilməz';
    END IF;
  ELSE
    v_doc_no := NULLIF(trim(v_header->>'doc_no'), '');
    v_prefix := CASE
      WHEN COALESCE(v_header->>'invoice_mode', '') = 'polywood' THEN 'SPW'
      ELSE 'SS'
    END;
    IF v_doc_no IS NULL OR v_doc_no ~ '\.{3,}$' THEN
      v_doc_no := public.next_sales_doc_no(v_prefix);
    END IF;
  END IF;

  IF v_sale_id IS NULL THEN
    INSERT INTO sales (
      doc_no, invoice_number, doc_date, customer_id, customer_name,
      seller_id, seller_name, warehouse_name, subtotal, discount_total, vat_total,
      total_amount, paid_amount, remaining_balance, delivery_address, delivery_type,
      delivery_fee, note, notes, payments, created_at, status, payment_type,
      due_date, currency, exchange_rate, additional_expenses, additional_expenses_total
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
      COALESCE(NULLIF(v_header->>'total_amount', '')::numeric, 0),
      COALESCE(NULLIF(v_header->>'paid_amount', '')::numeric, 0),
      GREATEST(COALESCE(NULLIF(v_header->>'remaining_balance', '')::numeric, 0), 0),
      NULLIF(trim(v_header->>'delivery_address'), ''),
      COALESCE(NULLIF(trim(v_header->>'delivery_type'), ''), 'free'),
      COALESCE(NULLIF(v_header->>'delivery_fee', '')::numeric, 0),
      NULLIF(trim(v_header->>'note'), ''),
      NULLIF(trim(v_header->>'notes'), ''),
      COALESCE(v_header->'payments', v_payments, '[]'::jsonb),
      COALESCE(NULLIF(v_header->>'created_at', '')::timestamptz, NOW()),
      'draft',
      COALESCE(NULLIF(trim(v_header->>'payment_type'), ''), 'cash'),
      NULLIF(v_header->>'due_date', '')::date,
      COALESCE(NULLIF(trim(v_header->>'currency'), ''), 'AZN'),
      COALESCE(NULLIF(v_header->>'exchange_rate', '')::numeric, 1),
      v_add_exp,
      COALESCE(NULLIF(v_header->>'additional_expenses_total', '')::numeric, 0)
    )
    RETURNING id INTO v_sale_id;
  ELSE
    UPDATE sales SET
      doc_date = COALESCE(NULLIF(v_header->>'doc_date', '')::date, doc_date),
      customer_id = v_customer_id,
      customer_name = COALESCE(NULLIF(trim(v_header->>'customer_name'), ''), v_customer_name),
      seller_id = NULLIF(v_header->>'seller_id', '')::uuid,
      seller_name = NULLIF(trim(v_header->>'seller_name'), ''),
      warehouse_name = NULLIF(trim(v_header->>'warehouse_name'), ''),
      subtotal = COALESCE(NULLIF(v_header->>'subtotal', '')::numeric, 0),
      discount_total = COALESCE(NULLIF(v_header->>'discount_total', '')::numeric, 0),
      vat_total = COALESCE(NULLIF(v_header->>'vat_total', '')::numeric, 0),
      total_amount = COALESCE(NULLIF(v_header->>'total_amount', '')::numeric, 0),
      paid_amount = COALESCE(NULLIF(v_header->>'paid_amount', '')::numeric, 0),
      remaining_balance = GREATEST(COALESCE(NULLIF(v_header->>'remaining_balance', '')::numeric, 0), 0),
      delivery_address = NULLIF(trim(v_header->>'delivery_address'), ''),
      delivery_type = COALESCE(NULLIF(trim(v_header->>'delivery_type'), ''), 'free'),
      delivery_fee = COALESCE(NULLIF(v_header->>'delivery_fee', '')::numeric, 0),
      note = NULLIF(trim(v_header->>'note'), ''),
      notes = NULLIF(trim(v_header->>'notes'), ''),
      payments = COALESCE(v_header->'payments', v_payments, '[]'::jsonb),
      status = 'draft',
      payment_type = COALESCE(NULLIF(trim(v_header->>'payment_type'), ''), payment_type, 'cash'),
      due_date = NULLIF(v_header->>'due_date', '')::date,
      currency = COALESCE(NULLIF(trim(v_header->>'currency'), ''), currency, 'AZN'),
      exchange_rate = COALESCE(NULLIF(v_header->>'exchange_rate', '')::numeric, exchange_rate, 1),
      additional_expenses = v_add_exp,
      additional_expenses_total = COALESCE(NULLIF(v_header->>'additional_expenses_total', '')::numeric, 0)
    WHERE id = v_sale_id;

    DELETE FROM sale_items WHERE sale_id = v_sale_id;
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_items)
  LOOP
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
      COALESCE(NULLIF(trim(v_item->>'unit'), ''), 'Ədəd'),
      COALESCE(NULLIF(v_item->>'unit_price', '')::numeric, 0),
      COALESCE(NULLIF(v_item->>'discount_percent', '')::numeric, 0),
      COALESCE(NULLIF(v_item->>'vat_rate', '')::numeric, 0),
      COALESCE(NULLIF(v_item->>'line_total', '')::numeric, NULLIF(v_item->>'total', '')::numeric, 0),
      NULLIF(trim(v_item->>'extra_info'), ''),
      NULLIF(trim(v_item->>'polywood_sale_mode'), ''),
      NULLIF(trim(v_item->>'polywood_length_m'), '')::numeric
    )
    RETURNING id INTO v_item_id;

    v_item_ids := v_item_ids || jsonb_build_array(
      jsonb_build_object(
        'index', v_idx,
        'id', v_item_id,
        'product_id', NULLIF(v_item->>'product_id', '')::uuid,
        'polywood_sale_mode', NULLIF(trim(v_item->>'polywood_sale_mode'), '')
      )
    );
    v_idx := v_idx + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'event_type', 'sales_invoice_draft',
    'sale_id', v_sale_id,
    'doc_no', v_doc_no,
    'status', 'draft',
    'items', v_item_ids
  );
END;
$$;

-- ─── Post a saved draft (stock + FIFO + cash + expenses + GL) ────────────────

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

  v_stock_demand := public.build_and_validate_sale_stock_demand(v_items);
  PERFORM public.apply_sale_stock_decrement(v_stock_demand);

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

  v_event_id := public.log_erp_event(
    'sales_invoice',
    'sales',
    p_sale_id,
    jsonb_build_object('sale_id', p_sale_id, 'posted_from', 'draft'),
    COALESCE(v_cogs_journal_id, v_journal_id),
    v_idempotency,
    v_result
  );

  RETURN v_result || jsonb_build_object('event_id', v_event_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_sales_invoice_draft(JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.post_sales_invoice_draft(UUID) TO authenticated, service_role;
