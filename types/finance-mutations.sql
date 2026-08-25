-- Del Groups ERP — Atomic finance & payroll mutations
-- Run in Supabase SQL Editor AFTER types/rbac-migration.sql.
-- Called via supabase.rpc() from server actions (authenticated session required).

-- ─── Expense: expense + transaction + account balance (single transaction) ───

CREATE OR REPLACE FUNCTION public.create_expense_atomic(
  p_code TEXT,
  p_category TEXT,
  p_amount NUMERIC,
  p_account_id UUID,
  p_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance NUMERIC;
  v_expense_id UUID;
BEGIN
  IF NOT public.require_permission('can_manage_expenses') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'invalid_amount' USING ERRCODE = '22023';
  END IF;

  IF p_code IS NULL OR length(trim(p_code)) = 0 THEN
    RAISE EXCEPTION 'invalid_code' USING ERRCODE = '22023';
  END IF;

  SELECT balance INTO v_balance
    FROM accounts
   WHERE id = p_account_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_balance < p_amount THEN
    RAISE EXCEPTION 'insufficient_balance' USING ERRCODE = '22023';
  END IF;

  INSERT INTO expenses (code, category, amount, account_id, notes)
  VALUES (trim(p_code), trim(p_category), p_amount, p_account_id, NULLIF(trim(p_notes), ''))
  RETURNING id INTO v_expense_id;

  INSERT INTO transactions (account_id, type, amount, category, notes)
  VALUES (
    p_account_id,
    'Məxaric',
    p_amount,
    trim(p_category),
    'Xərc: ' || trim(p_category) || COALESCE(' - ' || NULLIF(trim(p_notes), ''), '')
  );

  UPDATE accounts
     SET balance = balance - p_amount
   WHERE id = p_account_id;

  RETURN v_expense_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_expense_atomic(TEXT, TEXT, NUMERIC, UUID, TEXT) TO authenticated;

-- ─── Payroll: salary_payment + commissions + transaction + balance ───────────

CREATE OR REPLACE FUNCTION public.process_payroll_atomic(
  p_employee_id UUID,
  p_account_id UUID,
  p_base_salary NUMERIC,
  p_deductions NUMERIC,
  p_month_year TEXT,
  p_notes TEXT DEFAULT NULL,
  p_commission_ids UUID[] DEFAULT ARRAY[]::UUID[]
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance NUMERIC;
  v_net_amount NUMERIC;
  v_comm_total NUMERIC;
  v_comm_count INT;
  v_employee_name TEXT;
  v_payroll_id UUID;
BEGIN
  IF NOT public.require_permission('can_manage_hr') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  p_base_salary := COALESCE(p_base_salary, 0);
  p_deductions := COALESCE(p_deductions, 0);

  IF p_base_salary < 0 OR p_deductions < 0 THEN
    RAISE EXCEPTION 'invalid_amount' USING ERRCODE = '22023';
  END IF;

  IF p_month_year IS NULL OR length(trim(p_month_year)) = 0 THEN
    RAISE EXCEPTION 'invalid_month_year' USING ERRCODE = '22023';
  END IF;

  SELECT full_name INTO v_employee_name
    FROM employees
   WHERE id = p_employee_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'employee_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF p_commission_ids IS NOT NULL AND array_length(p_commission_ids, 1) > 0 THEN
    SELECT
      COALESCE(SUM(commission_amount), 0),
      COUNT(*)
    INTO v_comm_total, v_comm_count
    FROM sales_commissions
    WHERE id = ANY(p_commission_ids)
      AND employee_id = p_employee_id
      AND status = 'pending';

    IF v_comm_count IS DISTINCT FROM array_length(p_commission_ids, 1) THEN
      RAISE EXCEPTION 'invalid_commission_ids' USING ERRCODE = '22023';
    END IF;
  ELSE
    v_comm_total := 0;
  END IF;

  v_net_amount := GREATEST(0, p_base_salary + v_comm_total - p_deductions);

  IF v_net_amount <= 0 THEN
    RAISE EXCEPTION 'net_amount_zero' USING ERRCODE = '22023';
  END IF;

  SELECT balance INTO v_balance
    FROM accounts
   WHERE id = p_account_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_balance < v_net_amount THEN
    RAISE EXCEPTION 'insufficient_balance' USING ERRCODE = '22023';
  END IF;

  INSERT INTO salary_payments (
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
    p_employee_id,
    p_account_id,
    v_net_amount,
    v_net_amount,
    p_base_salary,
    v_comm_total,
    p_deductions,
    trim(p_month_year),
    NULLIF(trim(p_notes), ''),
    'paid'
  )
  RETURNING id INTO v_payroll_id;

  IF p_commission_ids IS NOT NULL AND array_length(p_commission_ids, 1) > 0 THEN
    UPDATE sales_commissions
       SET status = 'paid',
           payroll_id = v_payroll_id
     WHERE id = ANY(p_commission_ids)
       AND employee_id = p_employee_id
       AND status = 'pending';
  END IF;

  INSERT INTO transactions (account_id, type, amount, category, notes)
  VALUES (
    p_account_id,
    'Məxaric',
    v_net_amount,
    'Əmək Haqqı',
    format(
      'Maaş: %s — %s (Əsas: %s, Komissiya: %s, Tutulma: %s)',
      v_employee_name,
      trim(p_month_year),
      to_char(p_base_salary, 'FM999999990.00'),
      to_char(v_comm_total, 'FM999999990.00'),
      to_char(p_deductions, 'FM999999990.00')
    )
  );

  UPDATE accounts
     SET balance = balance - v_net_amount
   WHERE id = p_account_id;

  RETURN v_payroll_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_payroll_atomic(UUID, UUID, NUMERIC, NUMERIC, TEXT, TEXT, UUID[]) TO authenticated;
