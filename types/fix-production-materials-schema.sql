-- Del Groups ERP — production_materials schema drift fix
-- Run once in Supabase SQL Editor on production DBs where the app (unit_price/total_price)
-- and delivery RPCs (unit_cost/line_cost, issued, stage_no) disagree on column sets.
--
-- Safe to re-run (IF NOT EXISTS + idempotent backfills).

-- ─── Core row identity / quantities (minimal live app writes) ───────────────
ALTER TABLE public.production_materials
  ADD COLUMN IF NOT EXISTS production_order_id UUID,
  ADD COLUMN IF NOT EXISTS product_id UUID,
  ADD COLUMN IF NOT EXISTS warehouse_id UUID,
  ADD COLUMN IF NOT EXISTS quantity NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unit TEXT DEFAULT 'Ədəd',
  ADD COLUMN IF NOT EXISTS unit_price NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS total_price NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS notes TEXT;

-- ─── RPC / canonical schema columns (delivery COGS, workflow) ───────────────
ALTER TABLE public.production_materials
  ADD COLUMN IF NOT EXISTS unit_cost NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS line_cost NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS stage_no INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS stage_label TEXT,
  ADD COLUMN IF NOT EXISTS issued BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS issued_at TIMESTAMPTZ;

-- ─── Optional legacy / polywood / audit columns ─────────────────────────────
ALTER TABLE public.production_materials
  ADD COLUMN IF NOT EXISTS product_code TEXT,
  ADD COLUMN IF NOT EXISTS product_name TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS warehouse_name TEXT,
  ADD COLUMN IF NOT EXISTS inventory_mode TEXT DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS polywood_sale_mode TEXT,
  ADD COLUMN IF NOT EXISTS polywood_length_m NUMERIC,
  ADD COLUMN IF NOT EXISTS polywood_cut_details JSONB,
  ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS created_by_name TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

-- Legacy qty → quantity rename when only qty exists.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'production_materials' AND column_name = 'qty'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'production_materials' AND column_name = 'quantity'
  ) THEN
    ALTER TABLE public.production_materials RENAME COLUMN qty TO quantity;
  END IF;
END $$;

-- Backfill dual price columns so app reads and RPC COGS agree.
UPDATE public.production_materials pm
SET
  unit_price = COALESCE(NULLIF(pm.unit_price, 0), pm.unit_cost, 0),
  unit_cost = COALESCE(NULLIF(pm.unit_cost, 0), pm.unit_price, 0),
  total_price = COALESCE(
    NULLIF(pm.total_price, 0),
    NULLIF(pm.line_cost, 0),
    COALESCE(NULLIF(pm.unit_price, 0), pm.unit_cost, 0) * COALESCE(pm.quantity, 0),
    0
  ),
  line_cost = COALESCE(
    NULLIF(pm.line_cost, 0),
    NULLIF(pm.total_price, 0),
    COALESCE(NULLIF(pm.unit_cost, 0), pm.unit_price, 0) * COALESCE(pm.quantity, 0),
    0
  ),
  stage_no = COALESCE(NULLIF(pm.stage_no, 0), 1),
  issued = COALESCE(pm.issued, FALSE)
WHERE TRUE;

CREATE INDEX IF NOT EXISTS idx_production_materials_order
  ON public.production_materials (production_order_id);

CREATE INDEX IF NOT EXISTS idx_production_materials_stage
  ON public.production_materials (production_order_id, stage_no);

NOTIFY pgrst, 'reload schema';
