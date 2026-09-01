-- Production module overhaul: three production models, warehouse slips, subcontractor fee columns
-- Models: series | in_house_custom | subcontractor_custom

-- ─── production_orders extensions ─────────────────────────────────────────────

ALTER TABLE public.production_orders
  ADD COLUMN IF NOT EXISTS production_model TEXT NOT NULL DEFAULT 'in_house_custom';

ALTER TABLE public.production_orders
  DROP CONSTRAINT IF EXISTS production_orders_production_model_check;

ALTER TABLE public.production_orders
  ADD CONSTRAINT production_orders_production_model_check
  CHECK (production_model IN ('series', 'in_house_custom', 'subcontractor_custom'));

ALTER TABLE public.production_orders
  ADD COLUMN IF NOT EXISTS ousta_id UUID REFERENCES public.employees(id) ON DELETE SET NULL;

ALTER TABLE public.production_orders
  ADD COLUMN IF NOT EXISTS subcontractor_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL;

ALTER TABLE public.production_orders
  ADD COLUMN IF NOT EXISTS subcontractor_fee_percent NUMERIC(5,2) NOT NULL DEFAULT 20.00;

ALTER TABLE public.production_orders
  ADD COLUMN IF NOT EXISTS subcontractor_fee_amount NUMERIC(12,2) NOT NULL DEFAULT 0.00;

ALTER TABLE public.production_orders
  ADD COLUMN IF NOT EXISTS raw_material_warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE SET NULL;

ALTER TABLE public.production_orders
  ADD COLUMN IF NOT EXISTS furniture_warehouse_id UUID REFERENCES public.warehouses(id) ON DELETE SET NULL;

