-- Safety-stock auto-reorder + supplier delivery ratings.

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS min_stock_level NUMERIC DEFAULT 0;

UPDATE public.products
   SET min_stock_level = COALESCE(min_stock, 0)
 WHERE min_stock_level IS NULL OR min_stock_level IS DISTINCT FROM COALESCE(min_stock, 0);

ALTER TABLE public.products
  ALTER COLUMN min_stock_level SET DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.warehouse_stocks (
  product_id UUID PRIMARY KEY REFERENCES public.products(id) ON DELETE CASCADE,
  warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE SET NULL,
  current_stock NUMERIC NOT NULL DEFAULT 0,
  min_stock_level NUMERIC NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_warehouse_stocks_critical
  ON public.warehouse_stocks (product_id)
  WHERE current_stock <= min_stock_level AND min_stock_level > 0;

INSERT INTO public.warehouse_stocks (product_id, warehouse_id, current_stock, min_stock_level)
SELECT
  p.id,
  NULL,
  COALESCE(p.stock, 0),
  COALESCE(p.min_stock_level, p.min_stock, 0)
FROM public.products p
ON CONFLICT (product_id) DO UPDATE
  SET
    current_stock = EXCLUDED.current_stock,
    min_stock_level = EXCLUDED.min_stock_level,
    updated_at = NOW();

ALTER TABLE public.purchase_requests
  ALTER COLUMN production_order_id DROP NOT NULL;

ALTER TABLE public.purchase_requests
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'production';

ALTER TABLE public.purchase_requests
  DROP CONSTRAINT IF EXISTS purchase_requests_status_check;

ALTER TABLE public.purchase_requests
  ADD CONSTRAINT purchase_requests_status_check
  CHECK (status IN ('pending', 'ordered', 'received', 'fulfilled', 'cancelled', 'auto_triggered'));

ALTER TABLE public.purchase_requests
  DROP CONSTRAINT IF EXISTS purchase_requests_source_check;

ALTER TABLE public.purchase_requests
  ADD CONSTRAINT purchase_requests_source_check
  CHECK (source IN ('production', 'safety_stock'));

CREATE INDEX IF NOT EXISTS idx_purchase_requests_product_open
  ON public.purchase_requests (product_id, status)
  WHERE status IN ('pending', 'ordered', 'auto_triggered');

ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS quality_score NUMERIC(4, 2),
  ADD COLUMN IF NOT EXISTS delivery_speed_score NUMERIC(4, 2),
  ADD COLUMN IF NOT EXISTS rating_count INT NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.supplier_delivery_ratings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID NOT NULL REFERENCES public.suppliers(id) ON DELETE CASCADE,
  purchase_id UUID REFERENCES public.purchases(id) ON DELETE SET NULL,
  quality_score INT NOT NULL CHECK (quality_score BETWEEN 1 AND 5),
  delivery_speed_score INT NOT NULL CHECK (delivery_speed_score BETWEEN 1 AND 5),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (purchase_id)
);

