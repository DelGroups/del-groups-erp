-- Azerbaijan tax / payroll / e-Qaimə settings stored in system_settings.
-- az_payroll_statutory reads live rates so /employees payroll uses settings, not literals.

INSERT INTO public.system_settings (key, value)
VALUES (
  'tax_payroll_config',
  '{
    "company_voen": "",
    "default_vat_rate": "18",
    "e_qaime_export_format": "XML_ETAXES",
    "dsmf_employer_rate": 22,
    "dsmf_employee_rate": 3,
    "its_rate": 0.5,
    "non_taxable_salary_limit": 0
  }'::jsonb
)
ON CONFLICT (key) DO NOTHING;

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
STABLE
SET search_path = public
AS $$
DECLARE
  v_gross NUMERIC := GREATEST(COALESCE(p_gross, 0), 0);
  v_cfg JSONB;
  v_ee_rate NUMERIC;
  v_er_rate NUMERIC;
  v_its_rate NUMERIC;
  v_limit NUMERIC;
  v_first NUMERIC;
  v_mid NUMERIC;
  v_above NUMERIC;
  v_dsmf_ee NUMERIC;
  v_dsmf_er NUMERIC;
  v_its NUMERIC;
  v_taxable NUMERIC;
  v_pit_base NUMERIC;
  v_low_rate NUMERIC;
  v_low_tax NUMERIC;
  v_mid_tax NUMERIC;
  v_pit NUMERIC;
BEGIN
  SELECT value INTO v_cfg
    FROM public.system_settings
   WHERE key = 'tax_payroll_config';

  v_ee_rate := GREATEST(COALESCE((v_cfg ->> 'dsmf_employee_rate')::numeric, 3), 0) / 100.0;
  v_er_rate := GREATEST(COALESCE((v_cfg ->> 'dsmf_employer_rate')::numeric, 22), 0) / 100.0;
  v_its_rate := GREATEST(COALESCE((v_cfg ->> 'its_rate')::numeric, 0.5), 0) / 100.0;
  v_limit := GREATEST(COALESCE((v_cfg ->> 'non_taxable_salary_limit')::numeric, 0), 0);

  v_first := LEAST(v_gross, 200);
  v_mid := LEAST(GREATEST(v_gross - 200, 0), 7800);
  v_above := GREATEST(v_gross - 8000, 0);

  v_dsmf_ee := ROUND(v_first * v_ee_rate + v_mid * 0.10 + v_above * 0.10, 2);
  v_dsmf_er := ROUND(v_first * v_er_rate + v_mid * 0.15 + v_above * 0.11, 2);
  v_its := ROUND(v_gross * v_its_rate, 2);
  v_taxable := GREATEST(v_gross - v_dsmf_ee - v_its, 0);
  v_pit_base := GREATEST(v_taxable - v_limit, 0);

  v_low_rate := CASE
    WHEN COALESCE(p_year, 2026) >= 2028 THEN 0.07
    WHEN COALESCE(p_year, 2026) >= 2027 THEN 0.05
    ELSE 0.03
  END;
  v_low_tax := ROUND(2500 * v_low_rate, 2);
  v_mid_tax := ROUND(5500 * 0.10, 2);

  IF v_pit_base <= 2500 THEN
    v_pit := ROUND(v_pit_base * v_low_rate, 2);
  ELSIF v_pit_base <= 8000 THEN
    v_pit := ROUND(v_low_tax + (v_pit_base - 2500) * 0.10, 2);
  ELSE
    v_pit := ROUND(v_low_tax + v_mid_tax + (v_pit_base - 8000) * 0.14, 2);
  END IF;

  RETURN QUERY SELECT v_dsmf_ee, v_dsmf_er, v_its, v_its, v_pit, v_taxable;
END;
$$;

GRANT EXECUTE ON FUNCTION public.az_payroll_statutory(NUMERIC, INT) TO authenticated;
