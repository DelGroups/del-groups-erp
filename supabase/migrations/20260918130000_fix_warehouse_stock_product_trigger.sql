-- warehouse_stocks PK is no longer (product_id); sync trigger must not use ON CONFLICT (product_id).

CREATE OR REPLACE FUNCTION public.upsert_warehouse_stock_from_product()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row_id UUID;
BEGIN
  SELECT ws.id
    INTO v_row_id
    FROM public.warehouse_stocks ws
   WHERE ws.product_id = NEW.id
   ORDER BY ws.updated_at DESC NULLS LAST, ws.id
   LIMIT 1;

  IF v_row_id IS NOT NULL THEN
    UPDATE public.warehouse_stocks
       SET current_stock = COALESCE(NEW.stock, 0),
           min_stock_level = COALESCE(NEW.min_stock_level, NEW.min_stock, 0),
           updated_at = NOW()
     WHERE id = v_row_id;
  ELSE
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
    );
  END IF;

  RETURN NEW;
END;
$$;

NOTIFY pgrst, 'reload schema';
