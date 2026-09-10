-- Patch invoice/bill event processors to use 1C GL journal helpers

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

  v_journal_id := public.post_sale_invoice_gl_journal(
    v_sale_id,
    v_doc_no,
    v_total_amount,
    v_customer_id,
    v_idempotency
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

GRANT EXECUTE ON FUNCTION public.process_sales_invoice_event(JSONB) TO authenticated, service_role;

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

  v_journal_id := public.post_purchase_bill_gl_journal(
    v_purchase_id,
    v_invoice_number,
    v_total_amount,
    v_supplier_id,
    v_idempotency
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

GRANT EXECUTE ON FUNCTION public.process_purchase_receipt_event(JSONB) TO authenticated, service_role;
