-- Granular RBAC: scoped permissions, user overrides, and new production finance keys.

ALTER TABLE public.roles
  ADD COLUMN IF NOT EXISTS scopes JSONB NOT NULL DEFAULT jsonb_build_object(
    'allowed_warehouses', '[]'::jsonb,
    'allowed_financial_accounts', '[]'::jsonb,
    'record_access', '"ALL_RECORDS"'
  );

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS permission_overrides JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS scope_overrides JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Admin: full financial visibility + purchase approval
UPDATE public.roles
SET permissions = COALESCE(permissions, '{}'::jsonb)
  || jsonb_build_object(
    'can_view_production_financials', true,
    'can_approve_purchase_requests', true
  )
WHERE lower(name) = lower('Admin');

-- Manager: operational access without production financial privacy by default
UPDATE public.roles
SET permissions = COALESCE(permissions, '{}'::jsonb)
  || jsonb_build_object(
    'can_view_production_financials', false,
    'can_approve_purchase_requests', true
  )
WHERE lower(name) = lower('Manager');

UPDATE public.roles
SET permissions = COALESCE(permissions, '{}'::jsonb)
  || jsonb_build_object(
    'can_view_production_financials', false,
    'can_approve_purchase_requests', false
  )
WHERE lower(name) = lower('User');

CREATE OR REPLACE FUNCTION public.has_permission(perm TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (current_user_permissions() ->> perm)::boolean,
    false
  );
$$;

NOTIFY pgrst, 'reload schema';
