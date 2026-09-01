-- Del Groups ERP — Atomic purchase creation
-- Run in Supabase SQL Editor AFTER types/rbac-migration.sql AND types/account-mutations.sql.

DROP FUNCTION IF EXISTS public.create_purchase_atomic(JSONB);

CREATE OR REPLACE FUNCTION public.create_purchase_atomic(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
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
  v_account_balance NUMERIC;
  v_supplier_balance NUMERIC;
  v_account_name TEXT;
  v_pay_note TEXT;
  v_stock_demand JSONB := '{}'::jsonb;
  v_price_map JSONB := '{}'::jsonb;
  v_key TEXT;
BEGIN
  IF NOT (
    public.require_permission('can_edit_purchases')
    OR public.require_permission('can_create_purchase')
    OR public.require_permission('can_manage_finance')
  ) THEN
    RAISE EXCEPTION 'forbidden'
      USING ERRCODE = '42501',
            MESSAGE = 'Alış yaratmaq üçün icazəniz yoxdur';
  END IF;

  IF p_payload IS NULL THEN
    RAISE EXCEPTION 'invalid_payload'
      USING ERRCODE = '22023',
            MESSAGE = 'Alış məlumatları göndərilməyib';
  END IF;

  v_header := COALESCE(p_payload->'header', '{}'::jsonb);
  v_items := COALESCE(p_payload->'items', '[]'::jsonb);
  v_payments := COALESCE(p_payload->'payments', '[]'::jsonb);

  IF jsonb_typeof(v_items) <> 'array' OR jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'items_required'
      USING ERRCODE = '22023',
            MESSAGE = 'Ən azı bir məhsul tələb olunur';
  END IF;

  v_supplier_id := NULLIF(v_header->>'supplier_id', '')::uuid;
  IF v_supplier_id IS NULL THEN
    RAISE EXCEPTION 'supplier_required'
      USING ERRCODE = '22023',
            MESSAGE = 'Təchizatçı seçilməlidir';
  END IF;

  PERFORM id FROM suppliers WHERE id = v_supplier_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'supplier_not_found'
      USING ERRCODE = 'P0002',
            MESSAGE = 'Təchizatçı tapılmadı';
  END IF;

  v_total_amount := COALESCE(NULLIF(v_header->>'total_amount', '')::numeric, 0);
  v_paid_amount := COALESCE(NULLIF(v_header->>'paid_amount', '')::numeric, 0);
  v_debt_amount := COALESCE(
    NULLIF(v_header->>'debt_amount', '')::numeric,
    GREATEST(v_total_amount - v_paid_amount, 0)
  );

  IF v_paid_amount > v_total_amount + 0.0001 THEN
    RAISE EXCEPTION 'overpaid'
      USING ERRCODE = '22023',
            MESSAGE = 'Ödənilən məbləğ ümumi məbləğdən böyük ola bilməz';
  END IF;

  IF abs((v_paid_amount + v_debt_amount) - v_total_amount) > 0.01 THEN
    RAISE EXCEPTION 'amount_mismatch'
      USING ERRCODE = '22023',
            MESSAGE = 'Ödənilən və borc məbləğlərinin cəmi ümumi məbləğə bərabər olmalıdır';
  END IF;

  -- Aggregate stock increases per product (last unit_price wins per key)
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_items)
  LOOP
    v_product_id := NULLIF(v_item->>'product_id', '')::uuid;
    v_qty := COALESCE(NULLIF(v_item->>'quantity', '')::numeric, 0);
    v_unit_price := COALESCE(NULLIF(v_item->>'unit_price', '')::numeric, 0);

    IF v_product_id IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'invalid_item'
        USING ERRCODE = '22023',
              MESSAGE = 'Hər sətirdə məhsul və miqdar tələb olunur';
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
              MESSAGE = 'Məhsul tapılmadı: ' || v_key;
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

  v_invoice_number := COALESCE(
    NULLIF(trim(v_header->>'invoice_number'), ''),
    NULLIF(trim(p_payload->>'invoice_number'), ''),
    'PUR-' || to_char(CURRENT_DATE, 'YYYY') || '-' || floor(10000 + random() * 90000)::int
  );

  INSERT INTO purchases (
    invoice_number,
    supplier_id,
    warehouse_id,
    doc_date,
    responsible_id,
    responsible_name,
    total_amount,
    paid_amount,
    debt_amount,
    status,
    notes
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
      CASE WHEN v_debt_amount > 0.0001 THEN 'Borclu' ELSE 'Ödənilib' END
    ),
    NULLIF(trim(v_header->>'notes'), '')
  )
  RETURNING id INTO v_purchase_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_items)
  LOOP
    INSERT INTO purchase_items (
      purchase_id,
      product_id,
      product_code,
      product_name,
      quantity,
      unit,
      unit_price,
      total_price
    )
    VALUES (
      v_purchase_id,
      NULLIF(v_item->>'product_id', '')::uuid,
      NULLIF(trim(v_item->>'product_code'), ''),
      NULLIF(trim(v_item->>'product_name'), ''),
      COALESCE(NULLIF(v_item->>'quantity', '')::numeric, 0),
      COALESCE(NULLIF(trim(v_item->>'unit'), ''), 'Ədəd'),
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
    SET
      stock = COALESCE(v_stock, 0) + v_qty,
      buy_price = v_unit_price
    WHERE id = v_product_id;
  END LOOP;

  IF v_debt_amount > 0.0001 THEN
    SELECT balance INTO v_supplier_balance
    FROM suppliers
    WHERE id = v_supplier_id
    FOR UPDATE;

    UPDATE suppliers
    SET balance = COALESCE(v_supplier_balance, 0) + v_debt_amount
    WHERE id = v_supplier_id;
  END IF;

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
        format('Alış fakturası %s', v_invoice_number)
      );
      IF NULLIF(trim(v_pay->>'payment_date'), '') IS NOT NULL THEN
        v_pay_note := trim(v_pay->>'payment_date') || ' — ' || v_pay_note;
      END IF;
      IF v_account_name IS NOT NULL THEN
        v_pay_note := v_pay_note || ' — ' || v_account_name;
      END IF;

      PERFORM public.post_cash_transaction(
        v_account_id,
        'Məxaric',
        v_pay_amount,
        'Alış Ödənişi',
        v_pay_note
      );
    END LOOP;
  END IF;

  RETURN jsonb_build_object(
    'purchase_id', v_purchase_id,
    'invoice_number', v_invoice_number
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_purchase_atomic(JSONB) TO authenticated;
