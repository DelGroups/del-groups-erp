-- HR & Payroll system: employee dossier, advances, leaves, monthly payroll runs
-- Integrates with unified financial ledger via transactions.reference_type

-- ─── 1. Expand employees ─────────────────────────────────────────────────────

ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS fin_code VARCHAR(20);
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS iban VARCHAR(34);
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS bank_name VARCHAR(120);
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS hire_date DATE;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS contract_end_date DATE;
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS emergency_phone VARCHAR(40);
ALTER TABLE public.employees ADD COLUMN IF NOT EXISTS documents_json JSONB NOT NULL DEFAULT '{}'::jsonb;

-- ─── 2. Salary advances ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.employee_advances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  amount NUMERIC(15, 2) NOT NULL CHECK (amount > 0),
  request_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING', 'PAID', 'DEDUCTED')),
  account_id UUID REFERENCES public.accounts(id),
  transaction_id UUID REFERENCES public.transactions(id) ON DELETE SET NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employee_advances_employee
  ON public.employee_advances (employee_id, status, request_date DESC);

-- ─── 3. Leave management ─────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.employee_leaves (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  leave_type VARCHAR(20) NOT NULL DEFAULT 'PAID'
    CHECK (leave_type IN ('PAID', 'UNPAID', 'SICK')),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  days_count INT NOT NULL CHECK (days_count > 0),
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('APPROVED', 'PENDING', 'REJECTED')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (end_date >= start_date)
);

CREATE INDEX IF NOT EXISTS idx_employee_leaves_employee
  ON public.employee_leaves (employee_id, start_date DESC);

CREATE INDEX IF NOT EXISTS idx_employee_leaves_period
  ON public.employee_leaves (start_date, end_date)
  WHERE status = 'APPROVED';

-- ─── 4. Monthly payroll runs ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.payrolls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_month INT NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  period_year INT NOT NULL CHECK (period_year BETWEEN 2000 AND 2100),
  employee_id UUID NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
  base_salary NUMERIC(15, 2) NOT NULL DEFAULT 0,
  bonuses_commissions NUMERIC(15, 2) NOT NULL DEFAULT 0,
  advances_deducted NUMERIC(15, 2) NOT NULL DEFAULT 0,
  other_deductions NUMERIC(15, 2) NOT NULL DEFAULT 0,
  net_salary NUMERIC(15, 2) NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'APPROVED', 'PAID')),
  paid_at TIMESTAMPTZ,
  account_id UUID REFERENCES public.accounts(id),
  transaction_id UUID REFERENCES public.transactions(id) ON DELETE SET NULL,
  salary_payment_id UUID REFERENCES public.salary_payments(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payrolls_period_employee
  ON public.payrolls (period_year, period_month, employee_id);

CREATE INDEX IF NOT EXISTS idx_payrolls_status
  ON public.payrolls (period_year DESC, period_month DESC, status);

-- ─── 5. RLS ──────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_nargs int;
BEGIN
  SELECT p.pronargs INTO v_nargs
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = '_apply_table_rls'
  ORDER BY p.pronargs DESC
  LIMIT 1;

  IF v_nargs = 5 THEN
    EXECUTE 'SELECT public._apply_table_rls($1,$2,$3,$4,$5)'
      USING 'employee_advances', 'can_view_hr', 'can_manage_hr', 'can_manage_hr', 'can_manage_hr';
    EXECUTE 'SELECT public._apply_table_rls($1,$2,$3,$4,$5)'
      USING 'employee_leaves', 'can_view_hr', 'can_manage_hr', 'can_manage_hr', 'can_manage_hr';
    EXECUTE 'SELECT public._apply_table_rls($1,$2,$3,$4,$5)'
      USING 'payrolls', 'can_view_hr', 'can_manage_hr', 'can_manage_hr', 'can_manage_hr';
  ELSIF v_nargs = 4 THEN
    EXECUTE 'SELECT public._apply_table_rls($1,$2,$3,$4)'
      USING 'employee_advances', 'can_view_hr', 'can_manage_hr', 'can_manage_hr';
    EXECUTE 'SELECT public._apply_table_rls($1,$2,$3,$4)'
      USING 'employee_leaves', 'can_view_hr', 'can_manage_hr', 'can_manage_hr';
    EXECUTE 'SELECT public._apply_table_rls($1,$2,$3,$4)'
      USING 'payrolls', 'can_view_hr', 'can_manage_hr', 'can_manage_hr';
  END IF;
END $$;

-- ─── 6. Helpers ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.hr_leave_days_in_month(
  p_start DATE,
  p_end DATE,
  p_month INT,
  p_year INT
)
RETURNS INT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT GREATEST(
    0,
    (
      LEAST(
        p_end,
        (date_trunc('month', make_date(p_year, p_month, 1)) + INTERVAL '1 month' - INTERVAL '1 day')::date
      )
      - GREATEST(p_start, make_date(p_year, p_month, 1))
      + 1
    )::INT
  );
$$;

CREATE OR REPLACE FUNCTION public.hr_unpaid_leave_deduction(
  p_employee_id UUID,
  p_month INT,
  p_year INT,
  p_base_salary NUMERIC
)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_days INT := 0;
  v_daily_rate NUMERIC;
BEGIN
  SELECT COALESCE(SUM(public.hr_leave_days_in_month(l.start_date, l.end_date, p_month, p_year)), 0)
    INTO v_days
    FROM public.employee_leaves l
   WHERE l.employee_id = p_employee_id
     AND l.status = 'APPROVED'
     AND l.leave_type = 'UNPAID'
     AND l.start_date <= (date_trunc('month', make_date(p_year, p_month, 1)) + INTERVAL '1 month' - INTERVAL '1 day')::date
     AND l.end_date >= make_date(p_year, p_month, 1);

  IF v_days <= 0 OR COALESCE(p_base_salary, 0) <= 0 THEN
    RETURN 0;
  END IF;

  v_daily_rate := p_base_salary / 22.0;
  RETURN ROUND(v_daily_rate * v_days, 2);
END;
$$;

-- ─── 7. Calculate monthly payroll drafts ─────────────────────────────────────

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
       AND status = 'PAID';

    v_leave_deduction := public.hr_unpaid_leave_deduction(
      v_emp.id,
      p_month,
      p_year,
      v_emp.base_salary
    );

    v_net := GREATEST(
      0,
      COALESCE(v_emp.base_salary, 0)
      + COALESCE(v_commissions, 0)
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
      v_net,
      'DRAFT'
    )
    ON CONFLICT (period_year, period_month, employee_id) DO UPDATE
      SET
        base_salary = EXCLUDED.base_salary,
        bonuses_commissions = EXCLUDED.bonuses_commissions,
        advances_deducted = EXCLUDED.advances_deducted,
        other_deductions = EXCLUDED.other_deductions,
        net_salary = EXCLUDED.net_salary,
        updated_at = NOW()
      WHERE payrolls.status = 'DRAFT';

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.calculate_monthly_payroll_drafts(INT, INT) TO authenticated;

-- ─── 8. Pay employee advance (ledger + advance row) ───────────────────────────

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

-- ─── 9. Pay payroll run (ledger + commissions + advances) ─────────────────────

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
     AND status = 'PAID';

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
