-- Inter-warehouse stock transfers + per-warehouse stock rows.

CREATE TABLE IF NOT EXISTS public.stock_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reference_number TEXT NOT NULL UNIQUE,
  from_warehouse_id UUID NOT NULL REFERENCES public.warehouses(id),
  to_warehouse_id UUID NOT NULL REFERENCES public.warehouses(id),
  transfer_date DATE NOT NULL DEFAULT CURRENT_DATE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed')),
  notes TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT stock_transfers_distinct_warehouses CHECK (from_warehouse_id <> to_warehouse_id)
);

CREATE INDEX IF NOT EXISTS idx_stock_transfers_date
  ON public.stock_transfers (transfer_date DESC, created_at DESC);

CREATE TABLE IF NOT EXISTS public.stock_transfer_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id UUID NOT NULL REFERENCES public.stock_transfers(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES public.products(id),
  offcut_id UUID REFERENCES public.polywood_pieces(id) ON DELETE SET NULL,
  quantity NUMERIC NOT NULL DEFAULT 0 CHECK (quantity > 0),
  product_code TEXT,
  product_name TEXT,
  unit TEXT,
  barcode TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_transfer_items_transfer
  ON public.stock_transfer_items (transfer_id);

-- Allow multiple warehouse rows per product (multi-warehouse).
ALTER TABLE public.warehouse_stocks
  ADD COLUMN IF NOT EXISTS id UUID DEFAULT gen_random_uuid();

UPDATE public.warehouse_stocks
   SET id = gen_random_uuid()
 WHERE id IS NULL;

ALTER TABLE public.warehouse_stocks
  ALTER COLUMN id SET DEFAULT gen_random_uuid();

ALTER TABLE public.warehouse_stocks
  ALTER COLUMN id SET NOT NULL;

ALTER TABLE public.warehouse_stocks
  DROP CONSTRAINT IF EXISTS warehouse_stocks_pkey;

ALTER TABLE public.warehouse_stocks
  ADD CONSTRAINT warehouse_stocks_pkey PRIMARY KEY (id);

CREATE UNIQUE INDEX IF NOT EXISTS uq_warehouse_stocks_product_warehouse
  ON public.warehouse_stocks (
    product_id,
    COALESCE(warehouse_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

ALTER TABLE public.stock_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stock_transfer_items ENABLE ROW LEVEL SECURITY;

SELECT public._apply_table_rls(
  'stock_transfers',
  'can_view_products',
  'can_manage_warehouses',
  'can_manage_warehouses',
  'can_manage_warehouses'
);

SELECT public._apply_table_rls(
  'stock_transfer_items',
  'can_view_products',
  'can_manage_warehouses',
  'can_manage_warehouses',
  'can_manage_warehouses'
);
