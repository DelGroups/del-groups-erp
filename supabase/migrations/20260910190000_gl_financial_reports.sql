-- Phase 4: GL financial statements aggregation (P&L, Balance Sheet, General Ledger)

CREATE OR REPLACE FUNCTION public.journal_entry_date(je public.journal_entries)
RETURNS DATE
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE((je.date AT TIME ZONE 'UTC')::date, je.entry_date);
$$;

CREATE OR REPLACE FUNCTION public.get_gl_pl_summary(
  p_start_date DATE,
  p_end_date DATE
)
RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH lines AS (
    SELECT
      coa.account_type,
      coa.code,
      jel.debit,
      jel.credit
    FROM public.journal_entry_lines jel
    INNER JOIN public.journal_entries je ON je.id = jel.journal_entry_id
    INNER JOIN public.chart_of_accounts coa ON coa.id = jel.coa_id
    WHERE public.journal_entry_date(je) BETWEEN p_start_date AND p_end_date
  )
  SELECT jsonb_build_object(
    'total_revenue',
      COALESCE(SUM(
        CASE WHEN account_type IN ('revenue', 'income') THEN credit - debit ELSE 0 END
      ), 0),
    'total_cogs',
      COALESCE(SUM(
        CASE WHEN code IN ('5000', '5100') THEN debit - credit ELSE 0 END
      ), 0),
    'total_expenses',
      COALESCE(SUM(
        CASE
          WHEN account_type = 'expense' AND code NOT IN ('5000', '5100') THEN debit - credit
          ELSE 0
        END
      ), 0)
  )
  FROM lines;
$$;

CREATE OR REPLACE FUNCTION public.get_gl_balance_sheet(p_as_of_date DATE)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_assets JSONB;
  v_liabilities JSONB;
  v_equity_accounts JSONB;
  v_total_assets NUMERIC := 0;
  v_total_liabilities NUMERIC := 0;
  v_total_equity_accounts NUMERIC := 0;
  v_net_income NUMERIC := 0;
  v_pl JSONB;
