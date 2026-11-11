-- ============================================================================
-- LED-3: partner statement details.
--
-- get_partner_statement (LED-1, 20261111100000) gets what the statement page shows and
-- nothing else changes: same signature, same lines, same balances and totals.
--   * partner: phone, email, address and credit_limit as well;
--   * each line: created_by (for an invoice payment, which the ledger has without an author:
--     its cash row's author, else its journal entry's),
--     created_by_name (profiles.full_name, else the e-mail), and the document the line
--     opens: doc_kind ('sale' | 'purchase' | 'production' | 'import') and doc_id.
--
-- Read-only; safe to re-run. Needs LED-1 first.
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('public.partner_ledger_movements') IS NULL THEN
    RAISE EXCEPTION 'Run 20261111100000_partner_ledger.sql (LED-1) before 20261113100000_partner_statement_details.sql';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.get_partner_statement(
  p_partner_id UUID,
  p_from       DATE,
  p_to         DATE,
  p_side       TEXT DEFAULT 'net'
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_side    TEXT := lower(btrim(COALESCE(p_side, 'net')));
  v_from    DATE := COALESCE(p_from, '-infinity'::date);
  v_to      DATE := COALESCE(p_to, public._partner_ledger_day(NOW()));
  v_partner public.partners;
  v_opening NUMERIC;
  v_debit   NUMERIC;
  v_credit  NUMERIC;
  v_lines   JSONB;
  v_ccy     JSONB;
BEGIN
  PERFORM public._partner_ledger_authorize();
  IF v_side NOT IN ('net', 'receivable', 'payable') THEN
    RAISE EXCEPTION '%', 'p_side must be net, receivable or payable' USING ERRCODE = '22023';
  END IF;
  IF v_from > v_to THEN
    RAISE EXCEPTION '%', 'p_from is after p_to' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_partner FROM public.partners WHERE id = p_partner_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION '%', 'Tərəfdaş tapılmadı' USING ERRCODE = 'P0002';
  END IF;

  -- The partner's movements up to p_to (on the chosen side), once.
  WITH rows_ AS MATERIALIZED (
    SELECT m.* FROM public.partner_ledger_movements m
    WHERE m.partner_id = p_partner_id AND (v_side = 'net' OR m.side = v_side) AND m.entry_date <= v_to
  ),
  opening AS (
    SELECT round(COALESCE(sum(r.debit - r.credit), 0), 2) AS bal FROM rows_ r WHERE r.entry_date < v_from
  ),
  period AS (
    SELECT r.*, row_number() OVER w AS n,
           round((SELECT bal FROM opening) + sum(r.debit - r.credit) OVER (w ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW), 2) AS balance
    FROM rows_ r
    WHERE r.entry_date >= v_from
    WINDOW w AS (ORDER BY r.entry_date, r.created_at NULLS FIRST, r.source_type, r.source_id)
  ),
  -- The document each period line opens, and its author (lines of the period only).
  detailed AS (
    SELECT x.*, d.doc_kind, d.doc_id,
           COALESCE(x.created_by, d.cash_author) AS author
    FROM period x
    LEFT JOIN LATERAL (
      SELECT CASE
               WHEN x.source_type IN ('sale', 'purchase') THEN x.source_type
               WHEN x.source_type LIKE 'import%' THEN 'import'
               WHEN x.source_type ~ '^(sale|purchase|production)_payment(_reversal)?$' THEN split_part(x.source_type, '_', 1)
             END AS doc_kind,
             CASE
               WHEN x.source_type IN ('sale', 'purchase') THEN x.source_id
               WHEN x.source_type LIKE 'import%' THEN
                 (SELECT e.document_id FROM public.journal_entry_lines l
                  JOIN public.journal_entries e ON e.id = l.journal_entry_id WHERE l.id = x.source_id)
               WHEN x.source_type ~ '^(sale|purchase|production)_payment(_reversal)?$' THEN
                 (SELECT CASE WHEN b.reference_type IN ('sale', 'purchase') THEN b.reference_id ELSE b.source_id END
                  FROM public.transactions t
                  JOIN public.transactions b ON b.id = CASE WHEN t.reference_type = 'storno' THEN t.reference_id ELSE t.id END
                  WHERE t.id = x.source_id)
             END AS doc_id,
             CASE WHEN x.source_type ~ '^(sale|purchase|production)_payment(_reversal)?$' THEN
               -- The cash row's author, else its journal entry's (payments carry it there).
               (SELECT COALESCE(t.created_by, e.created_by) FROM public.transactions t
                LEFT JOIN public.journal_entries e ON e.id = t.journal_entry_id
                WHERE t.id = x.source_id)
             END AS cash_author
    ) d ON TRUE
  )
  SELECT
    (SELECT bal FROM opening),
    (SELECT round(COALESCE(sum(x.debit), 0), 2) FROM period x),
    (SELECT round(COALESCE(sum(x.credit), 0), 2) FROM period x),
    (SELECT COALESCE(jsonb_agg(jsonb_build_object(
              'entry_date', x.entry_date, 'source_type', x.source_type, 'source_id', x.source_id,
              'doc_no', x.doc_no, 'description', x.description, 'debit', x.debit, 'credit', x.credit,
              'currency_code', x.currency_code, 'amount_fc', x.amount_fc, 'rate', x.rate,
              'due_date', x.due_date, 'side', x.side, 'balance', x.balance,
              'doc_kind', x.doc_kind, 'doc_id', x.doc_id,
              'created_by', x.author,
              'created_by_name', COALESCE(NULLIF(btrim(pf.full_name), ''), pf.email)
            ) ORDER BY x.n), '[]'::jsonb)
     FROM detailed x
     LEFT JOIN public.profiles pf ON pf.id = x.author),
    -- Per currency in the period: AZN debit/credit and the signed foreign amount.
    (SELECT COALESCE(jsonb_agg(jsonb_build_object(
              'currency_code', c.currency_code, 'debit', c.debit, 'credit', c.credit, 'net_fc', c.net_fc
            ) ORDER BY c.currency_code), '[]'::jsonb)
     FROM (
       SELECT x.currency_code,
              round(sum(x.debit), 2) AS debit,
              round(sum(x.credit), 2) AS credit,
              round(sum(CASE WHEN x.debit >= x.credit THEN abs(x.amount_fc) ELSE -abs(x.amount_fc) END), 2) AS net_fc
       FROM period x
       GROUP BY x.currency_code
     ) c)
  INTO v_opening, v_debit, v_credit, v_lines, v_ccy;

  RETURN jsonb_build_object(
    'partner', jsonb_build_object(
      'id', v_partner.id, 'name', v_partner.name, 'full_name', v_partner.full_name,
      'company_name', v_partner.company_name, 'voen', v_partner.voen,
      'is_customer', v_partner.is_customer, 'is_supplier', v_partner.is_supplier,
      'is_deleted', v_partner.is_deleted, 'payment_terms_days', v_partner.payment_terms_days,
      'phone', v_partner.phone, 'email', v_partner.email, 'address', v_partner.address,
      'credit_limit', v_partner.credit_limit
    ),
    'from', CASE WHEN p_from IS NULL THEN NULL ELSE v_from END,
    'to', v_to,
    'side', v_side,
    'opening_balance', v_opening,
    'lines', v_lines,
    'period_debit', v_debit,
    'period_credit', v_credit,
    'closing_balance', round(v_opening + v_debit - v_credit, 2),
    'currencies', v_ccy
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_partner_statement(UUID, DATE, DATE, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_partner_statement(UUID, DATE, DATE, TEXT) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
