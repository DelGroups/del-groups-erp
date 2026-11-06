-- GL-1: partner cash payments on the cash account's own ledger.
--
-- In this chart (20260910160000_double_entry_accounting_core.sql, 20260901141000_journal_coa_resolve.sql):
--   1000 "Kassa"          seeded by the double-entry core; used ONLY by partner payments.
--   1100 "Kassa və Bank"  the cash-and-bank ledger every other flow uses: post_cash_transaction
--                         (invoice payments, expenses, the IMP-5 payment lines) hardcodes it, and
--                         imports use the account's own ledger (accounts.coa_id, which the
--                         journal migration backfilled to 1100 for every account), else 1100.
-- Partner payments used gl_coa_for_payment_method(method): 1100 for 'bank', 1000 for anything else.
-- So a Kassa received partner cash on 1000 and everything else on 1100: one cash desk on two
-- ledgers, and the GL cash figure split between them. A bank account paid with method "cash" (or
-- a Kassa with "bank") landed on the other ledger too.
--
-- Fix, going forward only (history is reported by supabase/scripts/gl_partner_cash_check.sql and
-- left alone):
--   gl_coa_for_cash_account(account, method): the account's own active ledger code
--                                             (accounts.coa_id), else gl_coa_for_payment_method(method).
--   post_partner_payment_gl_journal            uses it (same signature, same idempotency key).
--   create_partner_payment                     uses it on every line of the multi-line path; the
--                                             one-account path goes through the journal above.
-- Nothing else changes. Run after 20261106100000_imports_duty_override.sql. Safe to run twice.

CREATE OR REPLACE FUNCTION public.gl_coa_for_cash_account(p_account_id UUID, p_payment_method TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT c.code
       FROM public.accounts a
       JOIN public.chart_of_accounts c ON c.id = a.coa_id
      WHERE a.id = p_account_id AND c.is_active),
    public.gl_coa_for_payment_method(p_payment_method)
  );
$$;

COMMENT ON FUNCTION public.gl_coa_for_cash_account(UUID, TEXT) IS
  'GL-1: ledger code of a cash / bank account (accounts.coa_id); the payment method decides only when the account has none.';

