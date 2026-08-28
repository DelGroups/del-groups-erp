-- Polywood inventory module — run in Supabase SQL Editor after schema.sql

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

CREATE INDEX IF NOT EXISTS idx_polywood_pieces_warehouse
  ON polywood_pieces (warehouse_id);

-- Dedicated Polywood warehouse (isolated from general inventory)
INSERT INTO warehouses (code, name, location, is_default, warehouse_type)
SELECT 'PW-001', 'Polywood', 'Polywood anbarı', false, 'polywood'
WHERE NOT EXISTS (
  SELECT 1 FROM warehouses WHERE warehouse_type = 'polywood'
);

-- RLS (same permission model as products)
ALTER TABLE polywood_pieces ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS polywood_pieces_select ON polywood_pieces;
CREATE POLICY polywood_pieces_select ON polywood_pieces
  FOR SELECT USING (public.user_has_permission('can_view_products'));

DROP POLICY IF EXISTS polywood_pieces_insert ON polywood_pieces;
CREATE POLICY polywood_pieces_insert ON polywood_pieces
  FOR INSERT WITH CHECK (public.user_has_permission('can_manage_products'));

DROP POLICY IF EXISTS polywood_pieces_update ON polywood_pieces;
CREATE POLICY polywood_pieces_update ON polywood_pieces
  FOR UPDATE USING (public.user_has_permission('can_manage_products'));

DROP POLICY IF EXISTS polywood_pieces_delete ON polywood_pieces;
CREATE POLICY polywood_pieces_delete ON polywood_pieces
  FOR DELETE USING (public.user_has_permission('can_manage_products'));
