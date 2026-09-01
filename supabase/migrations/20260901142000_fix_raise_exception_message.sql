-- Fix invalid RAISE EXCEPTION syntax: first arg already sets MESSAGE; USING MESSAGE duplicates it.

CREATE OR REPLACE FUNCTION public.post_journal_entry(p_payload JSONB)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lines JSONB;
  v_line JSONB;
  v_entry_id UUID;
  v_entry_no TEXT;
  v_idempotency TEXT;
  v_total_debit NUMERIC := 0;
  v_total_credit NUMERIC := 0;
  v_coa_id UUID;
  v_coa_code TEXT;
  v_debit NUMERIC;
  v_credit NUMERIC;
  v_idx INT := 0;
BEGIN
  IF p_payload IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Journal payload tələb olunur';
  END IF;

  v_idempotency := NULLIF(trim(p_payload->>'idempotency_key'), '');
  IF v_idempotency IS NOT NULL THEN
    SELECT id INTO v_entry_id
    FROM public.journal_entries
    WHERE idempotency_key = v_idempotency
    LIMIT 1;
    IF FOUND THEN
      RETURN v_entry_id;
    END IF;
  END IF;

  v_lines := COALESCE(p_payload->'lines', '[]'::jsonb);
  IF jsonb_typeof(v_lines) <> 'array' OR jsonb_array_length(v_lines) = 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Journal sətirləri tələb olunur';
  END IF;

  FOR v_idx IN 0 .. jsonb_array_length(v_lines) - 1 LOOP
    v_line := v_lines->v_idx;
    v_debit := COALESCE((v_line->>'debit')::numeric, 0);
    v_credit := COALESCE((v_line->>'credit')::numeric, 0);
    v_total_debit := v_total_debit + v_debit;
    v_total_credit := v_total_credit + v_credit;
  END LOOP;

  IF abs(v_total_debit - v_total_credit) > 0.01 THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = format('Journal balanssızdir (debit=%s, credit=%s)', v_total_debit, v_total_credit);
  END IF;

  v_entry_no := COALESCE(
    NULLIF(trim(p_payload->>'entry_no'), ''),
    'JE-' || to_char(CURRENT_DATE, 'YYYYMMDD') || '-' || floor(1000 + random() * 9000)::int
  );

  INSERT INTO public.journal_entries (
    entry_no, entry_date, source_type, source_id, idempotency_key, memo, created_by
  )
  VALUES (
    v_entry_no,
    COALESCE(NULLIF(p_payload->>'entry_date', '')::date, CURRENT_DATE),
    COALESCE(NULLIF(trim(p_payload->>'source_type'), ''), 'manual'),
    NULLIF(p_payload->>'source_id', '')::uuid,
    v_idempotency,
    NULLIF(trim(p_payload->>'memo'), ''),
    auth.uid()
  )
  RETURNING id INTO v_entry_id;

  FOR v_idx IN 0 .. jsonb_array_length(v_lines) - 1 LOOP
    v_line := v_lines->v_idx;
    v_coa_id := NULLIF(v_line->>'coa_id', '')::uuid;
    v_coa_code := NULLIF(trim(v_line->>'coa_code'), '');

    IF v_coa_id IS NULL AND v_coa_code IS NOT NULL THEN
      v_coa_id := public.resolve_coa_id(v_coa_code);
    END IF;

    IF v_coa_id IS NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0002',
        MESSAGE = format('Hesab planı tapılmadı: %s', COALESCE(v_coa_code, v_line->>'coa_id'));
    END IF;

    INSERT INTO public.journal_entry_lines (
      journal_entry_id, coa_id, debit, credit, partner_type, partner_id, account_id, line_memo
    )
    VALUES (
      v_entry_id,
      v_coa_id,
      COALESCE((v_line->>'debit')::numeric, 0),
      COALESCE((v_line->>'credit')::numeric, 0),
      NULLIF(trim(v_line->>'partner_type'), ''),
      NULLIF(v_line->>'partner_id', '')::uuid,
      NULLIF(v_line->>'account_id', '')::uuid,
      NULLIF(trim(v_line->>'line_memo'), '')
    );
  END LOOP;

  RETURN v_entry_id;
END;
$$;

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
  v_order public.production_orders%ROWTYPE;
  v_tx_id UUID;
  v_event_id UUID;
  v_result JSONB;
BEGIN
  IF p_payload IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Avans payload göndərilməyib';
  END IF;

  v_idempotency := NULLIF(trim(p_payload->>'idempotency_key'), '');
  IF v_idempotency IS NOT NULL THEN
    v_cached := public.find_erp_event_by_idempotency(v_idempotency);
    IF v_cached IS NOT NULL THEN
      RETURN v_cached->'result';
    END IF;
  END IF;

  IF NOT public.user_has_permission('can_manage_production') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'İcazəniz yoxdur';
  END IF;

  v_order_id := NULLIF(p_payload->>'order_id', '')::uuid;
  IF v_order_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'İstehsal sifarişi identifikatoru tələb olunur';
  END IF;

  SELECT * INTO v_order
  FROM public.production_orders
  WHERE id = v_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'İstehsal sifarişi tapılmadı';
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
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Avans ödənişi üçün kassa/bank hesabı seçilməlidir';
  END IF;

  IF v_order.customer_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Avans üçün müştəri seçilməlidir';
  END IF;

  PERFORM id FROM public.accounts WHERE id = v_account_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Seçilmiş kassa/bank hesabı tapılmadı';
  END IF;

  UPDATE public.production_orders
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

  UPDATE public.production_orders
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

GRANT EXECUTE ON FUNCTION public.post_journal_entry(JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.post_cash_transaction(UUID, TEXT, NUMERIC, TEXT, TEXT, UUID, TEXT, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.process_production_advance_payment_event(JSONB) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
