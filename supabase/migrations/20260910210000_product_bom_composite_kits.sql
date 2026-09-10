-- Product BOM (kits) + composite FIFO/COGS + virtual stock

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS is_composite BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE IF NOT EXISTS public.product_bom (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  component_product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  quantity NUMERIC(14, 4) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (parent_product_id, component_product_id),
  CHECK (parent_product_id <> component_product_id)
);

CREATE INDEX IF NOT EXISTS idx_product_bom_parent
  ON public.product_bom (parent_product_id);

CREATE INDEX IF NOT EXISTS idx_product_bom_component
  ON public.product_bom (component_product_id);

-- ─── Stock helpers ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.get_batch_available_stock(p_product_id UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT SUM(ib.remaining_qty)
      FROM public.inventory_batches ib
      WHERE ib.product_id = p_product_id
        AND ib.remaining_qty > 0
    ),
    (
      SELECT COALESCE(p.stock, 0)
      FROM public.products p
      WHERE p.id = p_product_id
    ),
    0
  );
$$;

CREATE OR REPLACE FUNCTION public.get_composite_available_stock(p_product_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_min NUMERIC;
BEGIN
  SELECT MIN(
    FLOOR(
      public.get_batch_available_stock(pb.component_product_id)
      / GREATEST(pb.quantity, 0.0001)
    )
  )
  INTO v_min
  FROM public.product_bom pb
  WHERE pb.parent_product_id = p_product_id;

  IF v_min IS NULL THEN
    RETURN 0;
  END IF;

  RETURN GREATEST(v_min, 0);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_product_available_stock(p_product_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_is_composite BOOLEAN := false;
BEGIN
  SELECT COALESCE(is_composite, false)
  INTO v_is_composite
  FROM public.products
  WHERE id = p_product_id;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  IF v_is_composite THEN
    RETURN public.get_composite_available_stock(p_product_id);
  END IF;

  RETURN public.get_batch_available_stock(p_product_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.merge_stock_demand(
  p_demand JSONB,
  p_product_id UUID,
  p_quantity NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_is_composite BOOLEAN := false;
  v_bom RECORD;
  v_key TEXT;
  v_component_qty NUMERIC;
  v_result JSONB := COALESCE(p_demand, '{}'::jsonb);
BEGIN
  IF p_product_id IS NULL OR COALESCE(p_quantity, 0) <= 0 THEN
    RETURN v_result;
  END IF;

  SELECT COALESCE(is_composite, false)
  INTO v_is_composite
  FROM public.products
  WHERE id = p_product_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'product_not_found'
      USING ERRCODE = 'P0002', MESSAGE = format('Məhsul tapılmadı: %s', p_product_id);
  END IF;

  IF v_is_composite THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.product_bom WHERE parent_product_id = p_product_id
    ) THEN
      RAISE EXCEPTION 'composite_bom_missing'
        USING ERRCODE = '22023',
              MESSAGE = format('Komplekt məhsul üçün BOM təyin edilməyib: %s', p_product_id);
    END IF;

    FOR v_bom IN
      SELECT component_product_id, quantity
      FROM public.product_bom
      WHERE parent_product_id = p_product_id
    LOOP
      v_key := v_bom.component_product_id::text;
      v_component_qty := COALESCE(p_quantity, 0) * COALESCE(v_bom.quantity, 1);
      v_result := jsonb_set(
        v_result,
        ARRAY[v_key],
        to_jsonb(COALESCE((v_result->>v_key)::numeric, 0) + v_component_qty),
        true
      );
    END LOOP;
  ELSE
    v_key := p_product_id::text;
    v_result := jsonb_set(
      v_result,
      ARRAY[v_key],
      to_jsonb(COALESCE((v_result->>v_key)::numeric, 0) + COALESCE(p_quantity, 0)),
      true
    );
  END IF;

  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.build_and_validate_sale_stock_demand(p_items JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_item JSONB;
  v_product_id UUID;
  v_qty NUMERIC;
  v_polywood_mode TEXT;
  v_skip_stock BOOLEAN;
  v_stock_demand JSONB := '{}'::jsonb;
  v_key TEXT;
  v_stock NUMERIC;
  v_required NUMERIC;
BEGIN
  IF jsonb_typeof(p_items) <> 'array' THEN
    RETURN '{}'::jsonb;
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := NULLIF(v_item->>'product_id', '')::uuid;
    v_qty := COALESCE(NULLIF(v_item->>'quantity', '')::numeric, 0);
    v_polywood_mode := NULLIF(trim(v_item->>'polywood_sale_mode'), '');
    v_skip_stock := COALESCE((v_item->>'skip_stock')::boolean, false);

    IF v_product_id IS NULL OR v_qty <= 0 OR v_polywood_mode IS NOT NULL OR v_skip_stock THEN
      CONTINUE;
    END IF;

    v_stock_demand := public.merge_stock_demand(v_stock_demand, v_product_id, v_qty);
  END LOOP;

  FOR v_key IN SELECT jsonb_object_keys(v_stock_demand)
  LOOP
    v_product_id := v_key::uuid;
    v_required := COALESCE((v_stock_demand->>v_key)::numeric, 0);

    SELECT stock INTO v_stock
    FROM public.products
    WHERE id = v_product_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'product_not_found'
        USING ERRCODE = 'P0002', MESSAGE = 'Məhsul tapılmadı: ' || v_key;
    END IF;

    IF COALESCE(v_stock, 0) + 0.000001 < v_required THEN
      RAISE EXCEPTION 'insufficient_stock'
        USING ERRCODE = '22023',
              MESSAGE = format(
                'Stok kifayət etmir (məhsul %s, tələb: %s, mövcud: %s)',
                v_key,
                trim(to_char(v_required, 'FM999999990.00')),
                trim(to_char(COALESCE(v_stock, 0), 'FM999999990.00'))
              );
    END IF;
  END LOOP;

  RETURN v_stock_demand;
END;
$$;

CREATE OR REPLACE FUNCTION public.apply_sale_stock_decrement(p_stock_demand JSONB)
RETURNS VOID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_key TEXT;
  v_product_id UUID;
  v_qty NUMERIC;
BEGIN
  IF p_stock_demand IS NULL OR jsonb_typeof(p_stock_demand) <> 'object' THEN
    RETURN;
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(p_stock_demand)
  LOOP
    v_product_id := v_key::uuid;
    v_qty := COALESCE((p_stock_demand->>v_key)::numeric, 0);

    UPDATE public.products
    SET stock = COALESCE(stock, 0) - v_qty
    WHERE id = v_product_id;
  END LOOP;
END;
$$;

-- ─── FIFO: composite line depletion ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.fifo_deplete_sale_item(
  p_sale_item_id UUID,
  p_product_id UUID,
  p_quantity NUMERIC,
  p_sale_id UUID
)
RETURNS NUMERIC
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_is_composite BOOLEAN := false;
  v_bom RECORD;
  v_component_qty NUMERIC;
  v_line_cogs NUMERIC := 0;
  v_component_cogs NUMERIC;
BEGIN
  IF p_product_id IS NULL OR COALESCE(p_quantity, 0) <= 0 THEN
    RETURN 0;
  END IF;

  SELECT COALESCE(is_composite, false)
  INTO v_is_composite
  FROM public.products
  WHERE id = p_product_id;

  IF COALESCE(v_is_composite, false) THEN
    FOR v_bom IN
      SELECT component_product_id, quantity
      FROM public.product_bom
      WHERE parent_product_id = p_product_id
      ORDER BY component_product_id
    LOOP
      v_component_qty := COALESCE(p_quantity, 0) * COALESCE(v_bom.quantity, 1);
      v_component_cogs := public.fifo_deplete_product(
        v_bom.component_product_id,
        v_component_qty,
        p_sale_id,
        p_sale_item_id
      );
      v_line_cogs := v_line_cogs + COALESCE(v_component_cogs, 0);
    END LOOP;
  ELSE
    v_line_cogs := public.fifo_deplete_product(
      p_product_id,
      p_quantity,
      p_sale_id,
      p_sale_item_id
    );
  END IF;

  RETURN ROUND(COALESCE(v_line_cogs, 0), 2);
END;
$$;

CREATE OR REPLACE FUNCTION public.process_sale_fifo_cogs(
  p_sale_id UUID,
  p_doc_no TEXT DEFAULT NULL,
  p_idempotency TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_item RECORD;
  v_line_cogs NUMERIC;
  v_total_cogs NUMERIC := 0;
  v_cogs_journal_id UUID;
  v_doc_no TEXT;
BEGIN
  IF p_sale_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'sale_id tələb olunur';
  END IF;

  SELECT COALESCE(NULLIF(trim(doc_no), ''), id::text)
  INTO v_doc_no
  FROM public.sales
  WHERE id = p_sale_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'sale_not_found' USING ERRCODE = 'P0002', MESSAGE = 'Satış tapılmadı';
  END IF;

  v_doc_no := COALESCE(NULLIF(trim(p_doc_no), ''), v_doc_no);

  FOR v_item IN
    SELECT id, product_id, quantity, polywood_sale_mode
    FROM public.sale_items
    WHERE sale_id = p_sale_id
    ORDER BY id
    FOR UPDATE
  LOOP
    IF v_item.product_id IS NULL OR COALESCE(v_item.quantity, 0) <= 0 THEN
      CONTINUE;
    END IF;

    IF v_item.polywood_sale_mode IS NOT NULL THEN
      CONTINUE;
    END IF;

    v_line_cogs := public.fifo_deplete_sale_item(
      v_item.id,
      v_item.product_id,
      v_item.quantity,
      p_sale_id
    );

    UPDATE public.sale_items
    SET cogs_amount = v_line_cogs
    WHERE id = v_item.id;

    v_total_cogs := v_total_cogs + v_line_cogs;
  END LOOP;

  v_total_cogs := ROUND(v_total_cogs, 2);
  v_cogs_journal_id := public.post_sale_cogs_journal(
    p_sale_id,
    v_doc_no,
    v_total_cogs,
    COALESCE(p_idempotency, 'sale_cogs:' || p_sale_id::text)
  );

  UPDATE public.sales
  SET total_cogs = v_total_cogs,
      cogs_journal_entry_id = v_cogs_journal_id
  WHERE id = p_sale_id;

  RETURN jsonb_build_object(
    'total_cogs', v_total_cogs,
    'cogs_journal_entry_id', v_cogs_journal_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_batch_available_stock(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_composite_available_stock(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_product_available_stock(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.merge_stock_demand(JSONB, UUID, NUMERIC) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.build_and_validate_sale_stock_demand(JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.apply_sale_stock_decrement(JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fifo_deplete_sale_item(UUID, UUID, NUMERIC, UUID) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
