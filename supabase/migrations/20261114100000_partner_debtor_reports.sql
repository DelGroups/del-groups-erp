-- ============================================================================
-- LED-4: debtor / creditor reports and turnover per partner, on the LED-1 ledger.
--
-- Read-only. Three functions, all on public.partner_ledger_movements only:
--   * _partner_open_items(as_of, partner)  open items per partner and side as of a date
--     (internal; LED-5 builds get_partner_open_items / aging on it).
--   * get_debtor_creditor_report(as_of, tab, filters, sort, dir, limit, offset)
--     one call per view: the page of rows, the count, the totals and the KPI strip.
--   * get_partner_turnover(from, to, filters, sort, dir, limit, offset)
--     opening, debit, credit, closing per partner (= the statement's numbers), DSO / DPO.
-- Method and formulas: docs/ledgers/partner-ledger-spec.md ("Open items", "Reports").
-- Needs LED-1 (20261111100000) and its view as changed by LED-2 (20261112100000). Safe to re-run.
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('public.partner_ledger_movements') IS NULL THEN
    RAISE EXCEPTION 'Run 20261111100000_partner_ledger.sql (LED-1) before 20261114100000_partner_debtor_reports.sql';
  END IF;
END
$$;

-- ─── Open items ─────────────────────────────────────────────────────────────
--
-- For each partner and side (receivable / payable), as of p_as_of:
--  1. Every movement up to the date gets an item key: the document it belongs to (a sale and
--     its payments and reversals; a purchase and its payments; a production order, its advances
--     and its delivery invoice; an import shipment and all its journal lines), its own opening
--     balance, or the row itself (a partner payment, a refund).
--  2. Amounts are taken in the side's own direction (receivable: debit - credit, payable:
--     credit - debit) and summed per key. A positive key is an open item; payments linked to a
--     document are already netted in it.
--  3. Negative keys (partner payments, advances, overpaid or cancelled invoices) are a credit
--     pool, applied FIFO to the open items by due date, then document date.
--  4. What the pool leaves is one 'advance' row (negative amount), never hidden.
-- Sum of `remaining` per partner and side = the ledger balance of that side on the date.
-- Due date: the document's due_date, else its date + partners.payment_terms_days (0 if empty).
-- An opening balance has no document date: it is dated the day its customer / supplier record
-- was created (the start of that partner in the ERP).
CREATE OR REPLACE FUNCTION public._partner_open_items(p_as_of DATE, p_partner_id UUID DEFAULT NULL)
RETURNS TABLE (
  partner_id     UUID,
  side           TEXT,
  kind           TEXT,      -- 'item' | 'advance'
  item_key       TEXT,
  doc_kind       TEXT,      -- sale | purchase | production | import | opening | payment | NULL
  doc_id         UUID,
  doc_no         TEXT,
  item_date      DATE,
  due_date       DATE,
  amount         NUMERIC,   -- the item's own net amount (charges minus linked payments)
  remaining      NUMERIC,   -- after the FIFO pool; advance rows are negative
  currency_code  TEXT,
  remaining_fc   NUMERIC,   -- in the document currency when it is not AZN
  created_by     UUID,
  salesperson_id UUID
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH moves AS (
    SELECT m.*,
           CASE WHEN m.side = 'receivable' THEN m.debit - m.credit ELSE m.credit - m.debit END AS amt
    FROM public.partner_ledger_movements m
    WHERE m.entry_date <= p_as_of
      AND (p_partner_id IS NULL OR m.partner_id = p_partner_id)
  ),
  keyed AS (
    SELECT x.*,
           CASE
             WHEN x.source_type IN ('sale', 'purchase') AND sd.production_order_id IS NOT NULL THEN 'production'
             WHEN x.source_type IN ('sale', 'purchase') THEN x.source_type
             WHEN x.source_type LIKE 'opening%' THEN 'opening'
             WHEN x.source_type LIKE 'import%' THEN 'import'
             WHEN pay.doc_kind IS NOT NULL THEN pay.doc_kind
             ELSE 'payment'
           END AS k_kind,
           CASE
             WHEN x.source_type = 'sale' AND sd.production_order_id IS NOT NULL THEN sd.production_order_id
             WHEN x.source_type IN ('sale', 'purchase') THEN x.source_id
             WHEN x.source_type LIKE 'import%' THEN imp.document_id
             WHEN pay.doc_kind IS NOT NULL THEN pay.doc_id
             ELSE x.source_id
           END AS k_id,
           sd.salesperson_id AS k_salesperson
    FROM moves x
    LEFT JOIN public.sales sd ON x.source_type = 'sale' AND sd.id = x.source_id
    -- Invoice / production-order payments and their reversals: the document they pay.
    LEFT JOIN LATERAL (
      SELECT CASE WHEN sp.production_order_id IS NOT NULL THEN 'production' ELSE b.doc_kind END AS doc_kind,
             COALESCE(sp.production_order_id, b.doc_id) AS doc_id
      FROM public.transactions t
      JOIN LATERAL (
        SELECT CASE WHEN bb.reference_type IN ('sale', 'purchase') THEN bb.reference_type ELSE bb.source_type END AS doc_kind,
               CASE WHEN bb.reference_type IN ('sale', 'purchase') THEN bb.reference_id ELSE bb.source_id END AS doc_id
        FROM public.transactions bb
        WHERE bb.id = CASE WHEN t.reference_type = 'storno' THEN t.reference_id ELSE t.id END
      ) b ON TRUE
      LEFT JOIN public.sales sp ON b.doc_kind = 'sale' AND sp.id = b.doc_id
      WHERE x.source_type ~ '^(sale|purchase|production)_payment(_reversal)?$' AND t.id = x.source_id
    ) pay ON TRUE
    -- Import journal lines: their shipment.
    LEFT JOIN LATERAL (
      SELECT e.document_id FROM public.journal_entry_lines l JOIN public.journal_entries e ON e.id = l.journal_entry_id
      WHERE x.source_type LIKE 'import%' AND l.id = x.source_id
    ) imp ON TRUE
  ),
  groups AS (
    SELECT k.partner_id, k.side,
           k.k_kind || ':' || COALESCE(k.k_id::text, k.source_type || ':' || k.source_id::text) AS item_key,
           k.k_kind AS doc_kind,
           CASE WHEN k.k_kind IN ('opening', 'payment') THEN NULL ELSE k.k_id END AS doc_id,
           round(sum(k.amt), 2) AS amount,
           -- Charges (rows that raise the side) date and describe the item.
           min(k.doc_no) FILTER (WHERE k.amt > 0) AS doc_no_charge,
           min(k.doc_no) AS doc_no_any,
           min(CASE WHEN k.k_kind = 'opening' THEN public._partner_ledger_day(k.created_at) ELSE k.entry_date END) FILTER (WHERE k.amt > 0) AS date_charge,
           min(CASE WHEN k.k_kind = 'opening' THEN public._partner_ledger_day(k.created_at) ELSE k.entry_date END) AS date_any,
           min(k.due_date) FILTER (WHERE k.amt > 0) AS due_charge,
           min(k.currency_code) FILTER (WHERE k.amt > 0) AS ccy_min,
           max(k.currency_code) FILTER (WHERE k.amt > 0) AS ccy_max,
           sum(k.amt) FILTER (WHERE k.amt > 0) AS charged,
           sum(abs(k.amount_fc)) FILTER (WHERE k.amt > 0) AS charged_fc,
           (array_agg(k.created_by ORDER BY k.entry_date, k.created_at) FILTER (WHERE k.amt > 0 AND k.created_by IS NOT NULL))[1] AS created_by,
           (array_agg(k.k_salesperson) FILTER (WHERE k.k_salesperson IS NOT NULL))[1] AS salesperson_id
    FROM keyed k
    GROUP BY 1, 2, 3, 4, 5
  ),
  items AS (
    SELECT g.*, pa.payment_terms_days,
           COALESCE(g.date_charge, g.date_any) AS item_date,
           COALESCE(g.due_charge, COALESCE(g.date_charge, g.date_any) + COALESCE(pa.payment_terms_days, 0)) AS due_date
    FROM groups g
    JOIN public.partners pa ON pa.id = g.partner_id
    WHERE g.amount > 0.005
  ),
  pool AS (
    SELECT g.partner_id, g.side, round(-sum(g.amount), 2) AS credit
    FROM groups g
    WHERE g.amount < -0.005
    GROUP BY 1, 2
  ),
  fifo AS (
    SELECT i.*,
           COALESCE(p.credit, 0) AS credit,
           sum(i.amount) OVER w - i.amount AS before_
    FROM items i
    LEFT JOIN pool p ON p.partner_id = i.partner_id AND p.side = i.side
    WINDOW w AS (PARTITION BY i.partner_id, i.side ORDER BY i.due_date, i.item_date, i.item_key ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
  )
  SELECT f.partner_id, f.side, 'item', f.item_key, f.doc_kind, f.doc_id,
         COALESCE(f.doc_no_charge, f.doc_no_any), f.item_date, f.due_date, f.amount,
         round(f.amount - LEAST(f.amount, GREATEST(f.credit - f.before_, 0)), 2),
         CASE WHEN f.ccy_min = f.ccy_max THEN f.ccy_min ELSE 'AZN' END,
         CASE WHEN f.ccy_min = f.ccy_max AND f.ccy_min <> 'AZN' AND f.charged > 0
              THEN round((f.amount - LEAST(f.amount, GREATEST(f.credit - f.before_, 0))) * f.charged_fc / f.charged, 2) END,
         f.created_by, f.salesperson_id
  FROM fifo f
  UNION ALL
  -- The credit the open items do not absorb: an advance (negative), shown, never hidden.
  SELECT p.partner_id, p.side, 'advance', 'advance:' || p.side, NULL, NULL, NULL, NULL, NULL,
         -p.credit,
         -round(p.credit - COALESCE((SELECT sum(i.amount) FROM items i WHERE i.partner_id = p.partner_id AND i.side = p.side), 0), 2),
         'AZN', NULL, NULL, NULL
  FROM pool p
  WHERE p.credit - COALESCE((SELECT sum(i.amount) FROM items i WHERE i.partner_id = p.partner_id AND i.side = p.side), 0) > 0.005;
$$;

-- ─── Report rows (shared by the debtor report and turnover filters) ──────────

-- One row per partner with movements up to p_as_of: balances, overdue, oldest overdue,
-- open document count, last payment, and the filter facts. Internal.
CREATE OR REPLACE FUNCTION public._partner_report_facts(p_as_of DATE)
RETURNS TABLE (
  partner_id          UUID,
  partner_name        TEXT,
  phone               TEXT,
  voen                TEXT,
  is_customer         BOOLEAN,
  is_supplier         BOOLEAN,
  is_deleted          BOOLEAN,
  credit_limit        NUMERIC,
  payment_terms_days  INTEGER,
  receivable          NUMERIC,
  payable             NUMERIC,
  net                 NUMERIC,
  overdue_receivable  NUMERIC,
  overdue_payable     NUMERIC,
  oldest_rec_days     INTEGER,
  oldest_pay_days     INTEGER,
  open_rec_count      INTEGER,
  open_pay_count      INTEGER,
  advance_receivable  NUMERIC,
  advance_payable     NUMERIC,
  last_payment_date   DATE,
  last_payment_amount NUMERIC,
  currencies          TEXT[],
  people              UUID[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH moves AS (
    SELECT m.* FROM public.partner_ledger_movements m WHERE m.entry_date <= p_as_of
  ),
  sums AS (
    SELECT m.partner_id,
           round(sum(CASE WHEN m.side = 'receivable' THEN m.debit - m.credit ELSE 0 END), 2) AS receivable,
           round(sum(CASE WHEN m.side = 'payable' THEN m.credit - m.debit ELSE 0 END), 2) AS payable,
           array_agg(DISTINCT m.currency_code) AS currencies
    FROM moves m
    GROUP BY m.partner_id
  ),
  oi AS (SELECT * FROM public._partner_open_items(p_as_of, NULL)),
  open_facts AS (
    SELECT o.partner_id,
           round(COALESCE(sum(o.remaining) FILTER (WHERE o.side = 'receivable' AND o.kind = 'item' AND o.due_date < p_as_of), 0), 2) AS overdue_rec,
           round(COALESCE(sum(o.remaining) FILTER (WHERE o.side = 'payable' AND o.kind = 'item' AND o.due_date < p_as_of), 0), 2) AS overdue_pay,
           max(p_as_of - o.due_date) FILTER (WHERE o.side = 'receivable' AND o.kind = 'item' AND o.due_date < p_as_of AND o.remaining > 0.005) AS oldest_rec,
           max(p_as_of - o.due_date) FILTER (WHERE o.side = 'payable' AND o.kind = 'item' AND o.due_date < p_as_of AND o.remaining > 0.005) AS oldest_pay,
           count(*) FILTER (WHERE o.side = 'receivable' AND o.kind = 'item' AND o.remaining > 0.005 AND o.doc_kind IN ('sale', 'purchase', 'production', 'import'))::int AS open_rec,
           count(*) FILTER (WHERE o.side = 'payable' AND o.kind = 'item' AND o.remaining > 0.005 AND o.doc_kind IN ('sale', 'purchase', 'production', 'import'))::int AS open_pay,
           round(COALESCE(-sum(o.remaining) FILTER (WHERE o.side = 'receivable' AND o.kind = 'advance'), 0), 2) AS adv_rec,
           round(COALESCE(-sum(o.remaining) FILTER (WHERE o.side = 'payable' AND o.kind = 'advance'), 0), 2) AS adv_pay,
           array_remove(array_agg(DISTINCT o.created_by) FILTER (WHERE o.kind = 'item' AND o.remaining > 0.005), NULL)
             || array_remove(array_agg(DISTINCT o.salesperson_id) FILTER (WHERE o.kind = 'item' AND o.remaining > 0.005), NULL) AS people
    FROM oi o
    GROUP BY o.partner_id
  ),
  last_pay AS (
    -- Same rule as get_partner_balances (LED-1): reversed payments do not count.
    SELECT DISTINCT ON (m.partner_id) m.partner_id, m.entry_date, round(m.debit + m.credit, 2) AS amount
    FROM moves m
    WHERE m.source_type IN ('sale_payment', 'purchase_payment', 'production_payment', 'partner_payment', 'import_payment', 'import_prepayment', 'import_cost_advance')
      AND NOT EXISTS (SELECT 1 FROM public.transactions r WHERE r.reference_type = 'storno' AND r.reference_id = m.source_id)
      AND NOT EXISTS (
        SELECT 1 FROM public.journal_entry_lines l
        JOIN public.journal_entries e ON e.id = l.journal_entry_id
        WHERE l.id = m.source_id AND e.reversed_by IS NOT NULL
      )
    ORDER BY m.partner_id, m.entry_date DESC, m.created_at DESC NULLS LAST
  )
  SELECT s.partner_id,
         COALESCE(NULLIF(btrim(p.full_name), ''), NULLIF(btrim(p.company_name), ''), p.name),
         p.phone, p.voen, p.is_customer, p.is_supplier, p.is_deleted, COALESCE(p.credit_limit, 0), p.payment_terms_days,
         s.receivable, s.payable, round(s.receivable - s.payable, 2),
         COALESCE(f.overdue_rec, 0), COALESCE(f.overdue_pay, 0),
         f.oldest_rec, f.oldest_pay,
         COALESCE(f.open_rec, 0), COALESCE(f.open_pay, 0),
         COALESCE(f.adv_rec, 0), COALESCE(f.adv_pay, 0),
         lp.entry_date, lp.amount,
         s.currencies, COALESCE(f.people, '{}')
  FROM sums s
  JOIN public.partners p ON p.id = s.partner_id
  LEFT JOIN open_facts f ON f.partner_id = s.partner_id
  LEFT JOIN last_pay lp ON lp.partner_id = s.partner_id;
$$;

-- Does a facts row pass the report filters? (jsonb: type, min_amount, currency, user_id,
-- overdue_only, over_limit_only, search). `balance`, `overdue` and `used_pct` are the view's.
CREATE OR REPLACE FUNCTION public._partner_report_match(
  p_filters JSONB, p_name TEXT, p_phone TEXT, p_voen TEXT, p_is_customer BOOLEAN, p_is_supplier BOOLEAN,
  p_balance NUMERIC, p_overdue NUMERIC, p_used_pct NUMERIC, p_currencies TEXT[], p_people UUID[]
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT
    (CASE COALESCE(p_filters ->> 'type', 'all')
       WHEN 'customer' THEN p_is_customer
       WHEN 'supplier' THEN p_is_supplier
       WHEN 'partner' THEN p_is_customer AND p_is_supplier
       ELSE TRUE END)
    AND (NULLIF(p_filters ->> 'min_amount', '') IS NULL OR abs(p_balance) >= (p_filters ->> 'min_amount')::numeric)
    AND (NULLIF(p_filters ->> 'currency', '') IS NULL OR upper(p_filters ->> 'currency') = ANY (p_currencies))
    AND (NULLIF(p_filters ->> 'user_id', '') IS NULL OR (p_filters ->> 'user_id')::uuid = ANY (p_people))
    AND (NOT COALESCE((p_filters ->> 'overdue_only')::boolean, FALSE) OR p_overdue > 0.005)
    AND (NOT COALESCE((p_filters ->> 'over_limit_only')::boolean, FALSE) OR COALESCE(p_used_pct, 0) > 100)
    AND (NULLIF(btrim(p_filters ->> 'search'), '') IS NULL
         OR concat_ws(' ', p_name, p_phone, p_voen) ILIKE '%' || replace(replace(replace(btrim(p_filters ->> 'search'), '\', '\\'), '%', '\%'), '_', '\_') || '%'
         OR regexp_replace(COALESCE(p_phone, ''), '\D', '', 'g') LIKE '%' || NULLIF(regexp_replace(p_filters ->> 'search', '\D', '', 'g'), '') || '%');
$$;

-- ─── Debtors / creditors / net ──────────────────────────────────────────────

-- tab 'debtors': receivable > 0; 'creditors': payable > 0; 'net': any non-zero net balance.
-- balance, overdue, oldest overdue, open documents and credit use are those of the tab's side
-- (net: receivable minus payable; oldest of both; documents of both). Sort keys: name, balance,
-- overdue, oldest_days, open_count, used_pct, last_payment_date, terms. KPIs are over every
-- partner the filters keep (all tabs): totals, net, % overdue and the ten biggest debtors.
CREATE OR REPLACE FUNCTION public.get_debtor_creditor_report(
  p_as_of   DATE    DEFAULT NULL,
  p_tab     TEXT    DEFAULT 'debtors',
  p_filters JSONB   DEFAULT '{}'::jsonb,
  p_sort    TEXT    DEFAULT 'balance',
  p_dir     TEXT    DEFAULT 'desc',
  p_limit   INTEGER DEFAULT 50,
  p_offset  INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_as_of  DATE := COALESCE(p_as_of, public._partner_ledger_day(NOW()));
  v_tab    TEXT := lower(btrim(COALESCE(p_tab, 'debtors')));
  v_sort   TEXT := lower(btrim(COALESCE(p_sort, 'balance')));
  v_desc   BOOLEAN := lower(btrim(COALESCE(p_dir, 'desc'))) <> 'asc';
  v_limit  INTEGER := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 10000);
  v_offset INTEGER := GREATEST(COALESCE(p_offset, 0), 0);
  v_f      JSONB := COALESCE(p_filters, '{}'::jsonb);
  v_result JSONB;
BEGIN
  PERFORM public._partner_ledger_authorize();
  IF v_tab NOT IN ('debtors', 'creditors', 'net') THEN
    RAISE EXCEPTION '%', 'p_tab must be debtors, creditors or net' USING ERRCODE = '22023';
  END IF;
  IF v_sort NOT IN ('name', 'balance', 'overdue', 'oldest_days', 'open_count', 'used_pct', 'last_payment_date', 'terms') THEN
    RAISE EXCEPTION '%', 'unknown sort key' USING ERRCODE = '22023';
  END IF;

  WITH facts AS MATERIALIZED (SELECT * FROM public._partner_report_facts(v_as_of)),
  shaped AS (
    SELECT f.*,
           CASE v_tab WHEN 'debtors' THEN f.receivable WHEN 'creditors' THEN f.payable ELSE f.net END AS balance,
           CASE v_tab WHEN 'debtors' THEN f.overdue_receivable WHEN 'creditors' THEN f.overdue_payable
                ELSE round(f.overdue_receivable - f.overdue_payable, 2) END AS overdue,
           CASE v_tab WHEN 'debtors' THEN f.oldest_rec_days WHEN 'creditors' THEN f.oldest_pay_days
                ELSE GREATEST(f.oldest_rec_days, f.oldest_pay_days) END AS oldest_days,
           CASE v_tab WHEN 'debtors' THEN f.open_rec_count WHEN 'creditors' THEN f.open_pay_count
                ELSE f.open_rec_count + f.open_pay_count END AS open_count,
           CASE WHEN f.credit_limit > 0 THEN round(100 * (CASE v_tab WHEN 'creditors' THEN f.payable ELSE f.receivable END) / f.credit_limit, 1) END AS used_pct
    FROM facts f
  ),
  -- The filters, without the tab (for the KPI strip) …
  kept AS (
    SELECT s.* FROM shaped s
    WHERE public._partner_report_match(v_f, s.partner_name, s.phone, s.voen, s.is_customer, s.is_supplier,
                                       s.balance, s.overdue, s.used_pct, s.currencies, s.people)
  ),
  -- … and with it (the rows).
  tabbed AS (
    SELECT k.* FROM kept k
    WHERE CASE v_tab WHEN 'debtors' THEN k.receivable > 0.005
                     WHEN 'creditors' THEN k.payable > 0.005
                     ELSE abs(k.net) >= 0.005 END
  ),
  ordered AS (
    SELECT t.*,
           row_number() OVER (ORDER BY
             CASE WHEN NOT v_desc THEN
               CASE v_sort WHEN 'balance' THEN t.balance WHEN 'overdue' THEN t.overdue WHEN 'oldest_days' THEN t.oldest_days
                           WHEN 'open_count' THEN t.open_count WHEN 'used_pct' THEN t.used_pct WHEN 'terms' THEN t.payment_terms_days END END ASC NULLS LAST,
             CASE WHEN v_desc THEN
               CASE v_sort WHEN 'balance' THEN t.balance WHEN 'overdue' THEN t.overdue WHEN 'oldest_days' THEN t.oldest_days
                           WHEN 'open_count' THEN t.open_count WHEN 'used_pct' THEN t.used_pct WHEN 'terms' THEN t.payment_terms_days END END DESC NULLS LAST,
             CASE WHEN v_sort = 'last_payment_date' AND NOT v_desc THEN t.last_payment_date END ASC NULLS LAST,
             CASE WHEN v_sort = 'last_payment_date' AND v_desc THEN t.last_payment_date END DESC NULLS LAST,
             CASE WHEN v_sort = 'name' AND NOT v_desc THEN lower(t.partner_name) END ASC,
             CASE WHEN v_sort = 'name' AND v_desc THEN lower(t.partner_name) END DESC,
             lower(t.partner_name), t.partner_id) AS n
    FROM tabbed t
  )
  SELECT jsonb_build_object(
    'as_of', v_as_of,
    'tab', v_tab,
    'total_count', (SELECT count(*) FROM tabbed),
    'rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'partner_id', o.partner_id, 'partner_name', o.partner_name, 'phone', o.phone, 'voen', o.voen,
               'is_customer', o.is_customer, 'is_supplier', o.is_supplier, 'is_deleted', o.is_deleted,
               'balance', o.balance, 'receivable', o.receivable, 'payable', o.payable,
               'overdue', o.overdue, 'oldest_overdue_days', o.oldest_days, 'open_count', o.open_count,
               'advance', CASE v_tab WHEN 'debtors' THEN o.advance_receivable WHEN 'creditors' THEN o.advance_payable
                                     ELSE round(o.advance_receivable - o.advance_payable, 2) END,
               'credit_limit', o.credit_limit, 'credit_used_pct', o.used_pct,
               'last_payment_date', o.last_payment_date, 'last_payment_amount', o.last_payment_amount,
               'payment_terms_days', o.payment_terms_days
             ) ORDER BY o.n)
      FROM ordered o WHERE o.n > v_offset AND o.n <= v_offset + v_limit), '[]'::jsonb),
    'totals', jsonb_build_object(
      'balance', (SELECT round(COALESCE(sum(t.balance), 0), 2) FROM tabbed t),
      'overdue', (SELECT round(COALESCE(sum(t.overdue), 0), 2) FROM tabbed t),
      'open_count', (SELECT COALESCE(sum(t.open_count), 0) FROM tabbed t)
    ),
    'kpi', jsonb_build_object(
      'total_receivable', (SELECT round(COALESCE(sum(GREATEST(k.receivable, 0)), 0), 2) FROM kept k),
      'total_payable', (SELECT round(COALESCE(sum(GREATEST(k.payable, 0)), 0), 2) FROM kept k),
      'net', (SELECT round(COALESCE(sum(k.net), 0), 2) FROM kept k),
      'overdue_receivable', (SELECT round(COALESCE(sum(k.overdue_receivable), 0), 2) FROM kept k),
      'top_debtors', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('partner_id', d.partner_id, 'partner_name', d.partner_name, 'balance', d.receivable) ORDER BY d.receivable DESC, d.partner_name)
        FROM (SELECT k.* FROM kept k WHERE k.receivable > 0.005 ORDER BY k.receivable DESC, k.partner_name LIMIT 10) d), '[]'::jsonb)
    )
  ) INTO v_result;
  RETURN v_result;
END;
$$;

-- ─── Turnover per partner, DSO / DPO ────────────────────────────────────────

-- Per partner for [p_from, p_to] (net side, as the statement shows it): opening balance,
-- debit and credit turnover, closing balance. These equal get_partner_statement(p, p_from,
-- p_to, 'net') for every partner. Filters as the debtor report, evaluated on the closing date
-- (balance = closing; overdue and credit use as of p_to).
-- DSO = average receivable / credit sales × days in the period, where
--   average receivable = (receivable at the start + receivable at the end) / 2 and
--   credit sales = sales invoices (and production delivery invoices) of the period.
-- DPO = average payable / purchases × days, purchases = purchase invoices and import
--   payables (goods and costs) of the period. No sales (purchases) in the period: no DSO (DPO).
CREATE OR REPLACE FUNCTION public.get_partner_turnover(
  p_from    DATE,
  p_to      DATE,
  p_filters JSONB   DEFAULT '{}'::jsonb,
  p_sort    TEXT    DEFAULT 'name',
  p_dir     TEXT    DEFAULT 'asc',
  p_limit   INTEGER DEFAULT 50,
  p_offset  INTEGER DEFAULT 0
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_to     DATE := COALESCE(p_to, public._partner_ledger_day(NOW()));
  v_from   DATE := p_from;
  v_sort   TEXT := lower(btrim(COALESCE(p_sort, 'name')));
  v_desc   BOOLEAN := lower(btrim(COALESCE(p_dir, 'asc'))) = 'desc';
  v_limit  INTEGER := LEAST(GREATEST(COALESCE(p_limit, 50), 1), 10000);
  v_offset INTEGER := GREATEST(COALESCE(p_offset, 0), 0);
  v_f      JSONB := COALESCE(p_filters, '{}'::jsonb);
  v_days   INTEGER;
  v_result JSONB;
BEGIN
  PERFORM public._partner_ledger_authorize();
  IF v_from IS NULL OR v_from > v_to THEN
    RAISE EXCEPTION '%', 'p_from is empty or after p_to' USING ERRCODE = '22023';
  END IF;
  IF v_sort NOT IN ('name', 'opening', 'debit', 'credit', 'closing', 'dso', 'dpo') THEN
    RAISE EXCEPTION '%', 'unknown sort key' USING ERRCODE = '22023';
  END IF;
  v_days := v_to - v_from + 1;

  WITH moves AS (
    SELECT m.* FROM public.partner_ledger_movements m WHERE m.entry_date <= v_to
  ),
  per AS (
    SELECT m.partner_id,
           round(COALESCE(sum(m.debit - m.credit) FILTER (WHERE m.entry_date < v_from), 0), 2) AS opening,
           round(COALESCE(sum(m.debit) FILTER (WHERE m.entry_date >= v_from), 0), 2) AS debit,
           round(COALESCE(sum(m.credit) FILTER (WHERE m.entry_date >= v_from), 0), 2) AS credit,
           round(COALESCE(sum(m.debit - m.credit) FILTER (WHERE m.side = 'receivable' AND m.entry_date < v_from), 0), 2) AS rec_open,
           round(COALESCE(sum(m.debit - m.credit) FILTER (WHERE m.side = 'receivable'), 0), 2) AS rec_close,
           round(COALESCE(sum(m.credit - m.debit) FILTER (WHERE m.side = 'payable' AND m.entry_date < v_from), 0), 2) AS pay_open,
           round(COALESCE(sum(m.credit - m.debit) FILTER (WHERE m.side = 'payable'), 0), 2) AS pay_close,
           round(COALESCE(sum(m.debit) FILTER (WHERE m.entry_date >= v_from AND m.side = 'receivable' AND m.source_type = 'sale'), 0), 2) AS sales,
           round(COALESCE(sum(m.credit) FILTER (WHERE m.entry_date >= v_from AND m.side = 'payable'
                 AND (m.source_type = 'purchase' OR (m.source_type LIKE 'import%' AND m.source_type !~ '(payment|prepayment|advance|reversal)'))), 0), 2) AS purchases
    FROM moves m
    GROUP BY m.partner_id
  ),
  facts AS MATERIALIZED (SELECT * FROM public._partner_report_facts(v_to)),
  rows_ AS (
    SELECT p.*, f.partner_name, f.phone, f.voen, f.is_customer, f.is_supplier, f.is_deleted,
           round(p.opening + p.debit - p.credit, 2) AS closing,
           CASE WHEN p.sales > 0 THEN round(((p.rec_open + p.rec_close) / 2) / p.sales * v_days, 1) END AS dso,
           CASE WHEN p.purchases > 0 THEN round(((p.pay_open + p.pay_close) / 2) / p.purchases * v_days, 1) END AS dpo,
           f.overdue_receivable, f.overdue_payable, f.receivable, f.payable, f.credit_limit, f.currencies, f.people
    FROM per p
    JOIN facts f ON f.partner_id = p.partner_id
    WHERE abs(p.opening) >= 0.005 OR p.debit >= 0.005 OR p.credit >= 0.005
  ),
  kept AS (
    SELECT r.* FROM rows_ r
    WHERE public._partner_report_match(v_f, r.partner_name, r.phone, r.voen, r.is_customer, r.is_supplier,
            r.closing, round(r.overdue_receivable - r.overdue_payable, 2),
            CASE WHEN r.credit_limit > 0 THEN round(100 * r.receivable / r.credit_limit, 1) END,
            r.currencies, r.people)
      -- "Only overdue" counts either side here.
      AND (NOT COALESCE((v_f ->> 'overdue_only')::boolean, FALSE) OR r.overdue_receivable > 0.005 OR r.overdue_payable > 0.005)
  ),
  ordered AS (
    SELECT k.*,
           row_number() OVER (ORDER BY
             CASE WHEN NOT v_desc THEN
               CASE v_sort WHEN 'opening' THEN k.opening WHEN 'debit' THEN k.debit WHEN 'credit' THEN k.credit
                           WHEN 'closing' THEN k.closing WHEN 'dso' THEN k.dso WHEN 'dpo' THEN k.dpo END END ASC NULLS LAST,
             CASE WHEN v_desc THEN
               CASE v_sort WHEN 'opening' THEN k.opening WHEN 'debit' THEN k.debit WHEN 'credit' THEN k.credit
                           WHEN 'closing' THEN k.closing WHEN 'dso' THEN k.dso WHEN 'dpo' THEN k.dpo END END DESC NULLS LAST,
             CASE WHEN v_sort = 'name' AND NOT v_desc THEN lower(k.partner_name) END ASC,
             CASE WHEN v_sort = 'name' AND v_desc THEN lower(k.partner_name) END DESC,
             lower(k.partner_name), k.partner_id) AS n
    FROM kept k
  )
  SELECT jsonb_build_object(
    'from', v_from, 'to', v_to, 'days', v_days,
    'total_count', (SELECT count(*) FROM kept),
    'rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'partner_id', o.partner_id, 'partner_name', o.partner_name, 'phone', o.phone, 'voen', o.voen,
               'is_customer', o.is_customer, 'is_supplier', o.is_supplier, 'is_deleted', o.is_deleted,
               'opening', o.opening, 'debit', o.debit, 'credit', o.credit, 'closing', o.closing,
               'sales', o.sales, 'purchases', o.purchases, 'dso', o.dso, 'dpo', o.dpo
             ) ORDER BY o.n)
      FROM ordered o WHERE o.n > v_offset AND o.n <= v_offset + v_limit), '[]'::jsonb),
    'totals', (
      SELECT jsonb_build_object(
        'opening', round(COALESCE(sum(k.opening), 0), 2),
        'debit', round(COALESCE(sum(k.debit), 0), 2),
        'credit', round(COALESCE(sum(k.credit), 0), 2),
        'closing', round(COALESCE(sum(k.closing), 0), 2),
        'sales', round(COALESCE(sum(k.sales), 0), 2),
        'purchases', round(COALESCE(sum(k.purchases), 0), 2),
        'receivable_start', round(COALESCE(sum(k.rec_open), 0), 2),
        'receivable_end', round(COALESCE(sum(k.rec_close), 0), 2),
        'payable_start', round(COALESCE(sum(k.pay_open), 0), 2),
        'payable_end', round(COALESCE(sum(k.pay_close), 0), 2),
        'dso', CASE WHEN sum(k.sales) > 0 THEN round(((sum(k.rec_open) + sum(k.rec_close)) / 2) / sum(k.sales) * v_days, 1) END,
        'dpo', CASE WHEN sum(k.purchases) > 0 THEN round(((sum(k.pay_open) + sum(k.pay_close)) / 2) / sum(k.purchases) * v_days, 1) END
      ) FROM kept k)
  ) INTO v_result;
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public._partner_open_items(DATE, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._partner_open_items(DATE, UUID) TO service_role;
REVOKE ALL ON FUNCTION public._partner_report_facts(DATE) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._partner_report_facts(DATE) TO service_role;
REVOKE ALL ON FUNCTION public._partner_report_match(JSONB, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, NUMERIC, NUMERIC, NUMERIC, TEXT[], UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._partner_report_match(JSONB, TEXT, TEXT, TEXT, BOOLEAN, BOOLEAN, NUMERIC, NUMERIC, NUMERIC, TEXT[], UUID[]) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_debtor_creditor_report(DATE, TEXT, JSONB, TEXT, TEXT, INTEGER, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_debtor_creditor_report(DATE, TEXT, JSONB, TEXT, TEXT, INTEGER, INTEGER) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.get_partner_turnover(DATE, DATE, JSONB, TEXT, TEXT, INTEGER, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_partner_turnover(DATE, DATE, JSONB, TEXT, TEXT, INTEGER, INTEGER) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
