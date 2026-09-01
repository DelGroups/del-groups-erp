-- Del Groups ERP — Phase 3 production event processors
-- Prerequisites: production-migration, erp-events-migration, journal-engine-migration,
-- chart-of-accounts-migration, customer-ar-mutations, account-mutations,
-- production-delivery-migration (sale_id / production_order_id columns).

-- ─── WIP account (1350) ───────────────────────────────────────────────────────

INSERT INTO public.chart_of_accounts (code, name, account_type)
VALUES ('1350', 'WIP / İstehsalat inventarı', 'asset')
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    account_type = EXCLUDED.account_type,
    is_active = TRUE;

-- ─── Shared helpers ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.production_material_line_cost(
  p_quantity NUMERIC,
  p_unit_cost NUMERIC,
  p_line_cost NUMERIC
)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT GREATEST(
    COALESCE(
      NULLIF(p_line_cost, 0),
      COALESCE(p_quantity, 0) * COALESCE(p_unit_cost, 0)
    ),
    0
  );
$$;

CREATE OR REPLACE FUNCTION public.compute_production_issued_material_cost(p_order_id UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(SUM(
    public.production_material_line_cost(quantity, unit_cost, line_cost)
  ), 0)
  FROM public.production_materials
  WHERE production_order_id = p_order_id
    AND COALESCE(issued, false) = true;
$$;

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

  RETURN COALESCE(v_material, 0)
    + COALESCE(v_outsource, 0)
    + COALESCE(v_expense, 0)
    + COALESCE(v_contractor, 0);
END;
$$;

GRANT EXECUTE ON FUNCTION public.production_material_line_cost(NUMERIC, NUMERIC, NUMERIC) TO authenticated;
GRANT EXECUTE ON FUNCTION public.compute_production_issued_material_cost(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.compute_production_wip_cost(UUID) TO authenticated;

-- ─── A. Material issue event (In-Progress) ────────────────────────────────────

DROP FUNCTION IF EXISTS public.process_production_material_issue_event(UUID, UUID[], BOOLEAN);

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

-- ─── B. Ready event (Series FG receipt) ───────────────────────────────────────

DROP FUNCTION IF EXISTS public.process_production_ready_event(UUID);

CREATE OR REPLACE FUNCTION public.process_production_ready_event(p_order_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_idempotency TEXT;
  v_cached JSONB;
  v_order production_orders%ROWTYPE;
  v_qty NUMERIC;
  v_wip_cost NUMERIC;
  v_journal_id UUID;
  v_event_id UUID;
  v_result JSONB;
  v_stock NUMERIC;
BEGIN
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'order_required'
      USING ERRCODE = '22023',
            MESSAGE = 'İstehsal sifarişi identifikatoru tələb olunur';
  END IF;

  v_idempotency := 'production_ready:' || p_order_id::text;
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

  IF v_order.type IS DISTINCT FROM 'Series' THEN
    RAISE EXCEPTION 'invalid_order_type'
      USING ERRCODE = '22023',
            MESSAGE = 'Hazır statusu yalnız seriya sifarişləri üçün aktivdir';
  END IF;

  IF COALESCE(v_order.finished_goods_posted, false) THEN
    RETURN jsonb_build_object(
      'success', true,
      'event_type', 'production_ready',
      'order_id', p_order_id,
      'already_completed', true,
      'finished_goods_posted', true
    );
  END IF;

  IF v_order.status IS DISTINCT FROM 'In-Progress' AND v_order.status IS DISTINCT FROM 'Ready' THEN
    RAISE EXCEPTION 'invalid_status'
      USING ERRCODE = '22023',
            MESSAGE = 'Hazır statusu yalnız «İstehsalda» statusundan aktivdir';
  END IF;

  IF v_order.finished_product_id IS NULL THEN
    RAISE EXCEPTION 'finished_product_required'
      USING ERRCODE = '22023',
            MESSAGE = 'Hazır məhsul təyin edilməyib';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM production_materials
    WHERE production_order_id = p_order_id
      AND COALESCE(issued, false) = false
  ) THEN
    RAISE EXCEPTION 'materials_pending'
      USING ERRCODE = '22023',
            MESSAGE = 'Bütün BOM materialları verilməlidir';
  END IF;

  v_qty := GREATEST(COALESCE(v_order.quantity, 1), 1);

  SELECT stock INTO v_stock
  FROM products
  WHERE id = v_order.finished_product_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'finished_product_not_found'
      USING ERRCODE = 'P0002',
            MESSAGE = 'Hazır məhsul tapılmadı';
  END IF;

  UPDATE products
  SET stock = COALESCE(v_stock, 0) + v_qty
  WHERE id = v_order.finished_product_id;

  v_wip_cost := public.compute_production_wip_cost(p_order_id);

  IF v_wip_cost > 0.0001 THEN
    v_journal_id := public.post_journal_entry(
      jsonb_build_object(
        'source_type', 'production_ready',
        'source_id', p_order_id,
        'idempotency_key', v_idempotency,
        'memo', format('Hazır məhsul anbara — %s', v_order.order_no),
        'lines', jsonb_build_array(
          jsonb_build_object(
            'coa_code', '1300',
            'debit', v_wip_cost,
            'credit', 0,
            'line_memo', 'Hazır məhsul — ' || v_order.order_no
          ),
          jsonb_build_object(
            'coa_code', '1350',
            'debit', 0,
            'credit', v_wip_cost,
            'line_memo', 'WIP bağlanması — ' || v_order.order_no
          )
        )
      )
    );
  END IF;

  UPDATE production_orders
  SET finished_goods_posted = true,
      status = 'Ready',
      updated_at = NOW()
  WHERE id = p_order_id;

  v_result := jsonb_build_object(
    'success', true,
    'event_type', 'production_ready',
    'order_id', p_order_id,
    'finished_product_id', v_order.finished_product_id,
    'quantity', v_qty,
    'wip_cost', v_wip_cost,
    'journal_entry_id', v_journal_id,
    'finished_goods_posted', true,
    'status', 'Ready'
  );

  v_event_id := public.log_erp_event(
    'production_ready',
    'production_orders',
    p_order_id,
    jsonb_build_object('order_id', p_order_id),
    v_journal_id,
    v_idempotency,
    v_result
  );

  RETURN v_result || jsonb_build_object('event_id', v_event_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_production_ready_event(UUID) TO authenticated;

-- ─── C. Delivery event (Custom MTO + Series) ──────────────────────────────────

DROP FUNCTION IF EXISTS public.process_production_delivery_event(UUID, UUID);

CREATE OR REPLACE FUNCTION public.process_production_delivery_event(
  p_order_id UUID,
  p_account_id UUID DEFAULT NULL
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
  v_existing_sale_id UUID;
  v_sale_id UUID;
  v_product_id UUID;
  v_product_code TEXT;
  v_product_name TEXT;
  v_product_unit TEXT;
  v_sell_price NUMERIC;
  v_qty NUMERIC;
  v_project_price NUMERIC;
  v_install_fee NUMERIC;
  v_subtotal NUMERIC;
  v_advance NUMERIC;
  v_remaining NUMERIC;
  v_doc_no TEXT;
  v_material_cost NUMERIC := 0;
  v_outsource_cost NUMERIC := 0;
  v_expense_cost NUMERIC := 0;
  v_contractor_cost NUMERIC := 0;
  v_total_cost NUMERIC := 0;
  v_unit_cogs NUMERIC := 0;
  v_unit_sell NUMERIC := 0;
  v_stock NUMERIC := 0;
  v_payments JSONB := '[]'::jsonb;
  v_create_sale BOOLEAN := false;
  v_revenue_journal_id UUID;
  v_cogs_journal_id UUID;
  v_tx_id UUID;
  v_event_id UUID;
  v_result JSONB;
  v_payload JSONB;
BEGIN
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'order_required'
      USING ERRCODE = '22023',
            MESSAGE = 'İstehsal sifarişi identifikatoru tələb olunur';
  END IF;

  v_idempotency := 'production_delivery:' || p_order_id::text;
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

  IF v_order.sale_id IS NOT NULL AND v_order.status = 'Delivered' THEN
    SELECT doc_no INTO v_doc_no FROM sales WHERE id = v_order.sale_id;
    RETURN jsonb_build_object(
      'success', true,
      'event_type', 'production_delivery',
      'order_id', p_order_id,
      'order_type', v_order.type,
      'sale_id', v_order.sale_id,
      'doc_no', COALESCE(v_doc_no, v_order.order_no),
      'product_id', v_order.finished_product_id,
      'already_completed', true,
      'invoice_created', true
    );
  END IF;

  SELECT id INTO v_existing_sale_id
  FROM sales
  WHERE production_order_id = p_order_id
  LIMIT 1;

  IF v_existing_sale_id IS NOT NULL THEN
    RAISE EXCEPTION 'duplicate_sale_orphan'
      USING ERRCODE = '23505',
            MESSAGE = 'Bu sifariş üçün satış fakturası artıq mövcuddur, lakin sifariş bağlanmayıb. Administratorla əlaqə saxlayın.';
  END IF;

  IF v_order.status IS DISTINCT FROM 'Ready' THEN
    RAISE EXCEPTION 'order_not_ready'
      USING ERRCODE = '22023',
            MESSAGE = 'Təhvil yalnız «Hazır» statusundan verilə bilər';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM production_materials
    WHERE production_order_id = p_order_id
      AND COALESCE(issued, false) = false
  ) THEN
    RAISE EXCEPTION 'materials_pending'
      USING ERRCODE = '22023',
            MESSAGE = 'Bütün material sətirləri verilməlidir';
  END IF;

  v_qty := GREATEST(COALESCE(v_order.quantity, 1), 1);

  IF v_order.type = 'Series' THEN
    IF NOT COALESCE(v_order.finished_goods_posted, false) THEN
      RAISE EXCEPTION 'finished_goods_not_posted'
        USING ERRCODE = '22023',
              MESSAGE = 'Hazır məhsul anbara yazılmayıb. Əvvəlcə «Hazır» statusuna keçin.';
    END IF;

    IF v_order.finished_product_id IS NULL THEN
      RAISE EXCEPTION 'finished_product_required'
        USING ERRCODE = '22023',
              MESSAGE = 'Seriya sifarişi üçün hazır məhsul təyin edilməyib';
    END IF;

    v_product_id := v_order.finished_product_id;
    v_create_sale := v_order.customer_id IS NOT NULL;

    SELECT code, name, unit, COALESCE(sell_price, 0)
    INTO v_product_code, v_product_name, v_product_unit, v_sell_price
    FROM products
    WHERE id = v_product_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'finished_product_not_found'
        USING ERRCODE = 'P0002',
              MESSAGE = 'Hazır məhsul tapılmadı';
    END IF;

    SELECT stock INTO v_stock FROM products WHERE id = v_product_id FOR UPDATE;
    IF COALESCE(v_stock, 0) + 0.0001 < v_qty THEN
      RAISE EXCEPTION 'insufficient_finished_stock'
        USING ERRCODE = '22023',
              MESSAGE = format(
                'Hazır məhsul stok kifayət etmir (mövcud: %s, tələb: %s)',
                COALESCE(v_stock, 0),
                v_qty
              );
    END IF;

    v_total_cost := public.compute_production_wip_cost(p_order_id);

    IF v_create_sale THEN
      IF v_order.customer_id IS NULL THEN
        RAISE EXCEPTION 'customer_required'
          USING ERRCODE = '22023',
                MESSAGE = 'Təhvil üçün müştəri seçilməlidir';
      END IF;

      v_project_price := COALESCE(NULLIF(v_order.total_project_price, 0), v_sell_price * v_qty);
      IF v_project_price <= 0 THEN
        RAISE EXCEPTION 'invalid_total_price'
          USING ERRCODE = '22023',
                MESSAGE = 'Satış qiyməti sıfırdan böyük olmalıdır';
      END IF;

      v_install_fee := COALESCE(v_order.installation_fee, 0);
      v_subtotal := v_project_price + v_install_fee;
      v_advance := GREATEST(COALESCE(v_order.advance_payment, 0), 0);
      v_remaining := GREATEST(v_subtotal - v_advance, 0);

      IF v_advance > 0.0001 AND p_account_id IS NULL THEN
        RAISE EXCEPTION 'advance_account_required'
          USING ERRCODE = '22023',
                MESSAGE = 'Avans ödənişi üçün kassa/bank hesabı seçilməlidir';
      END IF;

      IF v_advance > 0.0001 THEN
        v_payments := jsonb_build_array(
          jsonb_build_object(
            'id', gen_random_uuid()::text,
            'method', 'Avans',
            'amount', v_advance,
            'account_id', p_account_id
          )
        );
      END IF;

      v_doc_no := 'SF-' || to_char(CURRENT_DATE, 'YYYY') || '-' || floor(10000 + random() * 90000)::int;

      INSERT INTO sales (
        doc_no, invoice_number, doc_date, customer_id, customer_name,
        seller_id, seller_name, warehouse_name, subtotal, discount_total, vat_total,
        total_amount, paid_amount, remaining_balance, delivery_type, delivery_fee,
        note, notes, production_order_id, payments
      )
      VALUES (
        v_doc_no, v_doc_no, CURRENT_DATE, v_order.customer_id, v_order.customer_name,
        auth.uid(), NULL, v_order.warehouse_name, v_subtotal, 0, 0,
        v_subtotal, v_advance, v_remaining,
        CASE WHEN v_install_fee > 0 THEN 'paid' ELSE 'free' END,
        v_install_fee,
        'Seriya istehsal təhvil: ' || v_order.order_no,
        COALESCE(v_order.notes, v_order.project_scope),
        p_order_id, v_payments
      )
      RETURNING id INTO v_sale_id;

      INSERT INTO sale_items (
        sale_id, product_id, product_code, product_name,
        warehouse_id, warehouse_name, quantity, unit,
        unit_price, discount_percent, vat_rate, line_total, extra_info
      )
      VALUES (
        v_sale_id, v_product_id, v_product_code, v_product_name,
        v_order.warehouse_id, v_order.warehouse_name, v_qty,
        COALESCE(v_product_unit, 'Ədəd'),
        CASE WHEN v_qty > 0 THEN ROUND(v_project_price / v_qty, 2) ELSE v_project_price END,
        0, 0, v_project_price,
        'Seriya istehsal — ' || v_order.order_no
      );

      IF v_install_fee > 0.0001 THEN
        INSERT INTO sale_items (
          sale_id, product_id, product_code, product_name,
          warehouse_id, warehouse_name, quantity, unit,
          unit_price, discount_percent, vat_rate, line_total, extra_info
        )
        VALUES (
          v_sale_id, NULL, NULL, 'Quraşdırma və çatdırılma',
          NULL, v_order.warehouse_name, 1, 'Xidmət',
          v_install_fee, 0, 0, v_install_fee, v_order.order_no
        );
      END IF;

      v_revenue_journal_id := public.post_journal_entry(
        jsonb_build_object(
          'source_type', 'production_delivery_revenue',
          'source_id', v_sale_id,
          'idempotency_key', v_idempotency || ':revenue',
          'memo', format('Seriya satış gəliri — %s', v_doc_no),
          'lines', jsonb_build_array(
            jsonb_build_object(
              'coa_code', '1200',
              'debit', v_subtotal,
              'credit', 0,
              'partner_type', 'customer',
              'partner_id', v_order.customer_id,
              'line_memo', 'AR — ' || v_doc_no
            ),
            jsonb_build_object(
              'coa_code', '4100',
              'debit', 0,
              'credit', v_subtotal,
              'line_memo', 'Gəlir — ' || v_doc_no
            )
          )
        )
      );

      IF v_advance > 0.0001 THEN
        IF v_order.advance_transaction_id IS NOT NULL THEN
          v_tx_id := v_order.advance_transaction_id;
        ELSE
          v_tx_id := public.post_cash_transaction(
            p_account_id,
            'Mədaxil',
            v_advance,
            'Satış Ödənişi',
            format('Seriya istehsal avansı — %s (%s)', v_doc_no, v_order.order_no),
            p_order_id,
            'production',
            p_order_id
          );
        END IF;
      END IF;

      PERFORM public.refresh_customer_ar_balance(v_order.customer_id);
    END IF;

    UPDATE products
    SET stock = COALESCE(v_stock, 0) - v_qty
    WHERE id = v_product_id;

    IF v_total_cost > 0.0001 THEN
      v_cogs_journal_id := public.post_journal_entry(
        jsonb_build_object(
          'source_type', 'production_delivery_cogs',
          'source_id', p_order_id,
          'idempotency_key', v_idempotency || ':cogs',
          'memo', format('Seriya COGS — %s', v_order.order_no),
          'lines', jsonb_build_array(
            jsonb_build_object(
              'coa_code', '5100',
              'debit', v_total_cost,
              'credit', 0,
              'line_memo', 'COGS — ' || v_order.order_no
            ),
            jsonb_build_object(
              'coa_code', '1300',
              'debit', 0,
              'credit', v_total_cost,
              'line_memo', 'Inventar — ' || v_order.order_no
            )
          )
        )
      );
    END IF;

    UPDATE production_orders
    SET sale_id = COALESCE(v_sale_id, sale_id),
        delivered_at = NOW(),
        status = 'Delivered',
        updated_at = NOW()
    WHERE id = p_order_id;

    v_result := jsonb_build_object(
      'success', true,
      'event_type', 'production_delivery',
      'order_type', 'Series',
      'order_id', p_order_id,
      'sale_id', v_sale_id,
      'doc_no', COALESCE(v_doc_no, v_order.order_no),
      'product_id', v_product_id,
      'invoice_created', v_create_sale,
      'revenue_journal_entry_id', v_revenue_journal_id,
      'cogs_journal_entry_id', v_cogs_journal_id,
      'transaction_id', v_tx_id,
      'already_completed', false
    );

  ELSIF v_order.type = 'Custom' THEN
    IF v_order.customer_id IS NULL THEN
      RAISE EXCEPTION 'customer_required'
        USING ERRCODE = '22023',
              MESSAGE = 'Təhvil üçün müştəri seçilməlidir';
    END IF;

    v_project_price := COALESCE(v_order.total_project_price, 0);
    IF v_project_price <= 0 THEN
      RAISE EXCEPTION 'invalid_total_price'
        USING ERRCODE = '22023',
              MESSAGE = 'Layihə qiyməti sıfırdan böyük olmalıdır';
    END IF;

    v_install_fee := COALESCE(v_order.installation_fee, 0);
    v_subtotal := v_project_price + v_install_fee;
    v_advance := GREATEST(COALESCE(v_order.advance_payment, 0), 0);
    v_remaining := GREATEST(v_subtotal - v_advance, 0);

    IF v_advance > 0.0001 AND p_account_id IS NULL THEN
      RAISE EXCEPTION 'advance_account_required'
        USING ERRCODE = '22023',
              MESSAGE = 'Avans ödənişi üçün kassa/bank hesabı seçilməlidir';
    END IF;

    IF v_advance > 0.0001 THEN
      PERFORM id FROM accounts WHERE id = p_account_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'account_not_found'
          USING ERRCODE = 'P0002',
                MESSAGE = 'Seçilmiş kassa/bank hesabı tapılmadı';
      END IF;

      v_payments := jsonb_build_array(
        jsonb_build_object(
          'id', gen_random_uuid()::text,
          'method', 'Avans',
          'amount', v_advance,
          'account_id', p_account_id
        )
      );
    END IF;

    v_total_cost := public.compute_production_wip_cost(p_order_id);
    v_unit_cogs := CASE WHEN v_qty > 0 THEN ROUND(v_total_cost / v_qty, 2) ELSE 0 END;
    v_unit_sell := CASE WHEN v_qty > 0 THEN ROUND(v_subtotal / v_qty, 2) ELSE v_subtotal END;

    IF v_order.finished_product_id IS NOT NULL THEN
      v_product_id := v_order.finished_product_id;
      SELECT code, name, unit
      INTO v_product_code, v_product_name, v_product_unit
      FROM products
      WHERE id = v_product_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'finished_product_not_found'
          USING ERRCODE = 'P0002',
                MESSAGE = 'Hazır məhsul tapılmadı';
      END IF;
    ELSE
      v_product_code := 'MTO-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
      v_product_name := COALESCE(NULLIF(btrim(v_order.project_name), ''), v_order.order_no);
      v_product_unit := 'Ədəd';

      INSERT INTO products (
        code, name, category, subcategory, unit,
        buy_price, sell_price, stock, min_stock, extra_info
      )
      VALUES (
        v_product_code, v_product_name, 'Fərdi istehsal', 'Make-to-Order', v_product_unit,
        v_unit_cogs, v_unit_sell, 0, 0,
        'Production order ' || v_order.order_no
      )
      RETURNING id INTO v_product_id;
    END IF;

    SELECT stock INTO v_stock FROM products WHERE id = v_product_id FOR UPDATE;
    UPDATE products SET stock = COALESCE(v_stock, 0) + v_qty WHERE id = v_product_id;

    v_doc_no := 'SF-' || to_char(CURRENT_DATE, 'YYYY') || '-' || floor(10000 + random() * 90000)::int;

    INSERT INTO sales (
      doc_no, invoice_number, doc_date, customer_id, customer_name,
      seller_id, seller_name, warehouse_name, subtotal, discount_total, vat_total,
      total_amount, paid_amount, remaining_balance, delivery_type, delivery_fee,
      note, notes, production_order_id, payments
    )
    VALUES (
      v_doc_no, v_doc_no, CURRENT_DATE, v_order.customer_id, v_order.customer_name,
      auth.uid(), NULL, v_order.warehouse_name, v_subtotal, 0, 0,
      v_subtotal, v_advance, v_remaining,
      CASE WHEN v_install_fee > 0 THEN 'paid' ELSE 'free' END,
      v_install_fee,
      'Fərdi istehsal təhvil: ' || v_order.order_no,
      COALESCE(v_order.project_scope, v_order.notes),
      p_order_id, v_payments
    )
    RETURNING id INTO v_sale_id;

    INSERT INTO sale_items (
      sale_id, product_id, product_code, product_name,
      warehouse_id, warehouse_name, quantity, unit,
      unit_price, discount_percent, vat_rate, line_total, extra_info
    )
    VALUES (
      v_sale_id, v_product_id, v_product_code, v_product_name,
      v_order.warehouse_id, v_order.warehouse_name, v_qty,
      COALESCE(v_product_unit, 'Ədəd'),
      CASE WHEN v_qty > 0 THEN ROUND(v_project_price / v_qty, 2) ELSE v_project_price END,
      0, 0, v_project_price,
      'COGS ref: ' || v_order.order_no
    );

    IF v_install_fee > 0.0001 THEN
      INSERT INTO sale_items (
        sale_id, product_id, product_code, product_name,
        warehouse_id, warehouse_name, quantity, unit,
        unit_price, discount_percent, vat_rate, line_total, extra_info
      )
      VALUES (
        v_sale_id, NULL, NULL, 'Quraşdırma və çatdırılma',
        NULL, v_order.warehouse_name, 1, 'Xidmət',
        v_install_fee, 0, 0, v_install_fee, v_order.order_no
      );
    END IF;

    SELECT stock INTO v_stock FROM products WHERE id = v_product_id FOR UPDATE;
    IF COALESCE(v_stock, 0) + 0.0001 < v_qty THEN
      RAISE EXCEPTION 'insufficient_finished_stock'
        USING ERRCODE = '22023',
              MESSAGE = 'Hazır məhsul stok çıxışı mümkün deyil';
    END IF;

    UPDATE products SET stock = COALESCE(v_stock, 0) - v_qty WHERE id = v_product_id;

    v_revenue_journal_id := public.post_journal_entry(
      jsonb_build_object(
        'source_type', 'production_delivery_revenue',
        'source_id', v_sale_id,
        'idempotency_key', v_idempotency || ':revenue',
        'memo', format('Fərdi satış gəliri — %s', v_doc_no),
        'lines', jsonb_build_array(
          jsonb_build_object(
            'coa_code', '1200',
            'debit', v_subtotal,
            'credit', 0,
            'partner_type', 'customer',
            'partner_id', v_order.customer_id,
            'line_memo', 'AR — ' || v_doc_no
          ),
          jsonb_build_object(
            'coa_code', '4100',
            'debit', 0,
            'credit', v_subtotal,
            'line_memo', 'Gəlir — ' || v_doc_no
          )
        )
      )
    );

    IF v_total_cost > 0.0001 THEN
      v_cogs_journal_id := public.post_journal_entry(
        jsonb_build_object(
          'source_type', 'production_delivery_cogs',
          'source_id', p_order_id,
          'idempotency_key', v_idempotency || ':cogs',
          'memo', format('Fərdi COGS — %s', v_order.order_no),
          'lines', jsonb_build_array(
            jsonb_build_object(
              'coa_code', '5100',
              'debit', v_total_cost,
              'credit', 0,
              'line_memo', 'COGS — ' || v_order.order_no
            ),
            jsonb_build_object(
              'coa_code', '1350',
              'debit', 0,
              'credit', v_total_cost,
              'line_memo', 'WIP — ' || v_order.order_no
            )
          )
        )
      );
    END IF;

    IF v_advance > 0.0001 THEN
      IF v_order.advance_transaction_id IS NOT NULL THEN
        v_tx_id := v_order.advance_transaction_id;
      ELSE
        v_tx_id := public.post_cash_transaction(
          p_account_id,
          'Mədaxil',
          v_advance,
          'Satış Ödənişi',
          format('Fərdi istehsal avansı — %s (%s)', v_doc_no, v_order.order_no),
          p_order_id,
          'production',
          p_order_id
        );
      END IF;
    END IF;

    PERFORM public.refresh_customer_ar_balance(v_order.customer_id);

    UPDATE production_orders
    SET finished_product_id = v_product_id,
        finished_product_name = v_product_name,
        sale_id = v_sale_id,
        delivered_at = NOW(),
        finished_goods_posted = true,
        status = 'Delivered',
        updated_at = NOW()
    WHERE id = p_order_id;

    v_result := jsonb_build_object(
      'success', true,
      'event_type', 'production_delivery',
      'order_type', 'Custom',
      'order_id', p_order_id,
      'sale_id', v_sale_id,
      'doc_no', v_doc_no,
      'product_id', v_product_id,
      'invoice_created', true,
      'revenue_journal_entry_id', v_revenue_journal_id,
      'cogs_journal_entry_id', v_cogs_journal_id,
      'transaction_id', v_tx_id,
      'already_completed', false
    );
  ELSE
    RAISE EXCEPTION 'invalid_order_type'
      USING ERRCODE = '22023',
            MESSAGE = 'Naməlum istehsal sifarişi tipi';
  END IF;

  v_payload := jsonb_build_object(
    'order_id', p_order_id,
    'account_id', p_account_id
  );

  v_event_id := public.log_erp_event(
    'production_delivery',
    'production_orders',
    p_order_id,
    v_payload,
    COALESCE(v_revenue_journal_id, v_cogs_journal_id),
    v_idempotency,
    v_result
  );

  RETURN v_result || jsonb_build_object('event_id', v_event_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_production_delivery_event(UUID, UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
