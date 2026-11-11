-- ============================================================================
-- Partner ledger (LED-1): one source of truth for every money movement of a
-- business partner (customer, supplier or both). Read-only: nothing here changes
-- a balance, a journal or a document. Spec: docs/ledgers/partner-ledger-spec.md.
--
-- - view partner_ledger_movements: one row per movement, debit = the partner owes
--   us more, credit = we owe them more or they paid us; balance = SUM(debit - credit)
--   (positive: debtor, negative: creditor). AZN, 2 decimals.
-- - get_partner_statement(partner, from, to, side): header, opening balance,
--   lines with running balance, period totals, closing balance, per-currency
--   subtotals.
-- - get_partner_balances(as_of): receivable / payable / net per partner, last
--   payment. LED-4 (debtors/creditors) and LED-5 (aging) build on it.
-- - check_partner_ledger_integrity(): per partner the ledger balance, today's stored
--   balance (compute_partner_net_balance) and the GL balance on 1200/2100, with the
--   deltas (the same query: supabase/scripts/partner_ledger_check.sql).
-- - partners.payment_terms_days (days until an invoice is due; 0 = on receipt).
--
-- Reports need can_view_financial_reports (admins always). Safe to re-run.
-- ============================================================================

ALTER TABLE public.partners
  ADD COLUMN IF NOT EXISTS payment_terms_days INTEGER NOT NULL DEFAULT 0;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'partners_payment_terms_days_check') THEN
    ALTER TABLE public.partners
      ADD CONSTRAINT partners_payment_terms_days_check CHECK (payment_terms_days >= 0);
  END IF;
END;
$$;

-- ─── Helpers ────────────────────────────────────────────────────────────────

