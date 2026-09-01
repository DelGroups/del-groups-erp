-- Backfill production_orders columns expected by the app (legacy DBs created before full production-migration.sql)

ALTER TABLE public.production_orders
  ADD COLUMN IF NOT EXISTS materials_allocated BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.production_orders
  ADD COLUMN IF NOT EXISTS finished_goods_posted BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.production_orders
  ADD COLUMN IF NOT EXISTS sale_id UUID;

ALTER TABLE public.production_orders
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;

ALTER TABLE public.production_orders
  ADD COLUMN IF NOT EXISTS remaining_balance NUMERIC NOT NULL DEFAULT 0;

ALTER TABLE public.production_orders
  ADD COLUMN IF NOT EXISTS project_scope TEXT;

ALTER TABLE public.production_orders
  ADD COLUMN IF NOT EXISTS terms TEXT;

ALTER TABLE public.production_orders
  ADD COLUMN IF NOT EXISTS notes TEXT;

ALTER TABLE public.production_orders
  ADD COLUMN IF NOT EXISTS advance_account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL;

ALTER TABLE public.production_orders
  ADD COLUMN IF NOT EXISTS advance_posted_at TIMESTAMPTZ;

ALTER TABLE public.production_orders
  ADD COLUMN IF NOT EXISTS advance_transaction_id UUID;

ALTER TABLE public.production_orders
  ADD COLUMN IF NOT EXISTS production_model TEXT NOT NULL DEFAULT 'in_house_custom';

ALTER TABLE public.production_orders
  ADD COLUMN IF NOT EXISTS ousta_id UUID REFERENCES public.employees(id) ON DELETE SET NULL;

ALTER TABLE public.production_orders
  ADD COLUMN IF NOT EXISTS subcontractor_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL;

ALTER TABLE public.production_orders
  ADD COLUMN IF NOT EXISTS subcontractor_fee_percent NUMERIC(5,2) NOT NULL DEFAULT 20.00;

ALTER TABLE public.production_orders
  ADD COLUMN IF NOT EXISTS subcontractor_fee_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00;

ALTER TABLE public.production_orders
  ADD COLUMN IF NOT EXISTS raw_material_warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE SET NULL;

ALTER TABLE public.production_orders
  ADD COLUMN IF NOT EXISTS furniture_warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE SET NULL;

ALTER TABLE public.production_orders
  ADD COLUMN IF NOT EXISTS custom_product_id UUID REFERENCES public.products(id) ON DELETE SET NULL;

-- FK for sale_id when sales table exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'production_orders_sale_id_fkey'
  ) THEN
    ALTER TABLE public.production_orders
      ADD CONSTRAINT production_orders_sale_id_fkey
      FOREIGN KEY (sale_id) REFERENCES public.sales(id) ON DELETE SET NULL;
  END IF;
EXCEPTION
  WHEN undefined_table THEN NULL;
  WHEN duplicate_object THEN NULL;
END;
$$;

ALTER TABLE public.production_orders
  DROP CONSTRAINT IF EXISTS production_orders_production_model_check;

ALTER TABLE public.production_orders
  ADD CONSTRAINT production_orders_production_model_check
  CHECK (production_model IN ('series', 'in_house_custom', 'subcontractor_custom'));

UPDATE public.production_orders
SET production_model = CASE
  WHEN type = 'Series' THEN 'series'
  WHEN custom_workflow = 'subcontractor' THEN 'subcontractor_custom'
  ELSE 'in_house_custom'
END
WHERE production_model IS NULL OR production_model = 'in_house_custom';
