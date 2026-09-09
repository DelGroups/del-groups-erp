-- Barcode / QR fields for products and polywood pieces, plus unique indexes.

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS barcode TEXT;
ALTER TABLE public.products ADD COLUMN IF NOT EXISTS qr_code TEXT;

ALTER TABLE public.polywood_pieces ADD COLUMN IF NOT EXISTS barcode TEXT;
ALTER TABLE public.polywood_pieces ADD COLUMN IF NOT EXISTS qr_code TEXT;

UPDATE public.products
SET barcode = 'DG' || upper(substr(replace(id::text, '-', ''), 1, 11))
WHERE barcode IS NULL OR btrim(barcode) = '';

UPDATE public.products
SET qr_code = barcode
WHERE qr_code IS NULL AND barcode IS NOT NULL;

UPDATE public.polywood_pieces
SET barcode = 'PW' || upper(substr(replace(id::text, '-', ''), 1, 11))
WHERE barcode IS NULL OR btrim(barcode) = '';

UPDATE public.polywood_pieces
SET qr_code = barcode
WHERE qr_code IS NULL AND barcode IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_products_barcode_unique
  ON public.products (barcode)
  WHERE barcode IS NOT NULL AND btrim(barcode) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_polywood_pieces_barcode_unique
  ON public.polywood_pieces (barcode)
  WHERE barcode IS NOT NULL AND btrim(barcode) <> '';

CREATE INDEX IF NOT EXISTS idx_products_qr_code
  ON public.products (qr_code)
  WHERE qr_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_polywood_pieces_qr_code
  ON public.polywood_pieces (qr_code)
  WHERE qr_code IS NOT NULL;

CREATE OR REPLACE FUNCTION public.ensure_inventory_barcode()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.barcode IS NULL OR btrim(NEW.barcode) = '' THEN
    NEW.barcode := CASE TG_TABLE_NAME
      WHEN 'polywood_pieces' THEN 'PW'
      ELSE 'DG'
    END || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 11));
  END IF;
  IF NEW.qr_code IS NULL OR btrim(NEW.qr_code) = '' THEN
    NEW.qr_code := NEW.barcode;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_products_barcode ON public.products;
CREATE TRIGGER trg_products_barcode
  BEFORE INSERT OR UPDATE ON public.products
  FOR EACH ROW
  EXECUTE PROCEDURE public.ensure_inventory_barcode();

DROP TRIGGER IF EXISTS trg_polywood_pieces_barcode ON public.polywood_pieces;
CREATE TRIGGER trg_polywood_pieces_barcode
  BEFORE INSERT OR UPDATE ON public.polywood_pieces
  FOR EACH ROW
  EXECUTE PROCEDURE public.ensure_inventory_barcode();
