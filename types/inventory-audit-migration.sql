-- Inventory Audit / Stock Count migration

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

ALTER TABLE inventory_audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_audit_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_adjustment_vouchers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inventory_audits_select ON inventory_audits;
CREATE POLICY inventory_audits_select ON inventory_audits
  FOR SELECT USING (public.user_has_permission('can_view_products'));

DROP POLICY IF EXISTS inventory_audits_insert ON inventory_audits;
CREATE POLICY inventory_audits_insert ON inventory_audits
  FOR INSERT WITH CHECK (public.user_has_permission('can_writeoff_inventory'));

DROP POLICY IF EXISTS inventory_audits_update ON inventory_audits;
CREATE POLICY inventory_audits_update ON inventory_audits
  FOR UPDATE USING (public.user_has_permission('can_writeoff_inventory'));

DROP POLICY IF EXISTS inventory_audit_items_select ON inventory_audit_items;
CREATE POLICY inventory_audit_items_select ON inventory_audit_items
  FOR SELECT USING (public.user_has_permission('can_view_products'));

DROP POLICY IF EXISTS inventory_audit_items_insert ON inventory_audit_items;
CREATE POLICY inventory_audit_items_insert ON inventory_audit_items
  FOR INSERT WITH CHECK (public.user_has_permission('can_writeoff_inventory'));

DROP POLICY IF EXISTS inventory_audit_items_update ON inventory_audit_items;
CREATE POLICY inventory_audit_items_update ON inventory_audit_items
  FOR UPDATE USING (public.user_has_permission('can_writeoff_inventory'));

DROP POLICY IF EXISTS inventory_adjustment_vouchers_select ON inventory_adjustment_vouchers;
CREATE POLICY inventory_adjustment_vouchers_select ON inventory_adjustment_vouchers
  FOR SELECT USING (public.user_has_permission('can_view_products'));

DROP POLICY IF EXISTS inventory_adjustment_vouchers_insert ON inventory_adjustment_vouchers;
CREATE POLICY inventory_adjustment_vouchers_insert ON inventory_adjustment_vouchers
  FOR INSERT WITH CHECK (public.user_has_permission('can_writeoff_inventory'));
