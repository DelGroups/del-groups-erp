-- 1C-style purchase document lifecycle: draft vs posted, due date, sequential AS numbers.
-- Posting of drafts reuses the same stock / FIFO / cash / GL helpers as process_purchase_receipt_event.

ALTER TABLE public.purchases ADD COLUMN IF NOT EXISTS payments JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.purchases ADD COLUMN IF NOT EXISTS due_date DATE;
ALTER TABLE public.purchases ADD COLUMN IF NOT EXISTS posted_at TIMESTAMPTZ;

UPDATE public.purchases
SET status = 'posted'
WHERE status IS NULL
   OR btrim(status) = ''
   OR lower(btrim(status)) IN ('borclu', 'ödənilib', 'odenilib', 'paid', 'debtor');

ALTER TABLE public.purchases
  ALTER COLUMN status SET DEFAULT 'draft';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'purchases_status_check'
  ) THEN
    ALTER TABLE public.purchases
      ADD CONSTRAINT purchases_status_check
      CHECK (status IN ('draft', 'posted', 'cancelled', 'void', 'voided'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_purchases_status ON public.purchases (status);
CREATE INDEX IF NOT EXISTS idx_purchases_due_date ON public.purchases (due_date);

CREATE OR REPLACE FUNCTION public.purchases_default_posted_when_blank()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status IS NULL OR btrim(NEW.status) = '' THEN
    NEW.status := 'posted';
  END IF;
  IF NEW.payments IS NULL THEN
    NEW.payments := '[]'::jsonb;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_purchases_default_posted_when_blank ON public.purchases;
CREATE TRIGGER trg_purchases_default_posted_when_blank
BEFORE INSERT ON public.purchases
FOR EACH ROW
EXECUTE FUNCTION public.purchases_default_posted_when_blank();

CREATE OR REPLACE FUNCTION public.next_purchase_doc_no(p_prefix TEXT DEFAULT 'AS')
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year INT := EXTRACT(YEAR FROM CURRENT_DATE)::INT;
  v_no INT;
  v_prefix TEXT := COALESCE(NULLIF(trim(p_prefix), ''), 'AS');
BEGIN
  INSERT INTO public.document_number_counters (doc_type, year, last_no)
  VALUES ('purchase_invoice', v_year, 1)
  ON CONFLICT (doc_type, year)
  DO UPDATE SET last_no = public.document_number_counters.last_no + 1
  RETURNING last_no INTO v_no;

  RETURN v_prefix || '-' || v_year::TEXT || '-' || lpad(v_no::TEXT, 5, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.peek_next_purchase_doc_no(p_prefix TEXT DEFAULT 'AS')
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year INT := EXTRACT(YEAR FROM CURRENT_DATE)::INT;
  v_no INT;
  v_prefix TEXT := COALESCE(NULLIF(trim(p_prefix), ''), 'AS');
BEGIN
  SELECT last_no INTO v_no
  FROM public.document_number_counters
  WHERE doc_type = 'purchase_invoice' AND year = v_year;

  RETURN v_prefix || '-' || v_year::TEXT || '-' || lpad((COALESCE(v_no, 0) + 1)::TEXT, 5, '0');
END;
$$;

GRANT EXECUTE ON FUNCTION public.next_purchase_doc_no(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.peek_next_purchase_doc_no(TEXT) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.save_purchase_invoice_draft(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_header JSONB;
  v_items JSONB;
  v_payments JSONB;
  v_add_exp JSONB;
  v_purchase_id UUID;
  v_invoice_number TEXT;
  v_supplier_id UUID;
  v_item JSONB;
  v_status TEXT;
BEGIN
  IF p_payload IS NULL THEN
    RAISE EXCEPTION 'invalid_payload'
      USING ERRCODE = '22023',
            MESSAGE = 'Alış draft payload göndərilməyib';
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
  v_add_exp := COALESCE(p_payload->'additional_expenses', '[]'::jsonb);
  v_purchase_id := NULLIF(p_payload->>'purchase_id', '')::uuid;
  IF v_purchase_id IS NULL THEN
    v_purchase_id := NULLIF(v_header->>'id', '')::uuid;
  END IF;

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

  IF v_purchase_id IS NOT NULL THEN
    SELECT status, invoice_number INTO v_status, v_invoice_number
    FROM purchases
    WHERE id = v_purchase_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'purchase_not_found'
        USING ERRCODE = 'P0002',
              MESSAGE = 'Alış sənədi tapılmadı';
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
    v_invoice_number := NULLIF(trim(v_header->>'invoice_number'), '');
    IF v_invoice_number IS NULL OR v_invoice_number ~ '\.{3,}$' THEN
      v_invoice_number := public.next_purchase_doc_no('AS');
    END IF;
  END IF;

  IF v_purchase_id IS NULL THEN
    INSERT INTO purchases (
      invoice_number, supplier_id, warehouse_id, doc_date, responsible_id, responsible_name,
      total_amount, paid_amount, debt_amount, status, notes, due_date,
      additional_expenses, additional_expenses_total, payments,
      is_official, contract_id, vat_mode, subtotal_amount, vat_rate, vat_amount, grand_total
    )
    VALUES (
      v_invoice_number,
      v_supplier_id,
      NULLIF(v_header->>'warehouse_id', '')::uuid,
      COALESCE(NULLIF(v_header->>'doc_date', '')::date, CURRENT_DATE),
      NULLIF(v_header->>'responsible_id', '')::uuid,
      NULLIF(trim(v_header->>'responsible_name'), ''),
      COALESCE(NULLIF(v_header->>'total_amount', '')::numeric, 0),
      COALESCE(NULLIF(v_header->>'paid_amount', '')::numeric, 0),
      GREATEST(COALESCE(NULLIF(v_header->>'debt_amount', '')::numeric, 0), 0),
      'draft',
      NULLIF(trim(v_header->>'notes'), ''),
      NULLIF(v_header->>'due_date', '')::date,
      v_add_exp,
      COALESCE(NULLIF(v_header->>'additional_expenses_total', '')::numeric, 0),
      v_payments,
      COALESCE((v_header->>'is_official')::boolean, false),
      NULLIF(v_header->>'contract_id', '')::uuid,
      COALESCE(NULLIF(trim(v_header->>'vat_mode'), ''), 'none'),
      NULLIF(v_header->>'subtotal_amount', '')::numeric,
      COALESCE(NULLIF(v_header->>'vat_rate', '')::numeric, 18),
      COALESCE(NULLIF(v_header->>'vat_amount', '')::numeric, 0),
      NULLIF(v_header->>'grand_total', '')::numeric
    )
    RETURNING id INTO v_purchase_id;
  ELSE
    UPDATE purchases SET
      supplier_id = v_supplier_id,
      warehouse_id = NULLIF(v_header->>'warehouse_id', '')::uuid,
      doc_date = COALESCE(NULLIF(v_header->>'doc_date', '')::date, doc_date),
      responsible_id = NULLIF(v_header->>'responsible_id', '')::uuid,
      responsible_name = NULLIF(trim(v_header->>'responsible_name'), ''),
      total_amount = COALESCE(NULLIF(v_header->>'total_amount', '')::numeric, 0),
      paid_amount = COALESCE(NULLIF(v_header->>'paid_amount', '')::numeric, 0),
      debt_amount = GREATEST(COALESCE(NULLIF(v_header->>'debt_amount', '')::numeric, 0), 0),
      status = 'draft',
      notes = NULLIF(trim(v_header->>'notes'), ''),
      due_date = NULLIF(v_header->>'due_date', '')::date,
      additional_expenses = v_add_exp,
      additional_expenses_total = COALESCE(NULLIF(v_header->>'additional_expenses_total', '')::numeric, 0),
      payments = v_payments,
      is_official = COALESCE((v_header->>'is_official')::boolean, is_official),
      contract_id = NULLIF(v_header->>'contract_id', '')::uuid,
      vat_mode = COALESCE(NULLIF(trim(v_header->>'vat_mode'), ''), vat_mode, 'none'),
      subtotal_amount = NULLIF(v_header->>'subtotal_amount', '')::numeric,
      vat_rate = COALESCE(NULLIF(v_header->>'vat_rate', '')::numeric, vat_rate, 18),
      vat_amount = COALESCE(NULLIF(v_header->>'vat_amount', '')::numeric, 0),
      grand_total = NULLIF(v_header->>'grand_total', '')::numeric
    WHERE id = v_purchase_id;

    DELETE FROM purchase_items WHERE purchase_id = v_purchase_id;
  END IF;

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
      COALESCE(NULLIF(trim(v_item->>'unit'), ''), 'Ədəd'),
      COALESCE(NULLIF(v_item->>'unit_price', '')::numeric, 0),
      COALESCE(
        NULLIF(v_item->>'total_price', '')::numeric,
        NULLIF(v_item->>'total', '')::numeric,
        0
      )
    );
  END LOOP;

  SELECT invoice_number INTO v_invoice_number FROM purchases WHERE id = v_purchase_id;

  RETURN jsonb_build_object(
    'success', true,
    'event_type', 'purchase_invoice_draft',
    'purchase_id', v_purchase_id,
    'invoice_number', v_invoice_number,
    'status', 'draft'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.post_purchase_invoice_draft(p_purchase_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_purchase RECORD;
  v_item RECORD;
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
  v_add_exp_total NUMERIC;
  v_idempotency TEXT;
  v_result JSONB;
  v_event_id UUID;
BEGIN
  IF p_purchase_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload'
      USING ERRCODE = '22023',
            MESSAGE = 'Alış ID göndərilməyib';
  END IF;

  IF NOT (
    public.require_permission('can_edit_purchases')
    OR public.require_permission('can_create_purchase')
    OR public.require_permission('can_manage_finance')
  ) THEN
    RAISE EXCEPTION 'forbidden'
      USING ERRCODE = '42501',
            MESSAGE = 'Alış təsdiqləmək üçün icazəniz yoxdur';
  END IF;

  SELECT * INTO v_purchase FROM purchases WHERE id = p_purchase_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'purchase_not_found'
      USING ERRCODE = 'P0002',
            MESSAGE = 'Alış sənədi tapılmadı';
  END IF;

  IF v_purchase.status = 'posted' THEN
    RAISE EXCEPTION 'already_posted'
      USING ERRCODE = '22023',
            MESSAGE = 'Sənəd artıq təsdiqlənib';
  END IF;

  IF v_purchase.status IN ('cancelled', 'void', 'voided') THEN
    RAISE EXCEPTION 'cancelled_document'
      USING ERRCODE = '22023',
            MESSAGE = 'Ləğv edilmiş sənəd təsdiqlənə bilməz';
  END IF;

  IF COALESCE(v_purchase.total_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'invalid_total_amount'
      USING ERRCODE = '22023',
            MESSAGE = 'Alış məbləği sıfırdan böyük olmalıdır';
  END IF;

  IF COALESCE(v_purchase.paid_amount, 0) > COALESCE(v_purchase.total_amount, 0) + 0.0001 THEN
    RAISE EXCEPTION 'overpaid'
      USING ERRCODE = '22023',
            MESSAGE = 'Ödənilən məbləğ ümumi məbləğdən böyük ola bilməz';
  END IF;

  FOR v_item IN
    SELECT product_id, quantity, unit_price
    FROM purchase_items
    WHERE purchase_id = p_purchase_id
  LOOP
    v_product_id := v_item.product_id;
    v_qty := COALESCE(v_item.quantity, 0);
    v_unit_price := COALESCE(v_item.unit_price, 0);

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

  IF jsonb_object_length(v_stock_demand) = 0 THEN
    RAISE EXCEPTION 'items_required'
      USING ERRCODE = '22023',
            MESSAGE = 'Ən azı bir məhsul tələb olunur';
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(v_stock_demand)
  LOOP
    PERFORM id FROM products WHERE id = v_key::uuid;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'product_not_found'
        USING ERRCODE = 'P0002',
              MESSAGE = 'Məhsul tapılmadı: ' || v_key;
    END IF;
  END LOOP;

  IF jsonb_typeof(v_purchase.payments) = 'array' THEN
    FOR v_pay IN SELECT value FROM jsonb_array_elements(v_purchase.payments)
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
      p_purchase_id,
      'purchase',
      v_unit_price,
      v_qty
    );
  END LOOP;

  IF jsonb_typeof(v_purchase.payments) = 'array' THEN
    FOR v_pay IN SELECT value FROM jsonb_array_elements(v_purchase.payments)
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
        format('Alış fakturası %s', v_purchase.invoice_number)
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
        p_purchase_id
      );
    END LOOP;
  END IF;

  v_add_exp_total := public.apply_document_additional_expenses(
    COALESCE(v_purchase.additional_expenses, '[]'::jsonb),
    'purchase',
    p_purchase_id,
    v_purchase.invoice_number
  );

  v_idempotency := 'purchase_receipt:' || p_purchase_id::text;

  v_journal_id := public.post_purchase_bill_gl_journal(
    p_purchase_id,
    v_purchase.invoice_number,
    v_purchase.total_amount,
    v_purchase.supplier_id,
    v_idempotency
  );

  PERFORM public.refresh_supplier_ap_balance(v_purchase.supplier_id);

  UPDATE purchases
  SET status = 'posted',
      posted_at = NOW(),
      additional_expenses_total = v_add_exp_total
  WHERE id = p_purchase_id;

  v_result := jsonb_build_object(
    'success', true,
    'event_type', 'purchase_invoice_post',
    'purchase_id', p_purchase_id,
    'invoice_number', v_purchase.invoice_number,
    'status', 'posted',
    'journal_entry_id', v_journal_id,
    'total_amount', v_purchase.total_amount,
    'paid_amount', v_purchase.paid_amount,
    'debt_amount', v_purchase.debt_amount
  );

  v_event_id := public.log_erp_event(
    'purchase_receipt',
    'purchases',
    p_purchase_id,
    jsonb_build_object('purchase_id', p_purchase_id, 'posted_from', 'draft'),
    v_journal_id,
    v_idempotency,
    v_result
  );

  RETURN v_result || jsonb_build_object('event_id', v_event_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_purchase_invoice_draft(JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.post_purchase_invoice_draft(UUID) TO authenticated, service_role;
