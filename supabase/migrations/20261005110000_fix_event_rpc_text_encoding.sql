-- Restore the Azerbaijani text inside four payment / posting RPCs.
--
-- Verified on production 2026-10-05: the live bodies of
--   process_invoice_payment_event, process_production_delivery_event,
--   process_purchase_receipt_event, process_sales_invoice_event
-- are byte-for-byte the versions in 20260901113000, 20260901120000,
-- 20260910180100 and 20260910210100, which were saved with their UTF-8 text
-- re-read as Windows-1252 ("Satış Ödənişi" became "SatÄ±ÅŸ Ã–dÉ™niÅŸi").
--
-- It is not only cosmetic. The cash category picks the ledger account:
--   coa_credit_for_cash_in('Satış Ödənişi') = 1200 Alıcılar
--   coa_credit_for_cash_in('SatÄ±ÅŸ Ã–dÉ™niÅŸi') = 4990 Digər gəlir
-- so every follow-up payment on a sales invoice (DocumentPaymentModal →
-- process_invoice_payment_event) credited Other income instead of clearing
-- the receivable, and every purchase payment debited 6190 instead of 2100
-- Kreditor borclar. The same happens to production advance/delivery cash.
-- Users also saw garbled error messages. No such transaction exists yet in
-- production (transactions is empty), so no data needs correcting.
--
-- The bodies below are those exact versions with only the non-ASCII text
-- re-decoded; every ASCII character, the signatures and the grants are
-- unchanged.

BEGIN;

