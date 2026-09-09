-- Azerbaijan statutory payroll deductions (DSMF, İTŞ, gəlir vergisi) for 2026.

ALTER TABLE public.payrolls ADD COLUMN IF NOT EXISTS gross_salary NUMERIC(15, 2) NOT NULL DEFAULT 0;
ALTER TABLE public.payrolls ADD COLUMN IF NOT EXISTS dsmf_employee NUMERIC(15, 2) NOT NULL DEFAULT 0;
ALTER TABLE public.payrolls ADD COLUMN IF NOT EXISTS dsmf_employer NUMERIC(15, 2) NOT NULL DEFAULT 0;
ALTER TABLE public.payrolls ADD COLUMN IF NOT EXISTS its_employee NUMERIC(15, 2) NOT NULL DEFAULT 0;
ALTER TABLE public.payrolls ADD COLUMN IF NOT EXISTS its_employer NUMERIC(15, 2) NOT NULL DEFAULT 0;
ALTER TABLE public.payrolls ADD COLUMN IF NOT EXISTS income_tax NUMERIC(15, 2) NOT NULL DEFAULT 0;
ALTER TABLE public.payrolls ADD COLUMN IF NOT EXISTS taxable_income NUMERIC(15, 2) NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.az_payroll_statutory(p_gross NUMERIC, p_year INT DEFAULT 2026)
RETURNS TABLE (
  dsmf_employee NUMERIC,
  dsmf_employer NUMERIC,
  its_employee NUMERIC,
  its_employer NUMERIC,
  income_tax NUMERIC,
  taxable_income NUMERIC
)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_gross NUMERIC := GREATEST(COALESCE(p_gross, 0), 0);
  v_first NUMERIC;
  v_mid NUMERIC;
  v_above NUMERIC;
  v_dsmf_ee NUMERIC;
  v_dsmf_er NUMERIC;
  v_its NUMERIC;
  v_taxable NUMERIC;
  v_low_rate NUMERIC;
  v_low_tax NUMERIC;
  v_mid_tax NUMERIC;
  v_pit NUMERIC;
BEGIN
  v_first := LEAST(v_gross, 200);
  v_mid := LEAST(GREATEST(v_gross - 200, 0), 7800);
  v_above := GREATEST(v_gross - 8000, 0);

  v_dsmf_ee := ROUND(v_first * 0.03 + v_mid * 0.10 + v_above * 0.10, 2);
  v_dsmf_er := ROUND(v_first * 0.22 + v_mid * 0.15 + v_above * 0.11, 2);
  v_its := ROUND(v_gross * 0.005, 2);
  v_taxable := GREATEST(v_gross - v_dsmf_ee - v_its, 0);

  v_low_rate := CASE
    WHEN COALESCE(p_year, 2026) >= 2028 THEN 0.07
    WHEN COALESCE(p_year, 2026) >= 2027 THEN 0.05
    ELSE 0.03
  END;
  v_low_tax := ROUND(2500 * v_low_rate, 2);
  v_mid_tax := ROUND(5500 * 0.10, 2);

  IF v_taxable <= 2500 THEN
    v_pit := ROUND(v_taxable * v_low_rate, 2);
  ELSIF v_taxable <= 8000 THEN
    v_pit := ROUND(v_low_tax + (v_taxable - 2500) * 0.10, 2);
  ELSE
    v_pit := ROUND(v_low_tax + v_mid_tax + (v_taxable - 8000) * 0.14, 2);
  END IF;

  RETURN QUERY SELECT v_dsmf_ee, v_dsmf_er, v_its, v_its, v_pit, v_taxable;
END;
$$;

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
       AND status = 'PAID';

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

GRANT EXECUTE ON FUNCTION public.az_payroll_statutory(NUMERIC, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.calculate_monthly_payroll_drafts(INT, INT) TO authenticated;
