-- ============================================================================
-- Fix the trial balance (ОСВ): opening and closing balances sat in the wrong
-- column for every liability, equity and revenue account.
--
-- Verified on production 2026-09-19 with a single 3.00 AZN sale:
--   4000 Satış gəliri — period debit 262.00, period credit 265.00
--   reported as CLOSING DEBIT 3.00, where a revenue account with more credit
--   than debit holds a CLOSING CREDIT of 3.00.
--
-- Cause: closing_net was computed in each account's own normal direction
--   asset/expense : debit  - credit
--   everything else: credit - debit      <- positive here means a CREDIT balance
-- and was then placed with
--   closing_debit  = GREATEST(closing_net, 0)
--   closing_credit = GREATEST(-closing_net, 0)
-- which sends every positive value to the debit column whatever the account is.
-- Assets and expenses came out right; the whole right-hand side of the balance
-- sheet came out mirrored. The same inversion applied to opening balances.
--
-- Consequence: the report's debit and credit totals could not agree, which is
-- the one property a trial balance exists to demonstrate. With the single test
-- sale the old report gave closing debit 7.00 against closing credit 1.00.
--
-- Which column a balance belongs in follows from raw debit vs raw credit alone,
-- never from the account's type. This rewrite drops the branching.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.get_gl_trial_balance(
  p_start_date DATE,
  p_end_date DATE
)
RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH movements AS (
    SELECT
      coa.id AS account_id,
      coa.code,
      coa.name,
      coa.account_type,
      COALESCE(SUM(
        CASE WHEN public.journal_entry_date(je) < p_start_date THEN jel.debit ELSE 0 END
      ), 0) AS open_debit_raw,
      COALESCE(SUM(
        CASE WHEN public.journal_entry_date(je) < p_start_date THEN jel.credit ELSE 0 END
      ), 0) AS open_credit_raw,
      COALESCE(SUM(
        CASE
          WHEN public.journal_entry_date(je) BETWEEN p_start_date AND p_end_date THEN jel.debit
          ELSE 0
        END
      ), 0) AS period_debit,
      COALESCE(SUM(
        CASE
          WHEN public.journal_entry_date(je) BETWEEN p_start_date AND p_end_date THEN jel.credit
          ELSE 0
        END
      ), 0) AS period_credit
    FROM public.chart_of_accounts coa
    LEFT JOIN public.journal_entry_lines jel ON jel.coa_id = coa.id
    LEFT JOIN public.journal_entries je ON je.id = jel.journal_entry_id
    WHERE coa.is_active = true
    GROUP BY coa.id, coa.code, coa.name, coa.account_type
  ),
  computed AS (
    SELECT
      account_id,
      code,
      name,
      account_type,
      period_debit,
      period_credit,
      (open_debit_raw - open_credit_raw) AS open_net,
      (open_debit_raw + period_debit) - (open_credit_raw + period_credit) AS closing_net
    FROM movements
  ),
  final_rows AS (
    SELECT
      account_id,
      code,
      name,
      account_type,
      ROUND(GREATEST(open_net, 0), 2)      AS initial_debit,
      ROUND(GREATEST(-open_net, 0), 2)     AS initial_credit,
      ROUND(period_debit, 2)               AS period_debit,
      ROUND(period_credit, 2)              AS period_credit,
      ROUND(GREATEST(closing_net, 0), 2)   AS closing_debit,
      ROUND(GREATEST(-closing_net, 0), 2)  AS closing_credit
    FROM computed
  )
  SELECT jsonb_build_object(
    'start_date', p_start_date,
    'end_date', p_end_date,
    'rows', COALESCE(
      (
        SELECT jsonb_agg(row_to_json(r)::jsonb ORDER BY r.code)
        FROM final_rows r
      ),
      '[]'::jsonb
    ),
    'totals', (
      SELECT jsonb_build_object(
        'initial_debit', ROUND(COALESCE(SUM(initial_debit), 0), 2),
        'initial_credit', ROUND(COALESCE(SUM(initial_credit), 0), 2),
        'period_debit', ROUND(COALESCE(SUM(period_debit), 0), 2),
        'period_credit', ROUND(COALESCE(SUM(period_credit), 0), 2),
        'closing_debit', ROUND(COALESCE(SUM(closing_debit), 0), 2),
        'closing_credit', ROUND(COALESCE(SUM(closing_credit), 0), 2)
      )
      FROM final_rows
    )
  );
$$;

NOTIFY pgrst, 'reload schema';
