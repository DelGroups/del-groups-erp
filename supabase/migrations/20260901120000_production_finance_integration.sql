-- Production ↔ Finance integration: contract-time advance posting + delivery deduplication

ALTER TABLE public.production_orders
  ADD COLUMN IF NOT EXISTS advance_posted_at TIMESTAMPTZ;

ALTER TABLE public.production_orders
  ADD COLUMN IF NOT EXISTS advance_transaction_id UUID REFERENCES public.transactions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_production_orders_advance_tx
  ON public.production_orders (advance_transaction_id)
  WHERE advance_transaction_id IS NOT NULL;

DROP FUNCTION IF EXISTS public.process_production_advance_payment_event(JSONB);

CREATE OR REPLACE FUNCTION public.process_production_advance_payment_event(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_idempotency TEXT;
  v_cached JSONB;
  v_order_id UUID;
  v_account_id UUID;
  v_amount NUMERIC;
  v_order production_orders%ROWTYPE;
  v_tx_id UUID;
  v_event_id UUID;
  v_result JSONB;
BEGIN
  IF p_payload IS NULL THEN
    RAISE EXCEPTION 'invalid_payload'
      USING ERRCODE = '22023',
            MESSAGE = 'Avans payload göndərilməyib';
  END IF;

  v_idempotency := NULLIF(trim(p_payload->>'idempotency_key'), '');
  IF v_idempotency IS NOT NULL THEN
    v_cached := public.find_erp_event_by_idempotency(v_idempotency);
    IF v_cached IS NOT NULL THEN
      RETURN v_cached->'result';
    END IF;
  END IF;

  IF NOT public.user_has_permission('can_manage_production') THEN
    RAISE EXCEPTION 'forbidden'
      USING ERRCODE = '42501',
            MESSAGE = 'İcazəniz yoxdur';
  END IF;

  v_order_id := NULLIF(p_payload->>'order_id', '')::uuid;
  IF v_order_id IS NULL THEN
    RAISE EXCEPTION 'order_required'
      USING ERRCODE = '22023',
            MESSAGE = 'İstehsal sifarişi identifikatoru tələb olunur';
  END IF;

  SELECT * INTO v_order
  FROM production_orders
  WHERE id = v_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'production_order_not_found'
      USING ERRCODE = 'P0002',
            MESSAGE = 'İstehsal sifarişi tapılmadı';
  END IF;

  IF v_order.advance_transaction_id IS NOT NULL THEN
    v_result := jsonb_build_object(
      'success', true,
      'event_type', 'production_advance_payment',
      'order_id', v_order_id,
      'transaction_id', v_order.advance_transaction_id,
      'already_posted', true
    );
    IF v_idempotency IS NOT NULL THEN
      PERFORM public.log_erp_event(
        'production_advance_payment',
        'production_orders',
        v_order_id,
        p_payload,
        NULL,
        v_idempotency,
        v_result
      );
    END IF;
    RETURN v_result;
  END IF;

  v_amount := COALESCE(
    NULLIF(p_payload->>'amount', '')::numeric,
    v_order.advance_payment,
    0
  );

  IF v_amount <= 0.0001 THEN
    RETURN jsonb_build_object('success', true, 'skipped', true, 'reason', 'no_advance');
  END IF;

  v_account_id := COALESCE(
    NULLIF(p_payload->>'account_id', '')::uuid,
    v_order.advance_account_id
  );

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'account_required'
      USING ERRCODE = '22023',
            MESSAGE = 'Avans ödənişi üçün kassa/bank hesabı seçilməlidir';
  END IF;

  IF v_order.customer_id IS NULL THEN
    RAISE EXCEPTION 'customer_required'
      USING ERRCODE = '22023',
            MESSAGE = 'Avans üçün müştəri seçilməlidir';
  END IF;

  PERFORM id FROM accounts WHERE id = v_account_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_not_found'
      USING ERRCODE = 'P0002',
            MESSAGE = 'Seçilmiş kassa/bank hesabı tapılmadı';
  END IF;

  UPDATE production_orders
  SET advance_payment = v_amount,
      advance_account_id = v_account_id
  WHERE id = v_order_id;

  v_tx_id := public.post_cash_transaction(
    v_account_id,
    'Mədaxil',
    v_amount,
    'Satış Ödənişi',
    format('İstehsalat avansı — %s', v_order.order_no),
    v_order_id,
    'production',
    v_order_id
  );

  UPDATE production_orders
  SET advance_transaction_id = v_tx_id,
      advance_posted_at = NOW()
  WHERE id = v_order_id;

  PERFORM public.refresh_customer_ar_balance(v_order.customer_id);

  v_result := jsonb_build_object(
    'success', true,
    'event_type', 'production_advance_payment',
    'order_id', v_order_id,
    'transaction_id', v_tx_id,
    'amount', v_amount
  );

  v_event_id := public.log_erp_event(
    'production_advance_payment',
    'production_orders',
    v_order_id,
    p_payload,
    NULL,
    v_idempotency,
    v_result
  );

  RETURN v_result || jsonb_build_object('event_id', v_event_id);
END;
$$;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS func
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'process_production_advance_payment_event'
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.func);
  END LOOP;
