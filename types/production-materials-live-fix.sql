-- Live/minimal production_materials schema (Del Groups ERP production DB).
-- Run once in Supabase SQL editor if inserts fail on missing columns.
-- App writes: production_order_id, product_id, warehouse_id, quantity, unit, unit_price, total_price, notes.

ALTER TABLE production_materials ADD COLUMN IF NOT EXISTS production_order_id UUID;
ALTER TABLE production_materials ADD COLUMN IF NOT EXISTS product_id UUID;
ALTER TABLE production_materials ADD COLUMN IF NOT EXISTS warehouse_id UUID;
ALTER TABLE production_materials ADD COLUMN IF NOT EXISTS quantity NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE production_materials ADD COLUMN IF NOT EXISTS unit TEXT DEFAULT 'Ədəd';
ALTER TABLE production_materials ADD COLUMN IF NOT EXISTS unit_price NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE production_materials ADD COLUMN IF NOT EXISTS total_price NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE production_materials ADD COLUMN IF NOT EXISTS notes TEXT;

-- Backfill from legacy column names when present.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'production_materials' AND column_name = 'unit_cost'
  ) THEN
    UPDATE production_materials
    SET unit_price = COALESCE(NULLIF(unit_price, 0), unit_cost, 0);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'production_materials' AND column_name = 'line_cost'
  ) THEN
    UPDATE production_materials
    SET total_price = COALESCE(NULLIF(total_price, 0), line_cost, 0);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'production_materials' AND column_name = 'qty'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'production_materials' AND column_name = 'quantity'
  ) THEN
    ALTER TABLE production_materials RENAME COLUMN qty TO quantity;
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
