-- production_orders: contractor link + UI production type (bom_series / internal_custom / contractor_outsource)

ALTER TABLE public.production_orders
  ADD COLUMN IF NOT EXISTS contractor_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS production_type VARCHAR(50) DEFAULT 'internal_custom';

UPDATE public.production_orders
SET contractor_id = subcontractor_id
WHERE contractor_id IS NULL
  AND subcontractor_id IS NOT NULL;

UPDATE public.production_orders
SET production_type = CASE
  WHEN production_model = 'series' THEN 'bom_series'
  WHEN production_model = 'subcontractor_custom' THEN 'contractor_outsource'
  ELSE 'internal_custom'
END
WHERE production_type IS NULL OR production_type = 'internal_custom';

ALTER TABLE public.production_orders
  DROP CONSTRAINT IF EXISTS production_orders_production_type_check;

ALTER TABLE public.production_orders
  ADD CONSTRAINT production_orders_production_type_check
  CHECK (
    production_type IN ('bom_series', 'internal_custom', 'contractor_outsource')
  );

CREATE INDEX IF NOT EXISTS idx_production_orders_contractor_id
  ON public.production_orders (contractor_id);

CREATE INDEX IF NOT EXISTS idx_production_orders_production_type
  ON public.production_orders (production_type);

NOTIFY pgrst, 'reload schema';
