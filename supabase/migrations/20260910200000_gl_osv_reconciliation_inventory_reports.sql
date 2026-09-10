-- 1C-style reports: Trial Balance (OSV), Partner Reconciliation Act, Inventory Turnover

-- ─── 1. Trial Balance (Oborotno-Saldovaya Vedomost / ОСВ) ───────────────────

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
      CASE
        WHEN account_type IN ('asset', 'expense')
          THEN GREATEST(open_debit_raw - open_credit_raw, 0)
        ELSE GREATEST(open_credit_raw - open_debit_raw, 0)
      END AS initial_debit,
      CASE
        WHEN account_type IN ('asset', 'expense')
          THEN GREATEST(open_credit_raw - open_debit_raw, 0)
        ELSE GREATEST(open_debit_raw - open_credit_raw, 0)
      END AS initial_credit,
      CASE
        WHEN account_type IN ('asset', 'expense')
          THEN (open_debit_raw - open_credit_raw) + period_debit - period_credit
        ELSE (open_credit_raw - open_debit_raw) + period_credit - period_debit
      END AS closing_net
    FROM movements
  ),
  final_rows AS (
    SELECT
      account_id,
      code,
      name,
      account_type,
      ROUND(initial_debit, 2) AS initial_debit,
      ROUND(initial_credit, 2) AS initial_credit,
      ROUND(period_debit, 2) AS period_debit,
      ROUND(period_credit, 2) AS period_credit,
      ROUND(GREATEST(closing_net, 0), 2) AS closing_debit,
      ROUND(GREATEST(-closing_net, 0), 2) AS closing_credit
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

-- ─── 2. Partner Reconciliation Act (Üzləşmə Aktı) ────────────────────────────

CREATE OR REPLACE FUNCTION public.get_partner_reconciliation_act(
  p_partner_id UUID,
  p_start_date DATE,
  p_end_date DATE
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_partner RECORD;
  v_customer_id UUID;
  v_supplier_id UUID;
  v_initial_balance NUMERIC := 0;
  v_closing_balance NUMERIC := 0;
  v_lines JSONB;
BEGIN
  SELECT id, name, full_name, company_name, customer_id, supplier_id
  INTO v_partner
  FROM public.partners
  WHERE id = p_partner_id AND is_deleted = FALSE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'partner_not_found'
      USING ERRCODE = '22023', MESSAGE = 'Tərəfdaş tapılmadı';
  END IF;

  v_customer_id := v_partner.customer_id;
  v_supplier_id := v_partner.supplier_id;

  SELECT COALESCE(SUM(our_debit - our_credit), 0)
  INTO v_initial_balance
  FROM (
    SELECT ROUND(COALESCE(s.total_amount, 0), 2) AS our_debit, 0::numeric AS our_credit
    FROM public.sales s
    WHERE (
      s.partner_id = p_partner_id
      OR (v_customer_id IS NOT NULL AND s.customer_id = v_customer_id)
    )
      AND COALESCE(s.doc_date, (s.created_at AT TIME ZONE 'UTC')::date) < p_start_date
      AND COALESCE(s.status, '') NOT IN ('void', 'cancelled', 'deleted')

    UNION ALL

    SELECT 0::numeric, ROUND(COALESCE(p.total_amount, 0), 2)
    FROM public.purchases p
    WHERE (
      p.partner_id = p_partner_id
      OR (v_supplier_id IS NOT NULL AND p.supplier_id = v_supplier_id)
    )
      AND COALESCE(p.doc_date, (p.created_at AT TIME ZONE 'UTC')::date) < p_start_date
      AND COALESCE(p.status, '') NOT IN ('void', 'cancelled', 'deleted')

    UNION ALL

    SELECT
      CASE WHEN pay.payment_type = 'out' THEN ROUND(pay.amount, 2) ELSE 0 END,
      CASE WHEN pay.payment_type = 'in' THEN ROUND(pay.amount, 2) ELSE 0 END
    FROM public.payments pay
    WHERE pay.partner_id = p_partner_id
      AND (pay.payment_date AT TIME ZONE 'UTC')::date < p_start_date
  ) opening_docs;

  v_initial_balance := ROUND(v_initial_balance, 2);

  WITH doc_lines AS (
    SELECT
      COALESCE(s.doc_date, (s.created_at AT TIME ZONE 'UTC')::date) AS entry_date,
      COALESCE(s.doc_no, s.id::text) AS document_no,
      'invoice'::text AS document_type,
      ROUND(COALESCE(s.total_amount, 0), 2) AS our_debit,
      0::numeric AS our_credit,
      1 AS sort_order
    FROM public.sales s
    WHERE (
      s.partner_id = p_partner_id
      OR (v_customer_id IS NOT NULL AND s.customer_id = v_customer_id)
    )
      AND COALESCE(s.doc_date, (s.created_at AT TIME ZONE 'UTC')::date) BETWEEN p_start_date AND p_end_date
      AND COALESCE(s.status, '') NOT IN ('void', 'cancelled', 'deleted')

    UNION ALL

    SELECT
      COALESCE(p.doc_date, (p.created_at AT TIME ZONE 'UTC')::date),
      COALESCE(p.invoice_number, p.id::text),
      'bill'::text,
      0::numeric,
      ROUND(COALESCE(p.total_amount, 0), 2),
      2
    FROM public.purchases p
    WHERE (
      p.partner_id = p_partner_id
      OR (v_supplier_id IS NOT NULL AND p.supplier_id = v_supplier_id)
    )
      AND COALESCE(p.doc_date, (p.created_at AT TIME ZONE 'UTC')::date) BETWEEN p_start_date AND p_end_date
      AND COALESCE(p.status, '') NOT IN ('void', 'cancelled', 'deleted')

    UNION ALL

    SELECT
      (pay.payment_date AT TIME ZONE 'UTC')::date,
      COALESCE(NULLIF(trim(pay.reference_note), ''), pay.id::text),
      CASE WHEN pay.payment_type = 'in' THEN 'payment_receipt' ELSE 'payment_disbursement' END,
      CASE WHEN pay.payment_type = 'out' THEN ROUND(pay.amount, 2) ELSE 0 END,
      CASE WHEN pay.payment_type = 'in' THEN ROUND(pay.amount, 2) ELSE 0 END,
      3
    FROM public.payments pay
    WHERE pay.partner_id = p_partner_id
      AND (pay.payment_date AT TIME ZONE 'UTC')::date BETWEEN p_start_date AND p_end_date
  ),
  ordered AS (
    SELECT
      entry_date,
      document_no,
      document_type,
      our_debit,
      our_credit,
      SUM(our_debit - our_credit) OVER (
        ORDER BY entry_date, sort_order, document_no
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) AS period_delta
    FROM doc_lines
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'entry_date', entry_date,
        'document_no', document_no,
        'document_type', document_type,
        'our_debit', our_debit,
        'our_credit', our_credit,
        'running_balance', ROUND(v_initial_balance + period_delta, 2)
      )
      ORDER BY entry_date, document_no
    ),
    '[]'::jsonb
  )
  INTO v_lines
  FROM ordered;

  v_closing_balance := ROUND(
    v_initial_balance + COALESCE((
      SELECT SUM(our_debit - our_credit) FROM (
        SELECT ROUND(COALESCE(s.total_amount, 0), 2) AS our_debit, 0::numeric AS our_credit
        FROM public.sales s
        WHERE (
          s.partner_id = p_partner_id
          OR (v_customer_id IS NOT NULL AND s.customer_id = v_customer_id)
        )
          AND COALESCE(s.doc_date, (s.created_at AT TIME ZONE 'UTC')::date) BETWEEN p_start_date AND p_end_date
          AND COALESCE(s.status, '') NOT IN ('void', 'cancelled', 'deleted')
        UNION ALL
        SELECT 0::numeric, ROUND(COALESCE(p.total_amount, 0), 2)
        FROM public.purchases p
        WHERE (
          p.partner_id = p_partner_id
          OR (v_supplier_id IS NOT NULL AND p.supplier_id = v_supplier_id)
        )
          AND COALESCE(p.doc_date, (p.created_at AT TIME ZONE 'UTC')::date) BETWEEN p_start_date AND p_end_date
          AND COALESCE(p.status, '') NOT IN ('void', 'cancelled', 'deleted')
        UNION ALL
        SELECT
          CASE WHEN pay.payment_type = 'out' THEN ROUND(pay.amount, 2) ELSE 0 END,
          CASE WHEN pay.payment_type = 'in' THEN ROUND(pay.amount, 2) ELSE 0 END
        FROM public.payments pay
        WHERE pay.partner_id = p_partner_id
          AND (pay.payment_date AT TIME ZONE 'UTC')::date BETWEEN p_start_date AND p_end_date
      ) t
    ), 0),
    2
  );

  RETURN jsonb_build_object(
    'partner_id', p_partner_id,
    'partner_name', COALESCE(v_partner.full_name, v_partner.company_name, v_partner.name),
    'start_date', p_start_date,
    'end_date', p_end_date,
    'initial_balance', v_initial_balance,
    'closing_balance', v_closing_balance,
    'lines', v_lines
  );
