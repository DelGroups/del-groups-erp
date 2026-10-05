-- Expense VAT paid separately from the ƏDV deposit account.
--
-- Builds on 20261005202000_expense_approval_and_employee_paid.
--
-- In Azerbaijan the VAT part of a supplier invoice is paid from the company's
-- ƏDV deposit account to the supplier's, and the net part from a normal
-- kassa/bank. A company-paid expense with VAT may now name a second account
-- (vat_account_id). Paying it then writes two cash rows and one journal:
--
--   Dr expense account   net
--   Dr 1410 Əvəzləşdirilən ƏDV   VAT   (input VAT, offset against VAT payable)
--   Cr 1100 (main kassa/bank)     net
--   Cr 1100 (ƏDV account)         VAT
--
-- Without vat_account_id nothing changes: the full amount leaves the main
-- account and is booked as expense. Employee-paid expenses are unchanged.
-- Cancelling reverses both cash rows (reverse_document_cash_transactions
-- reverses every 'expense' cash row of the document) and the journal.
--
-- Idempotent: safe to run more than once.

BEGIN;

-- ─── 1. Columns and GL account ──────────────────────────────────────────────
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS vat_account_id     UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS vat_transaction_id UUID REFERENCES public.transactions(id) ON DELETE SET NULL;

INSERT INTO public.chart_of_accounts (code, name, account_type, is_active)
VALUES ('1410', 'Əvəzləşdirilən ƏDV', 'asset', true)
ON CONFLICT (code) DO NOTHING;

