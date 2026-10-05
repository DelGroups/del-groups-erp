-- Expense documents (Xərc sənədi): date, supplier, VAT, department, draft/post/cancel.
--
-- Until now a manual expense was only a row in public.transactions written by
-- create_manual_expense_transaction(): category, kassa, amount and a note.
-- There was no date field (the cash row and its journal were always dated
-- NOW()), no document number, no supplier/payee, no receipt number, no VAT and
-- no department. public.expenses existed but only production expenses wrote to
-- it. 0 manual expenses exist on 2026-10-05, so nothing has to be migrated.
--
-- After this migration public.expenses is the expense document:
--   * record_expense_atomic(payload)  creates or edits a draft, and posts it
--     when payload.post = true;
--   * post_expense_atomic(id)         posts a draft: cash out of the chosen
--     kassa/bank and a balanced journal, both dated expense_date;
--   * cancel_expense_atomic(id, why)  cancels a draft, or reverses a posted
--     expense with a storno cash row and a storno journal (history is kept).
--
-- GL: Dr expense account / Cr 1100 for the gross amount (VAT included), the
-- same way purchases post today; there is no input-VAT account in the chart
-- yet. The expense account is the category's coa_id (or its parent's),
-- otherwise coa_debit_for_cash_out(category) as before (6100 / 6190).
--
-- Statuses submitted / approved are allowed by the CHECK for the approval
-- workflow that follows; nothing sets them yet.
--
-- Idempotent: safe to run more than once.

BEGIN;