END;
$$;

-- ─── 3. Inventory Turnover Report (Anbar Dövriyyə Cədvəli) ───────────────────

CREATE OR REPLACE FUNCTION public.get_inventory_turnover_report(
  p_start_date DATE,
  p_end_date DATE,
  p_category_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH inbound AS (
    SELECT
      ib.product_id,
      COALESCE(SUM(
        CASE WHEN (ib.created_at AT TIME ZONE 'UTC')::date < p_start_date THEN ib.initial_qty ELSE 0 END
      ), 0) AS inbound_qty_before,
      COALESCE(SUM(
        CASE
          WHEN (ib.created_at AT TIME ZONE 'UTC')::date BETWEEN p_start_date AND p_end_date
            THEN ib.initial_qty
          ELSE 0
        END
      ), 0) AS inbound_qty_period,
      COALESCE(SUM(
        CASE WHEN (ib.created_at AT TIME ZONE 'UTC')::date < p_start_date THEN ib.initial_qty * ib.unit_cost ELSE 0 END
      ), 0) AS inbound_value_before,
      COALESCE(SUM(
        CASE
          WHEN (ib.created_at AT TIME ZONE 'UTC')::date BETWEEN p_start_date AND p_end_date
            THEN ib.initial_qty * ib.unit_cost
          ELSE 0
        END
      ), 0) AS inbound_value_period
    FROM public.inventory_batches ib
    GROUP BY ib.product_id
  ),
  outbound AS (
    SELECT
      ibc.product_id,
      COALESCE(SUM(
        CASE WHEN (ibc.created_at AT TIME ZONE 'UTC')::date < p_start_date THEN ibc.quantity ELSE 0 END
      ), 0) AS outbound_qty_before,
      COALESCE(SUM(
        CASE
          WHEN (ibc.created_at AT TIME ZONE 'UTC')::date BETWEEN p_start_date AND p_end_date
            THEN ibc.quantity
          ELSE 0
        END
      ), 0) AS outbound_qty_period,
      COALESCE(SUM(
        CASE WHEN (ibc.created_at AT TIME ZONE 'UTC')::date < p_start_date THEN ibc.cogs_amount ELSE 0 END
      ), 0) AS outbound_value_before,
      COALESCE(SUM(
        CASE
          WHEN (ibc.created_at AT TIME ZONE 'UTC')::date BETWEEN p_start_date AND p_end_date
            THEN ibc.cogs_amount
          ELSE 0
        END
      ), 0) AS outbound_value_period
    FROM public.inventory_batch_consumptions ibc
    GROUP BY ibc.product_id
  ),
  combined AS (
    SELECT
      p.id AS product_id,
      COALESCE(p.code, '') AS product_code,
      COALESCE(p.name, '') AS product_name,
      COALESCE(p.unit, 'ədəd') AS unit,
      p.category_id,
      COALESCE(c.name, p.category, '') AS category_name,
      GREATEST(COALESCE(i.inbound_qty_before, 0) - COALESCE(o.outbound_qty_before, 0), 0) AS initial_qty,
      GREATEST(COALESCE(i.inbound_value_before, 0) - COALESCE(o.outbound_value_before, 0), 0) AS initial_value,
      COALESCE(i.inbound_qty_period, 0) AS inbound_qty,
      COALESCE(i.inbound_value_period, 0) AS inbound_value,
      COALESCE(o.outbound_qty_period, 0) AS outbound_qty,
      COALESCE(o.outbound_value_period, 0) AS outbound_value
    FROM public.products p
    LEFT JOIN public.categories c ON c.id = p.category_id
    LEFT JOIN inbound i ON i.product_id = p.id
    LEFT JOIN outbound o ON o.product_id = p.id
    WHERE (p_category_id IS NULL OR p.category_id = p_category_id)
  ),
  final_rows AS (
    SELECT
      product_id,
      product_code,
      product_name,
      unit,
      category_id,
      category_name,
      ROUND(initial_qty, 4) AS initial_qty,
      ROUND(initial_value, 2) AS initial_value,
      ROUND(inbound_qty, 4) AS inbound_qty,
      ROUND(inbound_value, 2) AS inbound_value,
      ROUND(outbound_qty, 4) AS outbound_qty,
      ROUND(outbound_value, 2) AS outbound_value,
      ROUND(GREATEST(initial_qty + inbound_qty - outbound_qty, 0), 4) AS closing_qty,
      ROUND(GREATEST(initial_value + inbound_value - outbound_value, 0), 2) AS closing_value
    FROM combined
    WHERE
      initial_qty > 0.0001
      OR inbound_qty > 0.0001
      OR outbound_qty > 0.0001
      OR GREATEST(initial_qty + inbound_qty - outbound_qty, 0) > 0.0001
  )
  SELECT jsonb_build_object(
    'start_date', p_start_date,
    'end_date', p_end_date,
    'category_id', p_category_id,
    'rows', COALESCE(
      (SELECT jsonb_agg(row_to_json(r)::jsonb ORDER BY r.product_code, r.product_name) FROM final_rows r),
      '[]'::jsonb
    ),
    'totals', (
      SELECT jsonb_build_object(
        'initial_qty', ROUND(COALESCE(SUM(initial_qty), 0), 4),
        'initial_value', ROUND(COALESCE(SUM(initial_value), 0), 2),
        'inbound_qty', ROUND(COALESCE(SUM(inbound_qty), 0), 4),
        'inbound_value', ROUND(COALESCE(SUM(inbound_value), 0), 2),
        'outbound_qty', ROUND(COALESCE(SUM(outbound_qty), 0), 4),
        'outbound_value', ROUND(COALESCE(SUM(outbound_value), 0), 2),
        'closing_qty', ROUND(COALESCE(SUM(closing_qty), 0), 4),
        'closing_value', ROUND(COALESCE(SUM(closing_value), 0), 2)
      )
      FROM final_rows
    )
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_gl_trial_balance(DATE, DATE) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_partner_reconciliation_act(UUID, DATE, DATE) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_inventory_turnover_report(DATE, DATE, UUID) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
