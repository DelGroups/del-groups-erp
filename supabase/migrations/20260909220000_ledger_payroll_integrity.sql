-- Ledger integrity: no double-post on production expenses, reconcile on delete,
-- payroll advances scoped to the payroll month, cash balance check uses reconciled ledger.

-- ─── Production expense trigger: reverse account balance on DELETE ────────────

CREATE OR REPLACE FUNCTION public.sync_production_expense_to_ledger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_category_id UUID;
  v_tx_id UUID;
  v_description TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.finance_transaction_id IS NOT NULL THEN
      RETURN NEW;
    END IF;

    IF NEW.account_id IS NULL THEN
      RETURN NEW;
    END IF;

    v_category_id := resolve_financial_category_id(NEW.category, 'EXPENSE');
    v_description := COALESCE(
      NULLIF(trim(NEW.notes), ''),
      NULLIF(trim(NEW.category), ''),
      'İstehsalat xərci'
    );

    v_tx_id := post_cash_transaction(
      NEW.account_id,
      'Məxaric',
      COALESCE(NEW.amount, 0),
      COALESCE(NEW.category, 'İstehsalat xərci'),
      v_description,
      NEW.production_order_id,
      'production_expense',
      NEW.id
    );

    UPDATE transactions
    SET
      unified_type = 'EXPENSE',
      category_id = v_category_id,
      reference_type = 'production_expense',
      reference_id = NEW.id,
      source_type = 'production_expense',
      source_id = NEW.id,
      production_order_id = NEW.production_order_id,
      description = v_description
    WHERE id = v_tx_id;

    UPDATE production_expenses
    SET finance_transaction_id = v_tx_id,
        is_posted_to_finance = true
    WHERE id = NEW.id;

    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.finance_transaction_id IS NOT NULL THEN
      DELETE FROM transactions WHERE id = OLD.finance_transaction_id;
    END IF;
    IF OLD.account_id IS NOT NULL THEN
      PERFORM public.reconcile_account_balance_atomic(OLD.account_id);
    END IF;
    RETURN OLD;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- ─── Order-create RPC: post cash once and skip the trigger ───────────────────

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
  v_category_id UUID;
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
    'production_expense',
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
    account_id, account_name, finance_expense_id, finance_transaction_id,
    is_posted_to_finance, notes, created_by, created_by_name
  )
  VALUES (
    p_production_order_id, p_category, trim(p_description), p_amount,
    COALESCE(p_expense_date, CURRENT_DATE), p_account_id, NULLIF(trim(p_account_name), ''),
    v_finance_expense_id, v_tx_id, true, NULLIF(trim(p_notes), ''), auth.uid(),
    NULLIF(trim(p_actor_name), '')
  )
  RETURNING id INTO v_production_expense_id;

  v_category_id := public.resolve_financial_category_id(COALESCE(p_category, 'İstehsalat xərci'), 'EXPENSE');

  UPDATE public.transactions
  SET
    unified_type = 'EXPENSE',
    category_id = v_category_id,
    reference_type = 'production_expense',
    reference_id = v_production_expense_id,
    source_type = 'production_expense',
    source_id = v_production_expense_id,
    production_order_id = p_production_order_id,
    description = v_memo
  WHERE id = v_tx_id;

  RETURN v_production_expense_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_production_expense_atomic(
  UUID, TEXT, TEXT, TEXT, NUMERIC, DATE, UUID, TEXT, TEXT, TEXT
) TO authenticated, service_role;

-- ─── Payroll: deduct advances for the payroll month only ─────────────────────

