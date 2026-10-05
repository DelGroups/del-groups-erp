-- Expense approval workflow and expenses paid by an employee (kompensasiya).
--
-- Builds on 20261005200000_expense_documents.
--
-- Company-paid expense (payment_mode = 'company', as before):
--   draft ──submit──▶ submitted ──approve──▶ posted (kassa out, Dr expense / Cr 1100)
--   draft ──────────────── pay now ────────▶ posted   (unchanged direct path)
--
-- Employee-paid expense (payment_mode = 'employee'): the employee paid from
-- their own pocket and the company owes it back.
--   draft ──submit──▶ submitted ──approve──▶ approved   Dr expense / Cr 2400, dated expense_date
--                                 ──reimburse──▶ posted  Dr 2400 / Cr 1100 + kassa out, dated pay date
--
-- reject: submitted ──▶ draft with a reason.
-- cancel: reverses whatever was posted (storno cash row + storno journals).
--
-- Approve, reject and reimburse need can_manage_finance; create, edit and
-- submit need can_manage_expenses.
--
-- Idempotent: safe to run more than once.

BEGIN;

-- ─── 1. Columns and GL account ──────────────────────────────────────────────
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS payment_mode             TEXT NOT NULL DEFAULT 'company',
  ADD COLUMN IF NOT EXISTS employee_id              UUID REFERENCES public.employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS submitted_at             TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS submitted_by             UUID,
  ADD COLUMN IF NOT EXISTS approved_at              TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS approved_by              UUID,
  ADD COLUMN IF NOT EXISTS rejected_at              TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejected_by              UUID,
  ADD COLUMN IF NOT EXISTS rejected_reason          TEXT,
  ADD COLUMN IF NOT EXISTS reimbursed_at            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reimbursed_by            UUID,
  ADD COLUMN IF NOT EXISTS reimbursement_journal_id UUID REFERENCES public.journal_entries(id) ON DELETE SET NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expenses_payment_mode_check') THEN
    ALTER TABLE public.expenses ADD CONSTRAINT expenses_payment_mode_check
      CHECK (payment_mode IN ('company', 'employee'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_expenses_employee_id ON public.expenses (employee_id) WHERE employee_id IS NOT NULL;

INSERT INTO public.chart_of_accounts (code, name, account_type, is_active)
VALUES ('2400', 'İşçilərə borc (xərc kompensasiyası)', 'liability', true)
ON CONFLICT (code) DO NOTHING;

-- ─── 2. Shared helpers ──────────────────────────────────────────────────────
-- Journal memo: code — description/category — party — № receipt.
CREATE OR REPLACE FUNCTION public.expense_memo(p_expense_id UUID)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT concat_ws(' — ',
    e.code,
    COALESCE(NULLIF(trim(e.description), ''), e.category),
    COALESCE(
      NULLIF(trim(COALESCE(NULLIF(trim(s.company_name), ''), s.full_name)), ''),
      NULLIF(trim(emp.full_name), ''),
      NULLIF(trim(e.payee), '')
    ),
    CASE WHEN NULLIF(trim(e.reference_no), '') IS NOT NULL THEN '№ ' || trim(e.reference_no) END
  )
  FROM public.expenses e
  LEFT JOIN public.suppliers s ON s.id = e.supplier_id
  LEFT JOIN public.employees emp ON emp.id = e.employee_id
  WHERE e.id = p_expense_id;
$$;

-- Expense GL account: category → parent category → name-based default.
CREATE OR REPLACE FUNCTION public.expense_coa_id(p_expense_id UUID)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_coa      UUID;
  v_category TEXT;
BEGIN
  SELECT COALESCE(c.coa_id, p.coa_id), e.category
  INTO v_coa, v_category
  FROM public.expenses e
  LEFT JOIN public.financial_categories c ON c.id = e.category_id
  LEFT JOIN public.financial_categories p ON p.id = c.parent_id
  WHERE e.id = p_expense_id;

  RETURN COALESCE(v_coa, public.resolve_gl_account_id(public.coa_debit_for_cash_out(v_category)));
END;
$$;

CREATE OR REPLACE FUNCTION public.assert_expense_date_postable(p_date DATE)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_date > CURRENT_DATE THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Gələcək tarixli xərc təsdiqlənə bilməz';
  END IF;
  IF public.is_accounting_period_closed(p_date) THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = format('%s dövrü bağlıdır — bu tarixə yazılış edilə bilməz', to_char(p_date, 'MM.YYYY'));
  END IF;
END;
$$;

-- Kassa/bank out: locks the account, checks the balance, writes the cash row.
CREATE OR REPLACE FUNCTION public.expense_cash_out(
  p_expense_id UUID,
  p_account_id UUID,
  p_amount     NUMERIC,
  p_date       DATE,
  p_memo       TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exp     public.expenses%ROWTYPE;
  v_balance NUMERIC;
  v_tx_id   UUID;
BEGIN
  SELECT * INTO v_exp FROM public.expenses WHERE id = p_expense_id;

  SELECT balance INTO v_balance FROM public.accounts WHERE id = p_account_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Kassa/bank hesabı tapılmadı';
  END IF;
  IF COALESCE(v_balance, 0) + 0.0001 < p_amount THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = format('Kassa/bank balansı kifayət etmir (lazım: %s, mövcud: %s)',
        trim(to_char(p_amount, 'FM999999990.00')),
        trim(to_char(COALESCE(v_balance, 0), 'FM999999990.00')));
  END IF;

  INSERT INTO public.transactions (
    account_id, type, amount, category, category_id, notes, description,
    source_type, source_id, reference_type, reference_id,
    unified_type, transaction_date, created_by, production_order_id
  )
  VALUES (
    p_account_id, 'Məxaric', p_amount, v_exp.category, v_exp.category_id,
    NULLIF(trim(v_exp.notes), ''), p_memo,
    'expense', v_exp.id, 'expense', v_exp.id,
    'EXPENSE', p_date::timestamptz, auth.uid(), v_exp.production_order_id
  )
  RETURNING id INTO v_tx_id;

  UPDATE public.accounts SET balance = COALESCE(v_balance, 0) - p_amount WHERE id = p_account_id;
  RETURN v_tx_id;
END;
$$;

-- ─── 3. Pay a company-paid expense (internal) ───────────────────────────────
CREATE OR REPLACE FUNCTION public.post_expense_internal(p_expense_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exp     public.expenses%ROWTYPE;
  v_tx_id   UUID;
  v_journal UUID;
  v_memo    TEXT;
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

  v_memo := public.expense_memo(v_exp.id);
  v_tx_id := public.expense_cash_out(v_exp.id, v_exp.account_id, v_exp.amount, v_exp.expense_date, v_memo);

  v_journal := public.post_journal_entry(jsonb_build_object(
    'source_type', 'expense',
    'source_id', v_exp.id,
    'document_type', 'expense',
    'document_id', v_exp.id,
    'idempotency_key', 'expense:' || v_exp.id::text,
    'entry_date', v_exp.expense_date,
    'memo', v_memo,
    'lines', jsonb_build_array(
      jsonb_build_object('coa_id', public.expense_coa_id(v_exp.id), 'debit', v_exp.amount, 'credit', 0,
                         'line_memo', v_exp.category),
      jsonb_build_object('coa_code', '1100', 'debit', 0, 'credit', v_exp.amount,
                         'account_id', v_exp.account_id, 'line_memo', v_memo)
    )
  ));

  UPDATE public.transactions SET journal_entry_id = v_journal WHERE id = v_tx_id;

  UPDATE public.expenses
  SET status = 'posted',
      transaction_id = v_tx_id,
      journal_entry_id = v_journal,
      posted_at = NOW(),
      posted_by = auth.uid(),
      updated_at = NOW()
  WHERE id = v_exp.id;

  RETURN v_tx_id;
END;
$$;

-- ─── 4. Create / edit (draft or submitted) ──────────────────────────────────
-- payload: id?, expense_date, category_id, payment_mode ('company'|'employee'),
-- employee_id?, account_id?, supplier_id?, payee?, reference_no?, description?,
-- notes?, net_amount, vat_rate?, vat_amount?, department_id?,
-- production_order_id?, post (bool, company only), submit (bool)
CREATE OR REPLACE FUNCTION public.record_expense_atomic(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id        UUID := NULLIF(p_payload->>'id', '')::uuid;
  v_existing  public.expenses%ROWTYPE;
  v_date      DATE := COALESCE(NULLIF(p_payload->>'expense_date', '')::date, CURRENT_DATE);
  v_cat_id    UUID := NULLIF(p_payload->>'category_id', '')::uuid;
  v_mode      TEXT := COALESCE(NULLIF(trim(p_payload->>'payment_mode'), ''), 'company');
  v_employee  UUID := NULLIF(p_payload->>'employee_id', '')::uuid;
  v_account   UUID := NULLIF(p_payload->>'account_id', '')::uuid;
  v_cat_label TEXT;
  v_net       NUMERIC(14,2) := round(COALESCE(NULLIF(p_payload->>'net_amount', '')::numeric, 0), 2);
  v_vat_rate  NUMERIC(5,2)  := round(COALESCE(NULLIF(p_payload->>'vat_rate', '')::numeric, 0), 2);
  v_vat       NUMERIC(14,2);
  v_total     NUMERIC(14,2);
  v_post      BOOLEAN := COALESCE((p_payload->>'post')::boolean, false);
  v_submit    BOOLEAN := COALESCE((p_payload->>'submit')::boolean, false);
  v_code      TEXT;
  v_tx_id     UUID;
  v_status    TEXT;
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
      code, expense_date, category_id, category, payment_mode, employee_id, account_id,
      supplier_id, payee, reference_no, description, notes, department_id, production_order_id,
      net_amount, vat_rate, vat_amount, amount, status, created_by
    )
    VALUES (
      v_code, v_date, v_cat_id, left(v_cat_label, 100), v_mode, v_employee, v_account,
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

-- ─── 5. Submit / reject / approve / reimburse ───────────────────────────────
CREATE OR REPLACE FUNCTION public.submit_expense_atomic(p_expense_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exp public.expenses%ROWTYPE;
BEGIN
  IF NOT public.require_permission('can_manage_expenses') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'İcazəniz yoxdur';
  END IF;
  SELECT * INTO v_exp FROM public.expenses WHERE id = p_expense_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Xərc sənədi tapılmadı';
  END IF;
  IF v_exp.status <> 'draft' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Yalnız qaralama təsdiqə göndərilə bilər';
  END IF;
  UPDATE public.expenses
  SET status = 'submitted', submitted_at = NOW(), submitted_by = auth.uid(),
      rejected_at = NULL, rejected_by = NULL, rejected_reason = NULL, updated_at = NOW()
  WHERE id = p_expense_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_expense_atomic(p_expense_id UUID, p_reason TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exp public.expenses%ROWTYPE;
BEGIN
  IF NOT public.require_permission('can_manage_finance') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Xərci geri qaytarmaq üçün icazəniz yoxdur';
  END IF;
  SELECT * INTO v_exp FROM public.expenses WHERE id = p_expense_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Xərc sənədi tapılmadı';
  END IF;
  IF v_exp.status <> 'submitted' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Yalnız təsdiq gözləyən xərc geri qaytarıla bilər';
  END IF;
  UPDATE public.expenses
  SET status = 'draft', rejected_at = NOW(), rejected_by = auth.uid(),
      rejected_reason = COALESCE(NULLIF(trim(p_reason), ''), 'Geri qaytarıldı'), updated_at = NOW()
  WHERE id = p_expense_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.approve_expense_atomic(p_expense_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exp     public.expenses%ROWTYPE;
  v_journal UUID;
  v_memo    TEXT;
BEGIN
  IF NOT public.require_permission('can_manage_finance') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Xərci təsdiqləmək üçün icazəniz yoxdur';
  END IF;
  SELECT * INTO v_exp FROM public.expenses WHERE id = p_expense_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Xərc sənədi tapılmadı';
  END IF;
  IF v_exp.status <> 'submitted' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Yalnız təsdiq gözləyən xərc təsdiqlənə bilər';
  END IF;

  IF v_exp.payment_mode = 'company' THEN
    PERFORM public.post_expense_internal(v_exp.id);
    UPDATE public.expenses SET approved_at = NOW(), approved_by = auth.uid() WHERE id = v_exp.id;
    RETURN jsonb_build_object('id', v_exp.id, 'status', 'posted');
  END IF;

  -- Employee paid: the expense is booked now, the company owes the employee.
  IF v_exp.employee_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Xərci ödəyən işçi seçilməyib';
  END IF;
  PERFORM public.assert_expense_date_postable(v_exp.expense_date);

  v_memo := public.expense_memo(v_exp.id);
  v_journal := public.post_journal_entry(jsonb_build_object(
    'source_type', 'expense',
    'source_id', v_exp.id,
    'document_type', 'expense',
    'document_id', v_exp.id,
    'idempotency_key', 'expense:' || v_exp.id::text,
    'entry_date', v_exp.expense_date,
    'memo', v_memo,
    'lines', jsonb_build_array(
      jsonb_build_object('coa_id', public.expense_coa_id(v_exp.id), 'debit', v_exp.amount, 'credit', 0,
                         'line_memo', v_exp.category),
      jsonb_build_object('coa_code', '2400', 'debit', 0, 'credit', v_exp.amount,
                         'partner_type', 'employee', 'partner_id', v_exp.employee_id, 'line_memo', v_memo)
    )
  ));

  UPDATE public.expenses
  SET status = 'approved', journal_entry_id = v_journal,
      approved_at = NOW(), approved_by = auth.uid(), updated_at = NOW()
  WHERE id = v_exp.id;

  RETURN jsonb_build_object('id', v_exp.id, 'status', 'approved', 'journal_entry_id', v_journal);
END;
$$;

CREATE OR REPLACE FUNCTION public.reimburse_expense_atomic(
  p_expense_id UUID,
  p_account_id UUID,
  p_pay_date   DATE DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exp     public.expenses%ROWTYPE;
  v_date    DATE := COALESCE(p_pay_date, CURRENT_DATE);
  v_tx_id   UUID;
  v_journal UUID;
  v_memo    TEXT;
BEGIN
  IF NOT public.require_permission('can_manage_finance') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Kompensasiya ödəmək üçün icazəniz yoxdur';
  END IF;
  SELECT * INTO v_exp FROM public.expenses WHERE id = p_expense_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Xərc sənədi tapılmadı';
  END IF;
  IF v_exp.payment_mode <> 'employee' OR v_exp.status <> 'approved' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Yalnız təsdiqlənmiş işçi xərci üçün kompensasiya ödənilir';
  END IF;
  IF p_account_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Kassa/bank hesabı seçilməlidir';
  END IF;
  IF v_date < v_exp.expense_date THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Ödəniş tarixi xərc tarixindən əvvəl ola bilməz';
  END IF;
  PERFORM public.assert_expense_date_postable(v_date);

  v_memo := 'Kompensasiya: ' || public.expense_memo(v_exp.id);
  v_tx_id := public.expense_cash_out(v_exp.id, p_account_id, v_exp.amount, v_date, v_memo);

  v_journal := public.post_journal_entry(jsonb_build_object(
    'source_type', 'expense',
    'source_id', v_exp.id,
    'document_type', 'expense',
    'document_id', v_exp.id,
    'idempotency_key', 'expense-reimburse:' || v_exp.id::text,
    'entry_date', v_date,
    'memo', v_memo,
    'lines', jsonb_build_array(
      jsonb_build_object('coa_code', '2400', 'debit', v_exp.amount, 'credit', 0,
                         'partner_type', 'employee', 'partner_id', v_exp.employee_id, 'line_memo', v_memo),
      jsonb_build_object('coa_code', '1100', 'debit', 0, 'credit', v_exp.amount,
                         'account_id', p_account_id, 'line_memo', v_memo)
    )
  ));

  UPDATE public.transactions SET journal_entry_id = v_journal WHERE id = v_tx_id;

  UPDATE public.expenses
  SET status = 'posted', account_id = p_account_id, transaction_id = v_tx_id,
      reimbursement_journal_id = v_journal, reimbursed_at = NOW(), reimbursed_by = auth.uid(),
      posted_at = NOW(), posted_by = auth.uid(), updated_at = NOW()
  WHERE id = v_exp.id;

  RETURN v_tx_id;
END;
$$;

-- ─── 6. Cancel ──────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cancel_expense_atomic(p_expense_id UUID, p_reason TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exp    public.expenses%ROWTYPE;
  v_reason TEXT;
  v_count  INTEGER := 0;
BEGIN
  IF NOT public.require_permission('can_manage_expenses') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Xərci ləğv etmək üçün icazəniz yoxdur';
  END IF;

  SELECT * INTO v_exp FROM public.expenses WHERE id = p_expense_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Xərc sənədi tapılmadı';
  END IF;
  IF v_exp.status = 'cancelled' THEN
    RETURN jsonb_build_object('id', v_exp.id, 'status', 'cancelled', 'reversed', 0);
  END IF;
  -- Undoing a booked expense is a finance decision.
  IF v_exp.status IN ('approved', 'posted') AND NOT public.require_permission('can_manage_finance')
     AND NOT (v_exp.status = 'posted' AND v_exp.payment_mode = 'company') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Təsdiqlənmiş xərci yalnız maliyyə ləğv edə bilər';
  END IF;
  -- Posted rows not posted by this module (production expenses) have no
  -- 'expense' cash row; they are cancelled where they were written.
  IF v_exp.status = 'posted' AND NOT EXISTS (
    SELECT 1 FROM public.transactions WHERE source_type = 'expense' AND source_id = v_exp.id
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'Bu xərc başqa bölmədən (məs. istehsalat) yazılıb və orada ləğv edilməlidir';
  END IF;

  v_reason := COALESCE(NULLIF(trim(p_reason), ''), 'Xərc ləğv edildi');

  IF v_exp.status = 'posted' THEN
    -- Kassa back (storno cash row + storno of its journal).
    v_count := public.reverse_document_cash_transactions('expense', v_exp.id, v_exp.code, v_reason);
  END IF;
  IF v_exp.status IN ('approved', 'posted') THEN
    IF v_exp.journal_entry_id IS NOT NULL THEN
      PERFORM public.reverse_journal_entry(v_exp.journal_entry_id, v_reason);
    END IF;
    IF v_exp.reimbursement_journal_id IS NOT NULL THEN
      PERFORM public.reverse_journal_entry(v_exp.reimbursement_journal_id, v_reason);
    END IF;
  END IF;

  UPDATE public.expenses
  SET status = 'cancelled', cancelled_at = NOW(), cancelled_by = auth.uid(),
      cancel_reason = v_reason, updated_at = NOW()
  WHERE id = v_exp.id;

  RETURN jsonb_build_object('id', v_exp.id, 'status', 'cancelled', 'reversed', v_count);
END;
$$;

-- ─── 7. Grants ──────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.expense_memo(UUID)                               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.expense_coa_id(UUID)                             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.assert_expense_date_postable(DATE)               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.expense_cash_out(UUID, UUID, NUMERIC, DATE, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.post_expense_internal(UUID)                      FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.submit_expense_atomic(UUID)                      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reject_expense_atomic(UUID, TEXT)                FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.approve_expense_atomic(UUID)                     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reimburse_expense_atomic(UUID, UUID, DATE)       FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_expense_atomic(JSONB)                  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_expense_atomic(UUID)                   TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reject_expense_atomic(UUID, TEXT)             TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.approve_expense_atomic(UUID)                  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reimburse_expense_atomic(UUID, UUID, DATE)    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_expense_atomic(UUID, TEXT)             TO authenticated, service_role;

COMMIT;
