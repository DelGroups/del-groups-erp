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
  type TEXT NOT NULL CHECK (type IN ('Custom', 'Series')),
  custom_workflow TEXT CHECK (custom_workflow IN ('in_house', 'outsourced_cut', 'subcontractor')),
  status TEXT NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft', 'In-Progress', 'Ready', 'Delivered')),
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
  stage_no INTEGER NOT NULL DEFAULT 1,
  stage_label TEXT,
  notes TEXT,
  issued BOOLEAN NOT NULL DEFAULT FALSE,
  issued_at TIMESTAMPTZ,
  created_by UUID REFERENCES auth.users(id),
  created_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_production_materials_order
  ON production_materials (production_order_id);

CREATE INDEX IF NOT EXISTS idx_production_materials_stage
  ON production_materials (production_order_id, stage_no);

CREATE TABLE IF NOT EXISTS production_stock_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  production_order_id UUID NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
  production_material_id UUID NOT NULL UNIQUE REFERENCES production_materials(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id),
  warehouse_id UUID REFERENCES warehouses(id),
  quantity NUMERIC NOT NULL CHECK (quantity > 0),
  status TEXT NOT NULL DEFAULT 'reserved'
    CHECK (status IN ('reserved', 'consumed', 'released')),
  reserved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  consumed_at TIMESTAMPTZ,
  released_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_production_reservations_product
  ON production_stock_reservations (product_id, warehouse_id, status);
CREATE INDEX IF NOT EXISTS idx_production_reservations_order
  ON production_stock_reservations (production_order_id);

