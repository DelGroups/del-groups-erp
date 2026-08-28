-- Manufacturing & Production module — run in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS production_boms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  finished_product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_production_boms_finished_product
  ON production_boms (finished_product_id);

CREATE TABLE IF NOT EXISTS production_bom_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  bom_id UUID NOT NULL REFERENCES production_boms(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id),
  product_code TEXT,
  product_name TEXT NOT NULL,
  warehouse_id UUID REFERENCES warehouses(id),
  warehouse_name TEXT,
  quantity NUMERIC NOT NULL DEFAULT 0 CHECK (quantity > 0),
  unit TEXT DEFAULT 'Ədəd',
  unit_cost NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_production_bom_items_bom_id
  ON production_bom_items (bom_id);

CREATE TABLE IF NOT EXISTS production_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_no TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('series', 'custom')),
  custom_workflow TEXT CHECK (custom_workflow IN ('in_house', 'outsourced_cut', 'subcontractor')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'in_progress', 'ready', 'delivered')),
  project_name TEXT NOT NULL,
  customer_id UUID REFERENCES customers(id),
  customer_name TEXT,
  finished_product_id UUID REFERENCES products(id),
  finished_product_name TEXT,
  quantity NUMERIC NOT NULL DEFAULT 1,
  warehouse_id UUID REFERENCES warehouses(id),
  warehouse_name TEXT,
  total_project_price NUMERIC NOT NULL DEFAULT 0,
  installation_fee NUMERIC NOT NULL DEFAULT 0,
  advance_payment NUMERIC NOT NULL DEFAULT 0,
  remaining_balance NUMERIC NOT NULL DEFAULT 0,
  expected_delivery_date DATE,
  project_scope TEXT,
  terms TEXT,
  notes TEXT,
  materials_allocated BOOLEAN NOT NULL DEFAULT FALSE,
  finished_goods_posted BOOLEAN NOT NULL DEFAULT FALSE,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_production_orders_status ON production_orders (status);
CREATE INDEX IF NOT EXISTS idx_production_orders_type ON production_orders (type);
CREATE INDEX IF NOT EXISTS idx_production_orders_customer ON production_orders (customer_id);

CREATE TABLE IF NOT EXISTS production_materials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  production_order_id UUID NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id),
  product_code TEXT,
  product_name TEXT NOT NULL,
  warehouse_id UUID REFERENCES warehouses(id),
  warehouse_name TEXT,
  quantity NUMERIC NOT NULL DEFAULT 0,
  unit TEXT DEFAULT 'Ədəd',
  unit_cost NUMERIC NOT NULL DEFAULT 0,
  line_cost NUMERIC NOT NULL DEFAULT 0,
  inventory_mode TEXT DEFAULT 'standard',
  polywood_sale_mode TEXT,
  polywood_length_m NUMERIC,
  polywood_cut_details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_production_materials_order
  ON production_materials (production_order_id);

CREATE TABLE IF NOT EXISTS production_outsourcing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  production_order_id UUID NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
  supplier_id UUID REFERENCES suppliers(id),
  supplier_name TEXT,
  material_description TEXT NOT NULL,
  sqm_quantity NUMERIC NOT NULL DEFAULT 0,
  price_per_sqm NUMERIC NOT NULL DEFAULT 0,
  total_cost NUMERIC NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_production_outsourcing_order
  ON production_outsourcing (production_order_id);

CREATE TABLE IF NOT EXISTS production_contractors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  production_order_id UUID NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
  contractor_id UUID,
  contractor_name TEXT NOT NULL,
  commission_percentage NUMERIC NOT NULL DEFAULT 20,
  calculated_fee NUMERIC NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_production_contractors_order
  ON production_contractors (production_order_id);

CREATE TABLE IF NOT EXISTS production_contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  production_order_id UUID NOT NULL UNIQUE REFERENCES production_orders(id) ON DELETE CASCADE,
  contract_no TEXT NOT NULL UNIQUE,
  contract_date DATE NOT NULL DEFAULT CURRENT_DATE,
  customer_id UUID REFERENCES customers(id),
  customer_name TEXT,
  project_name TEXT,
  project_scope TEXT,
  expected_delivery_date DATE,
  total_project_price NUMERIC NOT NULL DEFAULT 0,
  installation_fee NUMERIC NOT NULL DEFAULT 0,
  advance_payment NUMERIC NOT NULL DEFAULT 0,
  remaining_balance NUMERIC NOT NULL DEFAULT 0,
  terms TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_production_contracts_order
  ON production_contracts (production_order_id);

