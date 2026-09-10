-- Phase 2: Partner payments table + atomic journal posting + 1C GL journal helpers

-- ─── 1. Payments table (Ödənişlər) ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payment_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  partner_id UUID NOT NULL REFERENCES public.partners(id),
  amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
  payment_type TEXT NOT NULL CHECK (payment_type IN ('in', 'out')),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'bank')),
  reference_note TEXT,
  cash_account_id UUID NOT NULL REFERENCES public.accounts(id),
  journal_entry_id UUID REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  transaction_id UUID REFERENCES public.transactions(id) ON DELETE SET NULL,
  idempotency_key TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_idempotency
  ON public.payments (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payments_partner_id
  ON public.payments (partner_id, payment_date DESC);

CREATE INDEX IF NOT EXISTS idx_payments_payment_date
  ON public.payments (payment_date DESC);

-- ─── 2. Helpers ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.resolve_unified_partner_id(
  p_customer_id UUID DEFAULT NULL,
  p_supplier_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT p.id
  FROM public.partners p
  WHERE p.is_deleted = FALSE
    AND (
      (p_customer_id IS NOT NULL AND p.customer_id = p_customer_id)
      OR (p_supplier_id IS NOT NULL AND p.supplier_id = p_supplier_id)
    )
  ORDER BY p.created_at NULLS LAST
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.resolve_default_cash_account_id(p_payment_method TEXT)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
  v_type TEXT := CASE
    WHEN lower(trim(COALESCE(p_payment_method, ''))) = 'bank' THEN 'Bank'
    ELSE 'Kassa'
  END;
BEGIN
  SELECT id INTO v_account_id
  FROM public.accounts
  WHERE type = v_type
  ORDER BY name
  LIMIT 1;

  IF v_account_id IS NULL THEN
    SELECT id INTO v_account_id
    FROM public.accounts
    ORDER BY name
    LIMIT 1;
  END IF;

  RETURN v_account_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.gl_coa_for_payment_method(p_payment_method TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN lower(trim(COALESCE(p_payment_method, ''))) = 'bank' THEN '1100'
    ELSE '1000'
  END;
$$;

CREATE OR REPLACE FUNCTION public.refresh_partner_linked_balances(p_partner_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_partner public.partners%ROWTYPE;
BEGIN
  SELECT * INTO v_partner
  FROM public.partners
  WHERE id = p_partner_id AND is_deleted = FALSE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_partner.customer_id IS NOT NULL THEN
    PERFORM public.refresh_customer_ar_balance(v_partner.customer_id);
  END IF;

  IF v_partner.supplier_id IS NOT NULL THEN
    PERFORM public.refresh_supplier_ap_balance(v_partner.supplier_id);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.post_sale_invoice_gl_journal(
  p_sale_id UUID,
  p_doc_no TEXT,
  p_total NUMERIC,
  p_customer_id UUID,
  p_idempotency TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_partner_id UUID;
BEGIN
  v_partner_id := public.resolve_unified_partner_id(p_customer_id, NULL);

  RETURN public.create_journal_entry(
    jsonb_build_object(
      'document_type', 'invoice',
      'document_id', p_sale_id,
      'source_type', 'invoice',
      'source_id', p_sale_id,
      'idempotency_key', COALESCE(p_idempotency, 'sale_invoice:' || p_sale_id::text),
      'description', format('Satış fakturası %s', p_doc_no),
      'memo', format('Satış fakturası %s', p_doc_no),
      'lines', jsonb_build_array(
        jsonb_build_object(
          'account_code', '1200',
          'debit', p_total,
          'credit', 0,
          'partner_type', 'partner',
          'partner_id', v_partner_id,
          'line_memo', 'Müştəri borcları — ' || p_doc_no
        ),
        jsonb_build_object(
          'account_code', '4000',
          'debit', 0,
          'credit', p_total,
          'line_memo', 'Satış gəliri — ' || p_doc_no
        )
      )
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.post_purchase_bill_gl_journal(
  p_purchase_id UUID,
  p_invoice_number TEXT,
  p_total NUMERIC,
  p_supplier_id UUID,
  p_idempotency TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_partner_id UUID;
BEGIN
  v_partner_id := public.resolve_unified_partner_id(NULL, p_supplier_id);

  RETURN public.create_journal_entry(
    jsonb_build_object(
      'document_type', 'bill',
      'document_id', p_purchase_id,
      'source_type', 'bill',
      'source_id', p_purchase_id,
      'idempotency_key', COALESCE(p_idempotency, 'purchase_receipt:' || p_purchase_id::text),
      'description', format('Alış fakturası %s', p_invoice_number),
      'memo', format('Alış fakturası %s', p_invoice_number),
      'lines', jsonb_build_array(
        jsonb_build_object(
          'account_code', '1300',
          'debit', p_total,
          'credit', 0,
          'line_memo', 'Alış / inventar — ' || p_invoice_number
        ),
        jsonb_build_object(
          'account_code', '2100',
          'debit', 0,
          'credit', p_total,
          'partner_type', 'partner',
          'partner_id', v_partner_id,
          'line_memo', 'Təchizatçı borcları — ' || p_invoice_number
        )
      )
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.post_partner_payment_gl_journal(
  p_payment_id UUID,
  p_partner_id UUID,
  p_amount NUMERIC,
  p_payment_type TEXT,
  p_payment_method TEXT,
  p_cash_account_id UUID,
  p_reference_note TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_coa_cash TEXT;
  v_memo TEXT;
BEGIN
  v_coa_cash := public.gl_coa_for_payment_method(p_payment_method);
  v_memo := COALESCE(NULLIF(trim(p_reference_note), ''), 'Tərəfdaş ödənişi');

  IF p_payment_type = 'in' THEN
    RETURN public.create_journal_entry(
      jsonb_build_object(
        'document_type', 'payment_receipt',
        'document_id', p_payment_id,
        'source_type', 'payment_receipt',
        'source_id', p_payment_id,
        'idempotency_key', 'partner_payment:' || p_payment_id::text,
        'description', v_memo,
        'memo', v_memo,
        'lines', jsonb_build_array(
          jsonb_build_object(
            'account_code', v_coa_cash,
            'debit', p_amount,
            'credit', 0,
            'cash_account_id', p_cash_account_id,
            'line_memo', v_memo
          ),
          jsonb_build_object(
            'account_code', '1200',
            'debit', 0,
            'credit', p_amount,
            'partner_type', 'partner',
            'partner_id', p_partner_id,
            'line_memo', 'Alacaq azaldılması — ' || v_memo
          )
        )
      )
    );
  END IF;

  RETURN public.create_journal_entry(
    jsonb_build_object(
      'document_type', 'payment_disbursement',
      'document_id', p_payment_id,
      'source_type', 'payment_disbursement',
      'source_id', p_payment_id,
      'idempotency_key', 'partner_payment:' || p_payment_id::text,
      'description', v_memo,
      'memo', v_memo,
      'lines', jsonb_build_array(
        jsonb_build_object(
          'account_code', '2100',
          'debit', p_amount,
          'credit', 0,
          'partner_type', 'partner',
          'partner_id', p_partner_id,
          'line_memo', 'Öhdəlik azaldılması — ' || v_memo
        ),
        jsonb_build_object(
          'account_code', v_coa_cash,
          'debit', 0,
          'credit', p_amount,
          'cash_account_id', p_cash_account_id,
          'line_memo', v_memo
        )
      )
    )
  );
END;
$$;

-- ─── 3. Atomic partner payment RPC ───────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.create_partner_payment(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_idempotency TEXT;
  v_existing public.payments%ROWTYPE;
  v_partner_id UUID;
  v_amount NUMERIC;
  v_payment_type TEXT;
  v_payment_method TEXT;
  v_payment_date TIMESTAMPTZ;
  v_reference_note TEXT;
  v_cash_account_id UUID;
  v_balance NUMERIC;
  v_payment_id UUID;
  v_tx_id UUID;
  v_journal_id UUID;
  v_tx_type TEXT;
  v_category TEXT;
BEGIN
  IF p_payload IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Ödəniş payload tələb olunur';
  END IF;

  IF NOT public.require_permission('can_manage_finance') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501', MESSAGE = 'Maliyyə əməliyyatı üçün icazəniz yoxdur';
  END IF;

  v_idempotency := NULLIF(trim(p_payload->>'idempotency_key'), '');
  IF v_idempotency IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM public.payments
    WHERE idempotency_key = v_idempotency
    LIMIT 1;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'success', true,
        'payment_id', v_existing.id,
        'journal_entry_id', v_existing.journal_entry_id,
        'transaction_id', v_existing.transaction_id,
        'idempotent', true
      );
    END IF;
  END IF;

  v_partner_id := NULLIF(p_payload->>'partner_id', '')::uuid;
  v_amount := COALESCE(NULLIF(p_payload->>'amount', '')::numeric, 0);
  v_payment_type := lower(trim(COALESCE(p_payload->>'payment_type', '')));
  v_payment_method := lower(trim(COALESCE(p_payload->>'payment_method', 'cash')));
  v_payment_date := COALESCE(NULLIF(p_payload->>'payment_date', '')::timestamptz, NOW());
  v_reference_note := NULLIF(trim(p_payload->>'reference_note'), '');
  v_cash_account_id := NULLIF(p_payload->>'cash_account_id', '')::uuid;

  IF v_partner_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Tərəfdaş seçilməlidir';
  END IF;

  IF v_amount <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Məbləğ sıfırdan böyük olmalıdır';
  END IF;

  IF v_payment_type NOT IN ('in', 'out') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'payment_type «in» və ya «out» olmalıdır';
  END IF;

  IF v_payment_method NOT IN ('cash', 'bank') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'payment_method «cash» və ya «bank» olmalıdır';
  END IF;

  PERFORM id FROM public.partners WHERE id = v_partner_id AND is_deleted = FALSE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'partner_not_found' USING ERRCODE = 'P0002', MESSAGE = 'Tərəfdaş tapılmadı';
  END IF;

  IF v_cash_account_id IS NULL THEN
    v_cash_account_id := public.resolve_default_cash_account_id(v_payment_method);
  END IF;

  IF v_cash_account_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Kassa/bank hesabı tapılmadı';
  END IF;

  SELECT balance INTO v_balance
  FROM public.accounts
  WHERE id = v_cash_account_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_not_found' USING ERRCODE = 'P0002', MESSAGE = 'Kassa/bank hesabı tapılmadı';
  END IF;

  IF v_payment_type = 'out' AND COALESCE(v_balance, 0) + 0.0001 < v_amount THEN
    RAISE EXCEPTION 'insufficient_balance' USING ERRCODE = '22023', MESSAGE = 'Hesab balansı kifayət etmir';
  END IF;

  INSERT INTO public.payments (
    payment_date,
    partner_id,
    amount,
    payment_type,
    payment_method,
    reference_note,
    cash_account_id,
    idempotency_key,
    created_by
  )
  VALUES (
    v_payment_date,
    v_partner_id,
    v_amount,
    v_payment_type,
    v_payment_method,
    v_reference_note,
    v_cash_account_id,
    v_idempotency,
    auth.uid()
  )
  RETURNING id INTO v_payment_id;

  v_tx_type := CASE WHEN v_payment_type = 'in' THEN 'Mədaxil' ELSE 'Məxaric' END;
  v_category := CASE
    WHEN v_payment_type = 'in' THEN 'Tərəfdaşdan mədaxil'
    ELSE 'Tərəfdaşa məxaric'
  END;

  INSERT INTO public.transactions (
    account_id,
    amount,
    type,
    unified_type,
    category,
    notes,
    description,
    transaction_date,
    created_at,
    reference_type,
    reference_id,
    source_type,
    source_id
  )
  VALUES (
    v_cash_account_id,
    v_amount,
    v_tx_type,
    CASE WHEN v_payment_type = 'in' THEN 'INCOME' ELSE 'EXPENSE' END,
    v_category,
    COALESCE(v_reference_note, v_category),
    COALESCE(v_reference_note, v_category),
    v_payment_date,
    NOW(),
    'partner_payment',
    v_payment_id,
    'partner_payment',
    v_payment_id
  )
  RETURNING id INTO v_tx_id;

  IF v_payment_type = 'in' THEN
    UPDATE public.accounts
    SET balance = COALESCE(v_balance, 0) + v_amount
    WHERE id = v_cash_account_id;
  ELSE
    UPDATE public.accounts
    SET balance = COALESCE(v_balance, 0) - v_amount
    WHERE id = v_cash_account_id;
  END IF;

  v_journal_id := public.post_partner_payment_gl_journal(
    v_payment_id,
    v_partner_id,
    v_amount,
    v_payment_type,
    v_payment_method,
    v_cash_account_id,
    v_reference_note
  );

  UPDATE public.payments
  SET journal_entry_id = v_journal_id,
      transaction_id = v_tx_id
  WHERE id = v_payment_id;

  UPDATE public.transactions
  SET journal_entry_id = v_journal_id
  WHERE id = v_tx_id;

  PERFORM public.refresh_partner_linked_balances(v_partner_id);

  RETURN jsonb_build_object(
    'success', true,
    'payment_id', v_payment_id,
    'journal_entry_id', v_journal_id,
    'transaction_id', v_tx_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_unified_partner_id(UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_default_cash_account_id(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.gl_coa_for_payment_method(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.refresh_partner_linked_balances(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.post_sale_invoice_gl_journal(UUID, TEXT, NUMERIC, UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.post_purchase_bill_gl_journal(UUID, TEXT, NUMERIC, UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.post_partner_payment_gl_journal(UUID, UUID, NUMERIC, TEXT, TEXT, UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_partner_payment(JSONB) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
