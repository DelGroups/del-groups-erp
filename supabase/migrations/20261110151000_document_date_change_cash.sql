-- ============================================================================
-- DATE-2: change the date of cash documents in place (engine of DATE-1, 20261110150000).
--
-- New document types of preview_document_date_change / apply_document_date_change:
--
--   invoice_payment   a payment booked on a sales or purchase invoice (the three-dot menu,
--                     process_invoice_payment_event, or inside the invoice form): its cash
--                     row(s) (a split payment's legs share one journal and move together), the
--                     journal, and the invoice's payments JSON entry. Document id: a cash row.
--                     R7: not before the invoice date.
--   partner_payment   a customer / supplier payment (create_partner_payment): its payments
--                     row(s) (split lines share one journal), payment_date, the cash rows and
--                     the journal. Document id: payments.id.
--   cash_transaction  a manual cash row (create_manual_expense_transaction, or any cash row that
--                     belongs to no document) and its journal. Document id: the cash row.
--   expense           an expense document (expenses: company-paid with the VAT split rows, or
--                     employee-paid): expense_date, the cash rows and journals of that day. The
--                     reimbursement of an employee-paid expense is its payment: it stays on its
--                     day (R7: not before the expense) unless move_same_day_payments moves a
--                     reimbursement made on the old day along.
--
-- Every type: R1 admins only, R2 closed periods (old and new), R6 cash per account on every
-- account touched (the rule of post_cash_transaction / expense_cash_out / _post_payment_lines:
-- spending is refused below zero), W2 another month (warning other_month).
-- Transfers between accounts are not covered: no function writes them and nothing pairs two
-- cash rows as one transfer.
--
-- resolve_date_change_document(transaction_id) tells the cash ledger which document a cash row
-- belongs to. Needs 20261110150000. No data changes. Safe to re-run.
-- ============================================================================

DO $$
BEGIN
  IF to_regprocedure('public._date_change_rows(text, uuid, date, jsonb)') IS NULL THEN
    RAISE EXCEPTION 'Run 20261110150000_document_date_change_core.sql (DATE-1) before 20261110151000_document_date_change_cash.sql';
  END IF;
END
$$;

-- ─── 1. Header, lock and chatter target of every document type ──────────────

CREATE OR REPLACE FUNCTION public._date_change_header(p_document_type TEXT, p_document_id UUID)
RETURNS TABLE (label TEXT, doc_date DATE, status TEXT, posted BOOLEAN)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_document_type = 'sale' THEN
    RETURN QUERY
      SELECT COALESCE(NULLIF(btrim(s.doc_no), ''), s.id::text), s.doc_date, s.status,
             lower(COALESCE(s.status, '')) NOT IN ('draft', 'cancelled', 'void', 'voided') AND COALESCE(s.status, '') NOT ILIKE 'ləğv%'
      FROM public.sales s WHERE s.id = p_document_id;
  ELSIF p_document_type = 'purchase' THEN
    RETURN QUERY
      SELECT COALESCE(NULLIF(btrim(p.invoice_number), ''), p.id::text),
             COALESCE(p.doc_date, public._baku_day(p.created_at)), p.status,
             lower(COALESCE(p.status, '')) NOT IN ('draft', 'cancelled', 'void', 'voided') AND COALESCE(p.status, '') NOT ILIKE 'ləğv%'
      FROM public.purchases p WHERE p.id = p_document_id;
  ELSIF p_document_type = 'invoice_payment' THEN
    RETURN QUERY
      SELECT format('%s · %s AZN',
               COALESCE((SELECT NULLIF(btrim(s.doc_no), '') FROM public.sales s WHERE t.source_type = 'sale' AND s.id = t.source_id),
                        (SELECT NULLIF(btrim(p.invoice_number), '') FROM public.purchases p WHERE t.source_type = 'purchase' AND p.id = t.source_id),
                        t.source_id::text),
               trim(to_char(t.amount, 'FM999999990.00'))),
             public._baku_day(COALESCE(t.transaction_date, t.created_at)), 'posted'::text,
             t.source_type IN ('sale', 'purchase') AND t.category IN ('Satış Ödənişi', 'Alış Ödənişi') AND NOT public._is_storno_pair(t)
      FROM public.transactions t WHERE t.id = p_document_id;
  ELSIF p_document_type = 'partner_payment' THEN
    RETURN QUERY
      SELECT format('%s · %s AZN', COALESCE(NULLIF(btrim(pa.name), ''), py.id::text), trim(to_char(py.amount, 'FM999999990.00'))),
             public._baku_day(py.payment_date), 'posted'::text,
             EXISTS (SELECT 1 FROM public.transactions t
                     WHERE t.source_type = 'partner_payment' AND t.source_id = py.id AND NOT public._is_storno_pair(t))
      FROM public.payments py LEFT JOIN public.partners pa ON pa.id = py.partner_id
      WHERE py.id = p_document_id;
  ELSIF p_document_type = 'cash_transaction' THEN
    RETURN QUERY
      SELECT COALESCE(NULLIF(btrim(t.description), ''), NULLIF(btrim(t.notes), ''), t.category, t.id::text),
             public._baku_day(COALESCE(t.transaction_date, t.created_at)), 'posted'::text,
             (t.source_id IS NULL AND COALESCE(t.reference_type, 'manual_expense') = 'manual_expense') AND NOT public._is_storno_pair(t)
      FROM public.transactions t WHERE t.id = p_document_id;
  ELSIF p_document_type = 'expense' THEN
    IF to_regclass('public.expenses') IS NOT NULL THEN
      RETURN QUERY EXECUTE
        'SELECT COALESCE(NULLIF(btrim(e.code), ''''), e.id::text), e.expense_date, e.status, e.status IN (''posted'', ''approved'')
         FROM public.expenses e WHERE e.id = $1'
      USING p_document_id;
    END IF;
  END IF;
END;
$$;

-- Locks the document's header row; false when it does not exist.
CREATE OR REPLACE FUNCTION public._date_change_lock(p_document_type TEXT, p_document_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n INTEGER;
BEGIN
  IF p_document_type = 'sale' THEN
    PERFORM 1 FROM public.sales WHERE id = p_document_id FOR UPDATE;
  ELSIF p_document_type = 'purchase' THEN
    PERFORM 1 FROM public.purchases WHERE id = p_document_id FOR UPDATE;
  ELSIF p_document_type IN ('invoice_payment', 'cash_transaction') THEN
    PERFORM 1 FROM public.transactions WHERE id = p_document_id FOR UPDATE;
  ELSIF p_document_type = 'partner_payment' THEN
    PERFORM 1 FROM public.payments WHERE id = p_document_id FOR UPDATE;
  ELSIF p_document_type = 'expense' AND to_regclass('public.expenses') IS NOT NULL THEN
    EXECUTE 'SELECT 1 FROM public.expenses WHERE id = $1 FOR UPDATE' USING p_document_id;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n > 0;
  ELSE
    RETURN false;
  END IF;
  RETURN FOUND;
END;
$$;

-- Where the change is written in the chatter (a payment: on its invoice), and the erp_events
-- source table.
CREATE OR REPLACE FUNCTION public._date_change_chatter_target(p_document_type TEXT, p_document_id UUID)
RETURNS TABLE (res_model TEXT, res_id UUID)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE p_document_type
           WHEN 'sale' THEN 'sales' WHEN 'purchase' THEN 'purchases' WHEN 'expense' THEN 'expenses'
           WHEN 'partner_payment' THEN 'payments' WHEN 'cash_transaction' THEN 'transactions'
           WHEN 'invoice_payment' THEN (SELECT CASE t.source_type WHEN 'sale' THEN 'sales' ELSE 'purchases' END
                                        FROM public.transactions t WHERE t.id = p_document_id)
         END,
         CASE WHEN p_document_type = 'invoice_payment'
              THEN (SELECT t.source_id FROM public.transactions t WHERE t.id = p_document_id)
              ELSE p_document_id END;
$$;

-- ─── 2. The rows each document created (the handler registry) ────────────────

CREATE OR REPLACE FUNCTION public._date_change_rows(
  p_document_type TEXT, p_document_id UUID, p_new_date DATE, p_options JSONB DEFAULT '{}'::jsonb
)
RETURNS TABLE (tbl TEXT, row_id UUID, col TEXT, old_ts TIMESTAMPTZ, new_ts TIMESTAMPTZ, grp TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old        DATE;
  v_src        TEXT := p_document_type;
  v_pay_cat    TEXT := CASE WHEN p_document_type = 'sale' THEN 'Satış Ödənişi' ELSE 'Alış Ödənişi' END;
  v_move_pays  BOOLEAN := COALESCE((p_options->>'move_same_day_payments')::boolean, false);
  v_tx         public.transactions%ROWTYPE;
  v_pay        public.payments%ROWTYPE;
  v_reimb      UUID;
BEGIN
  SELECT h.doc_date INTO v_old FROM public._date_change_header(p_document_type, p_document_id) h;
  IF v_old IS NULL THEN
    RETURN;
  END IF;

  IF p_document_type IN ('sale', 'purchase') THEN
    RETURN QUERY
    -- Invoice and COGS journals.
    SELECT 'journal_entries', je.id, 'date', COALESCE(je.date, je.entry_date::timestamptz),
           public._date_change_ts(COALESCE(je.date, je.entry_date::timestamptz), p_new_date), 'invoice'
    FROM public.journal_entries je
    WHERE COALESCE(je.document_id, je.source_id) = p_document_id
      AND COALESCE(je.source_type, '') <> 'cash_transaction'
      AND je.reversal_of IS NULL AND je.reversed_by IS NULL
      AND (je.entry_date = v_old OR public._baku_day(je.date) = v_old)
    UNION ALL
    SELECT 'transactions', t.id, 'transaction_date', COALESCE(t.transaction_date, t.created_at),
           public._date_change_ts(COALESCE(t.transaction_date, t.created_at), p_new_date),
           CASE WHEN t.category = v_pay_cat THEN 'payment' ELSE 'cash' END
    FROM public.transactions t
    WHERE public._is_document_cash_row(t, v_src, p_document_id)
      AND public._baku_day(COALESCE(t.transaction_date, t.created_at)) = v_old
      AND (t.category IS DISTINCT FROM v_pay_cat OR v_move_pays)
    UNION ALL
    SELECT DISTINCT 'journal_entries', je.id, 'date', COALESCE(je.date, je.entry_date::timestamptz),
           public._date_change_ts(COALESCE(je.date, je.entry_date::timestamptz), p_new_date),
           CASE WHEN t.category = v_pay_cat THEN 'payment' ELSE 'cash' END
    FROM public.transactions t
    JOIN public.journal_entries je ON je.id = t.journal_entry_id
    WHERE public._is_document_cash_row(t, v_src, p_document_id)
      AND public._baku_day(COALESCE(t.transaction_date, t.created_at)) = v_old
      AND (t.category IS DISTINCT FROM v_pay_cat OR v_move_pays)
      AND je.reversal_of IS NULL AND je.reversed_by IS NULL
    UNION ALL
    SELECT 'stock_movements', sm.id, 'created_at', sm.created_at, public._date_change_ts(sm.created_at, p_new_date), 'invoice'
    FROM public.stock_movements sm
    WHERE sm.reference_id = p_document_id
      AND sm.reference_type IN (v_src, v_src || '_void')
      AND public._baku_day(sm.created_at) = v_old
    UNION ALL
    SELECT 'inventory_batches', b.id, 'created_at', b.created_at, public._date_change_ts(b.created_at, p_new_date), 'invoice'
    FROM public.inventory_batches b
    WHERE b.document_id = p_document_id
      AND public._baku_day(b.created_at) = v_old
    UNION ALL
    SELECT 'inventory_batch_consumptions', c.id, 'created_at', c.created_at, public._date_change_ts(c.created_at, p_new_date), 'invoice'
    FROM public.inventory_batch_consumptions c
    WHERE p_document_type = 'sale' AND c.sale_id = p_document_id
      AND public._baku_day(c.created_at) = v_old;

  ELSIF p_document_type IN ('invoice_payment', 'cash_transaction') THEN
    -- The cash row and, for a split payment, the other legs that share its journal.
    SELECT * INTO v_tx FROM public.transactions WHERE id = p_document_id;
    RETURN QUERY
    WITH legs AS (
      SELECT t.* FROM public.transactions t
      WHERE (t.id = v_tx.id
             OR (p_document_type = 'invoice_payment' AND v_tx.journal_entry_id IS NOT NULL
                 AND t.journal_entry_id = v_tx.journal_entry_id
                 AND t.source_type = v_tx.source_type AND t.source_id = v_tx.source_id))
        AND NOT public._is_storno_pair(t)
        AND public._baku_day(COALESCE(t.transaction_date, t.created_at)) = v_old
    )
    SELECT 'transactions', l.id, 'transaction_date', COALESCE(l.transaction_date, l.created_at),
           public._date_change_ts(COALESCE(l.transaction_date, l.created_at), p_new_date), 'payment'
    FROM legs l
    UNION ALL
    SELECT DISTINCT 'journal_entries', je.id, 'date', COALESCE(je.date, je.entry_date::timestamptz),
           public._date_change_ts(COALESCE(je.date, je.entry_date::timestamptz), p_new_date), 'payment'
    FROM legs l JOIN public.journal_entries je ON je.id = l.journal_entry_id
    WHERE je.reversal_of IS NULL AND je.reversed_by IS NULL;

  ELSIF p_document_type = 'partner_payment' THEN
    -- The payments rows of one payment (split lines share one journal), their cash rows, the journal.
    SELECT * INTO v_pay FROM public.payments WHERE id = p_document_id;
    RETURN QUERY
    WITH pays AS (
      SELECT py.* FROM public.payments py
      WHERE py.id = v_pay.id OR (v_pay.journal_entry_id IS NOT NULL AND py.journal_entry_id = v_pay.journal_entry_id)
    )
    SELECT 'payments', py.id, 'payment_date', py.payment_date, public._date_change_ts(py.payment_date, p_new_date), 'payment'
    FROM pays py
    UNION ALL
    SELECT 'transactions', t.id, 'transaction_date', COALESCE(t.transaction_date, t.created_at),
           public._date_change_ts(COALESCE(t.transaction_date, t.created_at), p_new_date), 'payment'
    FROM public.transactions t
    WHERE t.source_type = 'partner_payment' AND t.source_id IN (SELECT id FROM pays)
      AND NOT public._is_storno_pair(t)
    UNION ALL
    SELECT DISTINCT 'journal_entries', je.id, 'date', COALESCE(je.date, je.entry_date::timestamptz),
           public._date_change_ts(COALESCE(je.date, je.entry_date::timestamptz), p_new_date), 'payment'
    FROM public.journal_entries je
    WHERE je.id IN (SELECT journal_entry_id FROM pays)
      AND je.reversal_of IS NULL AND je.reversed_by IS NULL;

  ELSIF p_document_type = 'expense' AND to_regclass('public.expenses') IS NOT NULL THEN
    EXECUTE 'SELECT reimbursement_journal_id FROM public.expenses WHERE id = $1' INTO v_reimb USING p_document_id;
    RETURN QUERY
    -- Journals of the expense on its day (accrual / payment); the reimbursement is its payment.
    SELECT 'journal_entries', je.id, 'date', COALESCE(je.date, je.entry_date::timestamptz),
           public._date_change_ts(COALESCE(je.date, je.entry_date::timestamptz), p_new_date),
           CASE WHEN je.id = v_reimb THEN 'payment' ELSE 'cash' END
    FROM public.journal_entries je
    WHERE je.source_type = 'expense' AND je.source_id = p_document_id
      AND je.reversal_of IS NULL AND je.reversed_by IS NULL
      AND (je.entry_date = v_old OR public._baku_day(je.date) = v_old)
      AND (je.id IS DISTINCT FROM v_reimb OR v_move_pays)
    UNION ALL
    -- Its cash rows (the main and the VAT account) on that day.
    SELECT 'transactions', t.id, 'transaction_date', COALESCE(t.transaction_date, t.created_at),
           public._date_change_ts(COALESCE(t.transaction_date, t.created_at), p_new_date),
           CASE WHEN t.journal_entry_id = v_reimb THEN 'payment' ELSE 'cash' END
    FROM public.transactions t
    WHERE t.source_type = 'expense' AND t.source_id = p_document_id
      AND NOT public._is_storno_pair(t)
      AND public._baku_day(COALESCE(t.transaction_date, t.created_at)) = v_old
      AND (t.journal_entry_id IS DISTINCT FROM v_reimb OR v_reimb IS NULL OR v_move_pays);
  END IF;
END;
$$;

-- ─── 3. Per-type blockers (R7) ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._date_change_extra_blockers(
  p_document_type TEXT, p_document_id UUID, p_old DATE, p_new DATE, p_options JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_out       JSONB := '[]'::jsonb;
  v_move_pays BOOLEAN := COALESCE((p_options->>'move_same_day_payments')::boolean, false);
  v_tx        public.transactions%ROWTYPE;
  v_inv_date  DATE;
  v_label     TEXT;
  v_reimb     UUID;
  v_reimb_day DATE;
BEGIN
  IF p_document_type = 'invoice_payment' THEN
    -- R7: a payment is not before its invoice (assert_payment_not_before_document).
    SELECT * INTO v_tx FROM public.transactions WHERE id = p_document_id;
    SELECT h.doc_date, h.label INTO v_inv_date, v_label FROM public._date_change_header(v_tx.source_type, v_tx.source_id) h;
    IF v_inv_date IS NOT NULL AND p_new < v_inv_date THEN
      v_out := v_out || jsonb_build_object('code', 'payment_before_its_invoice',
        'message', 'Ödəniş fakturadan əvvələ düşür',
        'details', jsonb_build_object('items', jsonb_build_array(jsonb_build_object('doc_no', v_label, 'date', v_inv_date))));
    END IF;
  ELSIF p_document_type = 'expense' AND to_regclass('public.expenses') IS NOT NULL THEN
    -- R7: not before its source document (the production order it is booked on).
    IF to_regclass('public.production_orders') IS NOT NULL THEN
      EXECUTE 'SELECT COALESCE(po.start_date, (po.created_at AT TIME ZONE ''Asia/Baku'')::date), po.id::text
               FROM public.expenses e JOIN public.production_orders po ON po.id = e.production_order_id
               WHERE e.id = $1'
      INTO v_inv_date, v_label USING p_document_id;
      IF v_inv_date IS NOT NULL AND p_new < v_inv_date THEN
        v_out := v_out || jsonb_build_object('code', 'expense_before_source',
          'message', 'Xərc əsas sənəddən (istehsal sifarişi) əvvələ düşür',
          'details', jsonb_build_object('items', jsonb_build_array(jsonb_build_object('document_id', v_label, 'date', v_inv_date))));
      END IF;
    END IF;
    -- R7: the reimbursement of an employee-paid expense is not before the expense.
    EXECUTE 'SELECT reimbursement_journal_id FROM public.expenses WHERE id = $1' INTO v_reimb USING p_document_id;
    IF v_reimb IS NOT NULL THEN
      SELECT public._baku_day(COALESCE(je.date, je.entry_date::timestamptz)) INTO v_reimb_day
      FROM public.journal_entries je WHERE je.id = v_reimb AND je.reversal_of IS NULL AND je.reversed_by IS NULL;
      IF v_reimb_day IS NOT NULL AND v_reimb_day < p_new AND NOT (v_move_pays AND v_reimb_day = p_old) THEN
        v_out := v_out || jsonb_build_object('code', 'reimbursement_before_expense',
          'message', 'Kompensasiya xərcdən əvvələ düşür',
          'details', jsonb_build_object('items', jsonb_build_array(jsonb_build_object('date', v_reimb_day)),
                                        'same_day', v_reimb_day = p_old));
      END IF;
    END IF;
  END IF;
  RETURN v_out;
END;
$$;

-- ─── 4. Header update of every document type ─────────────────────────────────

-- The payments JSON of an invoice after one of its payments moved: the entry with the leg's
-- account and amount on the old day takes the new day (one entry per moved leg).
CREATE OR REPLACE FUNCTION public._date_change_payment_entry(p_payments JSONB, p_account UUID, p_amount NUMERIC, p_old DATE, p_new DATE)
RETURNS JSONB
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_out  JSONB := '[]'::jsonb;
  v_done BOOLEAN := false;
  v_e    JSONB;
BEGIN
  IF p_payments IS NULL OR jsonb_typeof(p_payments) <> 'array' THEN
    RETURN p_payments;
  END IF;
  FOR v_e IN SELECT value FROM jsonb_array_elements(p_payments) LOOP
    IF NOT v_done AND jsonb_typeof(v_e) = 'object'
       AND v_e->>'account_id' = p_account::text
       AND abs(COALESCE(NULLIF(v_e->>'amount', '')::numeric, 0) - p_amount) < 0.005
       AND left(COALESCE(NULLIF(v_e->>'date', ''), NULLIF(v_e->>'payment_date', ''), ''), 10) IN (p_old::text, '') THEN
      v_e := v_e || jsonb_build_object('date', p_new::text)
                 || CASE WHEN v_e ? 'payment_date' THEN jsonb_build_object('payment_date', p_new::text) ELSE '{}'::jsonb END;
      v_done := true;
    END IF;
    v_out := v_out || jsonb_build_array(v_e);
  END LOOP;
  RETURN v_out;
END;
$$;

CREATE OR REPLACE FUNCTION public._date_change_set_header(
  p_document_type TEXT, p_document_id UUID, p_old DATE, p_new DATE, p_options JSONB, p_moved JSONB
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_move BOOLEAN := COALESCE((p_options->>'move_same_day_payments')::boolean, false);
  v_tx   public.transactions%ROWTYPE;
  v_leg  RECORD;
BEGIN
  IF p_document_type = 'sale' THEN
    UPDATE public.sales SET doc_date = p_new, payments = public._date_change_payments_json(payments, p_old, p_new, v_move)
    WHERE id = p_document_id;
  ELSIF p_document_type = 'purchase' THEN
    UPDATE public.purchases SET doc_date = p_new, payments = public._date_change_payments_json(payments, p_old, p_new, v_move)
    WHERE id = p_document_id;
  ELSIF p_document_type = 'invoice_payment' THEN
    SELECT * INTO v_tx FROM public.transactions WHERE id = p_document_id;
    FOR v_leg IN
      SELECT t.account_id, t.amount FROM jsonb_array_elements(p_moved) m
      JOIN public.transactions t ON m->>'table' = 'transactions' AND t.id = (m->>'id')::uuid
    LOOP
      IF v_tx.source_type = 'sale' THEN
        UPDATE public.sales SET payments = public._date_change_payment_entry(payments, v_leg.account_id, v_leg.amount, p_old, p_new)
        WHERE id = v_tx.source_id;
      ELSIF v_tx.source_type = 'purchase' THEN
        UPDATE public.purchases SET payments = public._date_change_payment_entry(payments, v_leg.account_id, v_leg.amount, p_old, p_new)
        WHERE id = v_tx.source_id;
      END IF;
    END LOOP;
  ELSIF p_document_type = 'expense' AND to_regclass('public.expenses') IS NOT NULL THEN
    EXECUTE 'UPDATE public.expenses SET expense_date = $2, updated_at = NOW() WHERE id = $1' USING p_document_id, p_new;
  END IF;
  -- partner_payment: payments.payment_date moves with its rows; cash_transaction: the row is the document.
END;
$$;

-- ─── 5. Which document a cash row belongs to (the cash ledger's menu) ────────

CREATE OR REPLACE FUNCTION public.resolve_date_change_document(p_transaction_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tx   public.transactions%ROWTYPE;
  v_type TEXT;
  v_id   UUID;
  v_head RECORD;
BEGIN
  IF NOT public.user_is_admin() THEN
    RETURN NULL;
  END IF;
  SELECT * INTO v_tx FROM public.transactions WHERE id = p_transaction_id;
  IF NOT FOUND OR public._is_storno_pair(v_tx) THEN
    RETURN NULL;
  END IF;
  IF v_tx.source_type IN ('sale', 'purchase') AND v_tx.category IN ('Satış Ödənişi', 'Alış Ödənişi') THEN
    v_type := 'invoice_payment'; v_id := v_tx.id;
  ELSIF v_tx.source_type IN ('sale', 'purchase') THEN
    v_type := v_tx.source_type; v_id := v_tx.source_id;
  ELSIF v_tx.source_type = 'partner_payment' THEN
    v_type := 'partner_payment'; v_id := v_tx.source_id;
  ELSIF v_tx.source_type = 'expense' THEN
    v_type := 'expense'; v_id := v_tx.source_id;
  ELSIF v_tx.source_id IS NULL AND COALESCE(v_tx.reference_type, 'manual_expense') = 'manual_expense' THEN
    v_type := 'cash_transaction'; v_id := v_tx.id;
  ELSE
    RETURN NULL;
  END IF;
  SELECT * INTO v_head FROM public._date_change_header(v_type, v_id);
  IF NOT FOUND OR NOT v_head.posted THEN
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object('type', v_type, 'id', v_id, 'label', v_head.label, 'date', v_head.doc_date);
END;
$$;

-- ─── 6. Preview (all document types) ────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.preview_document_date_change(
  p_document_type TEXT, p_document_id UUID, p_new_date DATE, p_options JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_opts      JSONB := COALESCE(p_options, '{}'::jsonb);
  v_move_pays BOOLEAN := COALESCE((v_opts->>'move_same_day_payments')::boolean, false);
  v_invoice   BOOLEAN := p_document_type IN ('sale', 'purchase');
  v_head      RECORD;
  v_old       DATE;
  v_new       DATE := p_new_date;
  v_blockers  JSONB := '[]'::jsonb;
  v_warnings  JSONB := '[]'::jsonb;
  v_affected  JSONB;
  v_pay_cat   TEXT := CASE WHEN p_document_type = 'sale' THEN 'Satış Ödənişi' ELSE 'Alış Ödənişi' END;
  v_list      JSONB;
  v_moves     JSONB;
  v_count     INTEGER;
  v_rows      JSONB;
BEGIN
  -- R1: admins only.
  IF NOT public.user_is_admin() THEN
    RETURN jsonb_build_object('ok', false,
      'blockers', jsonb_build_array(jsonb_build_object('code', 'not_admin',
        'message', 'Sənədin tarixini yalnız administrator dəyişə bilər', 'details', '{}'::jsonb)),
      'warnings', '[]'::jsonb, 'affected', '{}'::jsonb);
  END IF;

  IF p_document_type IS NULL OR p_document_type NOT IN
       ('sale', 'purchase', 'invoice_payment', 'partner_payment', 'cash_transaction', 'expense') THEN
    RETURN jsonb_build_object('ok', false,
      'blockers', jsonb_build_array(jsonb_build_object('code', 'unsupported_document',
        'message', format('Bu sənəd növü üçün tarix dəyişikliyi yoxdur: %s', p_document_type), 'details', '{}'::jsonb)),
      'warnings', '[]'::jsonb, 'affected', '{}'::jsonb);
  END IF;

  SELECT * INTO v_head FROM public._date_change_header(p_document_type, p_document_id);
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false,
      'blockers', jsonb_build_array(jsonb_build_object('code', 'not_found', 'message', 'Sənəd tapılmadı', 'details', '{}'::jsonb)),
      'warnings', '[]'::jsonb, 'affected', '{}'::jsonb);
  END IF;
  v_old := v_head.doc_date;

  IF NOT v_head.posted THEN
    v_blockers := v_blockers || jsonb_build_object('code', 'not_posted',
      'message', 'Yalnız təsdiqlənmiş sənədin tarixi dəyişdirilir (qaralamada tarixi formada dəyişin)',
      'details', jsonb_build_object('status', v_head.status));
  END IF;
  IF v_new IS NULL OR v_new = v_old THEN
    v_blockers := v_blockers || jsonb_build_object('code', 'same_date', 'message', 'Yeni tarix köhnə tarixlə eynidir',
      'details', jsonb_build_object('old_date', v_old));
  END IF;
  IF v_new > public.document_today() THEN
    v_blockers := v_blockers || jsonb_build_object('code', 'future_date', 'message', 'Gələcək tarix seçilə bilməz',
      'details', jsonb_build_object('new_date', v_new));
  END IF;
  IF jsonb_array_length(v_blockers) > 0 THEN
    RETURN jsonb_build_object('ok', false, 'old_date', v_old, 'new_date', v_new, 'label', v_head.label,
      'blockers', v_blockers, 'warnings', v_warnings, 'affected', '{}'::jsonb);
  END IF;

  -- R2: closed periods, old and new.
  IF public.is_accounting_period_closed(v_old) THEN
    v_blockers := v_blockers || jsonb_build_object('code', 'period_closed_old',
      'message', format('Köhnə tarix (%s) bağlı maliyyə dövrünə düşür', to_char(v_old, 'DD.MM.YYYY')),
      'details', jsonb_build_object('date', v_old));
  END IF;
  IF public.is_accounting_period_closed(v_new) THEN
    v_blockers := v_blockers || jsonb_build_object('code', 'period_closed_new',
      'message', format('Yeni tarix (%s) bağlı maliyyə dövrünə düşür', to_char(v_new, 'DD.MM.YYYY')),
      'details', jsonb_build_object('date', v_new));
  END IF;

  IF v_invoice THEN
    -- R3: stock per product and warehouse.
    v_moves := public._date_change_stock_moves(p_document_type, p_document_id, v_new);
    SELECT jsonb_agg(jsonb_build_object('product_id', v.product_id, 'product', p.name, 'warehouse_id', v.warehouse_id,
                                        'warehouse', w.name, 'date', public._baku_day(v.at), 'shortfall', v.shortfall)
                     ORDER BY v.at)
    INTO v_list
    FROM (SELECT DISTINCT ON (x.product_id, x.warehouse_id) x.* FROM public._stock_timeline_violations(v_moves) x
          ORDER BY x.product_id, x.warehouse_id, x.at) v
    JOIN public.products p ON p.id = v.product_id
    LEFT JOIN public.warehouses w ON w.id = v.warehouse_id;
    IF v_list IS NOT NULL THEN
      v_blockers := v_blockers || jsonb_build_object('code', 'stock_negative',
        'message', 'Bu tarixlə anbar qalığı mənfiyə düşür', 'details', jsonb_build_object('items', v_list));
    END IF;

    -- R4: FIFO order.
    IF p_document_type = 'purchase' THEN
      SELECT jsonb_agg(DISTINCT jsonb_build_object('sale_id', c.sale_id, 'doc_no', s.doc_no, 'date', public._baku_day(c.created_at)))
      INTO v_list
      FROM public.inventory_batches b
      JOIN public.inventory_batch_consumptions c ON c.batch_id = b.id
      LEFT JOIN public.sales s ON s.id = c.sale_id
      WHERE b.document_id = p_document_id
        AND c.created_at < public._date_change_ts(b.created_at, v_new);
    ELSE
      SELECT jsonb_agg(DISTINCT jsonb_build_object('document_id', b.document_id, 'document_type', b.document_type,
                                                   'date', public._baku_day(b.created_at)))
      INTO v_list
      FROM public.inventory_batch_consumptions c
      JOIN public.inventory_batches b ON b.id = c.batch_id
      WHERE c.sale_id = p_document_id
        AND public._date_change_ts(c.created_at, v_new) < b.created_at;
    END IF;
    IF v_list IS NOT NULL THEN
      v_blockers := v_blockers || jsonb_build_object('code', 'fifo_order',
        'message', 'Mal alınmazdan əvvəl satılmış olardı (FIFO qaydası)', 'details', jsonb_build_object('items', v_list));
    END IF;

    -- R5: Polywood pieces.
    IF p_document_type = 'purchase' THEN
      SELECT jsonb_agg(DISTINCT jsonb_build_object('sale_id', s.id, 'doc_no', s.doc_no, 'date', s.doc_date))
      INTO v_list
      FROM public.polywood_pieces pc
      JOIN public.sale_items si ON si.id = pc.sale_item_id
      JOIN public.sales s ON s.id = si.sale_id
      WHERE pc.source_document_id = p_document_id
        AND s.doc_date < v_new;
    ELSE
      SELECT jsonb_agg(DISTINCT jsonb_build_object('purchase_id', pu.id, 'doc_no', pu.invoice_number, 'date', pu.doc_date))
      INTO v_list
      FROM public.sale_items si
      JOIN public.polywood_pieces pc ON pc.sale_item_id = si.id
      JOIN public.purchases pu ON pu.id = pc.source_document_id
      WHERE si.sale_id = p_document_id
        AND COALESCE(pu.doc_date, public._baku_day(pu.created_at)) > v_new;
    END IF;
    IF v_list IS NOT NULL THEN
      v_blockers := v_blockers || jsonb_build_object('code', 'polywood_order',
        'message', 'Polywood parçaları alışdan əvvəl satılmış olardı', 'details', jsonb_build_object('items', v_list));
    END IF;
  END IF;

  -- The rows that would move (with the options), built once.
  SELECT COALESCE(jsonb_agg(to_jsonb(r)), '[]'::jsonb) INTO v_rows
  FROM public._date_change_rows(p_document_type, p_document_id, v_new, v_opts) r;

  -- R6: cash per account, on every account the moving cash rows touch.
  SELECT jsonb_agg(jsonb_build_object('key', 'transactions:' || t.id, 'account_id', t.account_id,
                                      'amount', CASE WHEN t.type LIKE 'M%daxil' THEN t.amount ELSE -t.amount END,
                                      'old_ts', r->>'old_ts', 'new_ts', r->>'new_ts'))
  INTO v_moves
  FROM jsonb_array_elements(v_rows) r
  JOIN public.transactions t ON r->>'tbl' = 'transactions' AND t.id = (r->>'row_id')::uuid
  WHERE t.account_id IS NOT NULL;
  SELECT jsonb_agg(jsonb_build_object('account_id', v.account_id, 'account', a.name, 'date', public._baku_day(v.at), 'shortfall', v.shortfall)
                   ORDER BY v.at)
  INTO v_list
  FROM (SELECT DISTINCT ON (x.account_id) x.* FROM public._cash_timeline_violations(v_moves) x ORDER BY x.account_id, x.at) v
  JOIN public.accounts a ON a.id = v.account_id;
  IF v_list IS NOT NULL THEN
    v_blockers := v_blockers || jsonb_build_object('code', 'cash_negative',
      'message', 'Bu tarixlə kassa/bank qalığı mənfiyə düşür', 'details', jsonb_build_object('items', v_list));
  END IF;

  IF v_invoice THEN
    -- R7: payments that stay put must not be before the invoice.
    SELECT jsonb_agg(jsonb_build_object('transaction_id', t.id, 'date', public._baku_day(COALESCE(t.transaction_date, t.created_at)),
                                        'amount', t.amount) ORDER BY COALESCE(t.transaction_date, t.created_at))
    INTO v_list
    FROM public.transactions t
    WHERE public._is_document_cash_row(t, p_document_type, p_document_id)
      AND t.category = v_pay_cat
      AND public._baku_day(COALESCE(t.transaction_date, t.created_at)) < v_new
      AND NOT (v_move_pays AND public._baku_day(COALESCE(t.transaction_date, t.created_at)) = v_old);
    IF v_list IS NOT NULL THEN
      v_blockers := v_blockers || jsonb_build_object('code', 'payment_before_invoice',
        'message', 'Ödəniş fakturadan əvvələ düşür',
        'details', jsonb_build_object('items', v_list,
          'same_day', EXISTS (SELECT 1 FROM jsonb_array_elements(v_list) x WHERE (x->>'date')::date = v_old)));
    END IF;
    SELECT jsonb_agg(jsonb_build_object('slip_id', ws.id, 'slip_number', ws.slip_number, 'date', public._baku_day(ws.approved_at)))
    INTO v_list
    FROM public.warehouse_slips ws
    WHERE ws.source_document_id = p_document_id
      AND ws.status = 'approved'
      AND ws.approved_at IS NOT NULL
      AND public._baku_day(ws.approved_at) < v_new;
    IF v_list IS NOT NULL THEN
      v_blockers := v_blockers || jsonb_build_object('code', 'slip_before_invoice',
        'message', 'Təsdiqlənmiş anbar qaiməsi fakturadan əvvələ düşür', 'details', jsonb_build_object('items', v_list));
    END IF;

    -- R8: posted inventory counts of the same product and warehouse between the two dates.
    IF to_regclass('public.inventory_count_items') IS NOT NULL AND to_regclass('public.inventory_counts') IS NOT NULL THEN
      EXECUTE $q$
        SELECT jsonb_agg(DISTINCT jsonb_build_object('count_id', ic.id, 'document_number', ic.document_number, 'date', ic.count_date))
        FROM public.inventory_counts ic
        JOIN public.inventory_count_items it ON it.count_id = ic.id
        WHERE ic.status = 'posted'
          AND ic.count_date BETWEEN LEAST($3, $4) AND GREATEST($3, $4)
          AND (it.product_id, ic.warehouse_id) IN (
            SELECT (m->>'product_id')::uuid, (m->>'warehouse_id')::uuid
            FROM jsonb_array_elements(public._date_change_stock_moves($1, $2, $4)) m
            UNION
            SELECT pc.product_id, pc.warehouse_id FROM public.polywood_pieces pc WHERE pc.source_document_id = $2
            UNION
            SELECT si.product_id, si.warehouse_id FROM public.sale_items si WHERE $1 = 'sale' AND si.sale_id = $2
          )
      $q$ INTO v_list USING p_document_type, p_document_id, v_old, v_new;
      IF v_list IS NOT NULL THEN
        v_blockers := v_blockers || jsonb_build_object('code', 'inventory_count_between',
          'message', 'İki tarix arasında bu mal üçün təsdiqlənmiş inventarizasiya var', 'details', jsonb_build_object('items', v_list));
      END IF;
    END IF;
  END IF;

  -- R7 of the cash documents (a payment not before its invoice, an expense not before its source).
  v_blockers := v_blockers || public._date_change_extra_blockers(p_document_type, p_document_id, v_old, v_new, v_opts);

  -- Warnings: must be ticked by the user.
  IF date_trunc('month', v_old) <> date_trunc('month', v_new) THEN
    v_warnings := v_warnings || jsonb_build_object('code', 'other_month',
      'message', 'Sənəd başqa aya keçir: həmin ayların hesabatları dəyişəcək',
      'details', jsonb_build_object('old_month', to_char(v_old, 'YYYY-MM'), 'new_month', to_char(v_new, 'YYYY-MM')));
  END IF;
  -- Payments that move along with an invoice or an expense (a payment document is itself a payment).
  IF v_invoice OR p_document_type = 'expense' THEN
    SELECT count(*) INTO v_count
    FROM jsonb_array_elements(v_rows) r
    WHERE r->>'grp' = 'payment' AND r->>'tbl' IN ('transactions', 'journal_entries')
      AND (r->>'tbl' = 'transactions' OR p_document_type = 'expense');
    IF p_document_type = 'expense' THEN
      v_count := LEAST(v_count, 1);
    END IF;
    IF v_count > 0 THEN
      v_warnings := v_warnings || jsonb_build_object('code', 'payments_move',
        'message', format('Sənədlə eyni gündə olan %s ödəniş də yeni tarixə keçəcək', v_count),
        'details', jsonb_build_object('count', v_count));
    END IF;
  END IF;
  IF v_new < public.document_today() - 90 THEN
    v_warnings := v_warnings || jsonb_build_object('code', 'far_back',
      'message', 'Yeni tarix 90 gündən çox əvvəldir', 'details', jsonb_build_object('new_date', v_new));
  END IF;

  SELECT jsonb_build_object(
           'journals', count(*) FILTER (WHERE r->>'tbl' = 'journal_entries'),
           'cash', count(*) FILTER (WHERE r->>'tbl' = 'transactions'),
           'stock_moves', count(*) FILTER (WHERE r->>'tbl' = 'stock_movements'),
           'batches', count(*) FILTER (WHERE r->>'tbl' IN ('inventory_batches', 'inventory_batch_consumptions')),
           'payments', CASE WHEN v_invoice
                            THEN count(*) FILTER (WHERE r->>'tbl' = 'transactions' AND r->>'grp' = 'payment')
                            ELSE count(*) FILTER (WHERE r->>'tbl' = 'payments') END)
  INTO v_affected
  FROM jsonb_array_elements(v_rows) r;

  RETURN jsonb_build_object(
    'ok', jsonb_array_length(v_blockers) = 0,
    'old_date', v_old, 'new_date', v_new, 'label', v_head.label,
    'blockers', v_blockers, 'warnings', v_warnings, 'affected', v_affected);
END;
$$;

-- ─── 7. Apply (all document types) ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.apply_document_date_change(
  p_document_type TEXT,
  p_document_id UUID,
  p_new_date DATE,
  p_reason TEXT,
  p_options JSONB DEFAULT '{}'::jsonb,
  p_acknowledged_warnings TEXT[] DEFAULT '{}'::text[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_opts     JSONB := COALESCE(p_options, '{}'::jsonb);
  v_reason   TEXT := NULLIF(btrim(COALESCE(p_reason, '')), '');
  v_head     RECORD;
  v_target   RECORD;
  v_preview  JSONB;
  v_missing  TEXT[];
  v_moved    JSONB := '[]'::jsonb;
  v_row      RECORD;
  v_id       UUID;
  v_name     TEXT;
  v_count    INTEGER;
  v_key      TEXT;
  v_prev     public.document_date_changes%ROWTYPE;
BEGIN
  IF NOT public.user_is_admin() THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Sənədin tarixini yalnız administrator dəyişə bilər';
  END IF;
  IF v_reason IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Tarix dəyişikliyinin səbəbini yazın';
  END IF;
  IF p_document_type IS NULL OR p_document_type NOT IN
       ('sale', 'purchase', 'invoice_payment', 'partner_payment', 'cash_transaction', 'expense') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = format('Bu sənəd növü üçün tarix dəyişikliyi yoxdur: %s', p_document_type);
  END IF;

  -- Lock the document first, then (in id order) the accounts and stock rows it touches.
  IF NOT public._date_change_lock(p_document_type, p_document_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Sənəd tapılmadı';
  END IF;
  SELECT * INTO v_head FROM public._date_change_header(p_document_type, p_document_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Sənəd tapılmadı';
  END IF;

  -- The same change applied again (a retried request): return it, change nothing.
  IF v_head.doc_date = p_new_date THEN
    SELECT * INTO v_prev FROM public.document_date_changes
    WHERE document_type = p_document_type AND document_id = p_document_id AND new_date = p_new_date
    ORDER BY changed_at DESC LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object('ok', true, 'already_applied', true, 'change_id', v_prev.id,
        'old_date', v_prev.old_date, 'new_date', v_prev.new_date, 'moved', jsonb_array_length(v_prev.moved_rows));
    END IF;
  END IF;

  PERFORM 1 FROM public.accounts
  WHERE id IN (SELECT t.account_id FROM public._date_change_rows(p_document_type, p_document_id, p_new_date, v_opts) r
               JOIN public.transactions t ON r.tbl = 'transactions' AND t.id = r.row_id)
  ORDER BY id FOR UPDATE;
  IF p_document_type IN ('sale', 'purchase') THEN
    PERFORM 1 FROM public.warehouse_stocks ws
    WHERE (ws.product_id, ws.warehouse_id) IN (
      SELECT (m->>'product_id')::uuid, (m->>'warehouse_id')::uuid
      FROM jsonb_array_elements(public._date_change_stock_moves(p_document_type, p_document_id, p_new_date)) m)
    ORDER BY ws.id FOR UPDATE;
  END IF;

  -- The checks again, inside the transaction.
  v_preview := public.preview_document_date_change(p_document_type, p_document_id, p_new_date, v_opts);
  IF jsonb_array_length(v_preview->'blockers') > 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = format('Tarix dəyişdirilə bilməz: %s',
        (SELECT string_agg(b->>'message', '; ') FROM jsonb_array_elements(v_preview->'blockers') b)),
      DETAIL = (v_preview->'blockers')::text;
  END IF;
  SELECT array_agg(w->>'code') INTO v_missing
  FROM jsonb_array_elements(v_preview->'warnings') w
  WHERE NOT ((w->>'code') = ANY (COALESCE(p_acknowledged_warnings, '{}'::text[])));
  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = format('Xəbərdarlıqları təsdiqləyin: %s', array_to_string(v_missing, ', ')),
      DETAIL = (v_preview->'warnings')::text;
  END IF;

  -- Move the rows (amounts, lines, accounts and partners stay as they are).
  FOR v_row IN SELECT * FROM public._date_change_rows(p_document_type, p_document_id, p_new_date, v_opts) ORDER BY tbl, row_id
  LOOP
    IF v_row.tbl = 'journal_entries' THEN
      UPDATE public.journal_entries SET date = v_row.new_ts, entry_date = p_new_date WHERE id = v_row.row_id;
    ELSIF v_row.tbl = 'transactions' THEN
      UPDATE public.transactions SET transaction_date = v_row.new_ts WHERE id = v_row.row_id;
    ELSIF v_row.tbl = 'payments' THEN
      UPDATE public.payments SET payment_date = v_row.new_ts WHERE id = v_row.row_id;
    ELSIF v_row.tbl = 'stock_movements' THEN
      UPDATE public.stock_movements SET created_at = v_row.new_ts WHERE id = v_row.row_id;
    ELSIF v_row.tbl = 'inventory_batches' THEN
      UPDATE public.inventory_batches SET created_at = v_row.new_ts WHERE id = v_row.row_id;
    ELSIF v_row.tbl = 'inventory_batch_consumptions' THEN
      UPDATE public.inventory_batch_consumptions SET created_at = v_row.new_ts WHERE id = v_row.row_id;
    END IF;
    v_moved := v_moved || jsonb_build_object('table', v_row.tbl, 'id', v_row.row_id, 'column', v_row.col,
                                             'old', v_row.old_ts, 'new', v_row.new_ts, 'group', v_row.grp);
  END LOOP;

  -- The header date (its created_at, when it was typed in, stays) and the payments JSON an
  -- invoice form shows.
  PERFORM public._date_change_set_header(p_document_type, p_document_id, v_head.doc_date, p_new_date, v_opts, v_moved);

  v_name := (SELECT full_name FROM public.profiles WHERE id = auth.uid());
  INSERT INTO public.document_date_changes (document_type, document_id, document_label, old_date, new_date, reason,
                                            moved_rows, warnings_acknowledged, options, changed_by, changed_by_name)
  VALUES (p_document_type, p_document_id, v_head.label, v_head.doc_date, p_new_date, v_reason,
          v_moved, to_jsonb(COALESCE(p_acknowledged_warnings, '{}'::text[])), v_opts, auth.uid(), v_name)
  RETURNING id INTO v_id;

  SELECT * INTO v_target FROM public._date_change_chatter_target(p_document_type, p_document_id);
  IF to_regclass('public.mail_messages') IS NOT NULL AND v_target.res_model IS NOT NULL THEN
    EXECUTE
      'INSERT INTO public.mail_messages (res_model, res_id, kind, body, author_id, author_name)
       VALUES ($1, $2, ''log'', $3, $4, $5)'
    USING v_target.res_model,
          v_target.res_id,
          format(CASE WHEN p_document_type = 'invoice_payment'
                      THEN 'Ödənişin tarixi dəyişdirildi (%s): %s → %s. Səbəb: %s'
                      ELSE 'Sənədin tarixi dəyişdirildi%s: %s → %s. Səbəb: %s' END,
                 CASE WHEN p_document_type = 'invoice_payment' THEN v_head.label ELSE '' END,
                 to_char(v_head.doc_date, 'DD.MM.YYYY'), to_char(p_new_date, 'DD.MM.YYYY'), v_reason),
          auth.uid(), v_name;
  END IF;

  SELECT count(*) INTO v_count FROM public.document_date_changes
  WHERE document_type = p_document_type AND document_id = p_document_id;
  v_key := format('date_change:%s:%s:%s:%s', p_document_type, p_document_id, p_new_date, v_count);
  PERFORM public.log_erp_event(
    'document_date_change',
    COALESCE(v_target.res_model, p_document_type),
    COALESCE(v_target.res_id, p_document_id),
    jsonb_build_object('document_type', p_document_type, 'document_id', p_document_id, 'old_date', v_head.doc_date,
                       'new_date', p_new_date, 'reason', v_reason, 'options', v_opts),
    NULL,
    v_key,
    jsonb_build_object('change_id', v_id, 'moved', jsonb_array_length(v_moved))
  );

  RETURN jsonb_build_object('ok', true, 'change_id', v_id, 'old_date', v_head.doc_date, 'new_date', p_new_date,
                            'moved', jsonb_array_length(v_moved), 'affected', v_preview->'affected');
END;
$$;

-- ─── 8. Grants ──────────────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION public._date_change_header(TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._date_change_lock(TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._date_change_chatter_target(TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._date_change_rows(TEXT, UUID, DATE, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._date_change_extra_blockers(TEXT, UUID, DATE, DATE, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._date_change_payment_entry(JSONB, UUID, NUMERIC, DATE, DATE) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._date_change_set_header(TEXT, UUID, DATE, DATE, JSONB, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.resolve_date_change_document(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.preview_document_date_change(TEXT, UUID, DATE, JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.apply_document_date_change(TEXT, UUID, DATE, TEXT, JSONB, TEXT[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_date_change_document(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.preview_document_date_change(TEXT, UUID, DATE, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.apply_document_date_change(TEXT, UUID, DATE, TEXT, JSONB, TEXT[]) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