BEGIN
  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.code), '[]'::jsonb)
  INTO v_assets
  FROM (
    SELECT
      coa.code,
      coa.name,
      ROUND(COALESCE(SUM(jel.debit - jel.credit), 0), 2) AS balance
    FROM public.journal_entry_lines jel
    INNER JOIN public.journal_entries je ON je.id = jel.journal_entry_id
    INNER JOIN public.chart_of_accounts coa ON coa.id = jel.coa_id
    WHERE coa.account_type = 'asset'
      AND public.journal_entry_date(je) <= p_as_of_date
    GROUP BY coa.id, coa.code, coa.name
    HAVING ABS(COALESCE(SUM(jel.debit - jel.credit), 0)) > 0.0001
  ) t;

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.code), '[]'::jsonb)
  INTO v_liabilities
  FROM (
    SELECT
      coa.code,
      coa.name,
      ROUND(COALESCE(SUM(jel.credit - jel.debit), 0), 2) AS balance
    FROM public.journal_entry_lines jel
    INNER JOIN public.journal_entries je ON je.id = jel.journal_entry_id
    INNER JOIN public.chart_of_accounts coa ON coa.id = jel.coa_id
    WHERE coa.account_type = 'liability'
      AND public.journal_entry_date(je) <= p_as_of_date
    GROUP BY coa.id, coa.code, coa.name
    HAVING ABS(COALESCE(SUM(jel.credit - jel.debit), 0)) > 0.0001
  ) t;

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.code), '[]'::jsonb)
  INTO v_equity_accounts
  FROM (
    SELECT
      coa.code,
      coa.name,
      ROUND(COALESCE(SUM(jel.credit - jel.debit), 0), 2) AS balance
    FROM public.journal_entry_lines jel
    INNER JOIN public.journal_entries je ON je.id = jel.journal_entry_id
    INNER JOIN public.chart_of_accounts coa ON coa.id = jel.coa_id
    WHERE coa.account_type = 'equity'
      AND public.journal_entry_date(je) <= p_as_of_date
    GROUP BY coa.id, coa.code, coa.name
    HAVING ABS(COALESCE(SUM(jel.credit - jel.debit), 0)) > 0.0001
  ) t;

  SELECT COALESCE(SUM((elem->>'balance')::numeric), 0) INTO v_total_assets
  FROM jsonb_array_elements(v_assets) elem;

  SELECT COALESCE(SUM((elem->>'balance')::numeric), 0) INTO v_total_liabilities
  FROM jsonb_array_elements(v_liabilities) elem;

  SELECT COALESCE(SUM((elem->>'balance')::numeric), 0) INTO v_total_equity_accounts
  FROM jsonb_array_elements(v_equity_accounts) elem;

  v_pl := public.get_gl_pl_summary(
    date_trunc('year', p_as_of_date)::date,
    p_as_of_date
  );

  v_net_income :=
    COALESCE((v_pl->>'total_revenue')::numeric, 0)
    - COALESCE((v_pl->>'total_cogs')::numeric, 0)
    - COALESCE((v_pl->>'total_expenses')::numeric, 0);

  RETURN jsonb_build_object(
    'as_of_date', p_as_of_date,
    'assets', v_assets,
    'liabilities', v_liabilities,
    'equity_accounts', v_equity_accounts,
    'total_assets', ROUND(v_total_assets, 2),
    'total_liabilities', ROUND(v_total_liabilities, 2),
    'total_equity_accounts', ROUND(v_total_equity_accounts, 2),
    'net_income_ytd', ROUND(v_net_income, 2),
    'total_equity', ROUND(v_total_equity_accounts + v_net_income, 2)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_gl_general_ledger(
  p_start_date DATE,
  p_end_date DATE,
  p_account_id UUID DEFAULT NULL,
  p_partner_id UUID DEFAULT NULL,
  p_limit INT DEFAULT 50,
  p_offset INT DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_rows JSONB;
  v_total INT;
BEGIN
  SELECT COUNT(*)
  INTO v_total
  FROM public.journal_entry_lines jel
  INNER JOIN public.journal_entries je ON je.id = jel.journal_entry_id
  WHERE public.journal_entry_date(je) BETWEEN p_start_date AND p_end_date
    AND (p_account_id IS NULL OR jel.coa_id = p_account_id)
    AND (p_partner_id IS NULL OR jel.partner_id = p_partner_id);

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT
      jel.id AS line_id,
      je.id AS entry_id,
      public.journal_entry_date(je) AS entry_date,
      COALESCE(je.document_type, je.source_type) AS document_type,
      COALESCE(je.description, je.memo) AS description,
      coa.id AS account_id,
      coa.code AS account_code,
      coa.name AS account_name,
      jel.partner_id,
      ROUND(jel.debit, 2) AS debit,
      ROUND(jel.credit, 2) AS credit
    FROM public.journal_entry_lines jel
    INNER JOIN public.journal_entries je ON je.id = jel.journal_entry_id
    INNER JOIN public.chart_of_accounts coa ON coa.id = jel.coa_id
    WHERE public.journal_entry_date(je) BETWEEN p_start_date AND p_end_date
      AND (p_account_id IS NULL OR jel.coa_id = p_account_id)
      AND (p_partner_id IS NULL OR jel.partner_id = p_partner_id)
    ORDER BY public.journal_entry_date(je) DESC, je.id DESC, jel.id DESC
    LIMIT GREATEST(COALESCE(p_limit, 50), 1)
    OFFSET GREATEST(COALESCE(p_offset, 0), 0)
  ) t;

  RETURN jsonb_build_object(
    'rows', v_rows,
    'total', v_total,
    'limit', GREATEST(COALESCE(p_limit, 50), 1),
    'offset', GREATEST(COALESCE(p_offset, 0), 0)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_gl_pl_summary(DATE, DATE) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_gl_balance_sheet(DATE) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_gl_general_ledger(DATE, DATE, UUID, UUID, INT, INT) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
