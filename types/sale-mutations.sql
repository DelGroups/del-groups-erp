-- Del Groups ERP — Atomic sale creation
-- Run in Supabase SQL Editor AFTER types/rbac-migration.sql, types/account-mutations.sql,
-- AND types/customer-ar-mutations.sql (refresh_customer_ar_balance).
-- Called via supabase.rpc('create_sale_atomic', { p_payload: ... }) from submitSale.ts

DROP FUNCTION IF EXISTS public.create_sale_atomic(JSONB);

CREATE OR REPLACE FUNCTION public.create_sale_atomic(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
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
  v_item_ids JSONB := '[]'::jsonb;
  v_item_id UUID;
  v_idx INT := 0;
  v_stock_demand JSONB := '{}'::jsonb;
  v_key TEXT;
BEGIN
  IF NOT (
    public.require_permission('can_edit_sales')
    OR public.require_permission('can_create_invoice')
    OR public.require_permission('can_manage_finance')
  ) THEN
    RAISE EXCEPTION 'forbidden'
      USING ERRCODE = '42501',
            MESSAGE = 'Satış yaratmaq üçün icazəniz yoxdur';
  END IF;

  IF p_payload IS NULL THEN
    RAISE EXCEPTION 'invalid_payload'
      USING ERRCODE = '22023',
            MESSAGE = 'Satış məlumatları göndərilməyib';
  END IF;

  v_header := COALESCE(p_payload->'header', '{}'::jsonb);
  v_items := COALESCE(p_payload->'items', '[]'::jsonb);
  v_payments := COALESCE(p_payload->'payments', '[]'::jsonb);

  IF jsonb_typeof(v_items) <> 'array' OR jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'items_required'
      USING ERRCODE = '22023',
            MESSAGE = 'Ən azı bir satış sətri tələb olunur';
  END IF;

  IF (p_payload ? 'decrement_stock') THEN
    v_decrement_stock := COALESCE((p_payload->>'decrement_stock')::boolean, true);
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

  v_total_amount := COALESCE(NULLIF(v_header->>'total_amount', '')::numeric, 0);
  v_paid_amount := COALESCE(NULLIF(v_header->>'paid_amount', '')::numeric, 0);
  v_remaining := GREATEST(
    COALESCE(
      NULLIF(v_header->>'remaining_balance', '')::numeric,
      v_total_amount - v_paid_amount
    ),
    0
  );

  IF v_paid_amount > v_total_amount + 0.0001 THEN
    RAISE EXCEPTION 'overpaid'
      USING ERRCODE = '22023',
            MESSAGE = 'Ödənilən məbləğ ümumi məbləğdən böyük ola bilməz';
  END IF;

  -- Aggregate stock demand per product (standard lines only)
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
                MESSAGE = 'Məhsul tapılmadı: ' || v_key;
      END IF;

      IF COALESCE(v_stock, 0) + 0.000001 < v_qty THEN
        RAISE EXCEPTION 'insufficient_stock'
          USING ERRCODE = '22023',
                MESSAGE = format(
                  'Stok kifayət etmir (məhsul %s, tələb: %s, mövcud: %s)',
                  v_key,
                  trim(to_char(v_qty, 'FM999999990.00')),
                  trim(to_char(COALESCE(v_stock, 0), 'FM999999990.00'))
                );
      END IF;
    END LOOP;
  END IF;

  -- Validate payment accounts before writing
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
    END LOOP;
  END IF;

  v_doc_no := NULLIF(trim(v_header->>'doc_no'), '');
  IF v_doc_no IS NULL THEN
    v_doc_no := 'SF-' || to_char(CURRENT_DATE, 'YYYY') || '-' || floor(10000 + random() * 90000)::int;
  END IF;

  INSERT INTO sales (
    doc_no,
    invoice_number,
    doc_date,
    customer_id,
    customer_name,
    seller_id,
    seller_name,
    warehouse_name,
    subtotal,
    discount_total,
    vat_total,
    total_amount,
    paid_amount,
    remaining_balance,
    delivery_address,
    delivery_type,
    delivery_fee,
    note,
    notes,
    payments,
    created_at
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

  -- Insert line items
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_items)
  LOOP
    INSERT INTO sale_items (
      sale_id,
      product_id,
      product_code,
      product_name,
      warehouse_id,
      warehouse_name,
      quantity,
      unit,
      unit_price,
      discount_percent,
      vat_rate,
      line_total,
      extra_info,
      polywood_sale_mode,
      polywood_length_m
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
      COALESCE(
        NULLIF(v_item->>'line_total', '')::numeric,
        NULLIF(v_item->>'total', '')::numeric,
        0
      ),
      NULLIF(trim(v_item->>'extra_info'), ''),
      NULLIF(trim(v_item->>'polywood_sale_mode'), ''),
      NULLIF(v_item->>'polywood_length_m', '')::numeric
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

  -- Deduct aggregated stock
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

  -- Cash payments: transactions + account balance
  IF jsonb_typeof(v_payments) = 'array' THEN
    FOR v_pay IN SELECT value FROM jsonb_array_elements(v_payments)
    LOOP
      v_pay_amount := COALESCE(NULLIF(v_pay->>'amount', '')::numeric, 0);
      IF v_pay_amount <= 0 THEN
        CONTINUE;
      END IF;

      v_account_id := NULLIF(v_pay->>'account_id', '')::uuid;
      v_pay_method := COALESCE(NULLIF(trim(v_pay->>'method'), ''), 'Ödəniş');

      PERFORM public.post_cash_transaction(
        v_account_id,
        'Mədaxil',
        v_pay_amount,
        'Satış Ödənişi',
        format('Satış fakturası %s — %s', v_doc_no, v_pay_method)
      );
    END LOOP;
  END IF;

  -- Accounts receivable on customer master (derived from open sales)
  PERFORM public.refresh_customer_ar_balance(v_customer_id);

  RETURN jsonb_build_object(
    'sale_id', v_sale_id,
    'doc_no', v_doc_no,
    'items', v_item_ids
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_sale_atomic(JSONB) TO authenticated;
