-- ============================================================================
-- DATE-1: change the date of a posted sales or purchase invoice in place.
--
-- A date change keeps every amount, line, account and partner; only WHEN changes. Instead of
-- reversing and re-posting (the F1 amend RPCs, which fail for purchases whose goods were sold
-- and rewrite FIFO / COGS), the rows the invoice already created move to the new day, keeping
-- each row's Baku time of day, inside one transaction, after timeline checks prove nothing
-- goes negative and no order breaks:
--
--   R1 admins only (user_is_admin(); can_edit_posted_* does NOT allow it)
--   R2 neither the old nor the new date is in a closed accounting period (the journal guard
--      only reads NEW on update, so the old date is checked here)
--   R3 stock per product and warehouse never goes below zero (or deeper than it already was)
--   R4 FIFO: no layer is consumed before it exists
--   R5 Polywood: no piece is sold before the purchase that brought it
--   R6 cash per account never goes below zero (or deeper than it already was)
--   R7 dependents: payments not before the invoice (move_same_day_payments moves the ones
--      on the old invoice date along), approved warehouse slips not before the invoice
--   R8 no posted inventory count of the same product and warehouse between the two dates
--
-- Moved rows are listed in document_date_changes (table, id, column, old, new): the change can
-- be audited and undone by applying the reverse change. The amend RPCs are not touched.
--
-- Objects: document_date_changes, _date_change_ts, _date_change_rows, _date_change_stock_moves,
-- _stock_timeline_violations, _cash_timeline_violations, preview_document_date_change,
-- apply_document_date_change. Handlers: 'sale', 'purchase' (and the payments booked on them).
-- No data changes; existing documents are not re-dated. Safe to re-run.
-- ============================================================================

