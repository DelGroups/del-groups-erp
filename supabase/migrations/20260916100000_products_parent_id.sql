-- Link offcut / remainder piece products to parent sheet SKU.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES public.products(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_products_parent_id
  ON public.products (parent_id)
  WHERE parent_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