ALTER TABLE production_boms ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_bom_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_outsourcing ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_contractors ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_contracts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS production_boms_select ON production_boms;
CREATE POLICY production_boms_select ON production_boms
  FOR SELECT USING (public.user_has_permission('can_view_production'));

DROP POLICY IF EXISTS production_boms_write ON production_boms;
CREATE POLICY production_boms_write ON production_boms
  FOR ALL USING (public.user_has_permission('can_manage_production'))
  WITH CHECK (public.user_has_permission('can_manage_production'));

DROP POLICY IF EXISTS production_bom_items_select ON production_bom_items;
CREATE POLICY production_bom_items_select ON production_bom_items
  FOR SELECT USING (public.user_has_permission('can_view_production'));

DROP POLICY IF EXISTS production_bom_items_write ON production_bom_items;
CREATE POLICY production_bom_items_write ON production_bom_items
  FOR ALL USING (public.user_has_permission('can_manage_production'))
  WITH CHECK (public.user_has_permission('can_manage_production'));

DROP POLICY IF EXISTS production_orders_select ON production_orders;
CREATE POLICY production_orders_select ON production_orders
  FOR SELECT USING (public.user_has_permission('can_view_production'));

DROP POLICY IF EXISTS production_orders_write ON production_orders;
CREATE POLICY production_orders_write ON production_orders
  FOR ALL USING (public.user_has_permission('can_manage_production'))
  WITH CHECK (public.user_has_permission('can_manage_production'));

DROP POLICY IF EXISTS production_materials_select ON production_materials;
CREATE POLICY production_materials_select ON production_materials
  FOR SELECT USING (public.user_has_permission('can_view_production'));

DROP POLICY IF EXISTS production_materials_write ON production_materials;
CREATE POLICY production_materials_write ON production_materials
  FOR ALL USING (public.user_has_permission('can_manage_production'))
  WITH CHECK (public.user_has_permission('can_manage_production'));

DROP POLICY IF EXISTS production_outsourcing_select ON production_outsourcing;
CREATE POLICY production_outsourcing_select ON production_outsourcing
  FOR SELECT USING (public.user_has_permission('can_view_production'));

DROP POLICY IF EXISTS production_outsourcing_write ON production_outsourcing;
CREATE POLICY production_outsourcing_write ON production_outsourcing
  FOR ALL USING (public.user_has_permission('can_manage_production'))
  WITH CHECK (public.user_has_permission('can_manage_production'));

DROP POLICY IF EXISTS production_contractors_select ON production_contractors;
CREATE POLICY production_contractors_select ON production_contractors
  FOR SELECT USING (public.user_has_permission('can_view_production'));

DROP POLICY IF EXISTS production_contractors_write ON production_contractors;
CREATE POLICY production_contractors_write ON production_contractors
  FOR ALL USING (public.user_has_permission('can_manage_production'))
  WITH CHECK (public.user_has_permission('can_manage_production'));

DROP POLICY IF EXISTS production_contracts_select ON production_contracts;
CREATE POLICY production_contracts_select ON production_contracts
  FOR SELECT USING (public.user_has_permission('can_view_production'));

DROP POLICY IF EXISTS production_contracts_write ON production_contracts;
CREATE POLICY production_contracts_write ON production_contracts
  FOR ALL USING (public.user_has_permission('can_manage_production'))
  WITH CHECK (public.user_has_permission('can_manage_production'));

-- Existing role JSONB blobs do not include the new keys; Admin always gets them,
-- and product viewers inherit view access until Roles is updated.
UPDATE roles
SET permissions = COALESCE(permissions, '{}'::jsonb)
  || jsonb_build_object(
    'can_view_production',
      COALESCE(
        (permissions->>'can_view_production')::boolean,
        (permissions->>'can_view_products')::boolean,
        name = 'Admin'
      ),
    'can_manage_production',
      COALESCE(
        (permissions->>'can_manage_production')::boolean,
        (permissions->>'can_manage_products')::boolean,
        name = 'Admin'
      )
  );
