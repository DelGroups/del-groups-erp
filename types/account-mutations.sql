-- Del Groups ERP — Account ledger helpers (opening balance, reconcile, cash posting)
-- Run in Supabase SQL Editor AFTER types/rbac-migration.sql, types/schema.sql,
-- types/chart-of-accounts-migration.sql, and types/journal-engine-migration.sql.

-- ─── COA mapping for cash transaction journal pairing ───────────────────────

CREATE OR REPLACE FUNCTION public.coa_credit_for_cash_in(p_category TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_cat TEXT := trim(COALESCE(p_category, ''));
BEGIN
  IF v_cat = 'İlkin Qalıq' THEN
    RETURN '3900';
  END IF;
  IF v_cat IN ('Satış Ödənişi', 'Satış') OR v_cat ILIKE '%satış%' THEN
    RETURN '1200';
  END IF;
  IF v_cat = 'Satış gəliri' THEN
    RETURN '4100';
  END IF;
  RETURN '4990';
END;
$$;

CREATE OR REPLACE FUNCTION public.coa_debit_for_cash_out(p_category TEXT)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_cat TEXT := trim(COALESCE(p_category, ''));
BEGIN
  IF v_cat = 'İlkin Qalıq' THEN
    RETURN '3900';
  END IF;
  IF v_cat IN ('Alış Ödənişi', 'Alış') OR v_cat ILIKE '%alış%' THEN
    RETURN '2100';
  END IF;
  IF v_cat IN (
    'İcarə', 'Elektrik', 'Yanacaq', 'İnternet', 'Reklam', 'Təmir', 'Maaş', 'Digər',
    'transport', 'delivery', 'installation', 'tools', 'other'
  ) THEN
    RETURN '6100';
  END IF;
  RETURN '6190';
END;
$$;

-- ─── Enforce account binding on every transaction row ─────────────────────────

CREATE OR REPLACE FUNCTION public.validate_transaction_row()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.account_id IS NULL THEN
    RAISE EXCEPTION 'account_id_required'
      USING ERRCODE = '22023',
            MESSAGE = 'Kassa/bank hesabı (account_id) mütləqdir';
  END IF;

  IF NEW.amount IS NULL OR NEW.amount <= 0 THEN
    RAISE EXCEPTION 'invalid_amount'
      USING ERRCODE = '22023',
            MESSAGE = 'Əməliyyat məbləği sıfırdan böyük olmalıdır';
  END IF;

  IF NEW.type IS DISTINCT FROM 'Mədaxil' AND NEW.type IS DISTINCT FROM 'Məxaric' THEN
    RAISE EXCEPTION 'invalid_transaction_type'
      USING ERRCODE = '22023',
            MESSAGE = 'Əməliyyat növü Mədaxil və ya Məxaric olmalıdır';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_transaction_row ON public.transactions;
CREATE TRIGGER trg_validate_transaction_row
  BEFORE INSERT ON public.transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_transaction_row();

-- ─── Post cash movement: transaction row + accounts.balance + journal entry ─

DROP FUNCTION IF EXISTS public.post_cash_transaction(UUID, TEXT, NUMERIC, TEXT, TEXT, UUID);
DROP FUNCTION IF EXISTS public.post_cash_transaction(UUID, TEXT, NUMERIC, TEXT, TEXT, UUID, TEXT, UUID);

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
    RAISE EXCEPTION 'account_id_required'
      USING ERRCODE = '22023',
            MESSAGE = 'Kassa/bank hesabı mütləqdir';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'invalid_amount'
      USING ERRCODE = '22023',
            MESSAGE = 'Məbləğ sıfırdan böyük olmalıdır';
  END IF;

  v_type := trim(COALESCE(p_type, ''));
  IF v_type IS DISTINCT FROM 'Mədaxil' AND v_type IS DISTINCT FROM 'Məxaric' THEN
    RAISE EXCEPTION 'invalid_transaction_type'
      USING ERRCODE = '22023',
            MESSAGE = 'Əməliyyat növü Mədaxil və ya Məxaric olmalıdır';
  END IF;

  v_category := COALESCE(NULLIF(trim(p_category), ''), 'Digər');
  v_memo := COALESCE(NULLIF(trim(p_notes), ''), v_category);

  IF public.resolve_coa_id('1100') IS NULL THEN
    RAISE EXCEPTION 'coa_not_found'
      USING ERRCODE = 'P0002',
            MESSAGE = 'Hesab planında 1100 (Kassa/Bank) tapılmadı — chart-of-accounts miqrasiyasını yoxlayın';
  END IF;

  SELECT balance INTO v_balance
  FROM accounts
  WHERE id = p_account_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_not_found'
      USING ERRCODE = 'P0002',
            MESSAGE = 'Kassa/bank hesabı tapılmadı';
  END IF;

  IF v_type = 'Məxaric' AND COALESCE(v_balance, 0) + 0.0001 < p_amount THEN
    RAISE EXCEPTION 'insufficient_balance'
      USING ERRCODE = '22023',
            MESSAGE = 'Kassa/bank balansı kifayət etmir';
  END IF;

  INSERT INTO transactions (account_id, type, amount, category, notes, production_order_id, source_type, source_id)
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
    UPDATE accounts
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
    UPDATE accounts
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

  UPDATE transactions
  SET journal_entry_id = v_journal_id
  WHERE id = v_tx_id;

  RETURN v_tx_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.post_cash_transaction(UUID, TEXT, NUMERIC, TEXT, TEXT, UUID, TEXT, UUID) TO authenticated;

-- ─── Create account with optional opening balance journal entry ───────────────

DROP FUNCTION IF EXISTS public.create_account_atomic(TEXT, TEXT, TEXT, NUMERIC);

CREATE OR REPLACE FUNCTION public.create_account_atomic(
  p_code TEXT,
  p_name TEXT,
  p_type TEXT,
  p_opening_balance NUMERIC DEFAULT 0
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
  v_code TEXT;
  v_name TEXT;
  v_type TEXT;
  v_opening NUMERIC;
BEGIN
  IF NOT (
    public.require_permission('can_manage_finance')
    OR public.require_permission('can_manage_settings')
  ) THEN
    RAISE EXCEPTION 'forbidden'
      USING ERRCODE = '42501',
            MESSAGE = 'Hesab yaratmaq üçün icazəniz yoxdur';
  END IF;

  v_name := trim(COALESCE(p_name, ''));
  v_type := trim(COALESCE(p_type, ''));
  v_code := trim(COALESCE(p_code, ''));

  IF v_name = '' THEN
    RAISE EXCEPTION 'invalid_name'
      USING ERRCODE = '22023',
            MESSAGE = 'Hesab adı tələb olunur';
  END IF;

  IF v_type NOT IN ('Kassa', 'Bank') THEN
    RAISE EXCEPTION 'invalid_type'
      USING ERRCODE = '22023',
            MESSAGE = 'Hesab növü Kassa və ya Bank olmalıdır';
  END IF;

  v_opening := GREATEST(COALESCE(p_opening_balance, 0), 0);

  IF v_code = '' THEN
    v_code := 'ACC-' || floor(100 + random() * 900)::int;
  END IF;

  INSERT INTO accounts (code, name, type, balance)
  VALUES (v_code, v_name, v_type, 0)
  RETURNING id INTO v_account_id;

  IF v_opening > 0.0001 THEN
    PERFORM public.post_cash_transaction(
      v_account_id,
      'Mədaxil',
      v_opening,
      'İlkin Qalıq',
      format('İlkin qalıq — %s (%s)', v_name, v_code)
    );
  END IF;

  RETURN v_account_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_account_atomic(TEXT, TEXT, TEXT, NUMERIC) TO authenticated;

-- ─── Set / sync opening balance via journal adjustment ────────────────────────

DROP FUNCTION IF EXISTS public.set_account_opening_balance_atomic(UUID, NUMERIC);

CREATE OR REPLACE FUNCTION public.set_account_opening_balance_atomic(
  p_account_id UUID,
  p_target_balance NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target NUMERIC;
  v_ledger NUMERIC;
  v_delta NUMERIC;
  v_name TEXT;
  v_code TEXT;
BEGIN
  IF NOT (
    public.require_permission('can_manage_settings')
    OR public.require_permission('can_manage_finance')
  ) THEN
    RAISE EXCEPTION 'forbidden'
      USING ERRCODE = '42501',
            MESSAGE = 'İlkin qalıq yeniləmək üçün icazəniz yoxdur';
  END IF;

  IF p_account_id IS NULL THEN
    RAISE EXCEPTION 'account_required'
      USING ERRCODE = '22023',
            MESSAGE = 'Hesab identifikatoru tələb olunur';
  END IF;

  v_target := GREATEST(COALESCE(p_target_balance, 0), 0);

  SELECT name, code INTO v_name, v_code
  FROM accounts
  WHERE id = p_account_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_not_found'
      USING ERRCODE = 'P0002',
            MESSAGE = 'Hesab tapılmadı';
  END IF;

  DELETE FROM transactions
  WHERE account_id = p_account_id
    AND category = 'İlkin Qalıq';

  SELECT COALESCE(SUM(
    CASE
      WHEN type = 'Mədaxil' THEN amount
      WHEN type = 'Məxaric' THEN -amount
      ELSE 0
    END
  ), 0)
  INTO v_ledger
  FROM transactions
  WHERE account_id = p_account_id;

  v_delta := v_target - COALESCE(v_ledger, 0);

  IF v_delta > 0.0001 THEN
    PERFORM public.post_cash_transaction(
      p_account_id,
      'Mədaxil',
      v_delta,
      'İlkin Qalıq',
      format('İlkin qalıq tənzimləməsi — %s (%s)', v_name, v_code)
    );
  ELSIF v_delta < -0.0001 THEN
    PERFORM public.post_cash_transaction(
      p_account_id,
      'Məxaric',
      ABS(v_delta),
      'İlkin Qalıq',
      format('İlkin qalıq tənzimləməsi (azaldılma) — %s (%s)', v_name, v_code)
    );
  END IF;

  PERFORM public.reconcile_account_balance_atomic(p_account_id);

  RETURN jsonb_build_object(
    'account_id', p_account_id,
    'target_balance', v_target,
    'ledger_balance', (
      SELECT balance FROM accounts WHERE id = p_account_id
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_account_opening_balance_atomic(UUID, NUMERIC) TO authenticated;

-- ─── Reconcile accounts.balance from transaction journal ──────────────────────

DROP FUNCTION IF EXISTS public.reconcile_account_balance_atomic(UUID);

CREATE OR REPLACE FUNCTION public.reconcile_account_balance_atomic(
  p_account_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row RECORD;
  v_ledger NUMERIC;
  v_previous NUMERIC;
  v_fixed INT := 0;
  v_results JSONB := '[]'::jsonb;
BEGIN
  IF NOT (
    public.require_permission('can_manage_finance')
    OR public.require_permission('can_manage_settings')
  ) THEN
    RAISE EXCEPTION 'forbidden'
      USING ERRCODE = '42501',
            MESSAGE = 'Balans uyğunlaşdırması üçün icazəniz yoxdur';
  END IF;

  FOR v_row IN
    SELECT id, balance, name, code
    FROM accounts
    WHERE p_account_id IS NULL OR id = p_account_id
    ORDER BY name
  LOOP
    SELECT COALESCE(SUM(
      CASE
        WHEN type = 'Mədaxil' THEN amount
        WHEN type = 'Məxaric' THEN -amount
        ELSE 0
      END
    ), 0)
    INTO v_ledger
    FROM transactions
    WHERE account_id = v_row.id;

    v_previous := COALESCE(v_row.balance, 0);

    UPDATE accounts
    SET balance = COALESCE(v_ledger, 0)
    WHERE id = v_row.id;

    IF abs(v_previous - COALESCE(v_ledger, 0)) > 0.0001 THEN
      v_fixed := v_fixed + 1;
    END IF;

    v_results := v_results || jsonb_build_array(
      jsonb_build_object(
        'account_id', v_row.id,
        'account_name', v_row.name,
        'account_code', v_row.code,
        'previous_balance', v_previous,
        'ledger_balance', COALESCE(v_ledger, 0),
        'adjusted', abs(v_previous - COALESCE(v_ledger, 0)) > 0.0001
      )
    );
  END LOOP;

  IF p_account_id IS NOT NULL AND v_fixed = 0 AND jsonb_array_length(v_results) = 0 THEN
    RAISE EXCEPTION 'account_not_found'
      USING ERRCODE = 'P0002',
            MESSAGE = 'Hesab tapılmadı';
  END IF;

  RETURN jsonb_build_object(
    'accounts_checked', jsonb_array_length(v_results),
    'accounts_adjusted', v_fixed,
    'results', v_results
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.reconcile_account_balance_atomic(UUID) TO authenticated;
