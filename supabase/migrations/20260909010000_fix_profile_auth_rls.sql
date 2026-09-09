-- Hotfix: ensure RBAC columns exist and profile self-read always works after JSONB migration.

ALTER TABLE public.roles
  ADD COLUMN IF NOT EXISTS scopes JSONB NOT NULL DEFAULT jsonb_build_object(
    'allowed_warehouses', '[]'::jsonb,
    'allowed_financial_accounts', '[]'::jsonb,
    'record_access', '"ALL_RECORDS"'
  );

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS permission_overrides JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS scope_overrides JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Permissions helper must tolerate NULL is_active and missing flat keys.
CREATE OR REPLACE FUNCTION public.current_user_permissions()
RETURNS JSONB
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(r.permissions, '{}'::jsonb)
  FROM public.profiles p
  LEFT JOIN public.roles r ON r.id = p.role_id
  WHERE p.id = auth.uid()
    AND COALESCE(p.is_active, TRUE)
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.has_permission(perm TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (public.current_user_permissions() ->> perm)::boolean,
    FALSE
  );
$$;

CREATE OR REPLACE FUNCTION public.is_active_user()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND COALESCE(is_active, TRUE)
  );
$$;

-- Users must always read their own profile (required for login/session bootstrap).
DROP POLICY IF EXISTS profiles_select ON public.profiles;
CREATE POLICY profiles_select ON public.profiles
  FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR public.has_permission('can_manage_users')
  );

-- All authenticated users can read role definitions for their session.
DROP POLICY IF EXISTS roles_select ON public.roles;
CREATE POLICY roles_select ON public.roles
  FOR SELECT TO authenticated
  USING (TRUE);

NOTIFY pgrst, 'reload schema';
