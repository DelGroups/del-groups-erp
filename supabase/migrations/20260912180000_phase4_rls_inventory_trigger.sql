-- Phase 4: Role/department-scoped RLS, core table hardening, sales-posted inventory trigger.
-- "Posted" (təsdiqlənmiş) is the approved state for Satış Fakturası.

-- ─── Permission + scope helpers (role + user overrides) ─────────────────────

CREATE OR REPLACE FUNCTION public.effective_user_permissions()
RETURNS JSONB
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(r.permissions, '{}'::jsonb) || COALESCE(p.permission_overrides, '{}'::jsonb)
  FROM public.profiles p
  LEFT JOIN public.roles r ON r.id = p.role_id
  WHERE p.id = auth.uid()
    AND COALESCE(p.is_active, TRUE)
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.current_user_scopes()
RETURNS JSONB
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(r.scopes, '{}'::jsonb) || COALESCE(p.scope_overrides, '{}'::jsonb)
  FROM public.profiles p
  LEFT JOIN public.roles r ON r.id = p.role_id
  WHERE p.id = auth.uid()
    AND COALESCE(p.is_active, TRUE)
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.current_user_role_name()
RETURNS TEXT
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.name
  FROM public.profiles p
  LEFT JOIN public.roles r ON r.id = p.role_id
  WHERE p.id = auth.uid()
    AND COALESCE(p.is_active, TRUE)
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.current_user_department()
RETURNS TEXT
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e.department
  FROM public.profiles p
  LEFT JOIN public.employees e ON e.id = p.employee_id
  WHERE p.id = auth.uid()
    AND COALESCE(p.is_active, TRUE)
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.user_is_admin()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT lower(COALESCE(public.current_user_role_name(), '')) = 'admin';
$$;

CREATE OR REPLACE FUNCTION public.user_record_access_all()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    public.current_user_scopes() ->> 'record_access',
    'ALL_RECORDS'
  ) IN ('ALL_RECORDS', '"ALL_RECORDS"');
$$;

CREATE OR REPLACE FUNCTION public.user_can_access_own_sales_row(
  p_created_by UUID,
  p_seller_id UUID,
  p_issued_by UUID
)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.user_record_access_all()
    OR auth.uid() IS NOT DISTINCT FROM p_created_by
    OR auth.uid() IS NOT DISTINCT FROM p_seller_id
    OR auth.uid() IS NOT DISTINCT FROM p_issued_by;
$$;