-- A posted, live document: not a draft, not cancelled. The cancelled labels of
-- isInvoiceCancelled (src/lib/invoices/invoiceStatus.ts) plus 'deleted', which the old
-- reconciliation act also left out.
CREATE OR REPLACE FUNCTION public._partner_ledger_doc_live(p_status TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(btrim(COALESCE(p_status, ''))) NOT IN
    ('draft', 'cancelled', 'void', 'voided', 'deleted', 'ləğv edildi', 'legv edildi');
$$;

-- A timestamp as the company's calendar day.
CREATE OR REPLACE FUNCTION public._partner_ledger_day(p_ts TIMESTAMPTZ)
RETURNS DATE
LANGUAGE sql
STABLE
AS $$
  SELECT (p_ts AT TIME ZONE 'Asia/Baku')::date;
$$;

-- The partner of a customer / supplier id: the live one, else a deleted (merged-away) one,
-- so a deleted partner keeps its invoices and opening balance next to its payments.
CREATE OR REPLACE FUNCTION public._partner_ledger_partner(p_customer_id UUID, p_supplier_id UUID)
RETURNS UUID
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT p.id
  FROM public.partners p
  WHERE (p_customer_id IS NOT NULL AND p.customer_id = p_customer_id)
     OR (p_supplier_id IS NOT NULL AND p.supplier_id = p_supplier_id)
  ORDER BY p.is_deleted, p.created_at NULLS LAST, p.id
  LIMIT 1;
$$;

-- A production order's number and customer partner. production_orders belongs to the
-- production module: read only where it is installed (no error for a tenant without it).
CREATE OR REPLACE FUNCTION public._partner_ledger_production_order(p_order_id UUID, OUT order_no TEXT, OUT partner_id UUID)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
BEGIN
  IF p_order_id IS NULL OR to_regclass('public.production_orders') IS NULL THEN
    RETURN;
  END IF;
  EXECUTE 'SELECT o.order_no, public._partner_ledger_partner(o.customer_id, NULL) FROM public.production_orders o WHERE o.id = $1'
    INTO order_no, partner_id
    USING p_order_id;
END;
$$;

-- Reports: can_view_financial_reports or admin. Service-role callers (server code,
-- the SQL editor) have no auth.uid() and are trusted, like the other report RPCs.
CREATE OR REPLACE FUNCTION public._partner_ledger_authorize()
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT (public.is_active_user() AND (public.user_is_admin() OR public.has_permission('can_view_financial_reports'))) THEN
    RAISE EXCEPTION '%', 'forbidden' USING ERRCODE = '42501';
  END IF;
END;
$$;

-- ─── The movements ──────────────────────────────────────────────────────────

-- security_invoker: whoever reads the view sees only what the RLS of the source
-- tables lets them see. The report functions below read it as the owner, after
-- their own permission check.
CREATE OR REPLACE VIEW public.partner_ledger_movements
WITH (security_invoker = true)
AS
WITH
sale_docs AS (
  SELECT s.*, COALESCE(s.partner_id, public._partner_ledger_partner(s.customer_id, NULL)) AS ledger_partner
  FROM public.sales s
),
purchase_docs AS (
  SELECT p.*, COALESCE(p.partner_id, public._partner_ledger_partner(NULL, p.supplier_id)) AS ledger_partner
  FROM public.purchases p
),
-- Cash rows paid against an invoice or a production order (flows 7, 8, 22). post_cash_transaction
-- and _post_payment_lines link them with source_type / source_id; older rows may carry
-- reference_type / reference_id instead. Extra costs paid with an invoice ("Əlavə Xərc…") go to
-- third parties, not to the partner, and are left out.
invoice_cash_base AS (
  SELECT t.id, t.type, t.amount, COALESCE(t.transaction_date, t.created_at) AS moved_at, t.created_at, t.notes,
         CASE WHEN t.reference_type IN ('sale', 'purchase') THEN t.reference_type ELSE t.source_type END AS doc_kind,
         CASE WHEN t.reference_type IN ('sale', 'purchase') THEN t.reference_id ELSE t.source_id END AS doc_id
  FROM public.transactions t
  WHERE COALESCE(t.reference_type, '') <> 'storno'
    AND ((t.reference_type IN ('sale', 'purchase') AND t.reference_id IS NOT NULL)
      OR (t.source_type IN ('sale', 'purchase', 'production') AND t.source_id IS NOT NULL))
    AND COALESCE(t.category, '') NOT LIKE 'Əlavə Xərc%'
    AND COALESCE(t.amount, 0) > 0
),
-- ... and their storno rows (flow 9): the reversal of a payment, dated its own day.
invoice_cash AS (
  SELECT b.*, 'payment'::text AS kind FROM invoice_cash_base b
  UNION ALL
  SELECT r.id, r.type, r.amount, COALESCE(r.transaction_date, r.created_at), r.created_at, r.notes,
         b.doc_kind, b.doc_id, 'storno'
  FROM public.transactions r
  JOIN invoice_cash_base b ON b.id = r.reference_id
  WHERE r.reference_type = 'storno'
),
-- Import journal lines with a partner (flows 11-16). A reversal belongs to the entry it reverses.
import_lines AS (
  SELECT l.id, l.partner_id, l.debit, l.credit, l.line_memo,
         e.id AS entry_id, COALESCE(e.reversal_of, e.id) AS source_entry, e.entry_date, e.document_type,
         e.document_id, e.created_by, COALESCE(e.posted_at, e.date) AS posted_at, e.reversal_of
  FROM public.journal_entry_lines l
  JOIN public.journal_entries e ON e.id = l.journal_entry_id
  JOIN public.chart_of_accounts a ON a.id = l.coa_id
  WHERE e.document_type LIKE 'import%'
    AND a.code IN ('1200', '2100')
    AND l.partner_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.partners pa WHERE pa.id = l.partner_id)
)
-- 1. Customer opening balance. Opening balances are what was owed before the ERP: dated
-- 1900-01-01 so they come before every movement and are in every as-of balance.
SELECT
  public._partner_ledger_partner(c.id, NULL) AS partner_id,
  DATE '1900-01-01' AS entry_date,
  'opening_customer'::text AS source_type,
  c.id AS source_id,
  NULL::text AS doc_no,
  'Müştəri ilkin qalığı'::text AS description,
  round(GREATEST(c.opening_balance, 0), 2) AS debit,
  round(GREATEST(-c.opening_balance, 0), 2) AS credit,
  'AZN'::text AS currency_code,
  round(c.opening_balance, 2) AS amount_fc,
  1::numeric AS rate,
  NULL::date AS due_date,
  NULL::uuid AS created_by,
  c.created_at AS created_at,
  'receivable'::text AS side
