-- Role-Based Access Control & user management (see types/schema.sql)
-- Run in the Supabase SQL Editor.

-- ─── Roles ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO roles (name, description, is_system, permissions)
VALUES (
  'Admin',
  'Tam sistem girişi — bütün modullar və istifadəçi idarəetməsi',
  TRUE,
  jsonb_build_object(
    'can_view_dashboard', TRUE,
    'can_view_sales', TRUE, 'can_create_invoice', TRUE, 'can_edit_sales', TRUE, 'can_delete_sales', TRUE,
    'can_view_purchases', TRUE, 'can_create_purchase', TRUE, 'can_edit_purchases', TRUE, 'can_delete_purchases', TRUE,
    'can_view_consignments', TRUE, 'can_manage_consignments', TRUE,
    'can_view_products', TRUE, 'can_manage_products', TRUE, 'can_manage_warehouses', TRUE, 'can_writeoff_inventory', TRUE,
    'can_view_customers', TRUE, 'can_manage_customers', TRUE, 'can_view_suppliers', TRUE, 'can_manage_suppliers', TRUE,
    'can_view_finance', TRUE, 'can_manage_finance', TRUE, 'can_view_expenses', TRUE, 'can_manage_expenses', TRUE,
    'can_view_hr', TRUE, 'can_manage_hr', TRUE, 'can_view_commissions', TRUE, 'can_manage_commissions', TRUE,
    'can_view_reports', TRUE, 'can_view_financial_reports', TRUE,
    'can_view_settings', TRUE, 'can_manage_settings', TRUE, 'can_manage_users', TRUE, 'can_manage_roles', TRUE
  )
),
(
  'Manager',
  'Əməliyyat modullarını idarə edir, istifadəçi və rol tənzimləmələrinə girişi yoxdur',
  TRUE,
  jsonb_build_object(
    'can_view_dashboard', TRUE,
    'can_view_sales', TRUE, 'can_create_invoice', TRUE, 'can_edit_sales', TRUE, 'can_delete_sales', FALSE,
    'can_view_purchases', TRUE, 'can_create_purchase', TRUE, 'can_edit_purchases', TRUE, 'can_delete_purchases', FALSE,
    'can_view_consignments', TRUE, 'can_manage_consignments', TRUE,
    'can_view_products', TRUE, 'can_manage_products', TRUE, 'can_manage_warehouses', TRUE, 'can_writeoff_inventory', TRUE,
    'can_view_customers', TRUE, 'can_manage_customers', TRUE, 'can_view_suppliers', TRUE, 'can_manage_suppliers', TRUE,
    'can_view_finance', TRUE, 'can_manage_finance', FALSE, 'can_view_expenses', TRUE, 'can_manage_expenses', TRUE,
    'can_view_hr', TRUE, 'can_manage_hr', FALSE, 'can_view_commissions', TRUE, 'can_manage_commissions', TRUE,
    'can_view_reports', TRUE, 'can_view_financial_reports', TRUE,
    'can_view_settings', TRUE, 'can_manage_settings', FALSE, 'can_manage_users', FALSE, 'can_manage_roles', FALSE
  )
),
(
  'User',
  'Yalnız öz adına satış sənədi yaradır',
  TRUE,
  jsonb_build_object(
    'can_view_dashboard', TRUE,
    'can_view_sales', TRUE, 'can_create_invoice', TRUE, 'can_edit_sales', FALSE, 'can_delete_sales', FALSE,
    'can_view_purchases', FALSE, 'can_create_purchase', FALSE, 'can_edit_purchases', FALSE, 'can_delete_purchases', FALSE,
    'can_view_consignments', TRUE, 'can_manage_consignments', FALSE,
    'can_view_products', TRUE, 'can_manage_products', FALSE, 'can_manage_warehouses', FALSE, 'can_writeoff_inventory', FALSE,
    'can_view_customers', TRUE, 'can_manage_customers', TRUE, 'can_view_suppliers', FALSE, 'can_manage_suppliers', FALSE,
    'can_view_finance', FALSE, 'can_manage_finance', FALSE, 'can_view_expenses', FALSE, 'can_manage_expenses', FALSE,
    'can_view_hr', FALSE, 'can_manage_hr', FALSE, 'can_view_commissions', FALSE, 'can_manage_commissions', FALSE,
    'can_view_reports', FALSE, 'can_view_financial_reports', FALSE,
    'can_view_settings', FALSE, 'can_manage_settings', FALSE, 'can_manage_users', FALSE, 'can_manage_roles', FALSE
  )
)
ON CONFLICT (name) DO NOTHING;