CREATE OR REPLACE FUNCTION public.user_has_warehouse_access(p_warehouse_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.user_is_admin()
    OR p_warehouse_id IS NULL
    OR COALESCE(jsonb_array_length(public.current_user_scopes() -> 'allowed_warehouses'), 0) = 0
    OR (public.current_user_scopes() -> 'allowed_warehouses') @> to_jsonb(p_warehouse_id::text);
$$;

CREATE OR REPLACE FUNCTION public.user_can_read_employee_row(p_department TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.user_is_admin()
    OR public.user_record_access_all()
    OR public.current_user_department() IS NULL
    OR p_department IS NULL
    OR p_department = public.current_user_department();
$$;

CREATE OR REPLACE FUNCTION public.has_permission(perm TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (public.effective_user_permissions() ->> perm)::boolean,
    FALSE
  );
$$;

CREATE OR REPLACE FUNCTION public.current_user_permissions()
RETURNS JSONB
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.effective_user_permissions();
$$;

CREATE OR REPLACE FUNCTION public.require_permission(perm TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  RETURN public.is_active_user()
     AND public.has_permission(perm);
END;
$function$;

-- ─── RLS helper (idempotent per table) ───────────────────────────────────────

CREATE OR REPLACE FUNCTION public._apply_table_rls(
  p_table text,
  view_perm text,
  insert_perm text,
  update_perm text,
  delete_perm text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_schema text;
  v_table text;
  v_regclass regclass;
BEGIN
  IF position('.' IN p_table) > 0 THEN
    v_schema := split_part(p_table, '.', 1);
    v_table := split_part(p_table, '.', 2);
  ELSE
    v_schema := 'public';
    v_table := p_table;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = v_schema
      AND table_name = v_table
  ) THEN
    RAISE NOTICE 'Skipping RLS: table %.% does not exist', v_schema, v_table;
    RETURN;
  END IF;

  v_regclass := (format('%I.%I', v_schema, v_table))::regclass;

  EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', v_regclass);

  EXECUTE format('DROP POLICY IF EXISTS %I ON %s', v_table || '_select', v_regclass);
  EXECUTE format(
    'CREATE POLICY %I ON %s FOR SELECT TO authenticated USING (public.require_permission(%L))',
    v_table || '_select',
    v_regclass,
    view_perm
  );

  EXECUTE format('DROP POLICY IF EXISTS %I ON %s', v_table || '_insert', v_regclass);
  EXECUTE format(
    'CREATE POLICY %I ON %s FOR INSERT TO authenticated WITH CHECK (public.require_permission(%L))',
    v_table || '_insert',
    v_regclass,
    insert_perm
  );

  EXECUTE format('DROP POLICY IF EXISTS %I ON %s', v_table || '_update', v_regclass);
  EXECUTE format(
    'CREATE POLICY %I ON %s FOR UPDATE TO authenticated USING (public.require_permission(%L)) WITH CHECK (public.require_permission(%L))',
    v_table || '_update',
    v_regclass,
    update_perm,
    update_perm
  );

  EXECUTE format('DROP POLICY IF EXISTS %I ON %s', v_table || '_delete', v_regclass);
  EXECUTE format(
    'CREATE POLICY %I ON %s FOR DELETE TO authenticated USING (public.require_permission(%L))',
    v_table || '_delete',
    v_regclass,
    delete_perm
  );
END;
$function$;

-- ─── Core ERP tables (permission-based baseline) ─────────────────────────────

SELECT public._apply_table_rls('sales', 'can_view_sales', 'can_create_invoice', 'can_edit_sales', 'can_delete_sales');
SELECT public._apply_table_rls('sale_items', 'can_view_sales', 'can_create_invoice', 'can_edit_sales', 'can_delete_sales');
SELECT public._apply_table_rls('purchases', 'can_view_purchases', 'can_create_purchase', 'can_edit_purchases', 'can_delete_purchases');
SELECT public._apply_table_rls('purchase_items', 'can_view_purchases', 'can_create_purchase', 'can_edit_purchases', 'can_delete_purchases');
SELECT public._apply_table_rls('products', 'can_view_products', 'can_manage_products', 'can_manage_products', 'can_manage_products');
SELECT public._apply_table_rls('categories', 'can_view_products', 'can_manage_products', 'can_manage_products', 'can_manage_products');
SELECT public._apply_table_rls('warehouses', 'can_view_products', 'can_manage_warehouses', 'can_manage_warehouses', 'can_manage_warehouses');
SELECT public._apply_table_rls('inventory_writeoffs', 'can_view_products', 'can_writeoff_inventory', 'can_writeoff_inventory', 'can_writeoff_inventory');
SELECT public._apply_table_rls('customers', 'can_view_customers', 'can_manage_customers', 'can_manage_customers', 'can_manage_customers');
SELECT public._apply_table_rls('suppliers', 'can_view_suppliers', 'can_manage_suppliers', 'can_manage_suppliers', 'can_manage_suppliers');
SELECT public._apply_table_rls('accounts', 'can_view_finance', 'can_manage_finance', 'can_manage_finance', 'can_manage_finance');
SELECT public._apply_table_rls('transactions', 'can_view_finance', 'can_manage_finance', 'can_manage_finance', 'can_manage_finance');
SELECT public._apply_table_rls('expenses', 'can_view_expenses', 'can_manage_expenses', 'can_manage_expenses', 'can_manage_expenses');
SELECT public._apply_table_rls('employees', 'can_view_hr', 'can_manage_hr', 'can_manage_hr', 'can_manage_hr');
SELECT public._apply_table_rls('settings', 'can_view_settings', 'can_manage_settings', 'can_manage_settings', 'can_manage_settings');
SELECT public._apply_table_rls('company_settings', 'can_view_settings', 'can_manage_settings', 'can_manage_settings', 'can_manage_settings');

-- ─── Scoped policies: sales invoices (own-record + warehouse) ────────────────

DROP POLICY IF EXISTS sales_select ON public.sales;
CREATE POLICY sales_select ON public.sales
  FOR SELECT TO authenticated
  USING (
    public.require_permission('can_view_sales')
    AND public.user_can_access_own_sales_row(created_by, seller_id, issued_by)
  );

DROP POLICY IF EXISTS sales_insert ON public.sales;
CREATE POLICY sales_insert ON public.sales
  FOR INSERT TO authenticated
  WITH CHECK (public.require_permission('can_create_invoice'));

DROP POLICY IF EXISTS sales_update ON public.sales;
CREATE POLICY sales_update ON public.sales
  FOR UPDATE TO authenticated
  USING (
    public.require_permission('can_edit_sales')
    AND public.user_can_access_own_sales_row(created_by, seller_id, issued_by)
  )
  WITH CHECK (
    public.require_permission('can_edit_sales')
    AND public.user_can_access_own_sales_row(created_by, seller_id, issued_by)
  );

DROP POLICY IF EXISTS sales_delete ON public.sales;
CREATE POLICY sales_delete ON public.sales
  FOR DELETE TO authenticated
  USING (
    public.require_permission('can_delete_sales')
    AND (
      public.user_is_admin()
      OR public.user_record_access_all()
      OR auth.uid() IS NOT DISTINCT FROM created_by
    )
  );

DROP POLICY IF EXISTS sale_items_select ON public.sale_items;
CREATE POLICY sale_items_select ON public.sale_items
  FOR SELECT TO authenticated
  USING (
    public.require_permission('can_view_sales')
    AND EXISTS (
      SELECT 1
      FROM public.sales s
      WHERE s.id = sale_items.sale_id
        AND public.user_can_access_own_sales_row(s.created_by, s.seller_id, s.issued_by)
    )
    AND public.user_has_warehouse_access(sale_items.warehouse_id)
  );

DROP POLICY IF EXISTS sale_items_insert ON public.sale_items;
CREATE POLICY sale_items_insert ON public.sale_items
  FOR INSERT TO authenticated
  WITH CHECK (
    public.require_permission('can_create_invoice')
    AND public.user_has_warehouse_access(warehouse_id)
  );

DROP POLICY IF EXISTS sale_items_update ON public.sale_items;
CREATE POLICY sale_items_update ON public.sale_items
  FOR UPDATE TO authenticated
  USING (
    public.require_permission('can_edit_sales')
    AND public.user_has_warehouse_access(warehouse_id)
  )
  WITH CHECK (
    public.require_permission('can_edit_sales')
    AND public.user_has_warehouse_access(warehouse_id)
  );

DROP POLICY IF EXISTS sale_items_delete ON public.sale_items;
CREATE POLICY sale_items_delete ON public.sale_items
  FOR DELETE TO authenticated
  USING (public.require_permission('can_delete_sales'));

-- ─── Scoped policies: HR / employees (department) ────────────────────────────

DROP POLICY IF EXISTS employees_select ON public.employees;
CREATE POLICY employees_select ON public.employees
  FOR SELECT TO authenticated
  USING (
    public.require_permission('can_view_hr')
    AND public.user_can_read_employee_row(department)
  );

DROP POLICY IF EXISTS employees_update ON public.employees;
CREATE POLICY employees_update ON public.employees
  FOR UPDATE TO authenticated
  USING (
    public.require_permission('can_manage_hr')
    AND (
      public.user_is_admin()
      OR public.user_can_read_employee_row(department)
    )
  )
  WITH CHECK (
    public.require_permission('can_manage_hr')
    AND (
      public.user_is_admin()
      OR public.user_can_read_employee_row(department)
    )
  );

-- ─── Profiles / roles (users module) ─────────────────────────────────────────

DROP POLICY IF EXISTS profiles_select ON public.profiles;
CREATE POLICY profiles_select ON public.profiles
  FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR public.has_permission('can_manage_users')
  );

DROP POLICY IF EXISTS profiles_update ON public.profiles;
CREATE POLICY profiles_update ON public.profiles
  FOR UPDATE TO authenticated
  USING (
    (id = auth.uid() AND public.is_active_user())
    OR public.has_permission('can_manage_users')
  )
  WITH CHECK (
    (id = auth.uid() AND public.is_active_user())
    OR public.has_permission('can_manage_users')
  );

DROP POLICY IF EXISTS profiles_insert ON public.profiles;
CREATE POLICY profiles_insert ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (public.has_permission('can_manage_users'));

DROP POLICY IF EXISTS profiles_delete ON public.profiles;
CREATE POLICY profiles_delete ON public.profiles
  FOR DELETE TO authenticated
  USING (public.has_permission('can_manage_users'));

DROP POLICY IF EXISTS roles_insert ON public.roles;
CREATE POLICY roles_insert ON public.roles
  FOR INSERT TO authenticated
  WITH CHECK (public.has_permission('can_manage_roles'));

DROP POLICY IF EXISTS roles_update ON public.roles;
CREATE POLICY roles_update ON public.roles
  FOR UPDATE TO authenticated
  USING (public.has_permission('can_manage_roles'))
  WITH CHECK (public.has_permission('can_manage_roles'));

DROP POLICY IF EXISTS roles_delete ON public.roles;
CREATE POLICY roles_delete ON public.roles
  FOR DELETE TO authenticated
  USING (public.has_permission('can_manage_roles') AND NOT is_system);

-- ─── Inventory audit trail ───────────────────────────────────────────────────

ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS stock_movements_select_authenticated ON public.stock_movements;
DROP POLICY IF EXISTS stock_movements_insert_authenticated ON public.stock_movements;

CREATE POLICY stock_movements_select ON public.stock_movements
  FOR SELECT TO authenticated
  USING (public.require_permission('can_view_products'));

CREATE POLICY stock_movements_insert ON public.stock_movements
  FOR INSERT TO authenticated
  WITH CHECK (
    public.require_permission('can_manage_products')
    OR public.require_permission('can_create_invoice')
    OR public.require_permission('can_edit_sales')
  );

-- ─── Sales posted → warehouse stock deduction (idempotent trigger) ───────────

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS inventory_deducted_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.handle_sales_posted_inventory()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_items JSONB := '[]'::jsonb;
  v_stock_demand JSONB := '{}'::jsonb;
  v_line RECORD;
BEGIN
  IF NEW.status IS DISTINCT FROM 'posted' THEN
    RETURN NEW;
  END IF;

  IF COALESCE(OLD.status, '') = 'posted' THEN
    RETURN NEW;
  END IF;

  IF OLD.inventory_deducted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'product_id', si.product_id,
        'quantity', si.quantity,
        'warehouse_id', si.warehouse_id,
        'polywood_sale_mode', si.polywood_sale_mode,
        'polywood_length_m', si.polywood_length_m,
        'skip_stock', (si.polywood_sale_mode IS NOT NULL AND btrim(si.polywood_sale_mode) <> '')
      )
      ORDER BY si.id
    ),
    '[]'::jsonb
  )
  INTO v_items
  FROM public.sale_items si
  WHERE si.sale_id = NEW.id;

  IF jsonb_array_length(v_items) = 0 THEN
    RETURN NEW;
  END IF;

  v_stock_demand := public.build_and_validate_sale_stock_demand(v_items);
  PERFORM public.apply_sale_stock_decrement(v_stock_demand);

  FOR v_line IN
    SELECT
      si.id,
      si.product_id,
      si.quantity,
      si.warehouse_id,
      si.unit,
      p.name AS product_name
    FROM public.sale_items si
    LEFT JOIN public.products p ON p.id = si.product_id
    WHERE si.sale_id = NEW.id
      AND si.product_id IS NOT NULL
      AND COALESCE(si.quantity, 0) > 0
      AND (si.polywood_sale_mode IS NULL OR btrim(si.polywood_sale_mode) = '')
  LOOP
    INSERT INTO public.stock_movements (
      product_id,
      warehouse_id,
      movement_type,
      quantity,
      unit,
      reference_type,
      reference_id,
      source_line_id,
      description,
      created_by
    )
    VALUES (
      v_line.product_id,
      v_line.warehouse_id,
      'out',
      v_line.quantity,
      COALESCE(v_line.unit, 'Ədəd'),
      'sale',
      NEW.id,
      v_line.id,
      format('Satış fakturası %s — %s', COALESCE(NEW.doc_no, NEW.id::text), COALESCE(v_line.product_name, '')),
      auth.uid()
    );
  END LOOP;

  NEW.inventory_deducted_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sales_posted_inventory ON public.sales;