FROM public.customers c
WHERE COALESCE(c.opening_balance, 0) <> 0
  AND public._partner_ledger_partner(c.id, NULL) IS NOT NULL

UNION ALL
-- 2. Supplier opening balance (positive = we owe them).
SELECT
  public._partner_ledger_partner(NULL, su.id),
  DATE '1900-01-01',
  'opening_supplier',
  su.id,
  NULL,
  'Təchizatçı ilkin qalığı',
  round(GREATEST(-su.opening_balance, 0), 2),
  round(GREATEST(su.opening_balance, 0), 2),
  'AZN',
  round(-su.opening_balance, 2),
  1,
  NULL,
  NULL,
  su.created_at,
  'payable'
FROM public.suppliers su
WHERE COALESCE(su.opening_balance, 0) <> 0
  AND public._partner_ledger_partner(NULL, su.id) IS NOT NULL

UNION ALL
-- 3. Posted sales invoices (AZN total; the header currency is informational).
SELECT
  s.ledger_partner,
  COALESCE(s.doc_date, public._partner_ledger_day(s.created_at)),
  'sale',
  s.id,
  COALESCE(NULLIF(btrim(s.doc_no), ''), NULLIF(btrim(s.invoice_number), ''), left(s.id::text, 8)),
  'Satış fakturası',
  round(COALESCE(s.total_amount, 0), 2),
  0,
  CASE WHEN upper(COALESCE(NULLIF(btrim(s.currency), ''), 'AZN')) <> 'AZN' AND COALESCE(s.exchange_rate, 0) > 0
       THEN upper(btrim(s.currency)) ELSE 'AZN' END,
  CASE WHEN upper(COALESCE(NULLIF(btrim(s.currency), ''), 'AZN')) <> 'AZN' AND COALESCE(s.exchange_rate, 0) > 0
       THEN round(COALESCE(s.total_amount, 0) / s.exchange_rate, 2) ELSE round(COALESCE(s.total_amount, 0), 2) END,
  CASE WHEN upper(COALESCE(NULLIF(btrim(s.currency), ''), 'AZN')) <> 'AZN' AND COALESCE(s.exchange_rate, 0) > 0
       THEN s.exchange_rate ELSE 1 END,
  s.due_date,
  s.created_by,
  s.created_at,
  'receivable'
FROM sale_docs s
WHERE s.ledger_partner IS NOT NULL
  AND public._partner_ledger_doc_live(s.status)
  AND COALESCE(s.total_amount, 0) <> 0

UNION ALL
-- 4. Posted purchase invoices.
SELECT
  p.ledger_partner,
  COALESCE(p.doc_date, public._partner_ledger_day(p.created_at)),
  'purchase',
  p.id,
  COALESCE(NULLIF(btrim(p.invoice_number), ''), left(p.id::text, 8)),
  'Alış fakturası',
  0,
  round(COALESCE(p.total_amount, 0), 2),
  'AZN',
  round(COALESCE(p.total_amount, 0), 2),
  1,
  p.due_date,
  p.created_by,
  p.created_at,
  'payable'
FROM purchase_docs p
WHERE p.ledger_partner IS NOT NULL
  AND public._partner_ledger_doc_live(p.status)
  AND COALESCE(p.total_amount, 0) <> 0

UNION ALL
-- 5-9, 22. Invoice and production-order payments and their reversals. Money in reduces
-- what the partner owes (credit), money out increases it (debit). Cash counts even on a
-- draft or cancelled invoice: the money moved (a refund comes as its storno row).
SELECT
  COALESCE(sd.ledger_partner, pd.ledger_partner, po.partner_id),
  public._partner_ledger_day(ic.moved_at),
  CASE WHEN ic.kind = 'storno' THEN ic.doc_kind || '_payment_reversal' ELSE ic.doc_kind || '_payment' END,
  ic.id,
  COALESCE(NULLIF(btrim(sd.doc_no), ''), NULLIF(btrim(sd.invoice_number), ''), NULLIF(btrim(pd.invoice_number), ''), po.order_no, left(ic.doc_id::text, 8)),
  COALESCE(NULLIF(btrim(ic.notes), ''), CASE WHEN ic.doc_kind = 'purchase' THEN 'Alış ödənişi' ELSE 'Satış ödənişi' END),
  CASE WHEN ic.type LIKE 'M%daxil' THEN 0 ELSE round(ic.amount, 2) END,
  CASE WHEN ic.type LIKE 'M%daxil' THEN round(ic.amount, 2) ELSE 0 END,
  'AZN',
  round(ic.amount, 2),
  1,
  NULL::date,
  NULL::uuid,
  ic.created_at,
  CASE WHEN ic.doc_kind = 'purchase' THEN 'payable' ELSE 'receivable' END
