-- Close the RLS hole left by the original schema.
--
-- Verified on production 2026-10-05: 20 core tables still carry the policy
-- "Allow public access" (FOR ALL TO public USING (true) WITH CHECK (true)).
-- Permissive policies are OR-ed, so on these tables every signed-in user —
-- whatever their role — can read, change and delete every row, and the
-- require_permission() policies added later have no effect. This is how
-- products.stock / warehouse rows were edited and documents deleted outside
-- the posting functions (audit P0-5, P0-6). The anon role has no table
-- grants, so the hole is limited to authenticated users.
--
-- Not in any migration: the policy came from the original schema created in
-- the Supabase dashboard.
--
-- Effect after this migration: each table is governed only by its own
-- *_select/_insert/_update/_delete require_permission() policies. Posting
-- RPCs are SECURITY DEFINER and are unaffected.
--
-- To keep the sales / purchase / production forms working for roles without
-- finance or HR rights (Manager, User), a few narrow SELECT policies are added
-- for the pickers those forms load from the browser:
--   accounts          payment account picker (sales, purchases, payroll)
--   employees         seller / responsible-person picker
--   commission_rules  read while recording a sale's commissions
--   settings          company name and logo (sidebar, print headers)
--
-- consignments, consignment_items, monthly_commissions and
-- monthly_commission_details had RLS switched off entirely. The app no longer
-- uses them (the consignment module runs on consignment_* tables), so they
-- are locked: RLS on, no policy. service_role still bypasses RLS.

BEGIN;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'accounts', 'categories', 'commission_rules', 'customers', 'employees',
    'expenses', 'products', 'purchase_items', 'purchases', 'salary_payments',
    'sale_items', 'sales', 'settings', 'suppliers', 'transactions', 'warehouses',
    'consignments', 'consignment_items', 'monthly_commissions',
    'monthly_commission_details'
  ]
  LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('DROP POLICY IF EXISTS "Allow public access" ON public.%I', t);
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    END IF;
  END LOOP;
END;
$$;

DROP POLICY IF EXISTS accounts_select_payment_pickers ON public.accounts;
CREATE POLICY accounts_select_payment_pickers ON public.accounts
  FOR SELECT TO authenticated
  USING (
    public.require_permission('can_create_invoice')
    OR public.require_permission('can_create_purchase')
    OR public.require_permission('can_manage_hr')
  );

DROP POLICY IF EXISTS employees_select_pickers ON public.employees;
CREATE POLICY employees_select_pickers ON public.employees
  FOR SELECT TO authenticated
  USING (
    public.require_permission('can_create_invoice')
    OR public.require_permission('can_create_purchase')
    OR public.require_permission('can_manage_production')
  );

DROP POLICY IF EXISTS commission_rules_select_sellers ON public.commission_rules;
CREATE POLICY commission_rules_select_sellers ON public.commission_rules
  FOR SELECT TO authenticated
  USING (public.require_permission('can_create_invoice'));

DROP POLICY IF EXISTS settings_select_active_users ON public.settings;
CREATE POLICY settings_select_active_users ON public.settings
  FOR SELECT TO authenticated
  USING (public.is_active_user());

-- Fail the migration if any USING (true) write policy is still in place.
DO $$
DECLARE
  v_left TEXT;
BEGIN
  SELECT string_agg(tablename || '.' || policyname, ', ')
  INTO v_left
  FROM pg_policies
  WHERE schemaname = 'public'
    AND cmd IN ('ALL', 'INSERT', 'UPDATE', 'DELETE')
    AND (qual = 'true' OR with_check = 'true');

  IF v_left IS NOT NULL THEN
    RAISE EXCEPTION 'Permissive write policies still present: %', v_left;
  END IF;
END;
$$;

COMMIT;

NOTIFY pgrst, 'reload schema';
