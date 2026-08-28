-- Del Groups ERP — Canonical database schema reference
-- Run in Supabase SQL Editor to align remote DB with application code.

-- ─── Core tables (extend if already exist) ───────────────────────────────────

ALTER TABLE customers ADD COLUMN IF NOT EXISTS address TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS voen TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS name TEXT;

ALTER TABLE products ADD COLUMN IF NOT EXISTS subcategory TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS barcode TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS color TEXT;
ALTER TABLE products ADD COLUMN IF NOT EXISTS weight NUMERIC DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS extra_info TEXT;

-- Sales header (items live in sale_items; payments may stay JSONB on sales)
ALTER TABLE sales ADD COLUMN IF NOT EXISTS doc_no TEXT;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS doc_date DATE DEFAULT CURRENT_DATE;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS seller_id UUID;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS customer_name TEXT;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS seller_name TEXT;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS subtotal NUMERIC DEFAULT 0;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS discount_total NUMERIC DEFAULT 0;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS vat_total NUMERIC DEFAULT 0;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS delivery_type TEXT DEFAULT 'free';
ALTER TABLE sales ADD COLUMN IF NOT EXISTS delivery_address TEXT;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS delivery_fee NUMERIC DEFAULT 0;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS notes TEXT;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS note TEXT;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS remaining_balance NUMERIC DEFAULT 0;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS warehouse_name TEXT;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS payments JSONB DEFAULT '[]'::jsonb;

-- Normalized sale line items
CREATE TABLE IF NOT EXISTS sale_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id UUID,
  product_code TEXT,
  product_name TEXT,
  warehouse_id UUID,
  warehouse_name TEXT,
  quantity NUMERIC NOT NULL DEFAULT 0,
  unit TEXT DEFAULT 'Ədəd',
  unit_price NUMERIC DEFAULT 0,
  discount_percent NUMERIC DEFAULT 0,
  vat_rate NUMERIC DEFAULT 0,
  line_total NUMERIC DEFAULT 0,
  extra_info TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON sale_items (sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_product_id ON sale_items (product_id);

-- Inventory write-offs (damaged / waste)
CREATE TABLE IF NOT EXISTS inventory_writeoffs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_number TEXT NOT NULL,
  warehouse_id UUID REFERENCES warehouses(id),
  checker_name TEXT NOT NULL,
  writeoff_date DATE DEFAULT CURRENT_DATE,
  notes TEXT,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inventory_writeoffs_document_number ON inventory_writeoffs (document_number);
CREATE INDEX IF NOT EXISTS idx_inventory_writeoffs_warehouse_id ON inventory_writeoffs (warehouse_id);

-- Consignment orders
CREATE TABLE IF NOT EXISTS consignment_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_name TEXT NOT NULL,
  seller_name TEXT,
  product_name TEXT NOT NULL,
  category_name TEXT,
  sent_qty NUMERIC DEFAULT 0,
  sold_qty NUMERIC DEFAULT 0,
  returned_qty NUMERIC DEFAULT 0,
  remaining_qty NUMERIC DEFAULT 0,
  unit_price NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

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

-- Commission rules
CREATE TABLE IF NOT EXISTS commission_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_name TEXT NOT NULL,
  min_sales NUMERIC DEFAULT 0,
  max_sales NUMERIC,
  commission_percentage NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Categories
CREATE TABLE IF NOT EXISTS categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  parent_id UUID REFERENCES categories(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Warehouses
CREATE TABLE IF NOT EXISTS warehouses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT,
  name TEXT NOT NULL,
  location TEXT,
  is_default BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Products
CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT,
  name TEXT NOT NULL,
  category TEXT,
  subcategory TEXT,
  unit TEXT DEFAULT 'Ədəd',
  buy_price NUMERIC DEFAULT 0,
  sell_price NUMERIC DEFAULT 0,
  stock NUMERIC DEFAULT 0,
  min_stock NUMERIC DEFAULT 0,
  barcode TEXT,
  color TEXT,
  weight NUMERIC DEFAULT 0,
  extra_info TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_barcode ON products (barcode);

-- Suppliers
CREATE TABLE IF NOT EXISTS suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  company_name TEXT,
  phone TEXT,
  balance NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Purchase invoices (line items in purchase_items)
CREATE TABLE IF NOT EXISTS purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number TEXT NOT NULL,
  supplier_id UUID REFERENCES suppliers(id),
  warehouse_id UUID REFERENCES warehouses(id),
  doc_date DATE DEFAULT CURRENT_DATE,
  total_amount NUMERIC DEFAULT 0,
  paid_amount NUMERIC DEFAULT 0,
  debt_amount NUMERIC DEFAULT 0,
  status TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_purchases_invoice_number ON purchases (invoice_number);
CREATE INDEX IF NOT EXISTS idx_purchases_supplier_id ON purchases (supplier_id);
CREATE INDEX IF NOT EXISTS idx_purchases_warehouse_id ON purchases (warehouse_id);

CREATE TABLE IF NOT EXISTS purchase_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_id UUID NOT NULL REFERENCES purchases(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id),
  product_code TEXT,
  product_name TEXT,
  quantity NUMERIC NOT NULL DEFAULT 0,
  unit TEXT DEFAULT 'Ədəd',
  unit_price NUMERIC DEFAULT 0,
  total_price NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase_id ON purchase_items (purchase_id);
CREATE INDEX IF NOT EXISTS idx_purchase_items_product_id ON purchase_items (product_id);

-- Extend existing purchases table if created without warehouse/doc_date
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS warehouse_id UUID REFERENCES warehouses(id);
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS doc_date DATE DEFAULT CURRENT_DATE;

-- Migrate legacy inventory_writeoffs columns if an old version exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'inventory_writeoffs' AND column_name = 'doc_no'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'inventory_writeoffs' AND column_name = 'document_number'
  ) THEN
    ALTER TABLE inventory_writeoffs RENAME COLUMN doc_no TO document_number;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'inventory_writeoffs' AND column_name = 'inspector_name'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'inventory_writeoffs' AND column_name = 'checker_name'
  ) THEN
    ALTER TABLE inventory_writeoffs RENAME COLUMN inspector_name TO checker_name;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'inventory_writeoffs' AND column_name = 'doc_date'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'inventory_writeoffs' AND column_name = 'writeoff_date'
  ) THEN
    ALTER TABLE inventory_writeoffs RENAME COLUMN doc_date TO writeoff_date;
  END IF;