FROM invoice_cash ic
LEFT JOIN sale_docs sd ON ic.doc_kind = 'sale' AND sd.id = ic.doc_id
LEFT JOIN purchase_docs pd ON ic.doc_kind = 'purchase' AND pd.id = ic.doc_id
LEFT JOIN LATERAL public._partner_ledger_production_order(CASE WHEN ic.doc_kind = 'production' THEN ic.doc_id END) po ON TRUE
WHERE COALESCE(sd.ledger_partner, pd.ledger_partner, po.partner_id) IS NOT NULL
  AND COALESCE(ic.amount, 0) > 0

UNION ALL
-- 10. Partner payments not tied to an invoice. The copies written by import payments and
-- advances (their cash row has an import source) come from the import journal lines
-- below, at the settled amount.
SELECT
  pay.partner_id,
  public._partner_ledger_day(pay.payment_date),
  'partner_payment',
  pay.id,
  NULL,
  COALESCE(NULLIF(btrim(pay.reference_note), ''), CASE WHEN pay.payment_type = 'in' THEN 'Ödəniş qəbul edildi' ELSE 'Ödəniş edildi' END),
  CASE WHEN pay.payment_type = 'out' THEN round(pay.amount, 2) ELSE 0 END,
  CASE WHEN pay.payment_type = 'in' THEN round(pay.amount, 2) ELSE 0 END,
  'AZN',
  round(pay.amount, 2),
  1,
  NULL,
  pay.created_by,
  pay.created_at,
  -- A refund stays on the partner's own side; only a partner who is both goes by direction.
  CASE WHEN pr.is_supplier AND NOT pr.is_customer THEN 'payable'
       WHEN pr.is_customer AND NOT pr.is_supplier THEN 'receivable'
       WHEN pay.payment_type = 'in' THEN 'receivable' ELSE 'payable' END
FROM public.payments pay
LEFT JOIN public.partners pr ON pr.id = pay.partner_id
WHERE NOT EXISTS (
    SELECT 1 FROM public.transactions t
    WHERE t.id = pay.transaction_id AND COALESCE(t.source_type, '') LIKE 'import%'
  )

UNION ALL
-- 11-16. Imports, from their journal lines on 1200 / 2100 (settled amounts and FX
-- corrections are only there). Currency details when the entry belongs to exactly
-- one import payment, prepayment or payable of this partner.
SELECT
  il.partner_id,
  il.entry_date,
  CASE WHEN il.reversal_of IS NOT NULL THEN il.document_type || '_reversal' ELSE il.document_type END,
  il.id,
  sh.number,
  COALESCE(NULLIF(btrim(il.line_memo), ''), 'İdxal'),
  round(il.debit, 2),
  round(il.credit, 2),
  COALESCE(fx.currency_code, 'AZN'),
  COALESCE(fx.amount_fc, round(il.debit + il.credit, 2)),
  COALESCE(fx.rate, 1),
  NULL::date,
  il.created_by,
  il.posted_at,
  'payable'
FROM import_lines il
LEFT JOIN public.import_shipments sh ON sh.id = il.document_id
LEFT JOIN LATERAL (
  -- One row only when exactly one import document matches (else AZN, see the spec).
  SELECT min(x.currency_code) AS currency_code, min(x.amount_fc) AS amount_fc, min(x.rate) AS rate
  FROM (
    SELECT ip.currency_code, ip.amount_fc, ip.payment_rate AS rate
    FROM public.import_payments ip WHERE ip.journal_entry_id = il.source_entry
    UNION ALL
    SELECT pp.currency_code, pp.amount_fc, pp.rate
    FROM public.import_prepayments pp WHERE pp.journal_entry_id = il.source_entry
    UNION ALL
    SELECT py.currency_code, py.amount_fc, py.booking_rate
    FROM public.import_payables py
    WHERE py.journal_entry_id = il.source_entry
      AND public._partner_ledger_partner(NULL, py.partner_id) = il.partner_id
  ) x
  HAVING count(*) = 1
) fx ON TRUE;

