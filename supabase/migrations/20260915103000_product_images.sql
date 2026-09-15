-- Product catalog images (public URLs stored on products.image_url).

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS image_url TEXT;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'product-images',
  'product-images',
  true,
  5242880,
  ARRAY['image/png', 'image/jpeg', 'image/jpg', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS product_images_select ON storage.objects;
CREATE POLICY product_images_select ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'product-images');

DROP POLICY IF EXISTS product_images_insert ON storage.objects;
CREATE POLICY product_images_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'product-images');

DROP POLICY IF EXISTS product_images_update ON storage.objects;
CREATE POLICY product_images_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'product-images');

DROP POLICY IF EXISTS product_images_delete ON storage.objects;
CREATE POLICY product_images_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'product-images');

CREATE OR REPLACE FUNCTION public.create_product_with_bom_atomic(
  p_product JSONB,
  p_bom_rows JSONB DEFAULT '[]'::jsonb,
  p_is_composite BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product public.products;
  v_row JSONB;
  v_component_id UUID;
  v_quantity NUMERIC;
  v_bom_count INT := 0;
  v_is_service BOOLEAN := COALESCE((p_product->>'is_service')::boolean, false);
BEGIN
  IF p_product IS NULL OR COALESCE(btrim(p_product->>'name'), '') = '' THEN
    RAISE EXCEPTION 'product_name_required'
      USING ERRCODE = '22023',
            MESSAGE = 'Məhsul adı tələb olunur';
  END IF;

  INSERT INTO public.products (
    code,
    name,
    category,
    subcategory,
    unit,
    buy_price,
    sell_price,
    stock,
    min_stock,
    min_stock_level,
    barcode,
    qr_code,
    extra_info,
    category_id,
    is_dimensional,
    is_service,
    is_composite,
    base_length,
    base_width,
    image_url
  )
  VALUES (
    COALESCE(
      NULLIF(btrim(p_product->>'code'), ''),
      'PRD-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))
    ),
    btrim(p_product->>'name'),
    COALESCE(NULLIF(btrim(p_product->>'category'), ''), 'Ümumi'),
    NULLIF(btrim(p_product->>'subcategory'), ''),
    COALESCE(NULLIF(btrim(p_product->>'unit'), ''), 'Ədəd'),
    COALESCE((p_product->>'buy_price')::numeric, 0),
    COALESCE((p_product->>'sell_price')::numeric, 0),
    CASE WHEN v_is_service THEN 0 ELSE COALESCE((p_product->>'stock')::numeric, 0) END,
    CASE WHEN v_is_service THEN 0 ELSE COALESCE((p_product->>'min_stock')::numeric, 0) END,
    CASE
      WHEN v_is_service THEN 0
      ELSE COALESCE(
        (p_product->>'min_stock_level')::numeric,
        (p_product->>'min_stock')::numeric,
        0
      )
    END,
    NULLIF(btrim(p_product->>'barcode'), ''),
    NULLIF(btrim(p_product->>'qr_code'), ''),
    NULLIF(btrim(p_product->>'extra_info'), ''),
    NULLIF(p_product->>'category_id', '')::uuid,
    COALESCE((p_product->>'is_dimensional')::boolean, false),
    v_is_service,
    CASE WHEN v_is_service THEN false ELSE COALESCE(p_is_composite, false) END,
    NULLIF(p_product->>'base_length', '')::numeric,
    NULLIF(p_product->>'base_width', '')::numeric,
    NULLIF(btrim(p_product->>'image_url'), '')
  )
  RETURNING * INTO v_product;

  IF p_is_composite AND NOT v_is_service THEN
    FOR v_row IN
      SELECT value FROM jsonb_array_elements(COALESCE(p_bom_rows, '[]'::jsonb))
    LOOP
      v_component_id := NULLIF(v_row->>'component_product_id', '')::uuid;
      v_quantity := COALESCE((v_row->>'quantity')::numeric, 0);

      IF v_component_id IS NULL OR v_quantity <= 0 THEN
        CONTINUE;
      END IF;

      IF v_component_id = v_product.id THEN
        DELETE FROM public.products WHERE id = v_product.id;
        RAISE EXCEPTION 'bom_self_reference'
          USING ERRCODE = '22023',
                MESSAGE = 'Komplekt komponenti öz məhsuluna bərabər ola bilməz';
      END IF;

      INSERT INTO public.product_bom (parent_product_id, component_product_id, quantity)
      VALUES (v_product.id, v_component_id, v_quantity);

      v_bom_count := v_bom_count + 1;
    END LOOP;

    IF v_bom_count = 0 THEN
      DELETE FROM public.products WHERE id = v_product.id;
      RAISE EXCEPTION 'bom_rows_required'
        USING ERRCODE = '22023',
              MESSAGE = 'Komplekt üçün ən azı bir komponent tələb olunur';
    END IF;
  END IF;

  RETURN to_jsonb(v_product);
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_product_with_bom_atomic(JSONB, JSONB, BOOLEAN)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