-- ─── Profiles (1:1 with auth.users) ──────────────────────────────────────────

CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  full_name TEXT,
  role_id UUID REFERENCES roles(id) ON DELETE SET NULL,
  employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_profiles_role_id ON profiles (role_id);
CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles (email);

-- ─── Permission helpers ──────────────────────────────────────────────────────
-- SECURITY DEFINER so RLS policies on `profiles` can read `profiles`
-- without recursing into the very policy being evaluated.

CREATE OR REPLACE FUNCTION public.current_user_permissions()
RETURNS JSONB
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(r.permissions, '{}'::jsonb)
  FROM profiles p
  LEFT JOIN roles r ON r.id = p.role_id
  WHERE p.id = auth.uid() AND p.is_active
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.has_permission(perm TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((public.current_user_permissions() ->> perm)::boolean, FALSE);
$$;

CREATE OR REPLACE FUNCTION public.is_active_user()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles
    WHERE id = auth.uid() AND is_active IS TRUE
  );
$$;

-- ─── Row level security ──────────────────────────────────────────────────────

ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS roles_select ON roles;
CREATE POLICY roles_select ON roles
  FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS roles_insert ON roles;
CREATE POLICY roles_insert ON roles
  FOR INSERT TO authenticated WITH CHECK (public.has_permission('can_manage_roles'));

DROP POLICY IF EXISTS roles_update ON roles;
CREATE POLICY roles_update ON roles
  FOR UPDATE TO authenticated USING (public.has_permission('can_manage_roles'));

DROP POLICY IF EXISTS roles_delete ON roles;
CREATE POLICY roles_delete ON roles
  FOR DELETE TO authenticated
  USING (public.has_permission('can_manage_roles') AND NOT is_system);

DROP POLICY IF EXISTS profiles_select ON profiles;
CREATE POLICY profiles_select ON profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.has_permission('can_manage_users'));

DROP POLICY IF EXISTS profiles_insert ON profiles;
CREATE POLICY profiles_insert ON profiles
  FOR INSERT TO authenticated WITH CHECK (public.has_permission('can_manage_users'));

-- Users may edit their own name; only user managers may change roles/status.
-- Sensitive columns (role_id, is_active, email) are also guarded by trigger
-- guard_profile_sensitive_updates (see types/security-rls-migration.sql).
DROP POLICY IF EXISTS profiles_update ON profiles;
CREATE POLICY profiles_update ON profiles
  FOR UPDATE TO authenticated
  USING (
    (id = auth.uid() AND public.is_active_user())
    OR public.has_permission('can_manage_users')
  );

DROP POLICY IF EXISTS profiles_delete ON profiles;
CREATE POLICY profiles_delete ON profiles
  FOR DELETE TO authenticated USING (public.has_permission('can_manage_users'));

-- ─── Auto-provision a profile for every new auth user ────────────────────────
-- Covers invited users as well as anyone created straight from the dashboard.

CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_role_id UUID;
BEGIN
  SELECT id INTO target_role_id FROM roles
   WHERE name = COALESCE(NEW.raw_user_meta_data ->> 'role_name', 'User')
   LIMIT 1;

  IF target_role_id IS NULL THEN
    SELECT id INTO target_role_id FROM roles WHERE name = 'User' LIMIT 1;
  END IF;

  INSERT INTO profiles (id, email, full_name, role_id)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NULLIF(NEW.raw_user_meta_data ->> 'full_name', ''), split_part(NEW.email, '@', 1)),
    target_role_id
  )
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        full_name = COALESCE(profiles.full_name, EXCLUDED.full_name),
        role_id = COALESCE(profiles.role_id, EXCLUDED.role_id);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

-- Backfill profiles for users that already existed before this migration.
INSERT INTO profiles (id, email, full_name, role_id)
SELECT
  u.id,
  u.email,
  COALESCE(NULLIF(u.raw_user_meta_data ->> 'full_name', ''), split_part(u.email, '@', 1)),
  (SELECT id FROM roles WHERE name = 'User' LIMIT 1)
FROM auth.users u
ON CONFLICT (id) DO NOTHING;

-- ─── Bootstrap the first administrator ───────────────────────────────────────
-- Replace the address below with your own account, then run this statement.
-- UPDATE profiles
--    SET role_id = (SELECT id FROM roles WHERE name = 'Admin')
--  WHERE email = 'admin@delgroups.az';

-- ─── Responsible person on purchase documents ────────────────────────────────

ALTER TABLE purchases ADD COLUMN IF NOT EXISTS responsible_id UUID;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS responsible_name TEXT;
