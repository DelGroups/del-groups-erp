-- Del Groups ERP - Security hardening migration
-- Run in Supabase SQL Editor AFTER types/rbac-migration.sql and types/schema.sql.

-- Drop old helper overloads before recreating (safe to re-run).
DROP FUNCTION IF EXISTS public._apply_table_rls(regclass, text, text, text, text);
DROP FUNCTION IF EXISTS public._apply_table_rls(text, text, text, text, text);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_active_user()
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $function$
BEGIN
  RETURN EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND is_active IS TRUE
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.require_permission(perm text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO public
AS $function$
BEGIN
  RETURN public.is_active_user()
     AND public.has_permission(perm);
END;
$function$;

-- ---------------------------------------------------------------------------
-- Profile column guard
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.guard_profile_sensitive_updates()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $function$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.id = auth.uid() AND NOT public.has_permission('can_manage_users') THEN
    IF NEW.role_id IS DISTINCT FROM OLD.role_id
       OR NEW.is_active IS DISTINCT FROM OLD.is_active
       OR NEW.employee_id IS DISTINCT FROM OLD.employee_id
       OR NEW.email IS DISTINCT FROM OLD.email
       OR NEW.id IS DISTINCT FROM OLD.id THEN
      RAISE EXCEPTION 'profile_update_forbidden'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS profiles_guard_sensitive_updates ON public.profiles;
CREATE TRIGGER profiles_guard_sensitive_updates
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_profile_sensitive_updates();

DROP POLICY IF EXISTS profiles_update ON public.profiles;
CREATE POLICY profiles_update ON public.profiles
  FOR UPDATE TO authenticated
  USING (
    (id = auth.uid() AND public.is_active_user())
    OR public.has_permission('can_manage_users')
  );

-- ---------------------------------------------------------------------------
-- RLS helper: p_table = bare name ('sales') or qualified ('public.sales')
-- Skips missing tables with a NOTICE instead of failing.
-- ---------------------------------------------------------------------------

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
SET search_path TO public
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

-- ---------------------------------------------------------------------------
-- Apply RLS policies
-- ---------------------------------------------------------------------------

SELECT public._apply_table_rls(
  'sales',
  'can_view_sales',
  'can_create_invoice',
  'can_edit_sales',
  'can_delete_sales'
);

SELECT public._apply_table_rls(
  'sale_items',
  'can_view_sales',
  'can_create_invoice',
  'can_edit_sales',
  'can_delete_sales'
);

SELECT public._apply_table_rls(
  'purchases',
  'can_view_purchases',
  'can_create_purchase',
  'can_edit_purchases',
  'can_delete_purchases'
);

SELECT public._apply_table_rls(
  'purchase_items',
  'can_view_purchases',
  'can_create_purchase',
  'can_edit_purchases',
  'can_delete_purchases'
);

SELECT public._apply_table_rls(
  'products',
  'can_view_products',
  'can_manage_products',
  'can_manage_products',
  'can_manage_products'
);

SELECT public._apply_table_rls(
  'categories',
  'can_view_products',
  'can_manage_products',
  'can_manage_products',
  'can_manage_products'
);

SELECT public._apply_table_rls(
  'warehouses',
  'can_view_products',
  'can_manage_warehouses',
  'can_manage_warehouses',
  'can_manage_warehouses'
);

SELECT public._apply_table_rls(
  'inventory_writeoffs',
  'can_view_products',
  'can_writeoff_inventory',
  'can_writeoff_inventory',
  'can_writeoff_inventory'
);

SELECT public._apply_table_rls(
  'customers',
  'can_view_customers',
  'can_manage_customers',
  'can_manage_customers',
  'can_manage_customers'
);

SELECT public._apply_table_rls(
  'suppliers',
  'can_view_suppliers',
  'can_manage_suppliers',
  'can_manage_suppliers',
  'can_manage_suppliers'
);

SELECT public._apply_table_rls(
  'accounts',
  'can_view_finance',
  'can_manage_finance',
  'can_manage_finance',
  'can_manage_finance'
);

SELECT public._apply_table_rls(
  'transactions',
  'can_view_finance',
  'can_manage_finance',
  'can_manage_finance',
  'can_manage_finance'
);

SELECT public._apply_table_rls(
  'expenses',
  'can_view_expenses',
  'can_manage_expenses',
  'can_manage_expenses',
  'can_manage_expenses'
);

SELECT public._apply_table_rls(
  'employees',
  'can_view_hr',
  'can_manage_hr',
  'can_manage_hr',
  'can_manage_hr'
);

SELECT public._apply_table_rls(
  'salary_payments',
  'can_view_hr',
  'can_manage_hr',
  'can_manage_hr',
  'can_manage_hr'
);

SELECT public._apply_table_rls(
  'sales_commissions',
  'can_view_commissions',
  'can_manage_commissions',
  'can_manage_commissions',
  'can_manage_commissions'
);

SELECT public._apply_table_rls(
  'commission_rules',
  'can_view_commissions',
  'can_manage_commissions',
  'can_manage_commissions',
  'can_manage_commissions'
);

SELECT public._apply_table_rls(
  'employee_commission_rules',
  'can_view_commissions',
  'can_manage_commissions',
  'can_manage_commissions',
  'can_manage_commissions'
);

SELECT public._apply_table_rls(
  'consignment_orders',
  'can_view_consignments',
  'can_manage_consignments',
  'can_manage_consignments',
  'can_manage_consignments'
);

SELECT public._apply_table_rls(
  'settings',
  'can_view_settings',
  'can_manage_settings',
  'can_manage_settings',
  'can_manage_settings'
);

SELECT public._apply_table_rls(
  'company_settings',
  'can_view_settings',
  'can_manage_settings',
  'can_manage_settings',
  'can_manage_settings'
);

-- ---------------------------------------------------------------------------
-- Roles and profiles mutation policies
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS roles_insert ON public.roles;
CREATE POLICY roles_insert ON public.roles
  FOR INSERT TO authenticated
  WITH CHECK (public.require_permission('can_manage_roles'));

DROP POLICY IF EXISTS roles_update ON public.roles;
CREATE POLICY roles_update ON public.roles
  FOR UPDATE TO authenticated
  USING (public.require_permission('can_manage_roles'))
  WITH CHECK (public.require_permission('can_manage_roles'));

DROP POLICY IF EXISTS roles_delete ON public.roles;
CREATE POLICY roles_delete ON public.roles
  FOR DELETE TO authenticated
  USING (public.require_permission('can_manage_roles') AND NOT is_system);

DROP POLICY IF EXISTS profiles_insert ON public.profiles;
CREATE POLICY profiles_insert ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (public.require_permission('can_manage_users'));

DROP POLICY IF EXISTS profiles_delete ON public.profiles;
CREATE POLICY profiles_delete ON public.profiles
  FOR DELETE TO authenticated
  USING (public.require_permission('can_manage_users'));

-- Optional cleanup (comment out to keep helper for future migrations)
DROP FUNCTION IF EXISTS public._apply_table_rls(text, text, text, text, text);

-- Verification (run manually):
-- SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename;