ALTER TABLE public.production_orders
  ADD COLUMN IF NOT EXISTS custom_product_id UUID REFERENCES public.products(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_production_orders_production_model
  ON public.production_orders (production_model);

CREATE INDEX IF NOT EXISTS idx_production_orders_ousta
  ON public.production_orders (ousta_id);

CREATE INDEX IF NOT EXISTS idx_production_orders_subcontractor
  ON public.production_orders (subcontractor_id);

-- Backfill production_model from legacy type / custom_workflow
UPDATE public.production_orders
SET production_model = CASE
  WHEN type = 'Series' THEN 'series'
  WHEN custom_workflow = 'subcontractor' THEN 'subcontractor_custom'
  ELSE 'in_house_custom'
END
WHERE production_model IS NULL
   OR production_model = 'in_house_custom'
   AND type IS NOT NULL;

UPDATE public.production_orders
SET custom_product_id = finished_product_id
WHERE custom_product_id IS NULL
  AND finished_product_id IS NOT NULL
  AND type = 'Custom';

UPDATE public.production_orders
SET raw_material_warehouse_id = warehouse_id
WHERE raw_material_warehouse_id IS NULL
  AND warehouse_id IS NOT NULL;

UPDATE public.production_orders
SET furniture_warehouse_id = warehouse_id
WHERE furniture_warehouse_id IS NULL
  AND warehouse_id IS NOT NULL
  AND type = 'Custom';

-- ─── warehouse_slips: allow production source ─────────────────────────────────

ALTER TABLE public.warehouse_slips
  DROP CONSTRAINT IF EXISTS warehouse_slips_source_type_check;

ALTER TABLE public.warehouse_slips
  ADD CONSTRAINT warehouse_slips_source_type_check
  CHECK (source_type IS NULL OR source_type IN ('purchase', 'sale', 'writeoff', 'production'));

-- ─── Warehouse slip helper ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.create_production_warehouse_slip(
  p_order_id UUID,
  p_slip_type TEXT,
  p_warehouse_id UUID,
  p_warehouse_name TEXT,
  p_items JSONB,
  p_notes TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_no TEXT;
  v_slip_id UUID;
  v_prefix TEXT;
  v_slip_number TEXT;
BEGIN
  IF p_order_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RETURN NULL;
  END IF;

  IF p_slip_type NOT IN ('inbound', 'outbound') THEN
    RAISE EXCEPTION 'invalid_slip_type'
      USING ERRCODE = '22023',
            MESSAGE = 'Anbar qaimə tipi inbound və ya outbound olmalıdır';
  END IF;

  SELECT order_no INTO v_order_no
  FROM public.production_orders
  WHERE id = p_order_id;

  v_prefix := CASE WHEN p_slip_type = 'inbound' THEN 'IN' ELSE 'OUT' END;
  v_slip_number := 'WS-' || v_prefix || '-' || to_char(CURRENT_DATE, 'YYYY') || '-' || floor(10000 + random() * 90000)::int;

  INSERT INTO public.warehouse_slips (
    slip_number,
    type,
    status,
    source_document_id,
    source_document_no,
    source_type,
    warehouse_id,
    warehouse_name,
    items,
    notes,
    created_by,
    approved_by,
    approved_at
  )
  VALUES (
    v_slip_number,
    p_slip_type,
    'approved',
    p_order_id,
    COALESCE(v_order_no, p_order_id::text),
    'production',
    p_warehouse_id,
    p_warehouse_name,
    p_items,
    p_notes,
    auth.uid(),
    auth.uid(),
    NOW()
  )
  RETURNING id INTO v_slip_id;

  RETURN v_slip_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_production_warehouse_slip(UUID, TEXT, UUID, TEXT, JSONB, TEXT) TO authenticated;

-- ─── WIP cost includes order-level subcontractor fee ──────────────────────────

CREATE OR REPLACE FUNCTION public.compute_production_wip_cost(p_order_id UUID)
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
AS $$
DECLARE
  v_material NUMERIC := 0;
  v_outsource NUMERIC := 0;
  v_expense NUMERIC := 0;
  v_contractor NUMERIC := 0;
  v_sub_fee NUMERIC := 0;
BEGIN
  SELECT public.compute_production_issued_material_cost(p_order_id) INTO v_material;

  SELECT COALESCE(SUM(COALESCE(total_cost, 0)), 0)
  INTO v_outsource
  FROM public.production_outsourcing
  WHERE production_order_id = p_order_id;

  SELECT COALESCE(SUM(COALESCE(amount, 0)), 0)
  INTO v_expense
  FROM public.production_expenses
  WHERE production_order_id = p_order_id;

  SELECT COALESCE(SUM(COALESCE(calculated_fee, 0)), 0)
  INTO v_contractor
  FROM public.production_contractors
  WHERE production_order_id = p_order_id;

  SELECT COALESCE(subcontractor_fee_amount, 0)
  INTO v_sub_fee
  FROM public.production_orders
  WHERE id = p_order_id;

  RETURN COALESCE(v_material, 0)
    + COALESCE(v_outsource, 0)
    + COALESCE(v_expense, 0)
    + COALESCE(v_contractor, 0)
    + COALESCE(v_sub_fee, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.compute_production_wip_cost(UUID) TO authenticated;

-- ─── Delivery furniture receipt slip (trigger on Delivered) ─────────────────

CREATE OR REPLACE FUNCTION public.production_record_furniture_receipt_from_order(p_order_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.production_orders%ROWTYPE;
  v_product_id UUID;
  v_product_code TEXT;
  v_product_name TEXT;
  v_product_unit TEXT;
  v_wh_id UUID;
  v_wh_name TEXT;
  v_items JSONB;
BEGIN
  IF p_order_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.warehouse_slips
    WHERE source_type = 'production'
      AND source_document_id = p_order_id
      AND type = 'inbound'
  ) THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_order
  FROM public.production_orders
  WHERE id = p_order_id;

  IF NOT FOUND OR v_order.type IS DISTINCT FROM 'Custom' THEN
    RETURN NULL;
  END IF;

  v_product_id := COALESCE(v_order.custom_product_id, v_order.finished_product_id);
  IF v_product_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT code, name, unit
  INTO v_product_code, v_product_name, v_product_unit
  FROM public.products
  WHERE id = v_product_id;

  v_wh_id := COALESCE(v_order.furniture_warehouse_id, v_order.warehouse_id);
  IF v_wh_id IS NOT NULL THEN
    SELECT name INTO v_wh_name FROM public.warehouses WHERE id = v_wh_id;
  END IF;
  IF v_wh_name IS NULL THEN
    v_wh_name := v_order.warehouse_name;
  END IF;

  v_items := jsonb_build_array(
    jsonb_build_object(
      'product_id', v_product_id,
      'product_code', v_product_code,
      'product_name', v_product_name,
      'quantity', GREATEST(COALESCE(v_order.quantity, 1), 1),
      'unit', COALESCE(v_product_unit, 'Ədəd')
    )
  );

  RETURN public.create_production_warehouse_slip(
    p_order_id,
    'inbound',
    v_wh_id,
    v_wh_name,
    v_items,
    'Fərdi istehsal təhvil — ' || v_order.order_no
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.production_record_furniture_receipt_from_order(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.trg_production_orders_delivery_slip()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'Delivered'
     AND OLD.status IS DISTINCT FROM 'Delivered'
     AND NEW.type = 'Custom' THEN
    PERFORM public.production_record_furniture_receipt_from_order(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS production_orders_delivery_slip ON public.production_orders;
CREATE TRIGGER production_orders_delivery_slip
  AFTER UPDATE OF status ON public.production_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_production_orders_delivery_slip();

-- ─── Material issue slip aggregation ─────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.production_record_material_issue_slip(
  p_order_id UUID,
  p_material_ids UUID[] DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order public.production_orders%ROWTYPE;
  v_wh_id UUID;
  v_wh_name TEXT;
  v_items JSONB := '[]'::jsonb;
  v_material RECORD;
BEGIN
  SELECT * INTO v_order
  FROM public.production_orders
  WHERE id = p_order_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  v_wh_id := COALESCE(v_order.raw_material_warehouse_id, v_order.warehouse_id);
  v_wh_name := v_order.warehouse_name;
  IF v_wh_id IS NOT NULL THEN
    SELECT name INTO v_wh_name FROM public.warehouses WHERE id = v_wh_id;
  END IF;

  FOR v_material IN
    SELECT pm.id, pm.product_id, pm.product_code, pm.product_name, pm.quantity, pm.unit
    FROM public.production_materials pm
    WHERE pm.production_order_id = p_order_id
      AND pm.issued = true
      AND pm.product_id IS NOT NULL
      AND (
        p_material_ids IS NULL
        OR cardinality(p_material_ids) = 0
        OR pm.id = ANY(p_material_ids)
      )
  LOOP
    v_items := v_items || jsonb_build_array(
      jsonb_build_object(
        'product_id', v_material.product_id,
        'product_code', v_material.product_code,
        'product_name', v_material.product_name,
        'quantity', v_material.quantity,
        'unit', COALESCE(v_material.unit, 'Ədəd')
      )
    );
  END LOOP;

  IF jsonb_array_length(v_items) = 0 THEN
    RETURN NULL;
  END IF;

  RETURN public.create_production_warehouse_slip(
    p_order_id,
    'outbound',
    v_wh_id,
    v_wh_name,
    v_items,
    'Material verilməsi — ' || v_order.order_no
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.production_record_material_issue_slip(UUID, UUID[]) TO authenticated;

-- ─── Patch material issue RPC to emit outbound warehouse slip ─────────────────

CREATE OR REPLACE FUNCTION public.process_production_material_issue_event(
  p_order_id UUID,
  p_material_ids UUID[] DEFAULT NULL,
  p_update_status BOOLEAN DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_idempotency TEXT;
  v_cached JSONB;
  v_order production_orders%ROWTYPE;
  v_material RECORD;
  v_product RECORD;
  v_issue_cost NUMERIC := 0;
  v_journal_id UUID;
  v_event_id UUID;
  v_result JSONB;
  v_update_status BOOLEAN;
  v_pending_count INT;
  v_issued_count INT := 0;
  v_payload JSONB;
  v_issued_ids UUID[] := '{}';
  v_slip_id UUID;
BEGIN
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'order_required'
      USING ERRCODE = '22023',
            MESSAGE = 'İstehsal sifarişi identifikatoru tələb olunur';
  END IF;

  v_update_status := COALESCE(
    p_update_status,
    p_material_ids IS NULL OR cardinality(p_material_ids) = 0
  );

  v_idempotency := CASE
    WHEN p_material_ids IS NOT NULL AND cardinality(p_material_ids) > 0 THEN
      'production_material_issue:' || p_order_id::text || ':' || md5(p_material_ids::text)
    ELSE
      'production_material_issue:' || p_order_id::text
  END;

  v_cached := public.find_erp_event_by_idempotency(v_idempotency);
  IF v_cached IS NOT NULL THEN
    RETURN v_cached->'result';
  END IF;

  IF NOT public.user_has_permission('can_manage_production') THEN
    RAISE EXCEPTION 'forbidden'
      USING ERRCODE = '42501',
            MESSAGE = 'İcazəniz yoxdur';
  END IF;

  SELECT * INTO v_order
  FROM production_orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'production_order_not_found'
      USING ERRCODE = 'P0002',
            MESSAGE = 'İstehsal sifarişi tapılmadı';
  END IF;

  IF v_update_status AND v_order.status IS DISTINCT FROM 'Draft' AND v_order.status IS DISTINCT FROM 'In-Progress' THEN
    RAISE EXCEPTION 'invalid_status'
      USING ERRCODE = '22023',
            MESSAGE = 'Material verilməsi yalnız «Layihə» və ya «İstehsalda» statusundan mümkündür';
  END IF;

  FOR v_material IN
    SELECT pm.*, p.inventory_mode, p.name AS product_display_name
    FROM production_materials pm
    LEFT JOIN products p ON p.id = pm.product_id
    WHERE pm.production_order_id = p_order_id
      AND COALESCE(pm.issued, false) = false
      AND (
        p_material_ids IS NULL
        OR cardinality(p_material_ids) = 0
        OR pm.id = ANY(p_material_ids)
      )
    ORDER BY pm.created_at NULLS LAST, pm.id
  LOOP
    IF v_material.product_id IS NULL THEN
      UPDATE production_materials
      SET issued = true,
          issued_at = COALESCE(issued_at, NOW())
      WHERE id = v_material.id;
      v_issued_ids := array_append(v_issued_ids, v_material.id);
      v_issued_count := v_issued_count + 1;
      CONTINUE;
    END IF;

    SELECT id, stock, inventory_mode, name
    INTO v_product
    FROM products
    WHERE id = v_material.product_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'product_not_found'
        USING ERRCODE = 'P0002',
              MESSAGE = format('Material çıxışı: %s — məhsul tapılmadı', COALESCE(v_material.product_display_name, v_material.product_id::text));
    END IF;

    IF COALESCE(v_product.inventory_mode, 'standard') <> 'polywood' THEN
      IF COALESCE(v_product.stock, 0) + 0.000001 < COALESCE(v_material.quantity, 0) THEN
        RAISE EXCEPTION 'insufficient_stock'
          USING ERRCODE = '22023',
                MESSAGE = format(
                  'Material çıxışı: %s — stok kifayət etmir (mövcud: %s, tələb: %s)',
                  COALESCE(v_product.name, v_material.product_id::text),
                  trim(to_char(COALESCE(v_product.stock, 0), 'FM999999990.00')),
                  trim(to_char(COALESCE(v_material.quantity, 0), 'FM999999990.00'))
                );
      END IF;

      UPDATE products
      SET stock = COALESCE(stock, 0) - COALESCE(v_material.quantity, 0)
      WHERE id = v_material.product_id;
    END IF;

    v_issue_cost := v_issue_cost + public.production_material_line_cost(
      v_material.quantity,
      v_material.unit_cost,
      v_material.line_cost
    );

    UPDATE production_materials
    SET issued = true,
        issued_at = COALESCE(issued_at, NOW())
    WHERE id = v_material.id;

    UPDATE production_stock_reservations
    SET status = 'consumed',
        consumed_at = COALESCE(consumed_at, NOW())
    WHERE production_material_id = v_material.id;

    v_issued_ids := array_append(v_issued_ids, v_material.id);
    v_issued_count := v_issued_count + 1;
  END LOOP;

  IF v_issued_count = 0 THEN
    IF p_material_ids IS NOT NULL AND cardinality(p_material_ids) > 0 THEN
      RAISE EXCEPTION 'materials_not_found'
        USING ERRCODE = 'P0002',
              MESSAGE = 'Verilməmiş material tapılmadı';
    END IF;
    RAISE EXCEPTION 'materials_required'
      USING ERRCODE = '22023',
            MESSAGE = 'Material çıxışı: BOM material sətri tapılmadı';
  END IF;

  IF v_issue_cost > 0.0001 THEN
    v_journal_id := public.post_journal_entry(
      jsonb_build_object(
        'source_type', 'production_material_issue',
        'source_id', p_order_id,
        'idempotency_key', v_idempotency,
        'memo', format('Material verilməsi — %s', v_order.order_no),
        'lines', jsonb_build_array(
          jsonb_build_object(
            'coa_code', '1350',
            'debit', v_issue_cost,
            'credit', 0,
            'line_memo', 'WIP — ' || v_order.order_no
          ),
          jsonb_build_object(
            'coa_code', '1300',
            'debit', 0,
            'credit', v_issue_cost,
            'line_memo', 'Xammal — ' || v_order.order_no
          )
        )
      )
    );
  END IF;

  v_slip_id := public.production_record_material_issue_slip(p_order_id, v_issued_ids);

  SELECT COUNT(*) INTO v_pending_count
  FROM production_materials
  WHERE production_order_id = p_order_id
    AND COALESCE(issued, false) = false;

  IF v_pending_count = 0 OR v_update_status THEN
    UPDATE production_orders
    SET materials_allocated = true,
        status = CASE
          WHEN v_update_status AND v_order.status = 'Draft' THEN 'In-Progress'
          ELSE status
        END,
        updated_at = NOW()
    WHERE id = p_order_id;
  END IF;

  v_payload := jsonb_build_object(
    'order_id', p_order_id,
    'material_ids', COALESCE(to_jsonb(p_material_ids), '[]'::jsonb),
    'update_status', v_update_status
  );

  v_result := jsonb_build_object(
    'success', true,
    'event_type', 'production_material_issue',
    'order_id', p_order_id,
    'issued_count', v_issued_count,
    'issue_cost', v_issue_cost,
    'journal_entry_id', v_journal_id,
    'warehouse_slip_id', v_slip_id,
    'materials_allocated', true,
    'status', CASE WHEN v_update_status THEN 'In-Progress' ELSE v_order.status END
  );

  v_event_id := public.log_erp_event(
    'production_material_issue',
    'production_orders',
    p_order_id,
    v_payload,
    v_journal_id,
    v_idempotency,
    v_result
  );

  RETURN v_result || jsonb_build_object('event_id', v_event_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_production_material_issue_event(UUID, UUID[], BOOLEAN) TO authenticated;
