-- The Consignment module's application code (src/lib/actions/consignment.ts,
-- already deployed) has always queried consignment_partners,
-- consignment_dispatches, consignment_inventory, consignment_monthly_reports
-- and consignment_returns - but none of these tables were ever created in
-- this project. Verified against the live database: every dispatch/return/
-- settlement action has always failed with "relation ... does not exist".
-- The only consignment-shaped tables that DO exist (consignments,
-- consignment_orders, consignment_items) are legacy/unused - nothing imports
-- the one component that reads them, and they hold effectively no rows.
-- This migration creates the tables the live code actually needs, from
-- scratch (no data to migrate - nothing existed before), matching the exact
-- shape src/lib/actions/consignment.ts and src/lib/consignment/types.ts
-- already expect. sales_rep_id/name and returned_items are added by the two
-- migrations that follow this one (20260923120000, 20260923130000).

CREATE TABLE IF NOT EXISTS public.consignment_partners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  company_name TEXT,
  phone TEXT,
  address TEXT,
  voen TEXT,
  customer_id UUID REFERENCES public.customers(id),
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.consignment_dispatches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  dispatch_no TEXT NOT NULL UNIQUE,
  partner_id UUID NOT NULL REFERENCES public.consignment_partners(id),
  warehouse_id UUID REFERENCES public.warehouses(id),
  warehouse_name TEXT,
  dispatch_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status TEXT NOT NULL DEFAULT 'delivered'
    CHECK (status IN ('pending', 'delivered', 'returned')),
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_consignment_dispatches_partner
  ON public.consignment_dispatches(partner_id);

CREATE TABLE IF NOT EXISTS public.consignment_inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id UUID NOT NULL REFERENCES public.consignment_partners(id),
  product_id UUID NOT NULL REFERENCES public.products(id),
  product_code TEXT,
  product_name TEXT NOT NULL,
  category TEXT,
  unit TEXT NOT NULL DEFAULT 'Ədəd',
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
  ON public.consignment_inventory(partner_id);

CREATE TABLE IF NOT EXISTS public.consignment_monthly_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_no TEXT NOT NULL UNIQUE,
  partner_id UUID NOT NULL REFERENCES public.consignment_partners(id),
  report_period TEXT NOT NULL,
  sold_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_amount NUMERIC NOT NULL DEFAULT 0,
  invoice_id UUID REFERENCES public.sales(id),
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (partner_id, report_period)
);

CREATE INDEX IF NOT EXISTS idx_consignment_monthly_reports_partner
  ON public.consignment_monthly_reports(partner_id);

CREATE TABLE IF NOT EXISTS public.consignment_returns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  return_no TEXT NOT NULL UNIQUE,
  partner_id UUID NOT NULL REFERENCES public.consignment_partners(id),
  warehouse_id UUID REFERENCES public.warehouses(id),
  warehouse_name TEXT,
  return_date DATE NOT NULL DEFAULT CURRENT_DATE,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_consignment_returns_partner
  ON public.consignment_returns(partner_id);

-- Same permission-gated RLS baseline as every other core table
-- (can_view_consignments / can_manage_consignments already exist and are
-- already used throughout src/lib/actions/consignment.ts).
SELECT public._apply_table_rls('consignment_partners', 'can_view_consignments', 'can_manage_consignments', 'can_manage_consignments', 'can_manage_consignments');
SELECT public._apply_table_rls('consignment_dispatches', 'can_view_consignments', 'can_manage_consignments', 'can_manage_consignments', 'can_manage_consignments');
SELECT public._apply_table_rls('consignment_inventory', 'can_view_consignments', 'can_manage_consignments', 'can_manage_consignments', 'can_manage_consignments');
SELECT public._apply_table_rls('consignment_monthly_reports', 'can_view_consignments', 'can_manage_consignments', 'can_manage_consignments', 'can_manage_consignments');
SELECT public._apply_table_rls('consignment_returns', 'can_view_consignments', 'can_manage_consignments', 'can_manage_consignments', 'can_manage_consignments');

NOTIFY pgrst, 'reload schema';
