-- CRM: sales pipeline deals + quotations, linked to customers and production orders

-- ─── 0. Seed CRM permission keys on existing roles ───────────────────────────

UPDATE public.roles
SET permissions = COALESCE(permissions, '{}'::jsonb)
  || jsonb_build_object(
    'can_view_crm', true,
    'can_manage_crm', true
  )
WHERE lower(name) IN ('admin', 'manager');

UPDATE public.roles
SET permissions = COALESCE(permissions, '{}'::jsonb)
  || jsonb_build_object(
    'can_view_crm', COALESCE((permissions ->> 'can_view_customers')::boolean, false),
    'can_manage_crm', COALESCE((permissions ->> 'can_manage_customers')::boolean, false)
  )
WHERE lower(name) NOT IN ('admin', 'manager');

-- ─── 1. Deals / leads ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.deals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  title VARCHAR(240) NOT NULL,
  stage VARCHAR(20) NOT NULL DEFAULT 'LEAD'
    CHECK (stage IN ('LEAD', 'QUALIFIED', 'PROPOSAL', 'WON', 'LOST')),
  expected_value NUMERIC(15, 2) NOT NULL DEFAULT 0,
  assigned_to UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  notes TEXT,
  production_order_id UUID REFERENCES public.production_orders(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deals_stage ON public.deals (stage, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_deals_client ON public.deals (client_id);
CREATE INDEX IF NOT EXISTS idx_deals_assigned ON public.deals (assigned_to);

-- ─── 2. Quotations ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.quotations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deal_id UUID NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  quote_number VARCHAR(40) NOT NULL,
  total_amount NUMERIC(15, 2) NOT NULL DEFAULT 0,
  discount NUMERIC(15, 2) NOT NULL DEFAULT 0,
  tax NUMERIC(15, 2) NOT NULL DEFAULT 0,
  valid_until DATE,
  status VARCHAR(20) NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'WON', 'CONVERTED')),
  items_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT,
  production_order_id UUID REFERENCES public.production_orders(id) ON DELETE SET NULL,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_quotations_quote_number
  ON public.quotations (quote_number);

CREATE INDEX IF NOT EXISTS idx_quotations_deal
  ON public.quotations (deal_id, created_at DESC);

-- ─── 3. Quote number sequence ────────────────────────────────────────────────

CREATE SEQUENCE IF NOT EXISTS public.quotation_number_seq START WITH 1 INCREMENT BY 1;

CREATE OR REPLACE FUNCTION public.next_quotation_number()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_year INT := EXTRACT(YEAR FROM NOW())::INT;
  v_n INT;
BEGIN
  v_n := nextval('public.quotation_number_seq');
  RETURN 'TKL-' || v_year::TEXT || '-' || lpad(v_n::TEXT, 4, '0');
END;
$$;

GRANT EXECUTE ON FUNCTION public.next_quotation_number() TO authenticated;

-- ─── 4. RLS ──────────────────────────────────────────────────────────────────

DO $$
DECLARE
  v_nargs int;
BEGIN
  SELECT p.pronargs INTO v_nargs
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = '_apply_table_rls'
  ORDER BY p.pronargs DESC
  LIMIT 1;

  IF v_nargs = 5 THEN
    EXECUTE 'SELECT public._apply_table_rls($1,$2,$3,$4,$5)'
      USING 'deals', 'can_view_crm', 'can_manage_crm', 'can_manage_crm', 'can_manage_crm';
    EXECUTE 'SELECT public._apply_table_rls($1,$2,$3,$4,$5)'
      USING 'quotations', 'can_view_crm', 'can_manage_crm', 'can_manage_crm', 'can_manage_crm';
  ELSIF v_nargs = 4 THEN
    EXECUTE 'SELECT public._apply_table_rls($1,$2,$3,$4)'
      USING 'deals', 'can_view_crm', 'can_manage_crm', 'can_manage_crm';
    EXECUTE 'SELECT public._apply_table_rls($1,$2,$3,$4)'
      USING 'quotations', 'can_view_crm', 'can_manage_crm', 'can_manage_crm';
  END IF;
END $$;