-- ─── 1. Columns ──────────────────────────────────────────────────────────────
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS expense_date     DATE,
  ADD COLUMN IF NOT EXISTS category_id      UUID REFERENCES public.financial_categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS supplier_id      UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payee            TEXT,
  ADD COLUMN IF NOT EXISTS reference_no     TEXT,
  ADD COLUMN IF NOT EXISTS description      TEXT,
  ADD COLUMN IF NOT EXISTS net_amount       NUMERIC(14,2),
  ADD COLUMN IF NOT EXISTS vat_rate         NUMERIC(5,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vat_amount       NUMERIC(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS department_id    UUID REFERENCES public.employee_departments(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS status           TEXT NOT NULL DEFAULT 'posted',
  ADD COLUMN IF NOT EXISTS transaction_id   UUID REFERENCES public.transactions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS journal_entry_id UUID REFERENCES public.journal_entries(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS created_by       UUID,
  ADD COLUMN IF NOT EXISTS posted_at        TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS posted_by        UUID,
  ADD COLUMN IF NOT EXISTS cancelled_at     TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS cancelled_by     UUID,
  ADD COLUMN IF NOT EXISTS cancel_reason    TEXT,
  ADD COLUMN IF NOT EXISTS updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Rows written before this migration (production expenses) are posted cash
-- payments; date them by when they were created.
UPDATE public.expenses
SET expense_date = COALESCE((created_at AT TIME ZONE 'Asia/Baku')::date, CURRENT_DATE)
WHERE expense_date IS NULL;

UPDATE public.expenses
SET net_amount = amount - COALESCE(vat_amount, 0)
WHERE net_amount IS NULL;

ALTER TABLE public.expenses ALTER COLUMN expense_date SET DEFAULT CURRENT_DATE;
ALTER TABLE public.expenses ALTER COLUMN expense_date SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expenses_status_check') THEN
    ALTER TABLE public.expenses ADD CONSTRAINT expenses_status_check
      CHECK (status IN ('draft', 'submitted', 'approved', 'posted', 'cancelled'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expenses_vat_check') THEN
    ALTER TABLE public.expenses ADD CONSTRAINT expenses_vat_check
      CHECK (vat_amount >= 0 AND vat_rate >= 0 AND vat_rate <= 100 AND vat_amount <= amount);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_expenses_expense_date ON public.expenses (expense_date DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_category_id  ON public.expenses (category_id);
CREATE INDEX IF NOT EXISTS idx_expenses_supplier_id  ON public.expenses (supplier_id);
CREATE INDEX IF NOT EXISTS idx_expenses_status       ON public.expenses (status);

-- Optional GL mapping per expense category (falls back to the parent, then 6100/6190).
ALTER TABLE public.financial_categories
  ADD COLUMN IF NOT EXISTS coa_id UUID REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL;

-- ─── 2. Document number ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.next_expense_doc_no(p_date DATE DEFAULT CURRENT_DATE)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year INT := EXTRACT(YEAR FROM COALESCE(p_date, CURRENT_DATE))::INT;
  v_no   INT;
BEGIN
  INSERT INTO public.document_number_counters (doc_type, year, last_no)
  VALUES ('expense', v_year, 1)
  ON CONFLICT (doc_type, year)
  DO UPDATE SET last_no = public.document_number_counters.last_no + 1
  RETURNING last_no INTO v_no;

  RETURN 'XR-' || v_year::TEXT || '-' || lpad(v_no::TEXT, 5, '0');
END;
$$;

-- ─── 3. Post (internal) ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.post_expense_internal(p_expense_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exp      public.expenses%ROWTYPE;
  v_balance  NUMERIC;
  v_coa_id   UUID;
  v_coa_code TEXT;
  v_tx_id    UUID;
  v_journal  UUID;
  v_memo     TEXT;
  v_party    TEXT;
BEGIN
  SELECT * INTO v_exp FROM public.expenses WHERE id = p_expense_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Xərc sənədi tapılmadı';
  END IF;
  IF v_exp.status NOT IN ('draft', 'submitted', 'approved') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Yalnız qaralama xərc təsdiqlənə bilər';
  END IF;
  IF v_exp.account_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Kassa/bank hesabı seçilməlidir';
  END IF;
  IF COALESCE(v_exp.amount, 0) <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Məbləğ sıfırdan böyük olmalıdır';
  END IF;
  IF v_exp.expense_date > CURRENT_DATE THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Gələcək tarixli xərc təsdiqlənə bilməz';
  END IF;
  IF public.is_accounting_period_closed(v_exp.expense_date) THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = format('%s dövrü bağlıdır — bu tarixə xərc yazıla bilməz', to_char(v_exp.expense_date, 'MM.YYYY'));
  END IF;
  IF public.resolve_coa_id('1100') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002',
      MESSAGE = 'Hesab planında 1100 (Kassa/Bank) tapılmadı — chart-of-accounts miqrasiyasını yoxlayın';
  END IF;

  -- Expense account: category → parent category → name-based default.
  SELECT COALESCE(c.coa_id, p.coa_id) INTO v_coa_id
  FROM public.financial_categories c
  LEFT JOIN public.financial_categories p ON p.id = c.parent_id
  WHERE c.id = v_exp.category_id;

  IF v_coa_id IS NULL THEN
    v_coa_code := public.coa_debit_for_cash_out(v_exp.category);
  END IF;

  SELECT balance INTO v_balance FROM public.accounts WHERE id = v_exp.account_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Kassa/bank hesabı tapılmadı';
  END IF;
  IF COALESCE(v_balance, 0) + 0.0001 < v_exp.amount THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = format('Kassa/bank balansı kifayət etmir (lazım: %s, mövcud: %s)',
        trim(to_char(v_exp.amount, 'FM999999990.00')),
        trim(to_char(COALESCE(v_balance, 0), 'FM999999990.00')));
  END IF;

  SELECT COALESCE(NULLIF(trim(s.company_name), ''), NULLIF(trim(s.full_name), ''))
  INTO v_party
  FROM public.suppliers s WHERE s.id = v_exp.supplier_id;
  v_party := COALESCE(v_party, NULLIF(trim(v_exp.payee), ''));

  v_memo := concat_ws(' — ',
    v_exp.code,
    COALESCE(NULLIF(trim(v_exp.description), ''), v_exp.category),
    v_party,
    CASE WHEN NULLIF(trim(v_exp.reference_no), '') IS NOT NULL THEN '№ ' || trim(v_exp.reference_no) END
  );

  INSERT INTO public.transactions (
    account_id, type, amount, category, category_id, notes, description,
    source_type, source_id, reference_type, reference_id,
    unified_type, transaction_date, created_by, production_order_id
  )
  VALUES (
    v_exp.account_id, 'Məxaric', v_exp.amount, v_exp.category, v_exp.category_id,
    NULLIF(trim(v_exp.notes), ''), v_memo,
    'expense', v_exp.id, 'expense', v_exp.id,
    'EXPENSE', v_exp.expense_date::timestamptz, auth.uid(), v_exp.production_order_id
  )
  RETURNING id INTO v_tx_id;

  UPDATE public.accounts SET balance = COALESCE(v_balance, 0) - v_exp.amount WHERE id = v_exp.account_id;

  v_journal := public.post_journal_entry(jsonb_build_object(
    'source_type', 'expense',
    'source_id', v_exp.id,
    'document_type', 'expense',
    'document_id', v_exp.id,
    'idempotency_key', 'expense:' || v_exp.id::text,
    'entry_date', v_exp.expense_date,
    'memo', v_memo,
    'lines', jsonb_build_array(
      jsonb_build_object(
        'coa_id', v_coa_id,
        'coa_code', v_coa_code,
        'debit', v_exp.amount,
        'credit', 0,
        'line_memo', v_exp.category
      ),
      jsonb_build_object(
        'coa_code', '1100',
        'debit', 0,
        'credit', v_exp.amount,
        'account_id', v_exp.account_id,
        'line_memo', v_memo
      )
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

-- ─── 4. Create / edit draft (and optionally post) ───────────────────────────
-- payload: id?, expense_date, category_id, account_id, supplier_id?, payee?,
-- reference_no?, description?, notes?, net_amount, vat_rate?, vat_amount?,
-- department_id?, production_order_id?, post (bool)
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
  v_cat_label TEXT;
  v_net       NUMERIC(14,2) := round(COALESCE(NULLIF(p_payload->>'net_amount', '')::numeric, 0), 2);
  v_vat_rate  NUMERIC(5,2)  := round(COALESCE(NULLIF(p_payload->>'vat_rate', '')::numeric, 0), 2);
  v_vat       NUMERIC(14,2);
  v_total     NUMERIC(14,2);
  v_post      BOOLEAN := COALESCE((p_payload->>'post')::boolean, false);
  v_code      TEXT;
  v_tx_id     UUID;
BEGIN
  IF NOT public.require_permission('can_manage_expenses') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Xərc yazmaq üçün icazəniz yoxdur';
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
    IF v_existing.status NOT IN ('draft', 'submitted', 'approved') THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = 'Təsdiqlənmiş xərc dəyişdirilə bilməz — əvvəlcə ləğv edin';
    END IF;

    UPDATE public.expenses
    SET expense_date        = v_date,
        category_id         = v_cat_id,
        category            = left(v_cat_label, 100),
        account_id          = NULLIF(p_payload->>'account_id', '')::uuid,
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
  ELSE
    v_code := public.next_expense_doc_no(v_date);
    INSERT INTO public.expenses (
      code, expense_date, category_id, category, account_id, supplier_id, payee,
      reference_no, description, notes, department_id, production_order_id,
      net_amount, vat_rate, vat_amount, amount, status, created_by
    )
    VALUES (
      v_code, v_date, v_cat_id, left(v_cat_label, 100),
      NULLIF(p_payload->>'account_id', '')::uuid,
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
  END IF;

  IF v_post THEN
    v_tx_id := public.post_expense_internal(v_id);
  END IF;

  RETURN jsonb_build_object(
    'id', v_id,
    'code', v_code,
    'status', CASE WHEN v_post THEN 'posted' ELSE 'draft' END,
    'transaction_id', v_tx_id
  );
END;
$$;

-- ─── 5. Post a saved draft ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.post_expense_atomic(p_expense_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.require_permission('can_manage_expenses') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Xərc təsdiqləmək üçün icazəniz yoxdur';
  END IF;
  RETURN public.post_expense_internal(p_expense_id);
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
    v_count := public.reverse_document_cash_transactions('expense', v_exp.id, v_exp.code, v_reason);
    -- A journal with no cash row (should not happen) is still reversed.
    IF v_exp.journal_entry_id IS NOT NULL THEN
      PERFORM public.reverse_journal_entry(v_exp.journal_entry_id, v_reason);
    END IF;
  END IF;

  UPDATE public.expenses
  SET status = 'cancelled',
      cancelled_at = NOW(),
      cancelled_by = auth.uid(),
      cancel_reason = v_reason,
      updated_at = NOW()
  WHERE id = v_exp.id;

  RETURN jsonb_build_object('id', v_exp.id, 'status', 'cancelled', 'reversed', v_count);
END;
$$;

-- ─── 7. Grants ──────────────────────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.next_expense_doc_no(DATE)            FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.post_expense_internal(UUID)          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_expense_atomic(JSONB)         FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.post_expense_atomic(UUID)            FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.cancel_expense_atomic(UUID, TEXT)    FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_expense_atomic(JSONB)      TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.post_expense_atomic(UUID)         TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_expense_atomic(UUID, TEXT) TO authenticated, service_role;

COMMIT;
