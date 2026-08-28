-- Consignment Sales Management — run in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS consignment_partners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  company_name TEXT,
  phone TEXT,
  address TEXT,
  voen TEXT,
  customer_id UUID REFERENCES customers(id),
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_consignment_partners_customer
  ON consignment_partners (customer_id);

CREATE TABLE IF NOT EXISTS consignment_dispatches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispatch_no TEXT NOT NULL UNIQUE,
  partner_id UUID NOT NULL REFERENCES consignment_partners(id),
  warehouse_id UUID REFERENCES warehouses(id),
  warehouse_name TEXT,
  dispatch_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status TEXT NOT NULL DEFAULT 'delivered' CHECK (status IN ('pending', 'delivered', 'returned')),
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_consignment_dispatches_partner
  ON consignment_dispatches (partner_id, dispatch_date DESC);

CREATE TABLE IF NOT EXISTS consignment_inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id UUID NOT NULL REFERENCES consignment_partners(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id),
  product_code TEXT,
  product_name TEXT NOT NULL,
  category TEXT,
  unit TEXT DEFAULT 'Ədəd',
  delivered_qty NUMERIC NOT NULL DEFAULT 0,
  sold_qty NUMERIC NOT NULL DEFAULT 0,
  returned_qty NUMERIC NOT NULL DEFAULT 0,
  remaining_qty NUMERIC NOT NULL DEFAULT 0,
  unit_price NUMERIC NOT NULL DEFAULT 0,
  last_dispatch_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (partner_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_consignment_inventory_partner
  ON consignment_inventory (partner_id);

CREATE TABLE IF NOT EXISTS consignment_monthly_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_no TEXT NOT NULL UNIQUE,
  partner_id UUID NOT NULL REFERENCES consignment_partners(id),
  report_period TEXT NOT NULL,
  sold_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_amount NUMERIC NOT NULL DEFAULT 0,
  invoice_id UUID,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (partner_id, report_period)
);

CREATE INDEX IF NOT EXISTS idx_consignment_monthly_reports_partner
  ON consignment_monthly_reports (partner_id, report_period DESC);

CREATE TABLE IF NOT EXISTS consignment_returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_no TEXT NOT NULL UNIQUE,
  partner_id UUID NOT NULL REFERENCES consignment_partners(id),
  warehouse_id UUID REFERENCES warehouses(id),
  warehouse_name TEXT,
  return_date DATE NOT NULL DEFAULT CURRENT_DATE,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE consignment_partners ENABLE ROW LEVEL SECURITY;
ALTER TABLE consignment_dispatches ENABLE ROW LEVEL SECURITY;
ALTER TABLE consignment_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE consignment_monthly_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE consignment_returns ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS consignment_partners_select ON consignment_partners;
CREATE POLICY consignment_partners_select ON consignment_partners
  FOR SELECT USING (public.user_has_permission('can_view_consignments'));
DROP POLICY IF EXISTS consignment_partners_write ON consignment_partners;
CREATE POLICY consignment_partners_write ON consignment_partners
  FOR ALL USING (public.user_has_permission('can_manage_consignments'))
  WITH CHECK (public.user_has_permission('can_manage_consignments'));

DROP POLICY IF EXISTS consignment_dispatches_select ON consignment_dispatches;
CREATE POLICY consignment_dispatches_select ON consignment_dispatches
  FOR SELECT USING (public.user_has_permission('can_view_consignments'));
DROP POLICY IF EXISTS consignment_dispatches_write ON consignment_dispatches;
CREATE POLICY consignment_dispatches_write ON consignment_dispatches
  FOR ALL USING (public.user_has_permission('can_manage_consignments'))
  WITH CHECK (public.user_has_permission('can_manage_consignments'));

DROP POLICY IF EXISTS consignment_inventory_select ON consignment_inventory;
CREATE POLICY consignment_inventory_select ON consignment_inventory
  FOR SELECT USING (public.user_has_permission('can_view_consignments'));
DROP POLICY IF EXISTS consignment_inventory_write ON consignment_inventory;
CREATE POLICY consignment_inventory_write ON consignment_inventory
  FOR ALL USING (public.user_has_permission('can_manage_consignments'))
  WITH CHECK (public.user_has_permission('can_manage_consignments'));

DROP POLICY IF EXISTS consignment_monthly_reports_select ON consignment_monthly_reports;
CREATE POLICY consignment_monthly_reports_select ON consignment_monthly_reports
  FOR SELECT USING (public.user_has_permission('can_view_consignments'));
DROP POLICY IF EXISTS consignment_monthly_reports_write ON consignment_monthly_reports;
CREATE POLICY consignment_monthly_reports_write ON consignment_monthly_reports
  FOR ALL USING (public.user_has_permission('can_manage_consignments'))
  WITH CHECK (public.user_has_permission('can_manage_consignments'));

DROP POLICY IF EXISTS consignment_returns_select ON consignment_returns;
CREATE POLICY consignment_returns_select ON consignment_returns
  FOR SELECT USING (public.user_has_permission('can_view_consignments'));
DROP POLICY IF EXISTS consignment_returns_write ON consignment_returns;
CREATE POLICY consignment_returns_write ON consignment_returns
  FOR ALL USING (public.user_has_permission('can_manage_consignments'))
  WITH CHECK (public.user_has_permission('can_manage_consignments'));

UPDATE roles
SET permissions = COALESCE(permissions, '{}'::jsonb)
  || jsonb_build_object(
    'can_view_consignments',
      COALESCE(
        (permissions->>'can_view_consignments')::boolean,
        (permissions->>'can_view_sales')::boolean,
        name = 'Admin'
      ),
    'can_manage_consignments',
      COALESCE(
        (permissions->>'can_manage_consignments')::boolean,
        (permissions->>'can_create_invoice')::boolean,
        name = 'Admin'
      )
  );
