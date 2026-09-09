-- Close go-live hole: 20260908180000 originally granted anon/authenticated
-- FOR ALL USING (true) on production_orders and transactions. Drop those policies.
-- Keep service_role bypass for SECURITY DEFINER RPCs.

CREATE OR REPLACE FUNCTION public.user_has_permission(perm TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN coalesce(auth.jwt() ->> 'role', '') = 'service_role' THEN TRUE
    ELSE public.has_permission(perm)
  END;
$$;

GRANT EXECUTE ON FUNCTION public.user_has_permission(TEXT) TO authenticated, service_role;

DROP POLICY IF EXISTS "Allow authenticated full access to production_orders" ON public.production_orders;
DROP POLICY IF EXISTS "Allow authenticated full access to transactions" ON public.transactions;

REVOKE ALL ON TABLE public.production_orders FROM anon;
REVOKE ALL ON TABLE public.transactions FROM anon;
