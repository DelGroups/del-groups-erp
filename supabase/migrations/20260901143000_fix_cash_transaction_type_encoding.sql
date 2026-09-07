-- Fix UTF-8 mojibake in callers of post_cash_transaction (MÉ™daxil / MÉ™xaric)
-- and normalize legacy type strings at the RPC boundary.

CREATE OR REPLACE FUNCTION public.apply_document_additional_expenses(
  p_expenses JSONB,
  p_source_type TEXT,
  p_source_id UUID,
  p_doc_ref TEXT
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exp JSONB;
  v_amount NUMERIC;
  v_total NUMERIC := 0;
  v_account_id UUID;
  v_label TEXT;
  v_paid BOOLEAN;
BEGIN
  IF p_expenses IS NULL OR jsonb_typeof(p_expenses) <> 'array' THEN
    RETURN 0;
  END IF;

  FOR v_exp IN SELECT value FROM jsonb_array_elements(p_expenses)
  LOOP
    v_amount := COALESCE(NULLIF(v_exp->>'amount', '')::numeric, 0);
    IF v_amount <= 0 THEN
      CONTINUE;
    END IF;
    v_total := v_total + v_amount;
    v_paid := COALESCE((v_exp->>'paid_immediately')::boolean, false);
    IF NOT v_paid THEN
      CONTINUE;
    END IF;

    v_account_id := NULLIF(v_exp->>'account_id', '')::uuid;
    IF v_account_id IS NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = '22023',
        MESSAGE = 'Ödənilən əlavə xərc üçün kassa/bank hesabı seçilməlidir';
    END IF;

    v_label := COALESCE(NULLIF(trim(v_exp->>'label'), ''), 'Əlavə xərc');

    PERFORM public.post_cash_transaction(
      v_account_id,
      'Məxaric',
      v_amount,
      'Əlavə Xərc',
      format('%s — %s', p_doc_ref, v_label),
      NULL,
      p_source_type,
      p_source_id
    );
  END LOOP;

  RETURN v_total;
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_document_additional_expenses(JSONB, TEXT, UUID, TEXT)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_production_expense_atomic(
  p_production_order_id UUID,
  p_code TEXT,
  p_category TEXT,
  p_description TEXT,
  p_amount NUMERIC,
  p_expense_date DATE,
  p_account_id UUID,
  p_account_name TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_actor_name TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tx_id UUID;
  v_finance_expense_id UUID;
  v_production_expense_id UUID;
  v_memo TEXT;
BEGIN
  IF NOT public.user_has_permission('can_manage_production') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'İcazəniz yoxdur';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Məbləğ sıfırdan böyük olmalıdır';
  END IF;
  IF p_category NOT IN ('transport', 'delivery', 'installation', 'tools', 'other') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Xərc kateqoriyası keçərli deyil';
  END IF;
  IF p_account_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Kassa/bank hesabı seçilməlidir';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.production_orders WHERE id = p_production_order_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'İstehsal sifarişi tapılmadı';
  END IF;

  v_memo := COALESCE(
    NULLIF(trim(p_notes), ''),
    format('İstehsalat: %s', trim(p_description))
  );

  v_tx_id := public.post_cash_transaction(
    p_account_id,
    'Məxaric',
    p_amount,
    'Digər',
    v_memo,
    p_production_order_id,
    'production',
    p_production_order_id
  );

  INSERT INTO public.expenses (code, category, amount, account_id, production_order_id, notes)
  VALUES (
    trim(p_code),
    'Digər',
    p_amount,
    p_account_id,
    p_production_order_id,
    NULLIF(trim(p_notes), '')
  )
  RETURNING id INTO v_finance_expense_id;

  INSERT INTO public.production_expenses (
    production_order_id, category, description, amount, expense_date,
    account_id, account_name, finance_expense_id, notes, created_by, created_by_name
  )
  VALUES (
    p_production_order_id, p_category, trim(p_description), p_amount,
    COALESCE(p_expense_date, CURRENT_DATE), p_account_id, NULLIF(trim(p_account_name), ''),
    v_finance_expense_id, NULLIF(trim(p_notes), ''), auth.uid(), NULLIF(trim(p_actor_name), '')
  )
  RETURNING id INTO v_production_expense_id;

  RETURN v_production_expense_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_production_expense_atomic(
  UUID, TEXT, TEXT, TEXT, NUMERIC, DATE, UUID, TEXT, TEXT, TEXT
) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.post_cash_transaction(
  p_account_id UUID,
  p_type TEXT,
  p_amount NUMERIC,
  p_category TEXT,
  p_notes TEXT DEFAULT NULL,
  p_production_order_id UUID DEFAULT NULL,
  p_source_type TEXT DEFAULT NULL,
  p_source_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance NUMERIC;
  v_tx_id UUID;
  v_type TEXT;
  v_category TEXT;
  v_journal_id UUID;
  v_counter_coa TEXT;
  v_memo TEXT;
BEGIN
  IF p_account_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Kassa/bank hesabı mütləqdir';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Məbləğ sıfırdan böyük olmalıdır';
  END IF;

  v_type := trim(COALESCE(p_type, ''));
  -- Legacy migrations stored Azerbaijani labels with broken encoding (MÉ™daxil / MÉ™xaric).
  IF v_type LIKE 'M%daxil' THEN
    v_type := 'Mədaxil';
  ELSIF v_type LIKE 'M%xaric' THEN
    v_type := 'Məxaric';
  END IF;

  IF v_type IS DISTINCT FROM 'Mədaxil' AND v_type IS DISTINCT FROM 'Məxaric' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Əməliyyat növü Mədaxil və ya Məxaric olmalıdır';
  END IF;

  v_category := COALESCE(NULLIF(trim(p_category), ''), 'Digər');
  v_memo := COALESCE(NULLIF(trim(p_notes), ''), v_category);

  IF public.resolve_coa_id('1100') IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0002',
      MESSAGE = 'Hesab planında 1100 (Kassa/Bank) tapılmadı — chart-of-accounts miqrasiyasını yoxlayın';
  END IF;

  SELECT balance INTO v_balance
  FROM public.accounts
  WHERE id = p_account_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Kassa/bank hesabı tapılmadı';
  END IF;

  IF v_type = 'Məxaric' AND COALESCE(v_balance, 0) + 0.0001 < p_amount THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Kassa/bank balansı kifayət etmir';
  END IF;

  INSERT INTO public.transactions (
    account_id, type, amount, category, notes, production_order_id, source_type, source_id
  )
  VALUES (
    p_account_id,
    v_type,
    p_amount,
    v_category,
    NULLIF(trim(p_notes), ''),
    p_production_order_id,
    NULLIF(trim(p_source_type), ''),
    p_source_id
  )
  RETURNING id INTO v_tx_id;

  IF v_type = 'Mədaxil' THEN
    UPDATE public.accounts
    SET balance = COALESCE(v_balance, 0) + p_amount
    WHERE id = p_account_id;

    v_counter_coa := public.coa_credit_for_cash_in(v_category);
    v_journal_id := public.post_journal_entry(
      jsonb_build_object(
        'source_type', 'cash_transaction',
        'source_id', v_tx_id,
        'idempotency_key', 'cash_tx:' || v_tx_id::text,
        'memo', v_memo,
        'lines', jsonb_build_array(
          jsonb_build_object(
            'coa_code', '1100',
            'debit', p_amount,
            'credit', 0,
            'account_id', p_account_id,
            'line_memo', v_memo
          ),
          jsonb_build_object(
            'coa_code', v_counter_coa,
            'debit', 0,
            'credit', p_amount,
            'line_memo', v_category
          )
        )
      )
    );
  ELSE
    UPDATE public.accounts
    SET balance = COALESCE(v_balance, 0) - p_amount
    WHERE id = p_account_id;

    v_counter_coa := public.coa_debit_for_cash_out(v_category);
    v_journal_id := public.post_journal_entry(
      jsonb_build_object(
        'source_type', 'cash_transaction',
        'source_id', v_tx_id,
        'idempotency_key', 'cash_tx:' || v_tx_id::text,
        'memo', v_memo,
        'lines', jsonb_build_array(
          jsonb_build_object(
            'coa_code', v_counter_coa,
            'debit', p_amount,
            'credit', 0,
            'line_memo', v_category
          ),
          jsonb_build_object(
            'coa_code', '1100',
            'debit', 0,
            'credit', p_amount,
            'account_id', p_account_id,
            'line_memo', v_memo
          )
        )
      )
    );
  END IF;

  UPDATE public.transactions
  SET journal_entry_id = v_journal_id
  WHERE id = v_tx_id;

  RETURN v_tx_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.post_cash_transaction(UUID, TEXT, NUMERIC, TEXT, TEXT, UUID, TEXT, UUID)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