-- process_invoice_payment_event: body from 20260901113000_finance_expenses_source_linkage.sql, strings re-decoded as UTF-8.
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
            MESSAGE = 'Ödəniş event payload göndərilməyib';
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
  v_method := COALESCE(NULLIF(trim(p_payload->>'method'), ''), 'Ödəniş');
  v_notes := NULLIF(trim(p_payload->>'notes'), '');
  v_payment_id := COALESCE(NULLIF(trim(p_payload->>'payment_id'), ''), gen_random_uuid()::text);

  IF v_document_id IS NULL THEN
    RAISE EXCEPTION 'document_required'
      USING ERRCODE = '22023',
            MESSAGE = 'Sənəd identifikatoru tələb olunur';
  END IF;

  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'invalid_amount'
      USING ERRCODE = '22023',
            MESSAGE = 'Məbləğ sıfırdan böyük olmalıdır';
  END IF;

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'account_required'
      USING ERRCODE = '22023',
            MESSAGE = 'Kassa/bank hesabı seçilməlidir';
  END IF;

  PERFORM id FROM accounts WHERE id = v_account_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_not_found'
      USING ERRCODE = 'P0002',
            MESSAGE = 'Seçilmiş kassa/bank hesabı tapılmadı';
  END IF;

  IF v_document_type = 'sale' THEN
    IF NOT (
      public.require_permission('can_edit_sales')
      OR public.require_permission('can_create_invoice')
      OR public.require_permission('can_manage_finance')
    ) THEN
      RAISE EXCEPTION 'forbidden'
        USING ERRCODE = '42501',
              MESSAGE = 'Satış ödənişi üçün icazəniz yoxdur';
    END IF;

    SELECT total_amount, paid_amount, remaining_balance, customer_id, doc_no, payments
    INTO v_total_amount, v_paid_amount, v_remaining, v_customer_id, v_doc_label, v_payments
    FROM sales
    WHERE id = v_document_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'sale_not_found'
        USING ERRCODE = 'P0002',
              MESSAGE = 'Satış fakturası tapılmadı';
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
      'Mədaxil',
      v_amount,
      'Satış Ödənişi',
      COALESCE(v_notes, format('Satış fakturası %s — %s', COALESCE(v_doc_label, v_document_id::text), v_method)),
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
              MESSAGE = 'Alış ödənişi üçün icazəniz yoxdur';
    END IF;

    SELECT total_amount, paid_amount, debt_amount, supplier_id, invoice_number
    INTO v_total_amount, v_paid_amount, v_debt_amount, v_supplier_id, v_doc_label
    FROM purchases
    WHERE id = v_document_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'purchase_not_found'
        USING ERRCODE = 'P0002',
              MESSAGE = 'Alış fakturası tapılmadı';
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
    v_status := CASE WHEN v_new_debt > 0.0001 THEN 'Borclu' ELSE 'Ödənilib' END;

    UPDATE purchases
    SET paid_amount = v_new_paid,
        debt_amount = v_new_debt,
        status = v_status
    WHERE id = v_document_id;

    v_tx_id := public.post_cash_transaction(
      v_account_id,
      'Məxaric',
      v_amount,
      'Alış Ödənişi',
      COALESCE(v_notes, format('Alış fakturası %s — %s', COALESCE(v_doc_label, v_document_id::text), v_method)),
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
            MESSAGE = 'document_type «sale» və ya «purchase» olmalıdır';
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

-- process_production_delivery_event: body from 20260901120000_production_finance_integration.sql, strings re-decoded as UTF-8.
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
            MESSAGE = 'İstehsal sifarişi identifikatoru tələb olunur';
  END IF;

  v_idempotency := 'production_delivery:' || p_order_id::text;
  v_cached := public.find_erp_event_by_idempotency(v_idempotency);
  IF v_cached IS NOT NULL THEN
    RETURN v_cached->'result';
  END IF;

  IF NOT public.user_has_permission('can_manage_production') THEN
    RAISE EXCEPTION 'forbidden'
      USING ERRCODE = '42501',
            MESSAGE = 'İcazəniz yoxdur';
  END IF;

  SELECT * INTO v_order
  FROM production_orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'production_order_not_found'
      USING ERRCODE = 'P0002',
            MESSAGE = 'İstehsal sifarişi tapılmadı';
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
            MESSAGE = 'Bu sifariş üçün satış fakturası artıq mövcuddur, lakin sifariş bağlanmayıb. Administratorla əlaqə saxlayın.';
  END IF;

  IF v_order.status IS DISTINCT FROM 'Ready' THEN
    RAISE EXCEPTION 'order_not_ready'
      USING ERRCODE = '22023',
            MESSAGE = 'Təhvil yalnız «Hazır» statusundan verilə bilər';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM production_materials
    WHERE production_order_id = p_order_id
      AND COALESCE(issued, false) = false
  ) THEN
    RAISE EXCEPTION 'materials_pending'
      USING ERRCODE = '22023',
            MESSAGE = 'Bütün material sətirləri verilməlidir';
  END IF;

  v_qty := GREATEST(COALESCE(v_order.quantity, 1), 1);

  IF v_order.type = 'Series' THEN
    IF NOT COALESCE(v_order.finished_goods_posted, false) THEN
      RAISE EXCEPTION 'finished_goods_not_posted'
        USING ERRCODE = '22023',
              MESSAGE = 'Hazır məhsul anbara yazılmayıb. Ævvəlcə «Hazır» statusuna keçin.';
    END IF;

    IF v_order.finished_product_id IS NULL THEN
      RAISE EXCEPTION 'finished_product_required'
        USING ERRCODE = '22023',
              MESSAGE = 'Seriya sifarişi üçün hazır məhsul təyin edilməyib';
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
              MESSAGE = 'Hazır məhsul tapılmadı';
    END IF;

    SELECT stock INTO v_stock FROM products WHERE id = v_product_id FOR UPDATE;
    IF COALESCE(v_stock, 0) + 0.0001 < v_qty THEN
      RAISE EXCEPTION 'insufficient_finished_stock'
        USING ERRCODE = '22023',
              MESSAGE = format(
                'Hazır məhsul stok kifayət etmir (mövcud: %s, tələb: %s)',
                COALESCE(v_stock, 0),
                v_qty
              );
    END IF;

    v_total_cost := public.compute_production_wip_cost(p_order_id);

    IF v_create_sale THEN
      IF v_order.customer_id IS NULL THEN
        RAISE EXCEPTION 'customer_required'
          USING ERRCODE = '22023',
                MESSAGE = 'Təhvil üçün müştəri seçilməlidir';
      END IF;

      v_project_price := COALESCE(NULLIF(v_order.total_project_price, 0), v_sell_price * v_qty);
      IF v_project_price <= 0 THEN
        RAISE EXCEPTION 'invalid_total_price'
          USING ERRCODE = '22023',
                MESSAGE = 'Satış qiyməti sıfırdan böyük olmalıdır';
      END IF;

      v_install_fee := COALESCE(v_order.installation_fee, 0);
      v_subtotal := v_project_price + v_install_fee;
      v_advance := GREATEST(COALESCE(v_order.advance_payment, 0), 0);
      v_remaining := GREATEST(v_subtotal - v_advance, 0);

      IF v_advance > 0.0001 AND p_account_id IS NULL THEN
        RAISE EXCEPTION 'advance_account_required'
          USING ERRCODE = '22023',
                MESSAGE = 'Avans ödənişi üçün kassa/bank hesabı seçilməlidir';
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
        'Seriya istehsal təhvil: ' || v_order.order_no,
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
        COALESCE(v_product_unit, 'Ædəd'),
        CASE WHEN v_qty > 0 THEN ROUND(v_project_price / v_qty, 2) ELSE v_project_price END,
        0, 0, v_project_price,
        'Seriya istehsal — ' || v_order.order_no
      );

      IF v_install_fee > 0.0001 THEN
        INSERT INTO sale_items (
          sale_id, product_id, product_code, product_name,
          warehouse_id, warehouse_name, quantity, unit,
          unit_price, discount_percent, vat_rate, line_total, extra_info
        )
        VALUES (
          v_sale_id, NULL, NULL, 'Quraşdırma və çatdırılma',
          NULL, v_order.warehouse_name, 1, 'Xidmət',
          v_install_fee, 0, 0, v_install_fee, v_order.order_no
        );
      END IF;

      v_revenue_journal_id := public.post_journal_entry(
        jsonb_build_object(
          'source_type', 'production_delivery_revenue',
          'source_id', v_sale_id,
          'idempotency_key', v_idempotency || ':revenue',
          'memo', format('Seriya satış gəliri — %s', v_doc_no),
          'lines', jsonb_build_array(
            jsonb_build_object(
              'coa_code', '1200',
              'debit', v_subtotal,
              'credit', 0,
              'partner_type', 'customer',
              'partner_id', v_order.customer_id,
              'line_memo', 'AR — ' || v_doc_no
            ),
            jsonb_build_object(
              'coa_code', '4100',
              'debit', 0,
              'credit', v_subtotal,
              'line_memo', 'Gəlir — ' || v_doc_no
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
            'Mədaxil',
            v_advance,
            'Satış Ödənişi',
            format('Seriya istehsal avansı — %s (%s)', v_doc_no, v_order.order_no),
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
          'memo', format('Seriya COGS — %s', v_order.order_no),
          'lines', jsonb_build_array(
            jsonb_build_object(
              'coa_code', '5100',
              'debit', v_total_cost,
              'credit', 0,
              'line_memo', 'COGS — ' || v_order.order_no
            ),
            jsonb_build_object(
              'coa_code', '1300',
              'debit', 0,
              'credit', v_total_cost,
              'line_memo', 'Inventar — ' || v_order.order_no
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
              MESSAGE = 'Təhvil üçün müştəri seçilməlidir';
    END IF;

    v_project_price := COALESCE(v_order.total_project_price, 0);
    IF v_project_price <= 0 THEN
      RAISE EXCEPTION 'invalid_total_price'
        USING ERRCODE = '22023',
              MESSAGE = 'Layihə qiyməti sıfırdan böyük olmalıdır';
    END IF;

    v_install_fee := COALESCE(v_order.installation_fee, 0);
    v_subtotal := v_project_price + v_install_fee;
    v_advance := GREATEST(COALESCE(v_order.advance_payment, 0), 0);
    v_remaining := GREATEST(v_subtotal - v_advance, 0);

    IF v_advance > 0.0001 AND p_account_id IS NULL THEN
      RAISE EXCEPTION 'advance_account_required'
        USING ERRCODE = '22023',
              MESSAGE = 'Avans ödənişi üçün kassa/bank hesabı seçilməlidir';
    END IF;

    IF v_advance > 0.0001 THEN
      PERFORM id FROM accounts WHERE id = p_account_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'account_not_found'
          USING ERRCODE = 'P0002',
                MESSAGE = 'Seçilmiş kassa/bank hesabı tapılmadı';
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
                MESSAGE = 'Hazır məhsul tapılmadı';
      END IF;
    ELSE
      v_product_code := 'MTO-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
      v_product_name := COALESCE(NULLIF(btrim(v_order.project_name), ''), v_order.order_no);
      v_product_unit := 'Ædəd';

      INSERT INTO products (
        code, name, category, subcategory, unit,
        buy_price, sell_price, stock, min_stock, extra_info
      )
      VALUES (
        v_product_code, v_product_name, 'Fərdi istehsal', 'Make-to-Order', v_product_unit,
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
      'Fərdi istehsal təhvil: ' || v_order.order_no,
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
      COALESCE(v_product_unit, 'Ædəd'),
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
        v_sale_id, NULL, NULL, 'Quraşdırma və çatdırılma',
        NULL, v_order.warehouse_name, 1, 'Xidmət',
        v_install_fee, 0, 0, v_install_fee, v_order.order_no
      );
    END IF;

    SELECT stock INTO v_stock FROM products WHERE id = v_product_id FOR UPDATE;
    IF COALESCE(v_stock, 0) + 0.0001 < v_qty THEN
      RAISE EXCEPTION 'insufficient_finished_stock'
        USING ERRCODE = '22023',
              MESSAGE = 'Hazır məhsul stok çıxışı mümkün deyil';
    END IF;

    UPDATE products SET stock = COALESCE(v_stock, 0) - v_qty WHERE id = v_product_id;

    v_revenue_journal_id := public.post_journal_entry(
      jsonb_build_object(
        'source_type', 'production_delivery_revenue',
        'source_id', v_sale_id,
        'idempotency_key', v_idempotency || ':revenue',
        'memo', format('Fərdi satış gəliri — %s', v_doc_no),
        'lines', jsonb_build_array(
          jsonb_build_object(
            'coa_code', '1200',
            'debit', v_subtotal,
            'credit', 0,
            'partner_type', 'customer',
            'partner_id', v_order.customer_id,
            'line_memo', 'AR — ' || v_doc_no
          ),
          jsonb_build_object(
            'coa_code', '4100',
            'debit', 0,
            'credit', v_subtotal,
            'line_memo', 'Gəlir — ' || v_doc_no
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
          'memo', format('Fərdi COGS — %s', v_order.order_no),
          'lines', jsonb_build_array(
            jsonb_build_object(
              'coa_code', '5100',
              'debit', v_total_cost,
              'credit', 0,
              'line_memo', 'COGS — ' || v_order.order_no
            ),
            jsonb_build_object(
              'coa_code', '1350',
              'debit', 0,
              'credit', v_total_cost,
              'line_memo', 'WIP — ' || v_order.order_no
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
          'Mədaxil',
          v_advance,
          'Satış Ödənişi',
          format('Fərdi istehsal avansı — %s (%s)', v_doc_no, v_order.order_no),
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
            MESSAGE = 'Naməlum istehsal sifarişi tipi';
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

-- process_purchase_receipt_event: body from 20260910180100_fifo_invoice_hooks.sql, strings re-decoded as UTF-8.
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
            MESSAGE = 'Alış event payload göndərilməyib';
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
            MESSAGE = 'Alış yaratmaq üçün icazəniz yoxdur';
  END IF;

  v_header := COALESCE(p_payload->'header', '{}'::jsonb);
  v_items := COALESCE(p_payload->'items', '[]'::jsonb);
  v_payments := COALESCE(p_payload->'payments', '[]'::jsonb);

  IF jsonb_typeof(v_items) <> 'array' OR jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'items_required'
      USING ERRCODE = '22023',
            MESSAGE = 'Æn azı bir məhsul tələb olunur';
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

  IF v_total_amount <= 0 THEN
    RAISE EXCEPTION 'invalid_total_amount'
      USING ERRCODE = '22023',
            MESSAGE = 'Alış məbləği sıfırdan böyük olmalıdır';
  END IF;

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

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_items)
  LOOP
    v_product_id := NULLIF(v_item->>'product_id', '')::uuid;
    v_qty := COALESCE(NULLIF(v_item->>'quantity', '')::numeric, 0);
    v_unit_price := COALESCE(NULLIF(v_item->>'unit_price', '')::numeric, 0);

    IF v_product_id IS NULL OR v_qty <= 0 OR v_unit_price <= 0 THEN
      RAISE EXCEPTION 'invalid_item'
        USING ERRCODE = '22023',
              MESSAGE = 'Hər sətirdə məhsul, miqdar və qiymət tələb olunur';
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
      CASE WHEN v_debt_amount > 0.0001 THEN 'Borclu' ELSE 'Ödənilib' END
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
      COALESCE(NULLIF(trim(v_item->>'unit'), ''), 'Ædəd'),
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

    PERFORM public.create_inventory_batch(
      v_product_id,
      v_purchase_id,
      'purchase',
      v_unit_price,
      v_qty
    );
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

-- process_sales_invoice_event: body from 20260910210100_sales_invoice_bom_stock_patch.sql, strings re-decoded as UTF-8.
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
  v_cogs_result JSONB;
  v_total_cogs NUMERIC := 0;
  v_cogs_journal_id UUID;
  v_event_id UUID;
  v_result JSONB;
  v_add_exp_total NUMERIC;
BEGIN
  IF p_payload IS NULL THEN
    RAISE EXCEPTION 'invalid_payload'
      USING ERRCODE = '22023',
            MESSAGE = 'Satış event payload göndərilməyib';
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
            MESSAGE = 'Satış yaratmaq üçün icazəniz yoxdur';
  END IF;

  v_header := COALESCE(p_payload->'header', '{}'::jsonb);
  v_items := COALESCE(p_payload->'items', '[]'::jsonb);
  v_payments := COALESCE(p_payload->'payments', '[]'::jsonb);

  IF jsonb_typeof(v_items) <> 'array' OR jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'items_required'
      USING ERRCODE = '22023',
            MESSAGE = 'Æn azı bir satış sətri tələb olunur';
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
    COALESCE(NULLIF(v_header->>'remaining_balance', '')::numeric, v_total_amount - v_paid_amount),
    0
  );

  IF v_total_amount <= 0 THEN
    RAISE EXCEPTION 'invalid_total_amount'
      USING ERRCODE = '22023',
            MESSAGE = 'Satış məbləği sıfırdan böyük olmalıdır';
  END IF;

  IF v_paid_amount > v_total_amount + 0.0001 THEN
    RAISE EXCEPTION 'overpaid'
      USING ERRCODE = '22023',
            MESSAGE = 'Ödənilən məbləğ ümumi məbləğdən böyük ola bilməz';
  END IF;

  IF v_decrement_stock THEN
    v_stock_demand := public.build_and_validate_sale_stock_demand(v_items);
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
      COALESCE(NULLIF(trim(v_item->>'unit'), ''), 'Ædəd'),
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
    PERFORM public.apply_sale_stock_decrement(v_stock_demand);

    v_cogs_result := public.process_sale_fifo_cogs(
      v_sale_id,
      v_doc_no,
      COALESCE(v_idempotency, 'sale_invoice:' || v_sale_id::text) || ':cogs'
    );
    v_total_cogs := COALESCE((v_cogs_result->>'total_cogs')::numeric, 0);
    v_cogs_journal_id := NULLIF(v_cogs_result->>'cogs_journal_entry_id', '')::uuid;
  END IF;

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
        format('Satış fakturası %s — %s', v_doc_no, v_pay_method),
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
    'cogs_journal_entry_id', v_cogs_journal_id,
    'total_cogs', v_total_cogs,
    'total_amount', v_total_amount,
    'paid_amount', v_paid_amount,
    'remaining_balance', v_remaining
  );

  v_event_id := public.log_erp_event(
    'sales_invoice',
    'sales',
    v_sale_id,
    p_payload,
    COALESCE(v_cogs_journal_id, v_journal_id),
    v_idempotency,
    v_result
  );

  v_result := v_result || jsonb_build_object('event_id', v_event_id);
  RETURN v_result;
END;
$$;
GRANT EXECUTE ON FUNCTION public.process_sales_invoice_event(JSONB) TO authenticated, service_role;


COMMIT;

NOTIFY pgrst, 'reload schema';
