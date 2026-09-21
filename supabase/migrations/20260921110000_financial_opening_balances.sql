-- Phase 3: "Maliyyə İlkin Qalıqları" — opening balances for Customer
-- Receivables and Vendor Payables, independent of the inventory module.
-- Cash/Bank opening balances already exist via accounts.balance +
-- set_account_opening_balance_atomic (types/account-mutations.sql); this adds
-- the missing AR/AP counterpart, following the same double-entry pattern
-- against COA 3900 (İlkin qalıq kapitalı).

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS opening_balance NUMERIC NOT NULL DEFAULT 0;

ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS opening_balance NUMERIC NOT NULL DEFAULT 0;

-- Fold opening_balance into the live AR/AP computation so it survives any
-- refresh/reconcile pass triggered by sales, purchases or payments.
CREATE OR REPLACE FUNCTION public.compute_customer_open_ar(p_customer_id UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(SUM(GREATEST(COALESCE(remaining_balance, 0), 0)), 0)
    + COALESCE((SELECT opening_balance FROM public.customers WHERE id = p_customer_id), 0)
  FROM public.sales
  WHERE customer_id = p_customer_id;
$$;

CREATE OR REPLACE FUNCTION public.compute_supplier_open_ap(p_supplier_id UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(SUM(GREATEST(COALESCE(debt_amount, 0), 0)), 0)
    + COALESCE((SELECT opening_balance FROM public.suppliers WHERE id = p_supplier_id), 0)
  FROM public.purchases
  WHERE supplier_id = p_supplier_id;
$$;

CREATE OR REPLACE FUNCTION public.set_customer_opening_balance_atomic(
  p_customer_id UUID,
  p_opening_balance NUMERIC
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old NUMERIC;
  v_new NUMERIC := GREATEST(COALESCE(p_opening_balance, 0), 0);
  v_delta NUMERIC;
BEGIN
  SELECT COALESCE(opening_balance, 0) INTO v_old
  FROM public.customers
  WHERE id = p_customer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Müştəri tapılmadı';
  END IF;

  v_delta := v_new - v_old;

  UPDATE public.customers
  SET opening_balance = v_new
  WHERE id = p_customer_id;

  IF abs(v_delta) > 0.0001 THEN
    PERFORM public.create_journal_entry(jsonb_build_object(
      'document_type', 'customer_opening_balance',
      'document_id', p_customer_id,
      'description', 'Müştəri ilkin qalığı',
      'lines', jsonb_build_array(
        jsonb_build_object(
          'account_code', '1200',
          'debit', GREATEST(v_delta, 0),
          'credit', GREATEST(-v_delta, 0),
          'partner_type', 'customer',
          'partner_id', p_customer_id
        ),
        jsonb_build_object(
          'account_code', '3900',
          'debit', GREATEST(-v_delta, 0),
          'credit', GREATEST(v_delta, 0)
        )
      )
    ));
  END IF;

  RETURN public.refresh_customer_ar_balance(p_customer_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.set_supplier_opening_balance_atomic(
  p_supplier_id UUID,
  p_opening_balance NUMERIC
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old NUMERIC;
  v_new NUMERIC := GREATEST(COALESCE(p_opening_balance, 0), 0);
  v_delta NUMERIC;
BEGIN
  SELECT COALESCE(opening_balance, 0) INTO v_old
  FROM public.suppliers
  WHERE id = p_supplier_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Təchizatçı tapılmadı';
  END IF;

  v_delta := v_new - v_old;

  UPDATE public.suppliers
  SET opening_balance = v_new
  WHERE id = p_supplier_id;

  IF abs(v_delta) > 0.0001 THEN
    PERFORM public.create_journal_entry(jsonb_build_object(
      'document_type', 'supplier_opening_balance',
      'document_id', p_supplier_id,
      'description', 'Təchizatçı ilkin qalığı',
      'lines', jsonb_build_array(
        jsonb_build_object(
          'account_code', '3900',
          'debit', GREATEST(v_delta, 0),
          'credit', GREATEST(-v_delta, 0)
        ),
        jsonb_build_object(
          'account_code', '2100',
          'debit', GREATEST(-v_delta, 0),
          'credit', GREATEST(v_delta, 0),
          'partner_type', 'supplier',
          'partner_id', p_supplier_id
        )
      )
    ));
  END IF;

  RETURN public.refresh_supplier_ap_balance(p_supplier_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_customer_opening_balance_atomic(UUID, NUMERIC) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_supplier_opening_balance_atomic(UUID, NUMERIC) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