CREATE TRIGGER trg_sales_posted_inventory
  BEFORE UPDATE OF status ON public.sales
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_sales_posted_inventory();

-- Keep RPC posting idempotent with the trigger (sets inventory_deducted_at in same UPDATE).
CREATE OR REPLACE FUNCTION public.post_sales_invoice_draft(p_sale_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale RECORD;
  v_items JSONB := '[]'::jsonb;
  v_payments JSONB;
  v_stock_demand JSONB := '{}'::jsonb;
  v_pay JSONB;
  v_pay_amount NUMERIC;
  v_account_id UUID;
  v_pay_method TEXT;
  v_journal_id UUID;
  v_cogs_result JSONB;
  v_total_cogs NUMERIC := 0;
  v_cogs_journal_id UUID;
  v_add_exp_total NUMERIC;
  v_idempotency TEXT;
  v_result JSONB;
  v_event_id UUID;
BEGIN
  IF p_sale_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload'
      USING ERRCODE = '22023',
            MESSAGE = 'Satış ID göndərilməyib';
  END IF;

  IF NOT (
    public.require_permission('can_edit_sales')
    OR public.require_permission('can_create_invoice')
    OR public.require_permission('can_manage_finance')
  ) THEN
    RAISE EXCEPTION 'forbidden'
      USING ERRCODE = '42501',
            MESSAGE = 'Satış təsdiqləmək üçün icazəniz yoxdur';
  END IF;

  SELECT * INTO v_sale FROM sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'sale_not_found'
      USING ERRCODE = 'P0002',
            MESSAGE = 'Satış sənədi tapılmadı';
  END IF;

  IF v_sale.status = 'posted' THEN
    RAISE EXCEPTION 'already_posted'
      USING ERRCODE = '22023',
            MESSAGE = 'Sənəd artıq təsdiqlənib';
  END IF;

  IF v_sale.status IN ('cancelled', 'void', 'voided') THEN
    RAISE EXCEPTION 'cancelled_document'
      USING ERRCODE = '22023',
            MESSAGE = 'Ləğv edilmiş sənəd təsdiqlənə bilməz';
  END IF;

  IF COALESCE(v_sale.total_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'invalid_total_amount'
      USING ERRCODE = '22023',
            MESSAGE = 'Satış məbləği sıfırdan böyük olmalıdır';
  END IF;

  IF COALESCE(v_sale.paid_amount, 0) > COALESCE(v_sale.total_amount, 0) + 0.0001 THEN
    RAISE EXCEPTION 'overpaid'
      USING ERRCODE = '22023',
            MESSAGE = 'Ödənilən məbləğ ümumi məbləğdən böyük ola bilməz';
  END IF;

  SELECT COALESCE(jsonb_agg(item_json ORDER BY ord), '[]'::jsonb)
  INTO v_items
  FROM (
    SELECT
      row_number() OVER (ORDER BY id) AS ord,
      jsonb_build_object(
        'product_id', product_id,
        'quantity', quantity,
        'warehouse_id', warehouse_id,
        'polywood_sale_mode', polywood_sale_mode,
        'polywood_length_m', polywood_length_m,
        'skip_stock', (polywood_sale_mode IS NOT NULL AND btrim(polywood_sale_mode) <> '')
      ) AS item_json
    FROM sale_items
    WHERE sale_id = p_sale_id
  ) lined;

  IF jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'items_required'
      USING ERRCODE = '22023',
            MESSAGE = 'Ən azı bir satış sətri tələb olunur';
  END IF;

  -- Stock deduction is handled by trg_sales_posted_inventory when status becomes posted.
  -- Pre-validate demand so posting fails before side effects if stock is insufficient.
  PERFORM public.build_and_validate_sale_stock_demand(v_items);

  v_idempotency := 'sale_invoice:' || p_sale_id::text;
  v_cogs_result := public.process_sale_fifo_cogs(
    p_sale_id,
    v_sale.doc_no,
    v_idempotency || ':cogs'
  );
  v_total_cogs := COALESCE((v_cogs_result->>'total_cogs')::numeric, 0);
  v_cogs_journal_id := NULLIF(v_cogs_result->>'cogs_journal_entry_id', '')::uuid;

  v_payments := COALESCE(v_sale.payments, '[]'::jsonb);
  IF jsonb_typeof(v_payments) = 'array' THEN
    FOR v_pay IN SELECT value FROM jsonb_array_elements(v_payments)
    LOOP
      v_pay_amount := COALESCE(NULLIF(v_pay->>'amount', '')::numeric, 0);
      IF v_pay_amount <= 0 THEN
        CONTINUE;
      END IF;

      v_account_id := NULLIF(v_pay->>'account_id', '')::uuid;
      IF v_account_id IS NULL THEN
        RAISE EXCEPTION 'account_required'
          USING ERRCODE = '22023',
                MESSAGE = 'Ödəniş üçün kassa/bank hesabı seçilməlidir';
      END IF;

      PERFORM id FROM accounts WHERE id = v_account_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'account_not_found'
          USING ERRCODE = 'P0002',
                MESSAGE = 'Seçilmiş kassa/bank hesabı tapılmadı';
      END IF;

      v_pay_method := COALESCE(NULLIF(trim(v_pay->>'method'), ''), 'Ödəniş');
      PERFORM public.post_cash_transaction(
        v_account_id,
        'Mədaxil',
        v_pay_amount,
        'Satış Ödənişi',
        format('Satış fakturası %s — %s', v_sale.doc_no, v_pay_method),
        NULL,
        'sale',
        p_sale_id
      );
    END LOOP;
  END IF;

  v_add_exp_total := public.apply_document_additional_expenses(
    COALESCE(v_sale.additional_expenses, '[]'::jsonb),
    'sale',
    p_sale_id,
    v_sale.doc_no
  );

  v_journal_id := public.post_sale_invoice_gl_journal(
    p_sale_id,
    v_sale.doc_no,
    v_sale.total_amount,
    v_sale.customer_id,
    v_idempotency
  );

  UPDATE sales
  SET status = 'posted',
      posted_at = NOW(),
      additional_expenses_total = v_add_exp_total
  WHERE id = p_sale_id;

  PERFORM public.refresh_customer_ar_balance(v_sale.customer_id);

  v_result := jsonb_build_object(
    'success', true,
    'event_type', 'sales_invoice_post',
    'sale_id', p_sale_id,
    'doc_no', v_sale.doc_no,
    'status', 'posted',
    'journal_entry_id', v_journal_id,
    'cogs_journal_entry_id', v_cogs_journal_id,
    'total_cogs', v_total_cogs,
    'total_amount', v_sale.total_amount,
    'paid_amount', v_sale.paid_amount,
    'remaining_balance', v_sale.remaining_balance
  );

  v_event_id := public.log_erp_event(
    'sales_invoice',
    'sales',
    p_sale_id,
    'post',
    v_result,
    auth.uid()
  );

  RETURN v_result || jsonb_build_object('event_id', v_event_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.effective_user_permissions() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_user_scopes() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.handle_sales_posted_inventory() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