REVOKE ALL ON FUNCTION public.gl_coa_for_cash_account(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.gl_coa_for_cash_account(UUID, TEXT) TO authenticated, service_role;

-- ─── Partner payment journal (one account) ──────────────────────────────────

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
  -- GL-1: the chosen cash / bank account's own ledger (accounts.coa_id), like invoices and imports;
  -- the method only decides when the account has no ledger of its own.
  v_coa_cash := public.gl_coa_for_cash_account(p_cash_account_id, p_payment_method);
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

GRANT EXECUTE ON FUNCTION public.post_partner_payment_gl_journal(UUID, UUID, NUMERIC, TEXT, TEXT, UUID, TEXT) TO authenticated, service_role;

-- ─── Partner payment (one account, or several lines: IMP-5) ─────────────────

CREATE OR REPLACE FUNCTION public.create_partner_payment(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_lines JSONB;
  v_line JSONB;
  v_jl JSONB := '[]'::jsonb;
  v_payment_ids UUID[] := '{}';
  v_tx_ids UUID[] := '{}';
  v_name TEXT;
  v_method TEXT;
  v_memo TEXT;
  i INT := 0;
BEGIN
  IF p_payload IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Ödəniş payload tələb olunur';
  END IF;

  IF NOT public.require_permission('can_manage_finance') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501', MESSAGE = 'Maliyyə əməliyyatı üçün icazəniz yoxdur';
  END IF;

  v_idempotency := NULLIF(trim(p_payload->>'idempotency_key'), '');
  IF v_idempotency IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.payments WHERE idempotency_key = v_idempotency LIMIT 1;
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
  v_payment_type := lower(trim(COALESCE(p_payload->>'payment_type', '')));
  v_payment_method := lower(trim(COALESCE(p_payload->>'payment_method', 'cash')));
  v_payment_date := COALESCE(NULLIF(p_payload->>'payment_date', '')::timestamptz, NOW());
  v_reference_note := NULLIF(trim(p_payload->>'reference_note'), '');
  v_cash_account_id := NULLIF(p_payload->>'cash_account_id', '')::uuid;
  v_lines := public._payment_lines(p_payload->'lines');
  IF v_lines IS NOT NULL THEN
    SELECT COALESCE(SUM((x->>'amount')::numeric), 0) INTO v_amount FROM jsonb_array_elements(v_lines) x;
  ELSE
    v_amount := COALESCE(NULLIF(p_payload->>'amount', '')::numeric, 0);
  END IF;

  IF v_partner_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Tərəfdaş seçilməlidir';
  END IF;
  IF v_amount <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Məbləğ sıfırdan böyük olmalıdır';
  END IF;
  IF v_payment_type NOT IN ('in', 'out') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'payment_type «in» və ya «out» olmalıdır';
  END IF;
  IF v_lines IS NULL AND v_payment_method NOT IN ('cash', 'bank') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'payment_method «cash» və ya «bank» olmalıdır';
  END IF;

  PERFORM id FROM public.partners WHERE id = v_partner_id AND is_deleted = FALSE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'partner_not_found' USING ERRCODE = 'P0002', MESSAGE = 'Tərəfdaş tapılmadı';
  END IF;

  v_tx_type := CASE WHEN v_payment_type = 'in' THEN 'Mədaxil' ELSE 'Məxaric' END;
  v_category := CASE WHEN v_payment_type = 'in' THEN 'Tərəfdaşdan mədaxil' ELSE 'Tərəfdaşa məxaric' END;

  -- Several accounts: one payments row and one transaction per account, one journal entry.
  IF v_lines IS NOT NULL THEN
    v_memo := COALESCE(v_reference_note, 'Tərəfdaş ödənişi');
    PERFORM public.use_document_date((v_payment_date AT TIME ZONE 'Asia/Baku')::date);
    FOR v_line IN SELECT value FROM jsonb_array_elements(v_lines) LOOP
      i := i + 1;
      v_amount := (v_line->>'amount')::numeric;
      v_cash_account_id := (v_line->>'account_id')::uuid;
      v_method := CASE WHEN lower(v_line->>'method') IN ('cash', 'nağd', 'nagd') THEN 'cash' ELSE 'bank' END;
      SELECT balance, name INTO v_balance, v_name FROM public.accounts WHERE id = v_cash_account_id FOR UPDATE;
      IF v_payment_type = 'out' AND COALESCE(v_balance, 0) + 0.0001 < v_amount THEN
        RAISE EXCEPTION 'insufficient_balance' USING ERRCODE = '22023', MESSAGE = format('Hesab balansı kifayət etmir: %s', v_name);
      END IF;
      INSERT INTO public.payments (payment_date, partner_id, amount, payment_type, payment_method, reference_note, cash_account_id, idempotency_key, created_by)
      VALUES (v_payment_date, v_partner_id, v_amount, v_payment_type, v_method, COALESCE(v_line->>'note', v_reference_note), v_cash_account_id,
              CASE WHEN v_idempotency IS NULL THEN NULL WHEN i = 1 THEN v_idempotency ELSE v_idempotency || ':' || i::text END, auth.uid())
      RETURNING id INTO v_payment_id;
      v_payment_ids := v_payment_ids || v_payment_id;
      INSERT INTO public.transactions (account_id, amount, type, unified_type, category, notes, description, transaction_date, created_at,
                                       reference_type, reference_id, source_type, source_id)
      VALUES (v_cash_account_id, v_amount, v_tx_type, CASE WHEN v_payment_type = 'in' THEN 'INCOME' ELSE 'EXPENSE' END, v_category,
              COALESCE(v_line->>'note', v_reference_note, v_category), COALESCE(v_line->>'note', v_reference_note, v_category),
              v_payment_date, NOW(), 'partner_payment', v_payment_id, 'partner_payment', v_payment_id)
      RETURNING id INTO v_tx_id;
      v_tx_ids := v_tx_ids || v_tx_id;
      UPDATE public.payments SET transaction_id = v_tx_id WHERE id = v_payment_id;
      UPDATE public.accounts SET balance = COALESCE(v_balance, 0) + CASE WHEN v_payment_type = 'in' THEN v_amount ELSE -v_amount END
      WHERE id = v_cash_account_id;
      v_jl := v_jl || jsonb_build_array(jsonb_build_object(
        -- GL-1: each line on its account's own ledger (the method only without one).
        'account_code', public.gl_coa_for_cash_account(v_cash_account_id, v_method),
        'debit', CASE WHEN v_payment_type = 'in' THEN v_amount ELSE 0 END,
        'credit', CASE WHEN v_payment_type = 'in' THEN 0 ELSE v_amount END,
        'cash_account_id', v_cash_account_id,
        'line_memo', COALESCE(v_line->>'note', v_memo) || ' — ' || (v_line->>'method')));
    END LOOP;
    SELECT COALESCE(SUM((x->>'amount')::numeric), 0) INTO v_amount FROM jsonb_array_elements(v_lines) x;
    v_jl := jsonb_build_array(jsonb_build_object(
      'account_code', CASE WHEN v_payment_type = 'in' THEN '1200' ELSE '2100' END,
      'debit', CASE WHEN v_payment_type = 'in' THEN 0 ELSE v_amount END,
      'credit', CASE WHEN v_payment_type = 'in' THEN v_amount ELSE 0 END,
      'partner_type', 'partner',
      'partner_id', v_partner_id,
      'line_memo', CASE WHEN v_payment_type = 'in' THEN 'Alacaq azaldılması — ' ELSE 'Öhdəlik azaldılması — ' END || v_memo)) || v_jl;
    v_journal_id := public.create_journal_entry(jsonb_build_object(
      'document_type', CASE WHEN v_payment_type = 'in' THEN 'payment_receipt' ELSE 'payment_disbursement' END,
      'document_id', v_payment_ids[1],
      'source_type', CASE WHEN v_payment_type = 'in' THEN 'payment_receipt' ELSE 'payment_disbursement' END,
      'source_id', v_payment_ids[1],
      'idempotency_key', 'partner_payment:' || v_payment_ids[1]::text,
      'description', v_memo,
      'memo', v_memo,
      'lines', v_jl));
    PERFORM public.use_document_date(NULL);
    UPDATE public.payments SET journal_entry_id = v_journal_id WHERE id = ANY (v_payment_ids);
    UPDATE public.transactions SET journal_entry_id = v_journal_id WHERE id = ANY (v_tx_ids);
    PERFORM public.refresh_partner_linked_balances(v_partner_id);
    RETURN jsonb_build_object(
      'success', true,
      'payment_id', v_payment_ids[1],
      'payment_ids', to_jsonb(v_payment_ids),
      'journal_entry_id', v_journal_id,
      'transaction_id', v_tx_ids[1],
      'transaction_ids', to_jsonb(v_tx_ids)
    );
  END IF;

  -- One account: unchanged.
  IF v_cash_account_id IS NULL THEN
    v_cash_account_id := public.resolve_default_cash_account_id(v_payment_method);
  END IF;
  IF v_cash_account_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Kassa/bank hesabı tapılmadı';
  END IF;

  SELECT balance INTO v_balance FROM public.accounts WHERE id = v_cash_account_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_not_found' USING ERRCODE = 'P0002', MESSAGE = 'Kassa/bank hesabı tapılmadı';
  END IF;
  IF v_payment_type = 'out' AND COALESCE(v_balance, 0) + 0.0001 < v_amount THEN
    RAISE EXCEPTION 'insufficient_balance' USING ERRCODE = '22023', MESSAGE = 'Hesab balansı kifayət etmir';
  END IF;

  INSERT INTO public.payments (payment_date, partner_id, amount, payment_type, payment_method, reference_note, cash_account_id, idempotency_key, created_by)
  VALUES (v_payment_date, v_partner_id, v_amount, v_payment_type, v_payment_method, v_reference_note, v_cash_account_id, v_idempotency, auth.uid())
  RETURNING id INTO v_payment_id;

  INSERT INTO public.transactions (account_id, amount, type, unified_type, category, notes, description, transaction_date, created_at,
                                   reference_type, reference_id, source_type, source_id)
  VALUES (v_cash_account_id, v_amount, v_tx_type, CASE WHEN v_payment_type = 'in' THEN 'INCOME' ELSE 'EXPENSE' END, v_category,
          COALESCE(v_reference_note, v_category), COALESCE(v_reference_note, v_category), v_payment_date, NOW(),
          'partner_payment', v_payment_id, 'partner_payment', v_payment_id)
  RETURNING id INTO v_tx_id;

  IF v_payment_type = 'in' THEN
    UPDATE public.accounts SET balance = COALESCE(v_balance, 0) + v_amount WHERE id = v_cash_account_id;
  ELSE
    UPDATE public.accounts SET balance = COALESCE(v_balance, 0) - v_amount WHERE id = v_cash_account_id;
  END IF;

  PERFORM public.use_document_date((v_payment_date AT TIME ZONE 'Asia/Baku')::date);
  v_journal_id := public.post_partner_payment_gl_journal(
    v_payment_id, v_partner_id, v_amount, v_payment_type, v_payment_method, v_cash_account_id, v_reference_note);
  PERFORM public.use_document_date(NULL);

  UPDATE public.payments SET journal_entry_id = v_journal_id, transaction_id = v_tx_id WHERE id = v_payment_id;
  UPDATE public.transactions SET journal_entry_id = v_journal_id WHERE id = v_tx_id;

  PERFORM public.refresh_partner_linked_balances(v_partner_id);

  RETURN jsonb_build_object('success', true, 'payment_id', v_payment_id, 'journal_entry_id', v_journal_id, 'transaction_id', v_tx_id);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.create_partner_payment(JSONB) TO authenticated, service_role;