CREATE INDEX IF NOT EXISTS idx_supplier_delivery_ratings_supplier
  ON public.supplier_delivery_ratings (supplier_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.sync_product_min_stock_level()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.min_stock_level IS NULL OR NEW.min_stock_level = 0 THEN
      NEW.min_stock_level := COALESCE(NEW.min_stock, 0);
    END IF;
    IF NEW.min_stock IS NULL OR (NEW.min_stock = 0 AND COALESCE(NEW.min_stock_level, 0) > 0) THEN
      NEW.min_stock := COALESCE(NEW.min_stock_level, 0);
    END IF;
    NEW.min_stock := COALESCE(NEW.min_stock, 0);
    NEW.min_stock_level := COALESCE(NEW.min_stock_level, NEW.min_stock, 0);
    RETURN NEW;
  END IF;

  IF NEW.min_stock_level IS DISTINCT FROM OLD.min_stock_level THEN
    NEW.min_stock := COALESCE(NEW.min_stock_level, 0);
  ELSIF NEW.min_stock IS DISTINCT FROM OLD.min_stock THEN
    NEW.min_stock_level := COALESCE(NEW.min_stock, 0);
  ELSE
    NEW.min_stock := COALESCE(NEW.min_stock, NEW.min_stock_level, 0);
    NEW.min_stock_level := COALESCE(NEW.min_stock_level, NEW.min_stock, 0);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_product_min_stock_level ON public.products;
CREATE TRIGGER trg_sync_product_min_stock_level
  BEFORE INSERT OR UPDATE OF min_stock, min_stock_level
  ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_product_min_stock_level();

CREATE OR REPLACE FUNCTION public.upsert_warehouse_stock_from_product()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.warehouse_stocks (
    product_id,
    warehouse_id,
    current_stock,
    min_stock_level,
    updated_at
  )
  VALUES (
    NEW.id,
    NULL,
    COALESCE(NEW.stock, 0),
    COALESCE(NEW.min_stock_level, NEW.min_stock, 0),
    NOW()
  )
  ON CONFLICT (product_id) DO UPDATE
    SET
      current_stock = EXCLUDED.current_stock,
      min_stock_level = EXCLUDED.min_stock_level,
      updated_at = NOW();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_upsert_warehouse_stock_from_product ON public.products;
CREATE TRIGGER trg_upsert_warehouse_stock_from_product
  AFTER INSERT OR UPDATE OF stock, min_stock, min_stock_level
  ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.upsert_warehouse_stock_from_product();

CREATE OR REPLACE FUNCTION public.create_safety_stock_request(p_product_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product RECORD;
  v_min NUMERIC;
  v_stock NUMERIC;
  v_qty NUMERIC;
  v_existing UUID;
  v_request_id UUID;
  v_no TEXT;
BEGIN
  SELECT
    id,
    code,
    name,
    unit,
    COALESCE(is_service, FALSE) AS is_service,
    COALESCE(stock, 0) AS stock,
    COALESCE(min_stock_level, min_stock, 0) AS min_level
    INTO v_product
    FROM public.products
   WHERE id = p_product_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_product.is_service THEN
    RETURN NULL;
  END IF;

  v_min := COALESCE(v_product.min_level, 0);
  v_stock := COALESCE(v_product.stock, 0);

  IF v_min <= 0 OR v_stock > v_min THEN
    RETURN NULL;
  END IF;

  SELECT id
    INTO v_existing
    FROM public.purchase_requests
   WHERE product_id = p_product_id
     AND status IN ('auto_triggered', 'pending', 'ordered')
     AND source = 'safety_stock'
   LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  v_qty := GREATEST(v_min, v_min - v_stock, 1);
  v_no := 'ASR-' || to_char(NOW(), 'YYYYMMDD') || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);

  INSERT INTO public.purchase_requests (
    request_no,
    production_order_id,
    product_id,
    product_code,
    product_name,
    warehouse_id,
    quantity,
    unit,
    status,
    source,
    notes
  )
  VALUES (
    v_no,
    NULL,
    v_product.id,
    v_product.code,
    v_product.name,
    NULL,
    v_qty,
    COALESCE(v_product.unit, 'Ədəd'),
    'auto_triggered',
    'safety_stock',
    format(
      'Avtomatik: stok %s ≤ minimum hədd %s',
      to_char(v_stock, 'FM999999990.00'),
      to_char(v_min, 'FM999999990.00')
    )
  )
  RETURNING id INTO v_request_id;

  RETURN v_request_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.maybe_create_safety_stock_request()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.create_safety_stock_request(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_maybe_create_safety_stock_request ON public.products;
CREATE TRIGGER trg_maybe_create_safety_stock_request
  AFTER INSERT OR UPDATE OF stock, min_stock, min_stock_level, is_service
  ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.maybe_create_safety_stock_request();

CREATE OR REPLACE FUNCTION public.rate_supplier_delivery(
  p_purchase_id UUID,
  p_quality INT,
  p_speed INT,
  p_notes TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_supplier UUID;
BEGIN
  IF p_quality IS NULL OR p_quality < 1 OR p_quality > 5 THEN
    RAISE EXCEPTION 'invalid_quality_score' USING ERRCODE = '22023';
  END IF;
  IF p_speed IS NULL OR p_speed < 1 OR p_speed > 5 THEN
    RAISE EXCEPTION 'invalid_delivery_score' USING ERRCODE = '22023';
  END IF;

  SELECT supplier_id INTO v_supplier
    FROM public.purchases
   WHERE id = p_purchase_id;

  IF v_supplier IS NULL THEN
    RAISE EXCEPTION 'purchase_or_supplier_not_found' USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO public.supplier_delivery_ratings (
    supplier_id,
    purchase_id,
    quality_score,
    delivery_speed_score,
    notes
  )
  VALUES (v_supplier, p_purchase_id, p_quality, p_speed, NULLIF(trim(COALESCE(p_notes, '')), ''))
  ON CONFLICT (purchase_id) DO UPDATE
    SET
      quality_score = EXCLUDED.quality_score,
      delivery_speed_score = EXCLUDED.delivery_speed_score,
      notes = EXCLUDED.notes;

  UPDATE public.suppliers s
     SET
       quality_score = agg.quality_avg,
       delivery_speed_score = agg.speed_avg,
       rating_count = agg.rating_count
    FROM (
      SELECT
        supplier_id,
        ROUND(AVG(quality_score)::NUMERIC, 2) AS quality_avg,
        ROUND(AVG(delivery_speed_score)::NUMERIC, 2) AS speed_avg,
        COUNT(*)::INT AS rating_count
      FROM public.supplier_delivery_ratings
      WHERE supplier_id = v_supplier
      GROUP BY supplier_id
    ) agg
   WHERE s.id = agg.supplier_id;
END;
$$;

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT id
      FROM public.products
     WHERE COALESCE(is_service, FALSE) = FALSE
       AND COALESCE(min_stock_level, min_stock, 0) > 0
       AND COALESCE(stock, 0) <= COALESCE(min_stock_level, min_stock, 0)
  LOOP
    PERFORM public.create_safety_stock_request(r.id);
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION public.create_safety_stock_request(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rate_supplier_delivery(UUID, INT, INT, TEXT) TO authenticated;