END $$;

-- Migrate consignment_items → consignment_orders (optional data copy)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_name = 'consignment_items'
  ) AND NOT EXISTS (
    SELECT 1 FROM consignment_orders LIMIT 1
  ) THEN
    INSERT INTO consignment_orders (
      id, customer_name, seller_name, product_name, category_name,
      sent_qty, sold_qty, returned_qty, remaining_qty, unit_price, created_at
    )
    SELECT
      id, customer_name, seller_name, product_name, category_name,
      sent_qty, sold_qty, returned_qty, remaining_qty, unit_price, created_at
    FROM consignment_items
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;

-- ─── HR, Payroll & Sales Commissions ─────────────────────────────────────────

ALTER TABLE employees ADD COLUMN IF NOT EXISTS role TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS department TEXT DEFAULT 'general';
ALTER TABLE employees ADD COLUMN IF NOT EXISTS base_salary NUMERIC DEFAULT 0;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS default_commission NUMERIC DEFAULT 0;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active';
ALTER TABLE employees ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS employee_code TEXT;

UPDATE employees SET base_salary = salary WHERE base_salary = 0 AND salary IS NOT NULL AND salary > 0;
UPDATE employees SET role = position WHERE role IS NULL AND position IS NOT NULL;
UPDATE employees SET default_commission = default_commission_rate
WHERE default_commission IS NULL
  AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'employees' AND column_name = 'default_commission_rate'
  );
UPDATE employees SET employee_code = code
WHERE employee_code IS NULL
  AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'employees' AND column_name = 'code'
  );

CREATE TABLE IF NOT EXISTS employee_commission_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID NOT NULL REFERENCES employees(id) ON DELETE CASCADE,
  category_name TEXT NOT NULL,
  commission_rate NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employee_commission_rules_employee ON employee_commission_rules (employee_id);

CREATE TABLE IF NOT EXISTS sales_commissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  employee_id UUID REFERENCES employees(id),
  seller_name TEXT,
  sale_doc_no TEXT,
  product_category TEXT,
  product_name TEXT,
  sale_amount NUMERIC DEFAULT 0,
  commission_rate NUMERIC DEFAULT 0,
  commission_amount NUMERIC DEFAULT 0,
  status TEXT DEFAULT 'pending',
  payroll_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sales_commissions_employee_status ON sales_commissions (employee_id, status);
CREATE INDEX IF NOT EXISTS idx_sales_commissions_sale_id ON sales_commissions (sale_id);

CREATE TABLE IF NOT EXISTS salary_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id UUID REFERENCES employees(id),
  account_id UUID REFERENCES accounts(id),
  amount NUMERIC DEFAULT 0,
  month_year TEXT,
  notes TEXT,
  base_salary NUMERIC DEFAULT 0,
  commission_total NUMERIC DEFAULT 0,
  deductions NUMERIC DEFAULT 0,
  net_amount NUMERIC DEFAULT 0,
  status TEXT DEFAULT 'paid',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE salary_payments ADD COLUMN IF NOT EXISTS base_salary NUMERIC DEFAULT 0;
