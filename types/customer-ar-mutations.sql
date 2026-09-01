-- Del Groups ERP — Customer AR (accounts receivable) synchronization
-- Run AFTER types/rbac-migration.sql and types/schema.sql.
-- Keeps customers.balance = SUM(sales.remaining_balance) per customer.

DROP FUNCTION IF EXISTS public.compute_customer_open_ar(UUID);
DROP FUNCTION IF EXISTS public.refresh_customer_ar_balance(UUID);
DROP FUNCTION IF EXISTS public.check_customer_ar_discrepancies();
DROP FUNCTION IF EXISTS public.reconcile_customer_ar_balances(UUID);
DROP FUNCTION IF EXISTS public.void_sale_atomic(UUID, TEXT);

CREATE OR REPLACE FUNCTION public.compute_customer_open_ar(p_customer_id UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(SUM(GREATEST(COALESCE(remaining_balance, 0), 0)), 0)
  FROM sales
  WHERE customer_id = p_customer_id;
$$;

CREATE OR REPLACE FUNCTION public.refresh_customer_ar_balance(p_customer_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_open_ar NUMERIC;
BEGIN
  IF p_customer_id IS NULL THEN
    RETURN 0;
  END IF;

  v_open_ar := public.compute_customer_open_ar(p_customer_id);

  UPDATE customers
  SET balance = COALESCE(v_open_ar, 0)
  WHERE id = p_customer_id;

  RETURN COALESCE(v_open_ar, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.refresh_customer_ar_balance(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.check_customer_ar_discrepancies()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rows JSONB := '[]'::jsonb;
BEGIN
  SELECT COALESCE(jsonb_agg(row_payload ORDER BY customer_name), '[]'::jsonb)
  INTO v_rows
  FROM (
    SELECT jsonb_build_object(
      'customer_id', c.id,
      'customer_name', COALESCE(NULLIF(trim(c.full_name), ''), NULLIF(trim(c.name), ''), NULLIF(trim(c.company_name), ''), c.code, c.id::text),
      'stored_balance', COALESCE(c.balance, 0),
      'ledger_balance', COALESCE(SUM(GREATEST(COALESCE(s.remaining_balance, 0), 0)), 0),
      'delta', COALESCE(c.balance, 0) - COALESCE(SUM(GREATEST(COALESCE(s.remaining_balance, 0), 0)), 0)
    ) AS row_payload,
    COALESCE(NULLIF(trim(c.full_name), ''), NULLIF(trim(c.name), ''), c.code, c.id::text) AS customer_name
    FROM customers c
    LEFT JOIN sales s ON s.customer_id = c.id
    GROUP BY c.id, c.full_name, c.name, c.company_name, c.code, c.balance
    HAVING abs(COALESCE(c.balance, 0) - COALESCE(SUM(GREATEST(COALESCE(s.remaining_balance, 0), 0)), 0)) > 0.01
  ) mismatches;

  RETURN jsonb_build_object(
    'discrepancy_count', jsonb_array_length(v_rows),
    'discrepancies', v_rows
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.check_customer_ar_discrepancies() TO authenticated;

CREATE OR REPLACE FUNCTION public.reconcile_customer_ar_balances(
  p_customer_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer RECORD;
  v_fixed INT := 0;
  v_results JSONB := '[]'::jsonb;
  v_before NUMERIC;
  v_after NUMERIC;
BEGIN
  IF NOT (
    public.require_permission('can_manage_finance')
    OR public.require_permission('can_edit_sales')
    OR public.require_permission('can_manage_settings')
  ) THEN
    RAISE EXCEPTION 'forbidden'
      USING ERRCODE = '42501',
            MESSAGE = 'Müştəri borc uyğunlaşdırması üçün icazəniz yoxdur';
  END IF;

  FOR v_customer IN
    SELECT id, balance, full_name, name, company_name, code
    FROM customers
    WHERE p_customer_id IS NULL OR id = p_customer_id
    ORDER BY full_name NULLS LAST, name NULLS LAST
  LOOP
    v_before := COALESCE(v_customer.balance, 0);
    v_after := public.refresh_customer_ar_balance(v_customer.id);

    IF abs(v_before - COALESCE(v_after, 0)) > 0.01 THEN
      v_fixed := v_fixed + 1;
    END IF;

    v_results := v_results || jsonb_build_array(
      jsonb_build_object(
        'customer_id', v_customer.id,
        'customer_name', COALESCE(NULLIF(trim(v_customer.full_name), ''), NULLIF(trim(v_customer.name), ''), NULLIF(trim(v_customer.company_name), ''), v_customer.code, v_customer.id::text),
        'previous_balance', v_before,
        'ledger_balance', COALESCE(v_after, 0),
        'adjusted', abs(v_before - COALESCE(v_after, 0)) > 0.01
      )
    );
  END LOOP;

  IF p_customer_id IS NOT NULL AND jsonb_array_length(v_results) = 0 THEN
    RAISE EXCEPTION 'customer_not_found'
      USING ERRCODE = 'P0002',
            MESSAGE = 'Müştəri tapılmadı';
  END IF;

  RETURN jsonb_build_object(
    'customers_checked', jsonb_array_length(v_results),
    'customers_adjusted', v_fixed,
    'results', v_results
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.reconcile_customer_ar_balances(UUID) TO authenticated;

-- Void / cancel an open sale invoice and resync customer AR.
CREATE OR REPLACE FUNCTION public.void_sale_atomic(
  p_sale_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale sales%ROWTYPE;
  v_note TEXT;
BEGIN
  IF NOT public.require_permission('can_delete_sales')
     AND NOT public.require_permission('can_edit_sales') THEN
    RAISE EXCEPTION 'forbidden'
      USING ERRCODE = '42501',
            MESSAGE = 'Satış ləğvi üçün icazəniz yoxdur';
  END IF;

  SELECT * INTO v_sale
  FROM sales
  WHERE id = p_sale_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'sale_not_found'
      USING ERRCODE = 'P0002',
            MESSAGE = 'Satış fakturası tapılmadı';
  END IF;

  IF COALESCE(v_sale.remaining_balance, 0) <= 0.0001
     AND COALESCE(v_sale.paid_amount, 0) <= 0.0001 THEN
    RETURN jsonb_build_object(
      'sale_id', p_sale_id,
      'already_void', true
    );
  END IF;

  v_note := trim(COALESCE(p_reason, ''));
  IF v_note = '' THEN
    v_note := 'Satış ləğv edildi';
  END IF;

  UPDATE sales
  SET
    remaining_balance = 0,
    note = COALESCE(note, v_note),
    notes = CASE
      WHEN notes IS NULL OR trim(notes) = '' THEN v_note
      ELSE notes || E'\n' || v_note
    END
  WHERE id = p_sale_id;

  IF v_sale.customer_id IS NOT NULL THEN
    PERFORM public.refresh_customer_ar_balance(v_sale.customer_id);
  END IF;

  RETURN jsonb_build_object(
    'sale_id', p_sale_id,
    'customer_id', v_sale.customer_id,
    'previous_remaining', COALESCE(v_sale.remaining_balance, 0),
    'already_void', false
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.void_sale_atomic(UUID, TEXT) TO authenticated;
