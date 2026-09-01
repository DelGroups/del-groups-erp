-- Del Groups ERP — Atomic payment recording (sales + purchases)
-- Run in Supabase SQL Editor AFTER types/rbac-migration.sql AND types/account-mutations.sql.

DROP FUNCTION IF EXISTS public.record_payment_atomic(JSONB);

CREATE OR REPLACE FUNCTION public.record_payment_atomic(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
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
  v_account_balance NUMERIC;
  v_party_balance NUMERIC;
  v_payments JSONB;
  v_new_payment JSONB;
  v_status TEXT;
BEGIN
  IF p_payload IS NULL THEN
    RAISE EXCEPTION 'invalid_payload'
      USING ERRCODE = '22023',
            MESSAGE = 'Ödəniş məlumatları göndərilməyib';
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

    SELECT
      total_amount,
      paid_amount,
      remaining_balance,
      customer_id,
      doc_no,
      payments
    INTO
      v_total_amount,
      v_paid_amount,
      v_remaining,
      v_customer_id,
      v_doc_label,
      v_payments
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
    v_remaining := GREATEST(
      COALESCE(v_remaining, v_total_amount - v_paid_amount),
      0
    );

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
    SET
      paid_amount = v_new_paid,
      remaining_balance = v_new_remaining,
      payments = v_payments
    WHERE id = v_document_id;

    PERFORM public.post_cash_transaction(
      v_account_id,
      'Mədaxil',
      v_amount,
      'Satış Ödənişi',
      COALESCE(
        v_notes,
        format('Satış fakturası %s — %s', COALESCE(v_doc_label, v_document_id::text), v_method)
      ),
      NULL,
      'sale',
      v_document_id
    );

    IF v_customer_id IS NOT NULL THEN
      PERFORM public.refresh_customer_ar_balance(v_customer_id);
    END IF;

    RETURN jsonb_build_object(
      'document_type', 'sale',
      'document_id', v_document_id,
      'paid_amount', v_new_paid,
      'remaining_balance', v_new_remaining
    );
  END IF;

  IF v_document_type = 'purchase' THEN
    IF NOT (
      public.require_permission('can_edit_purchases')
      OR public.require_permission('can_create_purchase')
      OR public.require_permission('can_manage_finance')
    ) THEN
      RAISE EXCEPTION 'forbidden'
        USING ERRCODE = '42501',
              MESSAGE = 'Alış ödənişi üçün icazəniz yoxdur';
    END IF;

    SELECT
      total_amount,
      paid_amount,
      debt_amount,
      supplier_id,
      invoice_number
    INTO
      v_total_amount,
      v_paid_amount,
      v_debt_amount,
      v_supplier_id,
      v_doc_label
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
    SET
      paid_amount = v_new_paid,
      debt_amount = v_new_debt,
      status = v_status
    WHERE id = v_document_id;

    PERFORM public.post_cash_transaction(
      v_account_id,
      'Məxaric',
      v_amount,
      'Alış Ödənişi',
      COALESCE(
        v_notes,
        format('Alış fakturası %s — %s', COALESCE(v_doc_label, v_document_id::text), v_method)
      ),
      NULL,
      'purchase',
      v_document_id
    );

    IF v_supplier_id IS NOT NULL THEN
      SELECT balance INTO v_party_balance
      FROM suppliers
      WHERE id = v_supplier_id
      FOR UPDATE;

      UPDATE suppliers
      SET balance = GREATEST(COALESCE(v_party_balance, 0) - v_amount, 0)
      WHERE id = v_supplier_id;
    END IF;

    RETURN jsonb_build_object(
      'document_type', 'purchase',
      'document_id', v_document_id,
      'paid_amount', v_new_paid,
      'debt_amount', v_new_debt,
      'status', v_status
    );
  END IF;

  RAISE EXCEPTION 'invalid_document_type'
    USING ERRCODE = '22023',
          MESSAGE = 'document_type «sale» və ya «purchase» olmalıdır';
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_payment_atomic(JSONB) TO authenticated;