COMMENT ON VIEW public.partner_ledger_movements IS
  'LED-1: every money movement of a business partner. debit = the partner owes us more, credit = we owe them more or they paid us; balance = SUM(debit - credit). See docs/ledgers/partner-ledger-spec.md.';

REVOKE ALL ON public.partner_ledger_movements FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.partner_ledger_movements TO service_role;

-- ─── Statement ──────────────────────────────────────────────────────────────

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
  )
  SELECT
    (SELECT bal FROM opening),
    (SELECT round(COALESCE(sum(x.debit), 0), 2) FROM period x),
    (SELECT round(COALESCE(sum(x.credit), 0), 2) FROM period x),
    (SELECT COALESCE(jsonb_agg(jsonb_build_object(
              'entry_date', x.entry_date, 'source_type', x.source_type, 'source_id', x.source_id,
              'doc_no', x.doc_no, 'description', x.description, 'debit', x.debit, 'credit', x.credit,
              'currency_code', x.currency_code, 'amount_fc', x.amount_fc, 'rate', x.rate,
              'due_date', x.due_date, 'side', x.side, 'balance', x.balance
            ) ORDER BY x.n), '[]'::jsonb) FROM period x),
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
      'is_deleted', v_partner.is_deleted, 'payment_terms_days', v_partner.payment_terms_days
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

-- ─── Balances as of a date ──────────────────────────────────────────────────