-- ─── 2. Pay a company-paid expense (internal) ───────────────────────────────
CREATE OR REPLACE FUNCTION public.post_expense_internal(p_expense_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exp      public.expenses%ROWTYPE;
  v_tx_id    UUID;
  v_vat_tx   UUID;
  v_journal  UUID;
  v_memo     TEXT;
  v_split    BOOLEAN;
  v_main     NUMERIC(14,2);
  v_vat      NUMERIC(14,2);
  v_lines    JSONB;
BEGIN
  SELECT * INTO v_exp FROM public.expenses WHERE id = p_expense_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Xərc sənədi tapılmadı';
  END IF;
  IF v_exp.payment_mode = 'employee' THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'İşçinin ödədiyi xərc təsdiqlənir, sonra işçiyə kompensasiya ödənilir';
  END IF;
  IF v_exp.status NOT IN ('draft', 'submitted') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Yalnız qaralama və ya təsdiq gözləyən xərc ödənilə bilər';
  END IF;
  IF v_exp.account_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Kassa/bank hesabı seçilməlidir';
  END IF;
  IF COALESCE(v_exp.amount, 0) <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Məbləğ sıfırdan böyük olmalıdır';
  END IF;
  PERFORM public.assert_expense_date_postable(v_exp.expense_date);
  IF public.resolve_coa_id('1100') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002',
      MESSAGE = 'Hesab planında 1100 (Kassa/Bank) tapılmadı — chart-of-accounts miqrasiyasını yoxlayın';
  END IF;

  v_vat   := COALESCE(v_exp.vat_amount, 0);
  v_split := v_exp.vat_account_id IS NOT NULL AND v_vat > 0;
  IF v_split AND v_exp.vat_account_id = v_exp.account_id THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ƏDV hesabı əsas hesabdan fərqli olmalıdır';
  END IF;
  IF v_split AND public.resolve_coa_id('1410') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002',
      MESSAGE = 'Hesab planında 1410 (Əvəzləşdirilən ƏDV) tapılmadı';
  END IF;
  v_main := CASE WHEN v_split THEN v_exp.amount - v_vat ELSE v_exp.amount END;

  v_memo := public.expense_memo(v_exp.id);
  -- Lock both accounts in a fixed order so two payments never deadlock.
  IF v_split AND v_exp.vat_account_id < v_exp.account_id THEN
    v_vat_tx := public.expense_cash_out(v_exp.id, v_exp.vat_account_id, v_vat, v_exp.expense_date, v_memo || ' (ƏDV)');
    v_tx_id  := public.expense_cash_out(v_exp.id, v_exp.account_id, v_main, v_exp.expense_date, v_memo);
  ELSE
    v_tx_id := public.expense_cash_out(v_exp.id, v_exp.account_id, v_main, v_exp.expense_date, v_memo);
    IF v_split THEN
      v_vat_tx := public.expense_cash_out(v_exp.id, v_exp.vat_account_id, v_vat, v_exp.expense_date, v_memo || ' (ƏDV)');
    END IF;
  END IF;

  IF v_split THEN
    v_lines := jsonb_build_array(
      jsonb_build_object('coa_id', public.expense_coa_id(v_exp.id), 'debit', v_main, 'credit', 0,
                         'line_memo', v_exp.category),
      jsonb_build_object('coa_code', '1410', 'debit', v_vat, 'credit', 0,
                         'line_memo', 'ƏDV — ' || v_exp.code),
      jsonb_build_object('coa_code', '1100', 'debit', 0, 'credit', v_main,
                         'account_id', v_exp.account_id, 'line_memo', v_memo),
      jsonb_build_object('coa_code', '1100', 'debit', 0, 'credit', v_vat,
                         'account_id', v_exp.vat_account_id, 'line_memo', v_memo || ' (ƏDV)')
    );
  ELSE
    v_lines := jsonb_build_array(
      jsonb_build_object('coa_id', public.expense_coa_id(v_exp.id), 'debit', v_exp.amount, 'credit', 0,
                         'line_memo', v_exp.category),
      jsonb_build_object('coa_code', '1100', 'debit', 0, 'credit', v_exp.amount,
                         'account_id', v_exp.account_id, 'line_memo', v_memo)
    );
  END IF;

  v_journal := public.post_journal_entry(jsonb_build_object(
    'source_type', 'expense',
    'source_id', v_exp.id,
    'document_type', 'expense',
    'document_id', v_exp.id,
    'idempotency_key', 'expense:' || v_exp.id::text,
    'entry_date', v_exp.expense_date,
    'memo', v_memo,
    'lines', v_lines
  ));

  UPDATE public.transactions SET journal_entry_id = v_journal WHERE id IN (v_tx_id, v_vat_tx);

  UPDATE public.expenses
  SET status = 'posted',
      transaction_id = v_tx_id,
      vat_transaction_id = v_vat_tx,
      journal_entry_id = v_journal,
      posted_at = NOW(),
      posted_by = auth.uid(),
      updated_at = NOW()
  WHERE id = v_exp.id;

  RETURN v_tx_id;
END;
$$;

-- ─── 3. Create / edit: also stores vat_account_id ───────────────────────────
-- Same payload as before plus vat_account_id? (company-paid with VAT only).
CREATE OR REPLACE FUNCTION public.record_expense_atomic(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id          UUID := NULLIF(p_payload->>'id', '')::uuid;
  v_existing    public.expenses%ROWTYPE;
  v_date        DATE := COALESCE(NULLIF(p_payload->>'expense_date', '')::date, CURRENT_DATE);
  v_cat_id      UUID := NULLIF(p_payload->>'category_id', '')::uuid;
  v_mode        TEXT := COALESCE(NULLIF(trim(p_payload->>'payment_mode'), ''), 'company');
  v_employee    UUID := NULLIF(p_payload->>'employee_id', '')::uuid;
  v_account     UUID := NULLIF(p_payload->>'account_id', '')::uuid;
  v_vat_account UUID := NULLIF(p_payload->>'vat_account_id', '')::uuid;
  v_cat_label   TEXT;
  v_net         NUMERIC(14,2) := round(COALESCE(NULLIF(p_payload->>'net_amount', '')::numeric, 0), 2);
  v_vat_rate    NUMERIC(5,2)  := round(COALESCE(NULLIF(p_payload->>'vat_rate', '')::numeric, 0), 2);
  v_vat         NUMERIC(14,2);
  v_total       NUMERIC(14,2);
  v_post        BOOLEAN := COALESCE((p_payload->>'post')::boolean, false);
  v_submit      BOOLEAN := COALESCE((p_payload->>'submit')::boolean, false);
  v_code        TEXT;
  v_tx_id       UUID;
  v_status      TEXT;
BEGIN
  IF NOT public.require_permission('can_manage_expenses') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Xərc yazmaq üçün icazəniz yoxdur';
  END IF;

  IF v_mode NOT IN ('company', 'employee') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Ödəniş üsulu düzgün deyil';
  END IF;
  IF v_mode = 'employee' THEN
    IF v_employee IS NULL OR NOT EXISTS (SELECT 1 FROM public.employees WHERE id = v_employee) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Xərci ödəyən işçini seçin';
    END IF;
    IF v_post THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = 'İşçinin ödədiyi xərc birbaşa ödənilmir — təsdiqə göndərin';
    END IF;
    v_account := NULL;
    v_vat_account := NULL;
  ELSE
    v_employee := NULL;
  END IF;

  IF v_net <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Məbləğ sıfırdan böyük olmalıdır';
  END IF;
  IF v_vat_rate < 0 OR v_vat_rate > 100 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ƏDV dərəcəsi 0–100 arasında olmalıdır';
  END IF;
  v_vat := round(COALESCE(NULLIF(p_payload->>'vat_amount', '')::numeric, v_net * v_vat_rate / 100), 2);
  IF v_vat < 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ƏDV məbləği mənfi ola bilməz';
  END IF;
  v_total := v_net + v_vat;

  IF v_vat = 0 THEN
    v_vat_account := NULL;
  END IF;
  IF v_vat_account IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.accounts WHERE id = v_vat_account) THEN
      RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'ƏDV hesabı tapılmadı';
    END IF;
    IF v_vat_account = v_account THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ƏDV hesabı əsas hesabdan fərqli olmalıdır';
    END IF;
  END IF;

  SELECT CASE WHEN p.name IS NOT NULL THEN p.name || ' / ' || c.name ELSE c.name END
  INTO v_cat_label
  FROM public.financial_categories c
  LEFT JOIN public.financial_categories p ON p.id = c.parent_id
  WHERE c.id = v_cat_id AND c.type = 'EXPENSE';
  IF v_cat_label IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Xərc kateqoriyası seçilməlidir';
  END IF;

  IF v_id IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.expenses WHERE id = v_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Xərc sənədi tapılmadı';
    END IF;
    IF v_existing.status NOT IN ('draft', 'submitted') THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = 'Təsdiqlənmiş xərc dəyişdirilə bilməz — əvvəlcə ləğv edin';
    END IF;

    UPDATE public.expenses
    SET expense_date        = v_date,
        category_id         = v_cat_id,
        category            = left(v_cat_label, 100),
        payment_mode        = v_mode,
        employee_id         = v_employee,
        account_id          = v_account,
        vat_account_id      = v_vat_account,
        supplier_id         = NULLIF(p_payload->>'supplier_id', '')::uuid,
        payee               = NULLIF(trim(p_payload->>'payee'), ''),
        reference_no        = NULLIF(trim(p_payload->>'reference_no'), ''),
        description         = NULLIF(trim(p_payload->>'description'), ''),
        notes               = NULLIF(trim(p_payload->>'notes'), ''),
        department_id       = NULLIF(p_payload->>'department_id', '')::uuid,
        production_order_id = NULLIF(p_payload->>'production_order_id', '')::uuid,
        net_amount          = v_net,
        vat_rate            = v_vat_rate,
        vat_amount          = v_vat,
        amount              = v_total,
        updated_at          = NOW()
    WHERE id = v_id;
    v_code := v_existing.code;
    v_status := v_existing.status;
  ELSE
    v_code := public.next_expense_doc_no(v_date);
    INSERT INTO public.expenses (
      code, expense_date, category_id, category, payment_mode, employee_id, account_id, vat_account_id,
      supplier_id, payee, reference_no, description, notes, department_id, production_order_id,
      net_amount, vat_rate, vat_amount, amount, status, created_by
    )
    VALUES (
      v_code, v_date, v_cat_id, left(v_cat_label, 100), v_mode, v_employee, v_account, v_vat_account,
      NULLIF(p_payload->>'supplier_id', '')::uuid,
      NULLIF(trim(p_payload->>'payee'), ''),
      NULLIF(trim(p_payload->>'reference_no'), ''),
      NULLIF(trim(p_payload->>'description'), ''),
      NULLIF(trim(p_payload->>'notes'), ''),
      NULLIF(p_payload->>'department_id', '')::uuid,
      NULLIF(p_payload->>'production_order_id', '')::uuid,
      v_net, v_vat_rate, v_vat, v_total, 'draft', auth.uid()
    )
    RETURNING id INTO v_id;
    v_status := 'draft';
  END IF;

  IF v_post THEN
    v_tx_id := public.post_expense_internal(v_id);
    v_status := 'posted';
  ELSIF v_submit AND v_status = 'draft' THEN
    UPDATE public.expenses
    SET status = 'submitted', submitted_at = NOW(), submitted_by = auth.uid(),
        rejected_at = NULL, rejected_by = NULL, rejected_reason = NULL, updated_at = NOW()
    WHERE id = v_id;
    v_status := 'submitted';
  END IF;

  RETURN jsonb_build_object('id', v_id, 'code', v_code, 'status', v_status, 'transaction_id', v_tx_id);
END;
$$;

REVOKE ALL ON FUNCTION public.post_expense_internal(UUID)     FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_expense_atomic(JSONB) TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
