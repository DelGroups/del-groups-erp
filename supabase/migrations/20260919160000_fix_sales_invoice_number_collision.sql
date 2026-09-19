-- Sales invoice save failed with:
--   duplicate key value violates unique constraint "sales_invoice_number_key"
--
-- The form peeks SS-YYYY-NNNNN and sends it as doc_no. save_sales_invoice_draft
-- trusted that preview and wrote it to both doc_no and invoice_number without
-- incrementing document_number_counters. The next peek returned the same number,
-- which already existed, so every subsequent save failed.

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
  v_doc TEXT;
  v_attempts INT := 0;
BEGIN
  LOOP
    INSERT INTO public.document_number_counters (doc_type, year, last_no)
    VALUES ('sales_invoice', v_year, 1)
    ON CONFLICT (doc_type, year)
    DO UPDATE SET last_no = public.document_number_counters.last_no + 1
    RETURNING last_no INTO v_no;

    v_doc := v_prefix || '-' || v_year::TEXT || '-' || lpad(v_no::TEXT, 5, '0');

    EXIT WHEN NOT EXISTS (
      SELECT 1
      FROM public.sales s
      WHERE s.doc_no = v_doc
         OR s.invoice_number = v_doc
    );

    v_attempts := v_attempts + 1;
    IF v_attempts > 10000 THEN
      RAISE EXCEPTION 'doc_no_exhausted'
        USING ERRCODE = 'P0001',
              MESSAGE = 'Satış sənəd nömrəsi yaradıla bilmədi';
    END IF;
  END LOOP;

  RETURN v_doc;
END;
$$;

CREATE OR REPLACE FUNCTION public.sales_doc_serial(p_value TEXT)
RETURNS INT
LANGUAGE SQL
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_value ~ '^[A-Za-z]+-[0-9]{4}-[0-9]+$'
      THEN NULLIF(substring(p_value from '[0-9]+$'), '')::INT
    ELSE NULL
  END;
$$;

-- Align the counter with the highest serial already stored.
INSERT INTO public.document_number_counters (doc_type, year, last_no)
SELECT
  'sales_invoice',
  EXTRACT(YEAR FROM CURRENT_DATE)::INT,
  COALESCE(
    (
      SELECT MAX(n)
      FROM (
        SELECT public.sales_doc_serial(s.doc_no) AS n FROM public.sales s
        UNION ALL
        SELECT public.sales_doc_serial(s.invoice_number) FROM public.sales s
      ) nums
      WHERE n IS NOT NULL
    ),
    0
  )
ON CONFLICT (doc_type, year) DO UPDATE
SET last_no = GREATEST(public.document_number_counters.last_no, EXCLUDED.last_no);

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
  v_invoice_number TEXT;
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
    SELECT status, doc_no, invoice_number INTO v_status, v_doc_no, v_invoice_number
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
    v_prefix := CASE
      WHEN COALESCE(v_header->>'invoice_mode', '') = 'polywood' THEN 'SPW'
      ELSE 'SS'
    END;
    -- Never trust a peeked preview number; allocate atomically.
    v_doc_no := public.next_sales_doc_no(v_prefix);
    v_invoice_number := v_doc_no;
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
      COALESCE(v_invoice_number, v_doc_no),
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

GRANT EXECUTE ON FUNCTION public.next_sales_doc_no(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_sales_invoice_draft(JSONB) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
