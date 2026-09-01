-- Finance integration fix — run in Supabase SQL Editor AFTER rbac + account-mutations + erp-events
-- Fixes: User role can create invoices/payments; cashiers can read accounts/transactions;
--        production expenses post through journal engine.

-- ─── Operational read access for invoice/purchase/production users ────────────

DROP POLICY IF EXISTS accounts_select ON public.accounts;
CREATE POLICY accounts_select ON public.accounts
  FOR SELECT TO authenticated
  USING (
    public.is_active_user()
    AND (
      public.has_permission('can_view_finance')
      OR public.has_permission('can_create_invoice')
      OR public.has_permission('can_create_purchase')
      OR public.has_permission('can_manage_production')
      OR public.has_permission('can_manage_finance')
    )
  );

DROP POLICY IF EXISTS transactions_select ON public.transactions;
CREATE POLICY transactions_select ON public.transactions
  FOR SELECT TO authenticated
  USING (
    public.is_active_user()
    AND (
      public.has_permission('can_view_finance')
      OR public.has_permission('can_create_invoice')
      OR public.has_permission('can_create_purchase')
      OR public.has_permission('can_manage_production')
      OR public.has_permission('can_manage_finance')
    )
  );

-- ─── Production expense → post_cash_transaction (journal + source linkage) ────

CREATE OR REPLACE FUNCTION public.create_production_expense_atomic(
  p_production_order_id UUID,
  p_code TEXT,
  p_category TEXT,
  p_description TEXT,
  p_amount NUMERIC,
  p_expense_date DATE,
  p_account_id UUID,
  p_account_name TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_actor_name TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tx_id UUID;
  v_finance_expense_id UUID;
  v_production_expense_id UUID;
  v_memo TEXT;
BEGIN
  IF NOT public.user_has_permission('can_manage_production') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'invalid_amount' USING ERRCODE = '22023';
  END IF;
  IF p_category NOT IN ('transport', 'delivery', 'installation', 'tools', 'other') THEN
    RAISE EXCEPTION 'invalid_category' USING ERRCODE = '22023';
  END IF;
  IF p_account_id IS NULL THEN
    RAISE EXCEPTION 'account_required' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM production_orders WHERE id = p_production_order_id) THEN
    RAISE EXCEPTION 'production_order_not_found' USING ERRCODE = 'P0002';
  END IF;

  v_memo := COALESCE(
    NULLIF(trim(p_notes), ''),
    format('İstehsalat: %s', trim(p_description))
  );

  v_tx_id := public.post_cash_transaction(
    p_account_id,
    'Məxaric',
    p_amount,
    'Digər',
    v_memo,
    p_production_order_id,
    'production',
    p_production_order_id
  );

  INSERT INTO expenses (code, category, amount, account_id, production_order_id, notes)
  VALUES (
    trim(p_code),
    'Digər',
    p_amount,
    p_account_id,
    p_production_order_id,
    NULLIF(trim(p_notes), '')
  )
  RETURNING id INTO v_finance_expense_id;

  INSERT INTO production_expenses (
    production_order_id, category, description, amount, expense_date,
    account_id, account_name, finance_expense_id, notes, created_by, created_by_name
  )
  VALUES (
    p_production_order_id, p_category, trim(p_description), p_amount,
    COALESCE(p_expense_date, CURRENT_DATE), p_account_id, NULLIF(trim(p_account_name), ''),
    v_finance_expense_id, NULLIF(trim(p_notes), ''), auth.uid(), NULLIF(trim(p_actor_name), '')
  )
  RETURNING id INTO v_production_expense_id;

  RETURN v_production_expense_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_production_expense_atomic(
  UUID, TEXT, TEXT, TEXT, NUMERIC, DATE, UUID, TEXT, TEXT, TEXT
) TO authenticated;

-- NOTE: Re-run types/erp-events-migration.sql (permission blocks updated) so User role
-- with can_create_invoice can submit sales and record payments.