CREATE OR REPLACE FUNCTION public.calculate_monthly_payroll_drafts(
  p_month INT,
  p_year INT
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_emp RECORD;
  v_commissions NUMERIC;
  v_advances NUMERIC;
  v_leave_deduction NUMERIC;
  v_gross NUMERIC;
  v_tax RECORD;
  v_net NUMERIC;
  v_count INT := 0;
BEGIN
  IF NOT public.require_permission('can_manage_hr') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_month IS NULL OR p_month < 1 OR p_month > 12 THEN
    RAISE EXCEPTION 'invalid_month' USING ERRCODE = '22023';
  END IF;

  FOR v_emp IN
    SELECT id, COALESCE(base_salary, salary, 0) AS base_salary
      FROM public.employees
     WHERE COALESCE(status, 'active') = 'active'
  LOOP
    SELECT COALESCE(SUM(commission_amount), 0)
      INTO v_commissions
      FROM public.sales_commissions
     WHERE employee_id = v_emp.id
       AND status = 'pending';

    SELECT COALESCE(SUM(amount), 0)
      INTO v_advances
      FROM public.employee_advances
     WHERE employee_id = v_emp.id
       AND status = 'PAID'
       AND EXTRACT(YEAR FROM COALESCE(request_date, created_at)::date) = p_year
       AND EXTRACT(MONTH FROM COALESCE(request_date, created_at)::date) = p_month;

    v_leave_deduction := public.hr_unpaid_leave_deduction(
      v_emp.id,
      p_month,
      p_year,
      v_emp.base_salary
    );

    v_gross := GREATEST(0, COALESCE(v_emp.base_salary, 0) + COALESCE(v_commissions, 0));
    SELECT * INTO v_tax FROM public.az_payroll_statutory(v_gross, p_year);

    v_net := GREATEST(
      0,
      v_gross
      - COALESCE(v_tax.dsmf_employee, 0)
      - COALESCE(v_tax.its_employee, 0)
      - COALESCE(v_tax.income_tax, 0)
      - COALESCE(v_advances, 0)
      - COALESCE(v_leave_deduction, 0)
    );

    INSERT INTO public.payrolls (
      period_month,
      period_year,
      employee_id,
      base_salary,
      bonuses_commissions,
      advances_deducted,
      other_deductions,
      gross_salary,
      dsmf_employee,
      dsmf_employer,
      its_employee,
      its_employer,
      income_tax,
      taxable_income,
      net_salary,
      status
    )
    VALUES (
      p_month,
      p_year,
      v_emp.id,
      COALESCE(v_emp.base_salary, 0),
      COALESCE(v_commissions, 0),
      COALESCE(v_advances, 0),
      COALESCE(v_leave_deduction, 0),
      v_gross,
      COALESCE(v_tax.dsmf_employee, 0),
      COALESCE(v_tax.dsmf_employer, 0),
      COALESCE(v_tax.its_employee, 0),
      COALESCE(v_tax.its_employer, 0),
      COALESCE(v_tax.income_tax, 0),
      COALESCE(v_tax.taxable_income, 0),
      v_net,
      'DRAFT'
    )
    ON CONFLICT (period_year, period_month, employee_id) DO UPDATE
      SET
        base_salary = EXCLUDED.base_salary,
        bonuses_commissions = EXCLUDED.bonuses_commissions,
        advances_deducted = EXCLUDED.advances_deducted,
        other_deductions = EXCLUDED.other_deductions,
        gross_salary = EXCLUDED.gross_salary,
        dsmf_employee = EXCLUDED.dsmf_employee,
        dsmf_employer = EXCLUDED.dsmf_employer,
        its_employee = EXCLUDED.its_employee,
        its_employer = EXCLUDED.its_employer,
        income_tax = EXCLUDED.income_tax,
        taxable_income = EXCLUDED.taxable_income,
        net_salary = EXCLUDED.net_salary,
        updated_at = NOW()
      WHERE payrolls.status = 'DRAFT';

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.calculate_monthly_payroll_drafts(INT, INT) TO authenticated;

-- ─── Pay payroll: reconcile cash first; mark only this month's advances ──────

CREATE OR REPLACE FUNCTION public.pay_payroll_run_atomic(
  p_payroll_id UUID,
  p_account_id UUID,
  p_created_by UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payroll RECORD;
  v_balance NUMERIC;
  v_employee_name TEXT;
  v_tx_id UUID;
  v_category_id UUID;
  v_desc TEXT;
  v_salary_payment_id UUID;
  v_month_label TEXT;
BEGIN
  IF NOT public.require_permission('can_manage_hr') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT *
    INTO v_payroll
    FROM public.payrolls
   WHERE id = p_payroll_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'payroll_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_payroll.status = 'PAID' THEN
    RAISE EXCEPTION 'payroll_already_paid' USING ERRCODE = '22023';
  END IF;

  IF COALESCE(v_payroll.net_salary, 0) <= 0 THEN
    RAISE EXCEPTION 'net_amount_zero' USING ERRCODE = '22023';
  END IF;

  SELECT full_name INTO v_employee_name
    FROM public.employees
   WHERE id = v_payroll.employee_id;

  PERFORM public.reconcile_account_balance_atomic(p_account_id);

  SELECT balance INTO v_balance
    FROM public.accounts
   WHERE id = p_account_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF COALESCE(v_balance, 0) < v_payroll.net_salary THEN
    RAISE EXCEPTION 'insufficient_balance' USING ERRCODE = '22023';
  END IF;

  v_month_label := to_char(make_date(v_payroll.period_year, v_payroll.period_month, 1), 'TMMonth YYYY');

  v_desc := format(
    'Maaş bordrosu: %s — %s (Əsas: %s, Bonus: %s, Avans: %s, Tutulma: %s)',
    v_employee_name,
    v_month_label,
    to_char(v_payroll.base_salary, 'FM999999990.00'),
    to_char(v_payroll.bonuses_commissions, 'FM999999990.00'),
    to_char(v_payroll.advances_deducted, 'FM999999990.00'),
    to_char(v_payroll.other_deductions, 'FM999999990.00')
  );

  v_tx_id := public.post_cash_transaction(
    p_account_id,
    'Məxaric',
    v_payroll.net_salary,
    'Əmək Haqqı',
    v_desc,
    NULL,
    'payroll',
    p_payroll_id
  );

  v_category_id := public.resolve_financial_category_id('Maaş', 'EXPENSE');

  UPDATE public.transactions
     SET unified_type = 'EXPENSE',
         category_id = v_category_id,
         reference_type = 'payroll',
         reference_id = p_payroll_id,
         description = v_desc,
         transaction_date = COALESCE(transaction_date, created_at, NOW()),
         created_by = p_created_by
   WHERE id = v_tx_id;

  INSERT INTO public.salary_payments (
    employee_id,
    account_id,
    amount,
    net_amount,
    base_salary,
    commission_total,
    deductions,
    month_year,
    notes,
    status
  )
  VALUES (
    v_payroll.employee_id,
    p_account_id,
    v_payroll.net_salary,
    v_payroll.net_salary,
    v_payroll.base_salary,
    v_payroll.bonuses_commissions,
    v_payroll.advances_deducted + v_payroll.other_deductions,
    v_month_label,
    v_desc,
    'paid'
  )
  RETURNING id INTO v_salary_payment_id;

  UPDATE public.sales_commissions
     SET status = 'paid',
         payroll_id = v_salary_payment_id
   WHERE employee_id = v_payroll.employee_id
     AND status = 'pending';

  UPDATE public.employee_advances
     SET status = 'DEDUCTED',
         updated_at = NOW()
   WHERE employee_id = v_payroll.employee_id
     AND status = 'PAID'
     AND EXTRACT(YEAR FROM COALESCE(request_date, created_at)::date) = v_payroll.period_year
     AND EXTRACT(MONTH FROM COALESCE(request_date, created_at)::date) = v_payroll.period_month;

  UPDATE public.payrolls
     SET status = 'PAID',
         paid_at = NOW(),
         account_id = p_account_id,
         transaction_id = v_tx_id,
         salary_payment_id = v_salary_payment_id,
         updated_at = NOW()
   WHERE id = p_payroll_id;

  RETURN v_tx_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.pay_payroll_run_atomic(UUID, UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.pay_employee_advance_atomic(
  p_employee_id UUID,
  p_amount NUMERIC,
  p_account_id UUID,
  p_description TEXT DEFAULT NULL,
  p_request_date DATE DEFAULT CURRENT_DATE,
  p_created_by UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance NUMERIC;
  v_employee_name TEXT;
  v_advance_id UUID;
  v_tx_id UUID;
  v_category_id UUID;
  v_desc TEXT;
BEGIN
  IF NOT public.require_permission('can_manage_hr') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'invalid_amount' USING ERRCODE = '22023';
  END IF;

  SELECT full_name INTO v_employee_name
    FROM public.employees
   WHERE id = p_employee_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'employee_not_found' USING ERRCODE = 'P0002';
  END IF;

  PERFORM public.reconcile_account_balance_atomic(p_account_id);

  SELECT balance INTO v_balance
    FROM public.accounts
   WHERE id = p_account_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF COALESCE(v_balance, 0) < p_amount THEN
    RAISE EXCEPTION 'insufficient_balance' USING ERRCODE = '22023';
  END IF;

  v_desc := COALESCE(
    NULLIF(trim(p_description), ''),
    format('Avans: %s', v_employee_name)
  );

  v_tx_id := public.post_cash_transaction(
    p_account_id,
    'Məxaric',
    p_amount,
    'Əmək Haqqı',
    v_desc,
    NULL,
    'employee_advance',
    NULL
  );

  v_category_id := public.resolve_financial_category_id('Maaş', 'EXPENSE');

  UPDATE public.transactions
     SET unified_type = 'EXPENSE',
         category_id = v_category_id,
         reference_type = 'employee_advance',
         description = v_desc,
         transaction_date = COALESCE(transaction_date, created_at, NOW()),
         created_by = p_created_by
   WHERE id = v_tx_id;

  INSERT INTO public.employee_advances (
    employee_id,
    amount,
    request_date,
    status,
    account_id,
    transaction_id,
    description
  )
  VALUES (
    p_employee_id,
    p_amount,
    COALESCE(p_request_date, CURRENT_DATE),
    'PAID',
    p_account_id,
    v_tx_id,
    NULLIF(trim(p_description), '')
  )
  RETURNING id INTO v_advance_id;

  UPDATE public.transactions
     SET reference_id = v_advance_id
   WHERE id = v_tx_id;

  RETURN v_advance_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.pay_employee_advance_atomic(UUID, NUMERIC, UUID, TEXT, DATE, UUID) TO authenticated;
