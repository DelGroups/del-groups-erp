-- Run once in Supabase SQL editor.
-- Unblocks the CURRENT production site (legacy inserts) AND the new minimal 7-column app writes.
-- After deploying the latest app code, only unit_price/total_price + ids are required for writes.

-- ─── Price columns (minimal / new app) ───────────────────────────────────────
ALTER TABLE production_materials ADD COLUMN IF NOT EXISTS unit_price NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE production_materials ADD COLUMN IF NOT EXISTS total_price NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE production_materials ADD COLUMN IF NOT EXISTS notes TEXT;

-- ─── Denormalized display (legacy deployed app still sends these) ────────────
ALTER TABLE production_materials ADD COLUMN IF NOT EXISTS product_code TEXT;
ALTER TABLE production_materials ADD COLUMN IF NOT EXISTS product_name TEXT DEFAULT '';
ALTER TABLE production_materials ADD COLUMN IF NOT EXISTS warehouse_name TEXT;
ALTER TABLE production_materials ADD COLUMN IF NOT EXISTS unit TEXT DEFAULT 'Ədəd';
ALTER TABLE production_materials ADD COLUMN IF NOT EXISTS unit_cost NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE production_materials ADD COLUMN IF NOT EXISTS line_cost NUMERIC NOT NULL DEFAULT 0;

-- ─── Polywood / workflow (legacy) ────────────────────────────────────────────
ALTER TABLE production_materials ADD COLUMN IF NOT EXISTS inventory_mode TEXT DEFAULT 'standard';
ALTER TABLE production_materials ADD COLUMN IF NOT EXISTS polywood_sale_mode TEXT;
ALTER TABLE production_materials ADD COLUMN IF NOT EXISTS polywood_length_m NUMERIC;
ALTER TABLE production_materials ADD COLUMN IF NOT EXISTS polywood_cut_details JSONB;
ALTER TABLE production_materials ADD COLUMN IF NOT EXISTS stage_no INTEGER NOT NULL DEFAULT 1;
ALTER TABLE production_materials ADD COLUMN IF NOT EXISTS stage_label TEXT;
ALTER TABLE production_materials ADD COLUMN IF NOT EXISTS issued BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE production_materials ADD COLUMN IF NOT EXISTS issued_at TIMESTAMPTZ;
ALTER TABLE production_materials ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id);
ALTER TABLE production_materials ADD COLUMN IF NOT EXISTS created_by_name TEXT;
ALTER TABLE production_materials ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Backfill unit_price / total_price from legacy names when present.
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
END $$;

NOTIFY pgrst, 'reload schema';
