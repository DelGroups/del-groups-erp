-- Production orders RLS: permissive policies for authenticated users
-- Also fixes advance-payment RPC failing with "İcazəniz yoxdur" when called via service_role

-- ─── Service-role bypass for permission checks in SECURITY DEFINER RPCs ────────

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

-- ─── production_orders ────────────────────────────────────────────────────────

ALTER TABLE public.production_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS production_orders_select ON public.production_orders;
DROP POLICY IF EXISTS production_orders_write ON public.production_orders;
DROP POLICY IF EXISTS "Allow authenticated full access to production_orders" ON public.production_orders;

CREATE POLICY "Allow authenticated full access to production_orders"
ON public.production_orders
FOR ALL
TO authenticated, anon, service_role
USING (true)
WITH CHECK (true);

GRANT ALL ON public.production_orders TO authenticated, anon, service_role;

-- ─── transactions (advance payment journal rows) ────────────────────────────

ALTER TABLE public.transactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated full access to transactions" ON public.transactions;

CREATE POLICY "Allow authenticated full access to transactions"
ON public.transactions
FOR ALL
TO authenticated, anon, service_role
USING (true)
WITH CHECK (true);

GRANT ALL ON public.transactions TO authenticated, anon, service_role;

NOTIFY pgrst, 'reload schema';