-- ─── 1. History ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.document_date_changes (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_type         TEXT NOT NULL,
  document_id           UUID NOT NULL,
  document_label        TEXT,
  old_date              DATE NOT NULL,
  new_date              DATE NOT NULL,
  reason                TEXT NOT NULL CHECK (length(btrim(reason)) > 0),
  moved_rows            JSONB NOT NULL DEFAULT '[]'::jsonb,
  warnings_acknowledged JSONB NOT NULL DEFAULT '[]'::jsonb,
  options               JSONB NOT NULL DEFAULT '{}'::jsonb,
  changed_by            UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  changed_by_name       TEXT,
  changed_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_document_date_changes_document
  ON public.document_date_changes (document_type, document_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_document_date_changes_changed_at
  ON public.document_date_changes (changed_at DESC);

ALTER TABLE public.document_date_changes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS document_date_changes_select_admin ON public.document_date_changes;
CREATE POLICY document_date_changes_select_admin ON public.document_date_changes
  FOR SELECT TO authenticated USING (public.user_is_admin());
-- No insert/update/delete policy: rows are written only by apply_document_date_change.
REVOKE ALL ON public.document_date_changes FROM anon;
GRANT SELECT ON public.document_date_changes TO authenticated;

-- ─── 2. Helpers ─────────────────────────────────────────────────────────────

-- The same Baku time of day on another day (the idea of document_timestamp()).
CREATE OR REPLACE FUNCTION public._date_change_ts(p_ts TIMESTAMPTZ, p_new DATE)
RETURNS TIMESTAMPTZ
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN p_ts IS NULL THEN NULL
    ELSE ((p_new::timestamp + (p_ts AT TIME ZONE 'Asia/Baku')::time) AT TIME ZONE 'Asia/Baku') END;
$$;

CREATE OR REPLACE FUNCTION public._baku_day(p_ts TIMESTAMPTZ)
RETURNS DATE
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT (p_ts AT TIME ZONE 'Asia/Baku')::date;
$$;

-- A cash row that is a storno, or was cancelled by one (the rule of _invoice_payments_before).
CREATE OR REPLACE FUNCTION public._is_storno_pair(p_tx public.transactions)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(p_tx.reference_type, '') = 'storno'
      OR EXISTS (SELECT 1 FROM public.transactions s WHERE s.reference_type = 'storno' AND s.reference_id = p_tx.id);
$$;

-- A cash row of a document: linked by source (today) or by reference (older rows), not a
-- storno pair.
CREATE OR REPLACE FUNCTION public._is_document_cash_row(p_tx public.transactions, p_type TEXT, p_document_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ((p_tx.source_type = p_type AND p_tx.source_id = p_document_id)
          OR (p_tx.source_id IS NULL AND p_tx.reference_type = p_type AND p_tx.reference_id = p_document_id))
     AND NOT public._is_storno_pair(p_tx);
$$;

-- The header of a supported document: label, date and whether it is posted.
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
  END IF;
END;
$$;

-- ─── 3. The rows a document created (the handler registry) ───────────────────
--
-- Rows dated on the document's day that the document created:
--   journal_entries   COALESCE(document_id, source_id) = document, not reversed / not a
--                     reversal (the invoice and COGS journals; earlier revisions stay put)
--   transactions      source_type/source_id = document, not storno pairs:
--                       grp 'cash'    additional expenses paid on the invoice
--                       grp 'payment' payments booked on the invoice (category Satış/Alış
--                                     Ödənişi); with their cash_transaction journal
--   stock_movements   reference_type sale / sale_void (purchase / purchase_void), reference_id
--   inventory_batches document_id = document (purchase layers)
--   inventory_batch_consumptions sale_id = document (FIFO of a sale)
-- Cash rows are matched by source_type/source_id, and older rows by reference_type/reference_id.
-- Polywood pieces do not move: their created_at is when they were recorded (R5 compares the
-- documents' own dates). Only rows on the old document day (Baku) move; payments only with
-- move_same_day_payments.
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
BEGIN
  SELECT h.doc_date INTO v_old FROM public._date_change_header(p_document_type, p_document_id) h;
  IF v_old IS NULL THEN
    RETURN;
  END IF;

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
  -- Cash rows of the document (expenses always, payments with the option).
  SELECT 'transactions', t.id, 'transaction_date', COALESCE(t.transaction_date, t.created_at),
         public._date_change_ts(COALESCE(t.transaction_date, t.created_at), p_new_date),
         CASE WHEN t.category = v_pay_cat THEN 'payment' ELSE 'cash' END
  FROM public.transactions t
  WHERE public._is_document_cash_row(t, v_src, p_document_id)
    AND public._baku_day(COALESCE(t.transaction_date, t.created_at)) = v_old
    AND (t.category IS DISTINCT FROM v_pay_cat OR v_move_pays)
  UNION ALL
  -- Their journals (cash_transaction journals point at the cash row; one journal may serve
  -- several rows of a split payment: listed once).
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
END;
$$;

-- ─── 4. Timeline checks (written once, reused by every handler) ──────────────

-- Stock events of one (product, warehouse): stock movements (a kit's movement counts for its
-- components through the BOM) and purchase FIFO layers (purchases change warehouse stock
-- without a stock movement row). Services and Polywood products are left out (Polywood moves
-- through pieces: R5).
CREATE OR REPLACE FUNCTION public._stock_events(p_product_id UUID, p_warehouse_id UUID)
RETURNS TABLE (ev_key TEXT, ts TIMESTAMPTZ, qty NUMERIC)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH def AS (SELECT public.stock_default_warehouse() AS wid)
  SELECT 'stock_movements:' || sm.id, sm.created_at,
         CASE WHEN sm.movement_type = 'in' THEN sm.quantity ELSE -sm.quantity END
  FROM public.stock_movements sm, def
  WHERE sm.product_id = p_product_id
    AND COALESCE(sm.warehouse_id, def.wid) = p_warehouse_id
    AND NOT EXISTS (SELECT 1 FROM public.product_bom k WHERE k.parent_product_id = sm.product_id)
  UNION ALL
  SELECT 'stock_movements:' || sm.id || ':' || k.component_product_id, sm.created_at,
         (CASE WHEN sm.movement_type = 'in' THEN sm.quantity ELSE -sm.quantity END) * k.quantity
  FROM public.stock_movements sm
  JOIN public.product_bom k ON k.parent_product_id = sm.product_id AND k.component_product_id = p_product_id, def
  WHERE COALESCE(sm.warehouse_id, def.wid) = p_warehouse_id
  UNION ALL
  SELECT 'inventory_batches:' || b.id, b.created_at, b.initial_qty
  FROM public.inventory_batches b
  JOIN public.purchases pu ON pu.id = b.document_id, def
  WHERE b.document_type = 'purchase'
    AND b.product_id = p_product_id
    AND COALESCE(pu.warehouse_id, def.wid) = p_warehouse_id;
$$;

-- The stock events of a document, with their old and new moment: [{key, product_id,
-- warehouse_id, qty, old_ts, new_ts}] (kits exploded, services and Polywood left out).
CREATE OR REPLACE FUNCTION public._date_change_stock_moves(p_document_type TEXT, p_document_id UUID, p_new_date DATE)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH def AS (SELECT public.stock_default_warehouse() AS wid),
  rows AS (SELECT * FROM public._date_change_rows(p_document_type, p_document_id, p_new_date, '{}'::jsonb)),
  ev AS (
    SELECT 'stock_movements:' || sm.id AS k, sm.product_id AS pid, COALESCE(sm.warehouse_id, def.wid) AS wid,
           CASE WHEN sm.movement_type = 'in' THEN sm.quantity ELSE -sm.quantity END AS q, r.old_ts, r.new_ts
    FROM rows r JOIN public.stock_movements sm ON r.tbl = 'stock_movements' AND sm.id = r.row_id, def
    WHERE NOT EXISTS (SELECT 1 FROM public.product_bom k WHERE k.parent_product_id = sm.product_id)
    UNION ALL
    SELECT 'stock_movements:' || sm.id || ':' || k.component_product_id, k.component_product_id, COALESCE(sm.warehouse_id, def.wid),
           (CASE WHEN sm.movement_type = 'in' THEN sm.quantity ELSE -sm.quantity END) * k.quantity, r.old_ts, r.new_ts
    FROM rows r JOIN public.stock_movements sm ON r.tbl = 'stock_movements' AND sm.id = r.row_id
    JOIN public.product_bom k ON k.parent_product_id = sm.product_id, def
    UNION ALL
    SELECT 'inventory_batches:' || b.id, b.product_id, COALESCE(pu.warehouse_id, def.wid), b.initial_qty, r.old_ts, r.new_ts
    FROM rows r JOIN public.inventory_batches b ON r.tbl = 'inventory_batches' AND b.id = r.row_id
    JOIN public.purchases pu ON pu.id = b.document_id, def
    WHERE b.document_type = 'purchase'
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object('key', ev.k, 'product_id', ev.pid, 'warehouse_id', ev.wid, 'qty', ev.q,
                                               'old_ts', ev.old_ts, 'new_ts', ev.new_ts)), '[]'::jsonb)
  FROM ev
  JOIN public.products p ON p.id = ev.pid
  WHERE NOT COALESCE(p.is_service, false)
    AND COALESCE(p.inventory_mode, '') <> 'polywood'
    AND ev.wid IS NOT NULL;
$$;

-- R3. For each (product, warehouse) the document touches: the running balance over all its
-- stock events, with the document's events at their new moment. The balance after an event
-- is the current stock minus everything after it. A point is a violation when the balance is
-- below zero AND lower than it was at that moment before the change (history that was
-- already negative is not blamed on this change). Only moments from the earlier of the two
-- dates on are looked at.
CREATE OR REPLACE FUNCTION public._stock_timeline_violations(p_moves JSONB)
RETURNS TABLE (product_id UUID, warehouse_id UUID, at TIMESTAMPTZ, balance NUMERIC, shortfall NUMERIC)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH mv AS (
    SELECT (m->>'key') AS k, (m->>'product_id')::uuid AS pid, (m->>'warehouse_id')::uuid AS wid,
           (m->>'qty')::numeric AS q, (m->>'old_ts')::timestamptz AS o, (m->>'new_ts')::timestamptz AS n
    FROM jsonb_array_elements(COALESCE(p_moves, '[]'::jsonb)) m
  ),
  pairs AS (
    SELECT pid, wid, MIN(LEAST(o, n)) AS from_ts FROM mv GROUP BY pid, wid
  ),
  other AS (
    SELECT pr.pid, pr.wid, e.ev_key AS k, e.ts, e.qty AS q
    FROM pairs pr, LATERAL public._stock_events(pr.pid, pr.wid) e
    WHERE e.ts >= pr.from_ts
      AND NOT EXISTS (SELECT 1 FROM mv WHERE mv.k = e.ev_key)
  ),
  before_set AS (
    SELECT pid, wid, k, ts, q FROM other
    UNION ALL SELECT pid, wid, k, o, q FROM mv
  ),
  after_set AS (
    SELECT pid, wid, k, ts, q FROM other
    UNION ALL SELECT pid, wid, k, n, q FROM mv
  ),
  after_points AS (
    SELECT a.pid, a.wid, a.ts, a.k,
           public.stock_available(a.pid, a.wid)
             - COALESCE(SUM(a.q) OVER (PARTITION BY a.pid, a.wid ORDER BY a.ts DESC, a.k DESC
                                       ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS bal
    FROM after_set a
  )
  SELECT ap.pid, ap.wid, ap.ts, round(ap.bal, 4), round(-ap.bal, 4)
  FROM after_points ap
  JOIN pairs pr ON pr.pid = ap.pid AND pr.wid = ap.wid
  WHERE ap.ts >= pr.from_ts
    AND ap.bal < -0.0005
    AND ap.bal < (
      public.stock_available(ap.pid, ap.wid)
      - COALESCE((SELECT SUM(b.q) FROM before_set b
                  WHERE b.pid = ap.pid AND b.wid = ap.wid AND (b.ts, b.k) > (ap.ts, ap.k)), 0)
    ) - 0.0005
  ORDER BY ap.pid, ap.wid, ap.ts;
$$;

-- Cash events of one account: every cash row, storno pairs left out (as _invoice_payments_before).
CREATE OR REPLACE FUNCTION public._cash_events(p_account_id UUID)
RETURNS TABLE (ev_key TEXT, ts TIMESTAMPTZ, amount NUMERIC)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 'transactions:' || t.id, COALESCE(t.transaction_date, t.created_at),
         CASE WHEN t.type LIKE 'M%daxil' THEN t.amount ELSE -t.amount END
  FROM public.transactions t
  WHERE t.account_id = p_account_id
    AND NOT public._is_storno_pair(t);
$$;

-- R6. Same rule as R3 over each cash/bank account the document's moving cash rows touch:
-- [{key, account_id, amount (signed), old_ts, new_ts}]. Spending is refused below zero
-- (post_cash_transaction, create_partner_payment), so a negative balance is a violation.
CREATE OR REPLACE FUNCTION public._cash_timeline_violations(p_moves JSONB)
RETURNS TABLE (account_id UUID, at TIMESTAMPTZ, balance NUMERIC, shortfall NUMERIC)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH mv AS (
    SELECT (m->>'key') AS k, (m->>'account_id')::uuid AS aid, (m->>'amount')::numeric AS q,
           (m->>'old_ts')::timestamptz AS o, (m->>'new_ts')::timestamptz AS n
    FROM jsonb_array_elements(COALESCE(p_moves, '[]'::jsonb)) m
  ),
  accs AS (SELECT aid, MIN(LEAST(o, n)) AS from_ts FROM mv GROUP BY aid),
  other AS (
    SELECT ac.aid, e.ev_key AS k, e.ts, e.amount AS q
    FROM accs ac, LATERAL public._cash_events(ac.aid) e
    WHERE e.ts >= ac.from_ts
      AND NOT EXISTS (SELECT 1 FROM mv WHERE mv.k = e.ev_key)
  ),
  before_set AS (SELECT aid, k, ts, q FROM other UNION ALL SELECT aid, k, o, q FROM mv),
  after_set AS (SELECT aid, k, ts, q FROM other UNION ALL SELECT aid, k, n, q FROM mv),
  after_points AS (
    SELECT a.aid, a.ts, a.k,
           (SELECT COALESCE(balance, 0) FROM public.accounts WHERE id = a.aid)
             - COALESCE(SUM(a.q) OVER (PARTITION BY a.aid ORDER BY a.ts DESC, a.k DESC
                                       ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0) AS bal
    FROM after_set a
  )
  SELECT ap.aid, ap.ts, round(ap.bal, 2), round(-ap.bal, 2)
  FROM after_points ap
  JOIN accs ac ON ac.aid = ap.aid
  WHERE ap.ts >= ac.from_ts
    AND ap.bal < -0.005
    AND ap.bal < (
      (SELECT COALESCE(balance, 0) FROM public.accounts WHERE id = ap.aid)
      - COALESCE((SELECT SUM(b.q) FROM before_set b WHERE b.aid = ap.aid AND (b.ts, b.k) > (ap.ts, ap.k)), 0)
    ) - 0.005
  ORDER BY ap.aid, ap.ts;
$$;

-- ─── 5. Preview ─────────────────────────────────────────────────────────────

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

  IF p_document_type NOT IN ('sale', 'purchase') THEN
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

  -- The rows that would move (with the options), built once.
  SELECT COALESCE(jsonb_agg(to_jsonb(r)), '[]'::jsonb) INTO v_rows
  FROM public._date_change_rows(p_document_type, p_document_id, v_new, v_opts) r;

  -- R6: cash per account (the cash rows that move).
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

  -- Warnings: must be ticked by the user.
  IF date_trunc('month', v_old) <> date_trunc('month', v_new) THEN
    v_warnings := v_warnings || jsonb_build_object('code', 'other_month',
      'message', 'Sənəd başqa aya keçir: həmin ayların hesabatları dəyişəcək',
      'details', jsonb_build_object('old_month', to_char(v_old, 'YYYY-MM'), 'new_month', to_char(v_new, 'YYYY-MM')));
  END IF;
  SELECT count(*) INTO v_count
  FROM jsonb_array_elements(v_rows) r
  WHERE r->>'grp' = 'payment' AND r->>'tbl' = 'transactions';
  IF v_count > 0 THEN
    v_warnings := v_warnings || jsonb_build_object('code', 'payments_move',
      'message', format('Faktura ilə eyni gündə olan %s ödəniş də yeni tarixə keçəcək', v_count),
      'details', jsonb_build_object('count', v_count));
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
           'payments', count(*) FILTER (WHERE r->>'tbl' = 'transactions' AND r->>'grp' = 'payment'))
  INTO v_affected
  FROM jsonb_array_elements(v_rows) r;

  RETURN jsonb_build_object(
    'ok', jsonb_array_length(v_blockers) = 0,
    'old_date', v_old, 'new_date', v_new, 'label', v_head.label,
    'blockers', v_blockers, 'warnings', v_warnings, 'affected', v_affected);
END;
$$;

-- ─── 6. Apply ───────────────────────────────────────────────────────────────

-- The payments JSON of an invoice after a date change: entries dated on the old day (or with no
-- date, which means the invoice date) get the new day when same-day payments move, else the old
-- day written out. Other entries keep their date. Not an array: unchanged.
CREATE OR REPLACE FUNCTION public._date_change_payments_json(p_payments JSONB, p_old DATE, p_new DATE, p_move BOOLEAN)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN p_payments IS NULL OR jsonb_typeof(p_payments) <> 'array' THEN p_payments ELSE (
    SELECT COALESCE(jsonb_agg(
      CASE
        WHEN jsonb_typeof(e) <> 'object' THEN e
        WHEN COALESCE(NULLIF(e->>'date', ''), NULLIF(e->>'payment_date', '')) IS NULL
          THEN e || jsonb_build_object('date', (CASE WHEN p_move THEN p_new ELSE p_old END)::text)
        WHEN p_move AND left(COALESCE(NULLIF(e->>'date', ''), e->>'payment_date'), 10) = p_old::text
          THEN e || jsonb_build_object('date', p_new::text)
                 || CASE WHEN e ? 'payment_date' THEN jsonb_build_object('payment_date', p_new::text) ELSE '{}'::jsonb END
        ELSE e
      END ORDER BY ord), '[]'::jsonb)
    FROM jsonb_array_elements(p_payments) WITH ORDINALITY AS x(e, ord)
  ) END;
$$;

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
  IF p_document_type NOT IN ('sale', 'purchase') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = format('Bu sənəd növü üçün tarix dəyişikliyi yoxdur: %s', p_document_type);
  END IF;

  -- Lock the document first, then (in id order) the accounts and stock rows it touches.
  IF p_document_type = 'sale' THEN
    PERFORM 1 FROM public.sales WHERE id = p_document_id FOR UPDATE;
  ELSE
    PERFORM 1 FROM public.purchases WHERE id = p_document_id FOR UPDATE;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Sənəd tapılmadı';
  END IF;
  SELECT * INTO v_head FROM public._date_change_header(p_document_type, p_document_id);

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
  PERFORM 1 FROM public.warehouse_stocks ws
  WHERE (ws.product_id, ws.warehouse_id) IN (
    SELECT (m->>'product_id')::uuid, (m->>'warehouse_id')::uuid
    FROM jsonb_array_elements(public._date_change_stock_moves(p_document_type, p_document_id, p_new_date)) m)
  ORDER BY ws.id FOR UPDATE;

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

  -- The header date (the header's created_at, when it was typed in, stays), and the payments
  -- the invoice form shows: a payment on the old day takes the new day when the payments moved,
  -- else it keeps the old day written out (an entry without a date means "the invoice date").
  IF p_document_type = 'sale' THEN
    UPDATE public.sales
    SET doc_date = p_new_date,
        payments = public._date_change_payments_json(payments, v_head.doc_date, p_new_date,
                                                     COALESCE((v_opts->>'move_same_day_payments')::boolean, false))
    WHERE id = p_document_id;
  ELSE
    UPDATE public.purchases
    SET doc_date = p_new_date,
        payments = public._date_change_payments_json(payments, v_head.doc_date, p_new_date,
                                                     COALESCE((v_opts->>'move_same_day_payments')::boolean, false))
    WHERE id = p_document_id;
  END IF;

  v_name := (SELECT full_name FROM public.profiles WHERE id = auth.uid());
  INSERT INTO public.document_date_changes (document_type, document_id, document_label, old_date, new_date, reason,
                                            moved_rows, warnings_acknowledged, options, changed_by, changed_by_name)
  VALUES (p_document_type, p_document_id, v_head.label, v_head.doc_date, p_new_date, v_reason,
          v_moved, to_jsonb(COALESCE(p_acknowledged_warnings, '{}'::text[])), v_opts, auth.uid(), v_name)
  RETURNING id INTO v_id;

  IF to_regclass('public.mail_messages') IS NOT NULL THEN
    EXECUTE
      'INSERT INTO public.mail_messages (res_model, res_id, kind, body, author_id, author_name)
       VALUES ($1, $2, ''log'', $3, $4, $5)'
    USING CASE WHEN p_document_type = 'sale' THEN 'sales' ELSE 'purchases' END,
          p_document_id,
          format('Sənədin tarixi dəyişdirildi: %s → %s. Səbəb: %s',
                 to_char(v_head.doc_date, 'DD.MM.YYYY'), to_char(p_new_date, 'DD.MM.YYYY'), v_reason),
          auth.uid(), v_name;
  END IF;

  SELECT count(*) INTO v_count FROM public.document_date_changes
  WHERE document_type = p_document_type AND document_id = p_document_id;
  v_key := format('date_change:%s:%s:%s:%s', p_document_type, p_document_id, p_new_date, v_count);
  PERFORM public.log_erp_event(
    'document_date_change',
    CASE WHEN p_document_type = 'sale' THEN 'sales' ELSE 'purchases' END,
    p_document_id,
    jsonb_build_object('document_type', p_document_type, 'old_date', v_head.doc_date, 'new_date', p_new_date,
                       'reason', v_reason, 'options', v_opts),
    NULL,
    v_key,
    jsonb_build_object('change_id', v_id, 'moved', jsonb_array_length(v_moved))
  );

  RETURN jsonb_build_object('ok', true, 'change_id', v_id, 'old_date', v_head.doc_date, 'new_date', p_new_date,
                            'moved', jsonb_array_length(v_moved), 'affected', v_preview->'affected');
END;
$$;

-- ─── 7. Grants ──────────────────────────────────────────────────────────────
-- The two RPCs check admin themselves; the helpers are internal.

REVOKE ALL ON FUNCTION public._date_change_ts(TIMESTAMPTZ, DATE) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public._baku_day(TIMESTAMPTZ) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public._is_storno_pair(public.transactions) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._date_change_header(TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._is_document_cash_row(public.transactions, TEXT, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._date_change_payments_json(JSONB, DATE, DATE, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._date_change_rows(TEXT, UUID, DATE, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._stock_events(UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._date_change_stock_moves(TEXT, UUID, DATE) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._stock_timeline_violations(JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._cash_events(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._cash_timeline_violations(JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.preview_document_date_change(TEXT, UUID, DATE, JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.apply_document_date_change(TEXT, UUID, DATE, TEXT, JSONB, TEXT[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_document_date_change(TEXT, UUID, DATE, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.apply_document_date_change(TEXT, UUID, DATE, TEXT, JSONB, TEXT[]) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