END $$;
DROP FUNCTION IF EXISTS public.process_production_delivery_event(UUID, UUID);

CREATE OR REPLACE FUNCTION public.process_production_delivery_event(
  p_order_id UUID,
  p_account_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_idempotency TEXT;
  v_cached JSONB;
  v_order production_orders%ROWTYPE;
  v_existing_sale_id UUID;
  v_sale_id UUID;
  v_product_id UUID;
  v_product_code TEXT;
  v_product_name TEXT;
  v_product_unit TEXT;
  v_sell_price NUMERIC;
  v_qty NUMERIC;
  v_project_price NUMERIC;
  v_install_fee NUMERIC;
  v_subtotal NUMERIC;
  v_advance NUMERIC;
  v_remaining NUMERIC;
  v_doc_no TEXT;
  v_material_cost NUMERIC := 0;
  v_outsource_cost NUMERIC := 0;
  v_expense_cost NUMERIC := 0;
  v_contractor_cost NUMERIC := 0;
  v_total_cost NUMERIC := 0;
  v_unit_cogs NUMERIC := 0;
  v_unit_sell NUMERIC := 0;
  v_stock NUMERIC := 0;
  v_payments JSONB := '[]'::jsonb;
  v_create_sale BOOLEAN := false;
  v_revenue_journal_id UUID;
  v_cogs_journal_id UUID;
  v_tx_id UUID;
  v_event_id UUID;
  v_result JSONB;
  v_payload JSONB;
BEGIN
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'order_required'
      USING ERRCODE = '22023',
            MESSAGE = 'Ä°stehsal sifariÅŸi identifikatoru tÉ™lÉ™b olunur';
  END IF;

  v_idempotency := 'production_delivery:' || p_order_id::text;
  v_cached := public.find_erp_event_by_idempotency(v_idempotency);
  IF v_cached IS NOT NULL THEN
    RETURN v_cached->'result';
  END IF;

  IF NOT public.user_has_permission('can_manage_production') THEN
    RAISE EXCEPTION 'forbidden'
      USING ERRCODE = '42501',
            MESSAGE = 'Ä°cazÉ™niz yoxdur';
  END IF;

  SELECT * INTO v_order
  FROM production_orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'production_order_not_found'
      USING ERRCODE = 'P0002',
            MESSAGE = 'Ä°stehsal sifariÅŸi tapÄ±lmadÄ±';
  END IF;

  IF v_order.sale_id IS NOT NULL AND v_order.status = 'Delivered' THEN
    SELECT doc_no INTO v_doc_no FROM sales WHERE id = v_order.sale_id;
    RETURN jsonb_build_object(
      'success', true,
      'event_type', 'production_delivery',
      'order_id', p_order_id,
      'order_type', v_order.type,
      'sale_id', v_order.sale_id,
      'doc_no', COALESCE(v_doc_no, v_order.order_no),
      'product_id', v_order.finished_product_id,
      'already_completed', true,
      'invoice_created', true
    );
  END IF;

  SELECT id INTO v_existing_sale_id
  FROM sales
  WHERE production_order_id = p_order_id
  LIMIT 1;

  IF v_existing_sale_id IS NOT NULL THEN
    RAISE EXCEPTION 'duplicate_sale_orphan'
      USING ERRCODE = '23505',
            MESSAGE = 'Bu sifariÅŸ Ã¼Ã§Ã¼n satÄ±ÅŸ fakturasÄ± artÄ±q mÃ¶vcuddur, lakin sifariÅŸ baÄŸlanmayÄ±b. Administratorla É™laqÉ™ saxlayÄ±n.';
  END IF;

  IF v_order.status IS DISTINCT FROM 'Ready' THEN
    RAISE EXCEPTION 'order_not_ready'
      USING ERRCODE = '22023',
            MESSAGE = 'TÉ™hvil yalnÄ±z Â«HazÄ±rÂ» statusundan verilÉ™ bilÉ™r';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM production_materials
    WHERE production_order_id = p_order_id
      AND COALESCE(issued, false) = false
  ) THEN
    RAISE EXCEPTION 'materials_pending'
      USING ERRCODE = '22023',
            MESSAGE = 'BÃ¼tÃ¼n material sÉ™tirlÉ™ri verilmÉ™lidir';
  END IF;

  v_qty := GREATEST(COALESCE(v_order.quantity, 1), 1);

  IF v_order.type = 'Series' THEN
    IF NOT COALESCE(v_order.finished_goods_posted, false) THEN
      RAISE EXCEPTION 'finished_goods_not_posted'
        USING ERRCODE = '22023',
              MESSAGE = 'HazÄ±r mÉ™hsul anbara yazÄ±lmayÄ±b. ÆvvÉ™lcÉ™ Â«HazÄ±rÂ» statusuna keÃ§in.';
    END IF;

    IF v_order.finished_product_id IS NULL THEN
      RAISE EXCEPTION 'finished_product_required'
        USING ERRCODE = '22023',
              MESSAGE = 'Seriya sifariÅŸi Ã¼Ã§Ã¼n hazÄ±r mÉ™hsul tÉ™yin edilmÉ™yib';
    END IF;

    v_product_id := v_order.finished_product_id;
    v_create_sale := v_order.customer_id IS NOT NULL;

    SELECT code, name, unit, COALESCE(sell_price, 0)
    INTO v_product_code, v_product_name, v_product_unit, v_sell_price
    FROM products
    WHERE id = v_product_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'finished_product_not_found'
        USING ERRCODE = 'P0002',
              MESSAGE = 'HazÄ±r mÉ™hsul tapÄ±lmadÄ±';
    END IF;

    SELECT stock INTO v_stock FROM products WHERE id = v_product_id FOR UPDATE;
    IF COALESCE(v_stock, 0) + 0.0001 < v_qty THEN
      RAISE EXCEPTION 'insufficient_finished_stock'
        USING ERRCODE = '22023',
              MESSAGE = format(
                'HazÄ±r mÉ™hsul stok kifayÉ™t etmir (mÃ¶vcud: %s, tÉ™lÉ™b: %s)',
                COALESCE(v_stock, 0),
                v_qty
              );
    END IF;

    v_total_cost := public.compute_production_wip_cost(p_order_id);

    IF v_create_sale THEN
      IF v_order.customer_id IS NULL THEN
        RAISE EXCEPTION 'customer_required'
          USING ERRCODE = '22023',
                MESSAGE = 'TÉ™hvil Ã¼Ã§Ã¼n mÃ¼ÅŸtÉ™ri seÃ§ilmÉ™lidir';
      END IF;

      v_project_price := COALESCE(NULLIF(v_order.total_project_price, 0), v_sell_price * v_qty);
      IF v_project_price <= 0 THEN
        RAISE EXCEPTION 'invalid_total_price'
          USING ERRCODE = '22023',
                MESSAGE = 'SatÄ±ÅŸ qiymÉ™ti sÄ±fÄ±rdan bÃ¶yÃ¼k olmalÄ±dÄ±r';
      END IF;

      v_install_fee := COALESCE(v_order.installation_fee, 0);
      v_subtotal := v_project_price + v_install_fee;
      v_advance := GREATEST(COALESCE(v_order.advance_payment, 0), 0);
      v_remaining := GREATEST(v_subtotal - v_advance, 0);

      IF v_advance > 0.0001 AND p_account_id IS NULL THEN
        RAISE EXCEPTION 'advance_account_required'
          USING ERRCODE = '22023',
                MESSAGE = 'Avans Ã¶dÉ™niÅŸi Ã¼Ã§Ã¼n kassa/bank hesabÄ± seÃ§ilmÉ™lidir';
      END IF;

      IF v_advance > 0.0001 THEN
        v_payments := jsonb_build_array(
          jsonb_build_object(
            'id', gen_random_uuid()::text,
            'method', 'Avans',
            'amount', v_advance,
            'account_id', p_account_id
          )
        );
      END IF;

      v_doc_no := 'SF-' || to_char(CURRENT_DATE, 'YYYY') || '-' || floor(10000 + random() * 90000)::int;

      INSERT INTO sales (
        doc_no, invoice_number, doc_date, customer_id, customer_name,
        seller_id, seller_name, warehouse_name, subtotal, discount_total, vat_total,
        total_amount, paid_amount, remaining_balance, delivery_type, delivery_fee,
        note, notes, production_order_id, payments
      )
      VALUES (
        v_doc_no, v_doc_no, CURRENT_DATE, v_order.customer_id, v_order.customer_name,
        auth.uid(), NULL, v_order.warehouse_name, v_subtotal, 0, 0,
        v_subtotal, v_advance, v_remaining,
        CASE WHEN v_install_fee > 0 THEN 'paid' ELSE 'free' END,
        v_install_fee,
        'Seriya istehsal tÉ™hvil: ' || v_order.order_no,
        COALESCE(v_order.notes, v_order.project_scope),
        p_order_id, v_payments
      )
      RETURNING id INTO v_sale_id;

      INSERT INTO sale_items (
        sale_id, product_id, product_code, product_name,
        warehouse_id, warehouse_name, quantity, unit,
        unit_price, discount_percent, vat_rate, line_total, extra_info
      )
      VALUES (
        v_sale_id, v_product_id, v_product_code, v_product_name,
        v_order.warehouse_id, v_order.warehouse_name, v_qty,
        COALESCE(v_product_unit, 'ÆdÉ™d'),
        CASE WHEN v_qty > 0 THEN ROUND(v_project_price / v_qty, 2) ELSE v_project_price END,
        0, 0, v_project_price,
        'Seriya istehsal â€” ' || v_order.order_no
      );

      IF v_install_fee > 0.0001 THEN
        INSERT INTO sale_items (
          sale_id, product_id, product_code, product_name,
          warehouse_id, warehouse_name, quantity, unit,
          unit_price, discount_percent, vat_rate, line_total, extra_info
        )
        VALUES (
          v_sale_id, NULL, NULL, 'QuraÅŸdÄ±rma vÉ™ Ã§atdÄ±rÄ±lma',
          NULL, v_order.warehouse_name, 1, 'XidmÉ™t',
          v_install_fee, 0, 0, v_install_fee, v_order.order_no
        );
      END IF;

      v_revenue_journal_id := public.post_journal_entry(
        jsonb_build_object(
          'source_type', 'production_delivery_revenue',
          'source_id', v_sale_id,
          'idempotency_key', v_idempotency || ':revenue',
          'memo', format('Seriya satÄ±ÅŸ gÉ™liri â€” %s', v_doc_no),
          'lines', jsonb_build_array(
            jsonb_build_object(
              'coa_code', '1200',
              'debit', v_subtotal,
              'credit', 0,
              'partner_type', 'customer',
              'partner_id', v_order.customer_id,
              'line_memo', 'AR â€” ' || v_doc_no
            ),
            jsonb_build_object(
              'coa_code', '4100',
              'debit', 0,
              'credit', v_subtotal,
              'line_memo', 'GÉ™lir â€” ' || v_doc_no
            )
          )
        )
      );

      IF v_advance > 0.0001 THEN
        IF v_order.advance_transaction_id IS NOT NULL THEN
          v_tx_id := v_order.advance_transaction_id;
        ELSE
          v_tx_id := public.post_cash_transaction(
            p_account_id,
            'MÉ™daxil',
            v_advance,
            'SatÄ±ÅŸ Ã–dÉ™niÅŸi',
            format('Seriya istehsal avansÄ± â€” %s (%s)', v_doc_no, v_order.order_no),
            p_order_id,
            'production',
            p_order_id
          );
        END IF;
      END IF;

      PERFORM public.refresh_customer_ar_balance(v_order.customer_id);
    END IF;

    UPDATE products
    SET stock = COALESCE(v_stock, 0) - v_qty
    WHERE id = v_product_id;

    IF v_total_cost > 0.0001 THEN
      v_cogs_journal_id := public.post_journal_entry(
        jsonb_build_object(
          'source_type', 'production_delivery_cogs',
          'source_id', p_order_id,
          'idempotency_key', v_idempotency || ':cogs',
          'memo', format('Seriya COGS â€” %s', v_order.order_no),
          'lines', jsonb_build_array(
            jsonb_build_object(
              'coa_code', '5100',
              'debit', v_total_cost,
              'credit', 0,
              'line_memo', 'COGS â€” ' || v_order.order_no
            ),
            jsonb_build_object(
              'coa_code', '1300',
              'debit', 0,
              'credit', v_total_cost,
              'line_memo', 'Inventar â€” ' || v_order.order_no
            )
          )
        )
      );
    END IF;

    UPDATE production_orders
    SET sale_id = COALESCE(v_sale_id, sale_id),
        delivered_at = NOW(),
        status = 'Delivered',
        updated_at = NOW()
    WHERE id = p_order_id;

    v_result := jsonb_build_object(
      'success', true,
      'event_type', 'production_delivery',
      'order_type', 'Series',
      'order_id', p_order_id,
      'sale_id', v_sale_id,
      'doc_no', COALESCE(v_doc_no, v_order.order_no),
      'product_id', v_product_id,
      'invoice_created', v_create_sale,
      'revenue_journal_entry_id', v_revenue_journal_id,
      'cogs_journal_entry_id', v_cogs_journal_id,
      'transaction_id', v_tx_id,
      'already_completed', false
    );

  ELSIF v_order.type = 'Custom' THEN
    IF v_order.customer_id IS NULL THEN
      RAISE EXCEPTION 'customer_required'
        USING ERRCODE = '22023',
              MESSAGE = 'TÉ™hvil Ã¼Ã§Ã¼n mÃ¼ÅŸtÉ™ri seÃ§ilmÉ™lidir';
    END IF;

    v_project_price := COALESCE(v_order.total_project_price, 0);
    IF v_project_price <= 0 THEN
      RAISE EXCEPTION 'invalid_total_price'
        USING ERRCODE = '22023',
              MESSAGE = 'LayihÉ™ qiymÉ™ti sÄ±fÄ±rdan bÃ¶yÃ¼k olmalÄ±dÄ±r';
    END IF;

    v_install_fee := COALESCE(v_order.installation_fee, 0);
    v_subtotal := v_project_price + v_install_fee;
    v_advance := GREATEST(COALESCE(v_order.advance_payment, 0), 0);
    v_remaining := GREATEST(v_subtotal - v_advance, 0);

    IF v_advance > 0.0001 AND p_account_id IS NULL THEN
      RAISE EXCEPTION 'advance_account_required'
        USING ERRCODE = '22023',
              MESSAGE = 'Avans Ã¶dÉ™niÅŸi Ã¼Ã§Ã¼n kassa/bank hesabÄ± seÃ§ilmÉ™lidir';
    END IF;

    IF v_advance > 0.0001 THEN
      PERFORM id FROM accounts WHERE id = p_account_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'account_not_found'
          USING ERRCODE = 'P0002',
                MESSAGE = 'SeÃ§ilmiÅŸ kassa/bank hesabÄ± tapÄ±lmadÄ±';
      END IF;

      v_payments := jsonb_build_array(
        jsonb_build_object(
          'id', gen_random_uuid()::text,
          'method', 'Avans',
          'amount', v_advance,
          'account_id', p_account_id
        )
      );
    END IF;

    v_total_cost := public.compute_production_wip_cost(p_order_id);
    v_unit_cogs := CASE WHEN v_qty > 0 THEN ROUND(v_total_cost / v_qty, 2) ELSE 0 END;
    v_unit_sell := CASE WHEN v_qty > 0 THEN ROUND(v_subtotal / v_qty, 2) ELSE v_subtotal END;

    IF v_order.finished_product_id IS NOT NULL THEN
      v_product_id := v_order.finished_product_id;
      SELECT code, name, unit
      INTO v_product_code, v_product_name, v_product_unit
      FROM products
      WHERE id = v_product_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'finished_product_not_found'
          USING ERRCODE = 'P0002',
                MESSAGE = 'HazÄ±r mÉ™hsul tapÄ±lmadÄ±';
      END IF;
    ELSE
      v_product_code := 'MTO-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
      v_product_name := COALESCE(NULLIF(btrim(v_order.project_name), ''), v_order.order_no);
      v_product_unit := 'ÆdÉ™d';

      INSERT INTO products (
        code, name, category, subcategory, unit,
        buy_price, sell_price, stock, min_stock, extra_info
      )
      VALUES (
        v_product_code, v_product_name, 'FÉ™rdi istehsal', 'Make-to-Order', v_product_unit,
        v_unit_cogs, v_unit_sell, 0, 0,
        'Production order ' || v_order.order_no
      )
      RETURNING id INTO v_product_id;
    END IF;

    SELECT stock INTO v_stock FROM products WHERE id = v_product_id FOR UPDATE;
    UPDATE products SET stock = COALESCE(v_stock, 0) + v_qty WHERE id = v_product_id;

    v_doc_no := 'SF-' || to_char(CURRENT_DATE, 'YYYY') || '-' || floor(10000 + random() * 90000)::int;

    INSERT INTO sales (
      doc_no, invoice_number, doc_date, customer_id, customer_name,
      seller_id, seller_name, warehouse_name, subtotal, discount_total, vat_total,
      total_amount, paid_amount, remaining_balance, delivery_type, delivery_fee,
      note, notes, production_order_id, payments
    )
    VALUES (
      v_doc_no, v_doc_no, CURRENT_DATE, v_order.customer_id, v_order.customer_name,
      auth.uid(), NULL, v_order.warehouse_name, v_subtotal, 0, 0,
      v_subtotal, v_advance, v_remaining,
      CASE WHEN v_install_fee > 0 THEN 'paid' ELSE 'free' END,
      v_install_fee,
      'FÉ™rdi istehsal tÉ™hvil: ' || v_order.order_no,
      COALESCE(v_order.project_scope, v_order.notes),
      p_order_id, v_payments
    )
    RETURNING id INTO v_sale_id;

    INSERT INTO sale_items (
      sale_id, product_id, product_code, product_name,
      warehouse_id, warehouse_name, quantity, unit,
      unit_price, discount_percent, vat_rate, line_total, extra_info
    )
    VALUES (
      v_sale_id, v_product_id, v_product_code, v_product_name,
      v_order.warehouse_id, v_order.warehouse_name, v_qty,
      COALESCE(v_product_unit, 'ÆdÉ™d'),
      CASE WHEN v_qty > 0 THEN ROUND(v_project_price / v_qty, 2) ELSE v_project_price END,
      0, 0, v_project_price,
      'COGS ref: ' || v_order.order_no
    );

    IF v_install_fee > 0.0001 THEN
      INSERT INTO sale_items (
        sale_id, product_id, product_code, product_name,
        warehouse_id, warehouse_name, quantity, unit,
        unit_price, discount_percent, vat_rate, line_total, extra_info
      )
      VALUES (
        v_sale_id, NULL, NULL, 'QuraÅŸdÄ±rma vÉ™ Ã§atdÄ±rÄ±lma',
        NULL, v_order.warehouse_name, 1, 'XidmÉ™t',
        v_install_fee, 0, 0, v_install_fee, v_order.order_no
      );
    END IF;

    SELECT stock INTO v_stock FROM products WHERE id = v_product_id FOR UPDATE;
    IF COALESCE(v_stock, 0) + 0.0001 < v_qty THEN
      RAISE EXCEPTION 'insufficient_finished_stock'
        USING ERRCODE = '22023',
              MESSAGE = 'HazÄ±r mÉ™hsul stok Ã§Ä±xÄ±ÅŸÄ± mÃ¼mkÃ¼n deyil';
    END IF;

    UPDATE products SET stock = COALESCE(v_stock, 0) - v_qty WHERE id = v_product_id;

    v_revenue_journal_id := public.post_journal_entry(
      jsonb_build_object(
        'source_type', 'production_delivery_revenue',
        'source_id', v_sale_id,
        'idempotency_key', v_idempotency || ':revenue',
        'memo', format('FÉ™rdi satÄ±ÅŸ gÉ™liri â€” %s', v_doc_no),
        'lines', jsonb_build_array(
          jsonb_build_object(
            'coa_code', '1200',
            'debit', v_subtotal,
            'credit', 0,
            'partner_type', 'customer',
            'partner_id', v_order.customer_id,
            'line_memo', 'AR â€” ' || v_doc_no
          ),
          jsonb_build_object(
            'coa_code', '4100',
            'debit', 0,
            'credit', v_subtotal,
            'line_memo', 'GÉ™lir â€” ' || v_doc_no
          )
        )
      )
    );

    IF v_total_cost > 0.0001 THEN
      v_cogs_journal_id := public.post_journal_entry(
        jsonb_build_object(
          'source_type', 'production_delivery_cogs',
          'source_id', p_order_id,
          'idempotency_key', v_idempotency || ':cogs',
          'memo', format('FÉ™rdi COGS â€” %s', v_order.order_no),
          'lines', jsonb_build_array(
            jsonb_build_object(
              'coa_code', '5100',
              'debit', v_total_cost,
              'credit', 0,
              'line_memo', 'COGS â€” ' || v_order.order_no
            ),
            jsonb_build_object(
              'coa_code', '1350',
              'debit', 0,
              'credit', v_total_cost,
              'line_memo', 'WIP â€” ' || v_order.order_no
            )
          )
        )
      );
    END IF;

    IF v_advance > 0.0001 THEN
      IF v_order.advance_transaction_id IS NOT NULL THEN
        v_tx_id := v_order.advance_transaction_id;
      ELSE
        v_tx_id := public.post_cash_transaction(
          p_account_id,
          'MÉ™daxil',
          v_advance,
          'SatÄ±ÅŸ Ã–dÉ™niÅŸi',
          format('FÉ™rdi istehsal avansÄ± â€” %s (%s)', v_doc_no, v_order.order_no),
          p_order_id,
          'production',
          p_order_id
        );
      END IF;
    END IF;

    PERFORM public.refresh_customer_ar_balance(v_order.customer_id);

    UPDATE production_orders
    SET finished_product_id = v_product_id,
        finished_product_name = v_product_name,
        sale_id = v_sale_id,
        delivered_at = NOW(),
        finished_goods_posted = true,
        status = 'Delivered',
        updated_at = NOW()
    WHERE id = p_order_id;

    v_result := jsonb_build_object(
      'success', true,
      'event_type', 'production_delivery',
      'order_type', 'Custom',
      'order_id', p_order_id,
      'sale_id', v_sale_id,
      'doc_no', v_doc_no,
      'product_id', v_product_id,
      'invoice_created', true,
      'revenue_journal_entry_id', v_revenue_journal_id,
      'cogs_journal_entry_id', v_cogs_journal_id,
      'transaction_id', v_tx_id,
      'already_completed', false
    );
  ELSE
    RAISE EXCEPTION 'invalid_order_type'
      USING ERRCODE = '22023',
            MESSAGE = 'NamÉ™lum istehsal sifariÅŸi tipi';
  END IF;

  v_payload := jsonb_build_object(
    'order_id', p_order_id,
    'account_id', p_account_id
  );

  v_event_id := public.log_erp_event(
    'production_delivery',
    'production_orders',
    p_order_id,
    v_payload,
    COALESCE(v_revenue_journal_id, v_cogs_journal_id),
    v_idempotency,
    v_result
  );

  RETURN v_result || jsonb_build_object('event_id', v_event_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_production_delivery_event(UUID, UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