-- receivable = what the partner owes on the customer side, payable = what we owe on
-- the supplier side (both positive), net = receivable - payable (= SUM(debit - credit)).
CREATE OR REPLACE FUNCTION public.get_partner_balances(p_as_of DATE DEFAULT NULL)
RETURNS TABLE (
  partner_id          UUID,
  partner_name        TEXT,
  is_customer         BOOLEAN,
  is_supplier         BOOLEAN,
  is_deleted          BOOLEAN,
  payment_terms_days  INTEGER,
  receivable          NUMERIC,
  payable             NUMERIC,
  net                 NUMERIC,
  last_payment_date   DATE,
  last_payment_amount NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_as_of DATE := COALESCE(p_as_of, public._partner_ledger_day(NOW()));
BEGIN
  PERFORM public._partner_ledger_authorize();
  RETURN QUERY
  WITH moves AS (
    SELECT m.* FROM public.partner_ledger_movements m WHERE m.entry_date <= v_as_of
  ),
  sums AS (
    SELECT m.partner_id,
           round(sum(CASE WHEN m.side = 'receivable' THEN m.debit - m.credit ELSE 0 END), 2) AS receivable,
           round(sum(CASE WHEN m.side = 'payable' THEN m.credit - m.debit ELSE 0 END), 2) AS payable
    FROM moves m
    GROUP BY m.partner_id
  ),
  last_pay AS (
    SELECT DISTINCT ON (m.partner_id) m.partner_id, m.entry_date, round(m.debit + m.credit, 2) AS amount
    FROM moves m
    WHERE m.source_type IN ('sale_payment', 'purchase_payment', 'production_payment', 'partner_payment', 'import_payment', 'import_prepayment', 'import_cost_advance')
      -- A payment reversed later (storno, or an import entry reversed) does not count.
      AND NOT EXISTS (SELECT 1 FROM public.transactions r WHERE r.reference_type = 'storno' AND r.reference_id = m.source_id)
      AND NOT EXISTS (
        SELECT 1 FROM public.journal_entry_lines l
        JOIN public.journal_entries e ON e.id = l.journal_entry_id
        WHERE l.id = m.source_id AND e.reversed_by IS NOT NULL
      )
    ORDER BY m.partner_id, m.entry_date DESC, m.created_at DESC NULLS LAST
  )
  SELECT s.partner_id, p.name, p.is_customer, p.is_supplier, p.is_deleted, p.payment_terms_days,
         s.receivable, s.payable, round(s.receivable - s.payable, 2),
         lp.entry_date, lp.amount
  FROM sums s
  JOIN public.partners p ON p.id = s.partner_id
  LEFT JOIN last_pay lp ON lp.partner_id = s.partner_id
  WHERE abs(s.receivable) >= 0.005 OR abs(s.payable) >= 0.005
  ORDER BY abs(s.receivable - s.payable) DESC, p.name;
END;
$$;

-- ─── Integrity: ledger vs stored balance vs GL ──────────────────────────────

-- Read-only. One row per partner where any of the three is not zero, plus one row
-- (partner_id NULL) for GL movement on 1200/2100 that names no partner. Expected
-- differences are explained in docs/ledgers/partner-ledger-spec.md.
CREATE OR REPLACE FUNCTION public.check_partner_ledger_integrity()
RETURNS TABLE (
  partner_id     UUID,
  partner_name   TEXT,
  ledger_balance NUMERIC,
  stored_balance NUMERIC,
  gl_balance     NUMERIC,
  delta_stored   NUMERIC,
  delta_gl       NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  PERFORM public._partner_ledger_authorize();
  RETURN QUERY
  WITH ledger AS (
    SELECT m.partner_id, round(sum(m.debit - m.credit), 2) AS bal
    FROM public.partner_ledger_movements m GROUP BY m.partner_id
  ),
  gl AS (
    SELECT l.partner_id, round(sum(l.debit - l.credit), 2) AS bal
    FROM public.journal_entry_lines l
    JOIN public.chart_of_accounts a ON a.id = l.coa_id
    WHERE a.code IN ('1200', '2100')
    GROUP BY l.partner_id
  ),
  rows_ AS (
    SELECT p.id AS partner_id, p.name AS partner_name,
           COALESCE(le.bal, 0) AS ledger_balance,
           CASE WHEN p.id IN (SELECT x.partner_id FROM public.sales x WHERE x.partner_id IS NOT NULL
                              UNION SELECT y.partner_id FROM public.purchases y WHERE y.partner_id IS NOT NULL)
                THEN round(COALESCE(public.compute_partner_net_balance(p.id), 0), 2) ELSE 0 END AS stored_balance,
           COALESCE(g.bal, 0) AS gl_balance
    FROM public.partners p
    LEFT JOIN ledger le ON le.partner_id = p.id
    LEFT JOIN gl g ON g.partner_id = p.id
  )
  SELECT r.partner_id, r.partner_name, r.ledger_balance, r.stored_balance, r.gl_balance,
         round(r.ledger_balance - r.stored_balance, 2), round(r.ledger_balance - r.gl_balance, 2)
  FROM rows_ r
  WHERE abs(r.ledger_balance) >= 0.005 OR abs(r.stored_balance) >= 0.005 OR abs(r.gl_balance) >= 0.005
  UNION ALL
  -- GL lines on 1200 / 2100 whose partner_id is empty or not a partners row (LED-2).
  SELECT NULL::uuid, 'GL 1200/2100 without a partners.id', 0::numeric, 0::numeric,
         round(COALESCE(sum(l.debit - l.credit), 0), 2), 0::numeric, round(-COALESCE(sum(l.debit - l.credit), 0), 2)
  FROM public.journal_entry_lines l
  JOIN public.chart_of_accounts a ON a.id = l.coa_id
  WHERE a.code IN ('1200', '2100')
    AND (l.partner_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.partners p WHERE p.id = l.partner_id))
  HAVING abs(COALESCE(sum(l.debit - l.credit), 0)) >= 0.005;
END;
$$;

-- ─── Grants ────────────────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION public._partner_ledger_doc_live(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._partner_ledger_doc_live(TEXT) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public._partner_ledger_partner(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._partner_ledger_partner(UUID, UUID) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public._partner_ledger_production_order(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._partner_ledger_production_order(UUID) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public._partner_ledger_day(TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._partner_ledger_day(TIMESTAMPTZ) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public._partner_ledger_authorize() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._partner_ledger_authorize() TO service_role;
REVOKE ALL ON FUNCTION public.get_partner_statement(UUID, DATE, DATE, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_partner_statement(UUID, DATE, DATE, TEXT) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_partner_balances(DATE) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_partner_balances(DATE) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.check_partner_ledger_integrity() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_partner_ledger_integrity() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
