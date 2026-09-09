-- Procurement reorder rules + supplier scoring weights in system_settings.
-- Safety-stock auto PRs and lead-time notes read live config.

INSERT INTO public.system_settings (key, value)
VALUES (
  'procurement_config',
  '{
    "auto_create_purchase_request": true,
    "default_lead_time_days": 7,
    "critical_stock_notification": true,
    "price_weight": 40,
    "quality_weight": 30,
    "delivery_speed_weight": 30
  }'::jsonb
)
ON CONFLICT (key) DO NOTHING;

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
  v_cfg JSONB;
  v_auto BOOLEAN;
  v_lead INT;
BEGIN
  SELECT value INTO v_cfg
    FROM public.system_settings
   WHERE key = 'procurement_config';

  v_auto := COALESCE((v_cfg ->> 'auto_create_purchase_request')::boolean, true);
  IF NOT v_auto THEN
    RETURN NULL;
  END IF;

  v_lead := GREATEST(COALESCE((v_cfg ->> 'default_lead_time_days')::int, 7), 0);

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
      'Avtomatik: stok %s ≤ minimum hədd %s. Təxmini çatdırılma: %s gün',
      to_char(v_stock, 'FM999999990.00'),
      to_char(v_min, 'FM999999990.00'),
      v_lead::text
    )
  )
  RETURNING id INTO v_request_id;

  RETURN v_request_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_safety_stock_request(UUID) TO authenticated;