ALTER TABLE salary_payments ADD COLUMN IF NOT EXISTS commission_total NUMERIC DEFAULT 0;
ALTER TABLE salary_payments ADD COLUMN IF NOT EXISTS deductions NUMERIC DEFAULT 0;
ALTER TABLE salary_payments ADD COLUMN IF NOT EXISTS net_amount NUMERIC DEFAULT 0;
ALTER TABLE salary_payments ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'paid';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'sales_commissions_payroll_id_fkey'
  ) THEN
    ALTER TABLE sales_commissions
      ADD CONSTRAINT sales_commissions_payroll_id_fkey
      FOREIGN KEY (payroll_id) REFERENCES salary_payments(id);
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE commission_rules ADD COLUMN IF NOT EXISTS commission_percentage NUMERIC DEFAULT 0;
ALTER TABLE commission_rules ADD COLUMN IF NOT EXISTS max_sales NUMERIC;
UPDATE commission_rules
SET commission_percentage = commission_rate
WHERE commission_percentage IS NULL
  AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'commission_rules' AND column_name = 'commission_rate'
  );

-- ─── Access control (full definitions + seed data in types/rbac-migration.sql) ─

-- Granular permission checkpoints live in roles.permissions as a flat
-- { "can_view_sales": true, ... } object; keys are mirrored by
-- PERMISSION_MODULES in src/types/database.types.ts.
CREATE TABLE IF NOT EXISTS roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  description TEXT,
  permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_system BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  full_name TEXT,
  role_id UUID REFERENCES roles(id) ON DELETE SET NULL,
  employee_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  locale TEXT NOT NULL DEFAULT 'az' CHECK (locale IN ('az', 'en', 'ru')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_profiles_role_id ON profiles (role_id);
CREATE INDEX IF NOT EXISTS idx_profiles_email ON profiles (email);

-- Responsible person recorded on purchase documents
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS responsible_id UUID;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS responsible_name TEXT;

-- ─── Polywood module (see types/polywood-migration.sql) ─────────────────────
ALTER TABLE warehouses ADD COLUMN IF NOT EXISTS warehouse_type TEXT NOT NULL DEFAULT 'general';
ALTER TABLE products ADD COLUMN IF NOT EXISTS inventory_mode TEXT NOT NULL DEFAULT 'standard';
ALTER TABLE products ADD COLUMN IF NOT EXISTS full_sheet_length_m NUMERIC NOT NULL DEFAULT 4;
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS polywood_sale_mode TEXT;
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS polywood_length_m NUMERIC;
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS polywood_cut_details JSONB;

CREATE TABLE IF NOT EXISTS polywood_pieces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,
  length_m NUMERIC NOT NULL CHECK (length_m > 0),
  piece_type TEXT NOT NULL DEFAULT 'full' CHECK (piece_type IN ('full', 'cut')),
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN ('available', 'sold', 'consumed')),
  sale_item_id UUID,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_polywood_pieces_product_available
  ON polywood_pieces (product_id, warehouse_id)
  WHERE status = 'available';

-- ─── Inventory audit (stock count / انبارگردانی) ──────────────────────────────
CREATE TABLE IF NOT EXISTS inventory_audits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_number TEXT NOT NULL UNIQUE,
  audit_type TEXT NOT NULL CHECK (audit_type IN ('standard', 'polywood')),
  warehouse_id UUID REFERENCES warehouses(id),
  warehouse_name TEXT,
  audit_date DATE NOT NULL DEFAULT CURRENT_DATE,
  auditor_name TEXT NOT NULL,
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'applied')),
  created_by UUID REFERENCES auth.users(id),
  applied_by UUID REFERENCES auth.users(id),
  applied_at TIMESTAMPTZ,
  voucher_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inventory_audits_date ON inventory_audits (audit_date DESC);
CREATE INDEX IF NOT EXISTS idx_inventory_audits_status ON inventory_audits (status);

CREATE TABLE IF NOT EXISTS inventory_audit_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id UUID NOT NULL REFERENCES inventory_audits(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES products(id),
  product_code TEXT,
  product_name TEXT NOT NULL,
  unit TEXT,
  system_qty NUMERIC NOT NULL DEFAULT 0,
  actual_qty NUMERIC NOT NULL DEFAULT 0,
  variance_qty NUMERIC NOT NULL DEFAULT 0,
  full_sheet_length_m NUMERIC,
  system_full_sheet_count INTEGER,
  system_cut_pieces JSONB,
  actual_full_sheet_count INTEGER,
  actual_cut_pieces JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inventory_audit_items_audit_id
  ON inventory_audit_items (audit_id);

CREATE TABLE IF NOT EXISTS inventory_adjustment_vouchers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  voucher_number TEXT NOT NULL UNIQUE,
  audit_id UUID NOT NULL REFERENCES inventory_audits(id) ON DELETE CASCADE,
  audit_type TEXT NOT NULL CHECK (audit_type IN ('standard', 'polywood')),
  warehouse_id UUID REFERENCES warehouses(id),
  warehouse_name TEXT,
  audit_date DATE,
  auditor_name TEXT,
  notes TEXT,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  applied_by UUID REFERENCES auth.users(id),
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inventory_adjustment_vouchers_applied_at
  ON inventory_adjustment_vouchers (applied_at DESC);

-- ─── Manufacturing & Production ───────────────────────────────────────────────
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

