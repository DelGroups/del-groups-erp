-- Stock movement audit ledger + production material issue integration

CREATE TABLE IF NOT EXISTS stock_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  warehouse_id UUID REFERENCES warehouses(id) ON DELETE SET NULL,
  movement_type TEXT NOT NULL CHECK (movement_type IN ('in', 'out')),
  quantity NUMERIC NOT NULL CHECK (quantity > 0),
  unit TEXT DEFAULT 'Ədəd',
  reference_type TEXT NOT NULL,
  reference_id UUID,
  source_line_id UUID,
  description TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stock_movements_product_created
  ON stock_movements (product_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_stock_movements_reference
  ON stock_movements (reference_type, reference_id);

ALTER TABLE stock_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY stock_movements_select_authenticated
  ON stock_movements FOR SELECT TO authenticated USING (true);

CREATE POLICY stock_movements_insert_authenticated
  ON stock_movements FOR INSERT TO authenticated WITH CHECK (true);

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

      INSERT INTO stock_movements (
        product_id,
        warehouse_id,
        movement_type,
        quantity,
        unit,
        reference_type,
        reference_id,
        source_line_id,
        description,
        created_by
      )
      VALUES (
        v_material.product_id,
        v_material.warehouse_id,
        'out',
        COALESCE(v_material.quantity, 0),
        COALESCE(v_material.unit, 'Ədəd'),
        'production',
        p_order_id,
        v_material.id,
        'İstehsalat üçün material',
        auth.uid()
      );
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