CREATE TABLE IF NOT EXISTS production_outsourcing (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  production_order_id UUID NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
  supplier_id UUID REFERENCES suppliers(id),
  supplier_name TEXT,
  material_description TEXT NOT NULL,
  description TEXT,
  sqm_quantity NUMERIC NOT NULL DEFAULT 0,
  price_per_sqm NUMERIC NOT NULL DEFAULT 0,
  total_cost NUMERIC NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE production_outsourcing ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES suppliers(id);
ALTER TABLE production_outsourcing ADD COLUMN IF NOT EXISTS supplier_name TEXT;
ALTER TABLE production_outsourcing ADD COLUMN IF NOT EXISTS material_description TEXT;
ALTER TABLE production_outsourcing ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE production_outsourcing ADD COLUMN IF NOT EXISTS sqm_quantity NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE production_outsourcing ADD COLUMN IF NOT EXISTS price_per_sqm NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE production_outsourcing ADD COLUMN IF NOT EXISTS total_cost NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE production_outsourcing ADD COLUMN IF NOT EXISTS notes TEXT;
UPDATE production_outsourcing
SET
  material_description = COALESCE(NULLIF(btrim(material_description), ''), NULLIF(btrim(description), ''), 'Xarici xidmət'),
  description = COALESCE(NULLIF(btrim(description), ''), NULLIF(btrim(material_description), ''), 'Xarici xidmət');
ALTER TABLE production_outsourcing ALTER COLUMN material_description SET NOT NULL;

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

CREATE TABLE IF NOT EXISTS production_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  production_order_id UUID NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
  category TEXT NOT NULL DEFAULT 'other'
    CHECK (category IN ('transport', 'delivery', 'installation', 'tools', 'other')),
  description TEXT NOT NULL,
  amount NUMERIC NOT NULL DEFAULT 0 CHECK (amount >= 0),
  expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
  account_id UUID REFERENCES accounts(id),
  account_name TEXT,
  finance_expense_id UUID REFERENCES expenses(id) ON DELETE SET NULL,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_production_expenses_order
  ON production_expenses (production_order_id);

-- Re-runnable on databases that already had the first production tables
ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS production_order_id UUID
  REFERENCES production_orders(id) ON DELETE SET NULL;
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS production_order_id UUID
  REFERENCES production_orders(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_expenses_production_order
  ON expenses (production_order_id);
CREATE INDEX IF NOT EXISTS idx_transactions_production_order
  ON transactions (production_order_id);

CREATE OR REPLACE FUNCTION public.create_production_expense_atomic(
  p_production_order_id UUID,
  p_code TEXT,
  p_category TEXT,
  p_description TEXT,
  p_amount NUMERIC,
  p_expense_date DATE,
  p_account_id UUID,
  p_account_name TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_actor_name TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance NUMERIC;
  v_finance_expense_id UUID;
  v_production_expense_id UUID;
BEGIN
  IF NOT public.user_has_permission('can_manage_production') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'invalid_amount' USING ERRCODE = '22023';
  END IF;
  IF p_category NOT IN ('transport', 'delivery', 'installation', 'tools', 'other') THEN
    RAISE EXCEPTION 'invalid_category' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM production_orders WHERE id = p_production_order_id) THEN
    RAISE EXCEPTION 'production_order_not_found' USING ERRCODE = 'P0002';
  END IF;

  SELECT balance INTO v_balance
    FROM accounts
   WHERE id = p_account_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_balance < p_amount THEN
    RAISE EXCEPTION 'insufficient_balance' USING ERRCODE = '22023';
  END IF;

  INSERT INTO expenses (
    code, category, amount, account_id, production_order_id, notes
  )
  VALUES (
    trim(p_code), 'Digər', p_amount, p_account_id, p_production_order_id,
    NULLIF(trim(p_notes), '')
  )
  RETURNING id INTO v_finance_expense_id;

  INSERT INTO transactions (
    account_id, type, amount, category, production_order_id, notes
  )
  VALUES (
    p_account_id, 'Məxaric', p_amount, 'Digər', p_production_order_id,
    NULLIF(trim(p_notes), '')
  );

  UPDATE accounts SET balance = balance - p_amount WHERE id = p_account_id;

  INSERT INTO production_expenses (
    production_order_id, category, description, amount, expense_date,
    account_id, account_name, finance_expense_id, notes, created_by, created_by_name
  )
  VALUES (
    p_production_order_id, p_category, trim(p_description), p_amount,
    COALESCE(p_expense_date, CURRENT_DATE), p_account_id, NULLIF(trim(p_account_name), ''),
    v_finance_expense_id, NULLIF(trim(p_notes), ''), auth.uid(), NULLIF(trim(p_actor_name), '')
  )
  RETURNING id INTO v_production_expense_id;

  RETURN v_production_expense_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_production_expense_atomic(
  UUID, TEXT, TEXT, TEXT, NUMERIC, DATE, UUID, TEXT, TEXT, TEXT
) TO authenticated;

ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS remaining_balance NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS project_scope TEXT;
ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS terms TEXT;
ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE production_contracts ADD COLUMN IF NOT EXISTS remaining_balance NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE production_contracts ADD COLUMN IF NOT EXISTS project_scope TEXT;
ALTER TABLE production_contracts ADD COLUMN IF NOT EXISTS terms TEXT;
ALTER TABLE production_contracts ADD COLUMN IF NOT EXISTS notes TEXT;

ALTER TABLE production_materials ADD COLUMN IF NOT EXISTS stage_no INTEGER NOT NULL DEFAULT 1;
ALTER TABLE production_materials ADD COLUMN IF NOT EXISTS stage_label TEXT;
ALTER TABLE production_materials ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE production_materials ADD COLUMN IF NOT EXISTS issued BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE production_materials ADD COLUMN IF NOT EXISTS issued_at TIMESTAMPTZ;
ALTER TABLE production_materials ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id);
ALTER TABLE production_materials ADD COLUMN IF NOT EXISTS created_by_name TEXT;

UPDATE production_materials pm
SET issued = TRUE,
    issued_at = COALESCE(pm.issued_at, pm.created_at)
WHERE pm.issued = FALSE
  AND EXISTS (
    SELECT 1 FROM production_orders po
    WHERE po.id = pm.production_order_id
      AND po.materials_allocated = TRUE
  );

ALTER TABLE production_boms ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_bom_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE production_stock_reservations ENABLE ROW LEVEL SECURITY;
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

DROP POLICY IF EXISTS production_stock_reservations_select ON production_stock_reservations;
CREATE POLICY production_stock_reservations_select ON production_stock_reservations
  FOR SELECT USING (public.user_has_permission('can_view_production'));

DROP POLICY IF EXISTS production_stock_reservations_write ON production_stock_reservations;
CREATE POLICY production_stock_reservations_write ON production_stock_reservations
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

ALTER TABLE production_expenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS production_expenses_select ON production_expenses;
CREATE POLICY production_expenses_select ON production_expenses
  FOR SELECT USING (public.user_has_permission('can_view_production'));

DROP POLICY IF EXISTS production_expenses_write ON production_expenses;
CREATE POLICY production_expenses_write ON production_expenses
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

-- Align status CHECK with the Title-Case keys the app writes.
ALTER TABLE production_orders DROP CONSTRAINT IF EXISTS production_orders_status_check;
UPDATE production_orders
SET status = CASE
  WHEN status IN ('Draft', 'In-Progress', 'Ready', 'Delivered') THEN status
  WHEN lower(regexp_replace(replace(btrim(status), '_', '-'), '\s+', '-', 'g'))
    IN ('in-progress', 'inprogress') THEN 'In-Progress'
  WHEN lower(btrim(status)) IN ('ready', 'hazir') THEN 'Ready'
  WHEN lower(btrim(status)) IN ('delivered') THEN 'Delivered'
  ELSE 'Draft'
END;
ALTER TABLE production_orders ALTER COLUMN status SET DEFAULT 'Draft';
ALTER TABLE production_orders
  ADD CONSTRAINT production_orders_status_check
  CHECK (status IN ('Draft', 'In-Progress', 'Ready', 'Delivered'));

-- Align type CHECK with the Title-Case keys the app writes.
ALTER TABLE production_orders DROP CONSTRAINT IF EXISTS production_orders_type_check;
UPDATE production_orders
SET type = CASE
  WHEN type IN ('Custom', 'Series') THEN type
  WHEN lower(btrim(type)) IN ('series', 'seriya', 'seria', 'serial', 'stock') THEN 'Series'
  ELSE 'Custom'
END;
ALTER TABLE production_orders
  ADD CONSTRAINT production_orders_type_check
  CHECK (type IN ('Custom', 'Series'));

NOTIFY pgrst, 'reload schema';
