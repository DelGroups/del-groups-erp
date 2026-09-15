-- Unique product SKU for bulk import upsert on conflict (code).

CREATE UNIQUE INDEX IF NOT EXISTS idx_products_code_unique
  ON public.products (code)
  WHERE code IS NOT NULL AND btrim(code) <> '';

NOTIFY pgrst, 'reload schema';
