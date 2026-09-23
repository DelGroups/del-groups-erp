-- Enterprise rebuild of Consignment Dispatch + Monthly Settlement:
--  1. Dispatch and settlement-time returns now move real per-warehouse stock
--     (warehouse_stocks), not just the legacy global products.stock mirror -
--     the old JS actions only touched products.stock, which is wrong on any
--     multi-warehouse business.
--  2. Both operations become single-transaction atomic RPCs (this codebase's
--     existing convention for money/stock-moving actions - see
--     create_product_with_bom_atomic, create_expense_atomic) instead of
--     sequential JS admin calls with no rollback.
--  3. Settlement now posts a real GL journal entry via post_sale_invoice_gl_journal
--     (Debit AR / Credit Revenue) - previously the invoice row was inserted
--     directly and auto-defaulted to status='posted' by
--     sales_default_posted_when_blank(), but trg_sales_posted_inventory only
--     fires on UPDATE OF status, so the normal posting pipeline never ran and
--     no journal entry was ever created. Revenue/AR only, no COGS (dispatch
--     doesn't snapshot buy_price yet, so COGS is out of scope here).
--  4. Settlement now captures returned/unsold lines in the same document
--     (new consignment_monthly_reports.returned_items column) instead of a
--     separate consignment_returns row, since it's one physical operation.

ALTER TABLE consignment_monthly_reports
  ADD COLUMN IF NOT EXISTS returned_items JSONB NOT NULL DEFAULT '[]'::jsonb;

-- ─── Shared helper: adjust a product's stock at one warehouse ───────────────
-- Mirrors src/lib/inventory/warehouseProductStock.ts adjustProductStockAtWarehouse:
-- upserts warehouse_stocks.current_stock and mirrors the legacy products.stock.

CREATE OR REPLACE FUNCTION public.consignment_adjust_warehouse_stock(
  p_product_id UUID,
  p_warehouse_id UUID,
  p_delta NUMERIC
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_current NUMERIC;
  v_next NUMERIC;
BEGIN
  SELECT id, current_stock INTO v_id, v_current
  FROM public.warehouse_stocks
  WHERE product_id = p_product_id AND warehouse_id = p_warehouse_id
  FOR UPDATE;

  v_next := GREATEST(0, COALESCE(v_current, 0) + p_delta);

  IF v_id IS NOT NULL THEN
    UPDATE public.warehouse_stocks
    SET current_stock = v_next, updated_at = NOW()
    WHERE id = v_id;
  ELSE
    INSERT INTO public.warehouse_stocks (product_id, warehouse_id, current_stock, updated_at)
    VALUES (p_product_id, p_warehouse_id, v_next, NOW());
  END IF;

  UPDATE public.products
  SET stock = GREATEST(0, COALESCE(stock, 0) + p_delta)
  WHERE id = p_product_id;
END;
$$;

-- ─── Dispatch (Anbardan çıxış) ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.create_consignment_dispatch_atomic(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_partner_id UUID := NULLIF(p_payload->>'partner_id', '')::uuid;
  v_warehouse_id UUID := NULLIF(p_payload->>'warehouse_id', '')::uuid;
  v_warehouse_name TEXT := NULLIF(p_payload->>'warehouse_name', '');
  v_dispatch_date DATE := COALESCE(NULLIF(p_payload->>'dispatch_date', '')::date, CURRENT_DATE);
  v_notes TEXT := NULLIF(btrim(p_payload->>'notes'), '');
  v_sales_rep_id UUID := NULLIF(p_payload->>'sales_rep_id', '')::uuid;
  v_sales_rep_name TEXT := NULLIF(p_payload->>'sales_rep_name', '');
  v_dispatch_no TEXT := NULLIF(btrim(p_payload->>'dispatch_no'), '');
  v_items JSONB := COALESCE(p_payload->'items', '[]'::jsonb);
  v_item JSONB;
  v_product_id UUID;
  v_quantity NUMERIC;
  v_unit_price NUMERIC;
  v_available NUMERIC;
  v_product_name TEXT;
  v_dispatch_id UUID;
  v_now TIMESTAMPTZ := NOW();
  v_inv_id UUID;
  v_delivered NUMERIC;
  v_sold NUMERIC;
  v_returned NUMERIC;
  v_partner_name TEXT;
  v_result JSONB;
  v_created_by UUID := NULLIF(p_payload->>'created_by', '')::uuid;
BEGIN
  -- Permission is checked in JS (requirePermissionAction) before this RPC is
  -- called via the service-role admin client, which has no auth.uid() /
  -- session context - same convention as create_product_with_bom_atomic and
  -- set_customer_opening_balance_atomic.

  IF v_partner_id IS NULL THEN
    RAISE EXCEPTION 'partner_required' USING ERRCODE = '22023', MESSAGE = 'Tərəfdaş seçin';
  END IF;
  IF v_warehouse_id IS NULL THEN
    RAISE EXCEPTION 'warehouse_required' USING ERRCODE = '22023', MESSAGE = 'Anbar seçin';
  END IF;
  IF jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'items_required' USING ERRCODE = '22023', MESSAGE = 'Ən azı bir məhsul əlavə edin';
  END IF;

  -- Validate every line against live per-warehouse stock before touching anything.
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_items)
  LOOP
    v_product_id := NULLIF(v_item->>'product_id', '')::uuid;
    v_quantity := COALESCE((v_item->>'quantity')::numeric, 0);
    IF v_product_id IS NULL OR v_quantity <= 0 THEN
      RAISE EXCEPTION 'invalid_item' USING ERRCODE = '22023', MESSAGE = 'Sətirdə məhsul və ya miqdar yanlışdır';
    END IF;

    SELECT current_stock INTO v_available
    FROM public.warehouse_stocks
    WHERE product_id = v_product_id AND warehouse_id = v_warehouse_id
    FOR UPDATE;

    SELECT name INTO v_product_name FROM public.products WHERE id = v_product_id;
    IF v_product_name IS NULL THEN
      RAISE EXCEPTION 'product_not_found' USING ERRCODE = 'P0002', MESSAGE = 'Məhsul tapılmadı';
    END IF;

    IF COALESCE(v_available, 0) + 0.0001 < v_quantity THEN
      RAISE EXCEPTION 'insufficient_stock'
        USING ERRCODE = '22023',
              MESSAGE = format('%s: seçilmiş anbarda qalıq kifayət etmir (mövcud: %s)', v_product_name, COALESCE(v_available, 0));
    END IF;
  END LOOP;

  IF v_dispatch_no IS NULL THEN
    v_dispatch_no := 'CD-' || EXTRACT(YEAR FROM v_now)::text || '-' || floor(random() * 90000 + 10000)::int::text;
  END IF;

  INSERT INTO public.consignment_dispatches (
    dispatch_no, partner_id, warehouse_id, warehouse_name, dispatch_date,
    status, items, notes, sales_rep_id, sales_rep_name, created_by
  )
  VALUES (
    v_dispatch_no, v_partner_id, v_warehouse_id, v_warehouse_name, v_dispatch_date,
    'delivered', v_items, v_notes, v_sales_rep_id, v_sales_rep_name, v_created_by
  )
  RETURNING id INTO v_dispatch_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_items)
  LOOP
    v_product_id := (v_item->>'product_id')::uuid;
    v_quantity := (v_item->>'quantity')::numeric;
    v_unit_price := COALESCE((v_item->>'unit_price')::numeric, 0);

    PERFORM public.consignment_adjust_warehouse_stock(v_product_id, v_warehouse_id, -v_quantity);

    INSERT INTO public.stock_movements (
      product_id, warehouse_id, movement_type, quantity, unit,
      reference_type, reference_id, description, created_by
    )
    VALUES (
      v_product_id, v_warehouse_id, 'out', v_quantity, COALESCE(v_item->>'unit', 'Ədəd'),
      'consignment_dispatch', v_dispatch_id,
      format('Əmanət mal çıxışı %s', v_dispatch_no), v_created_by
    );

    SELECT id, delivered_qty, sold_qty, returned_qty INTO v_inv_id, v_delivered, v_sold, v_returned
    FROM public.consignment_inventory
    WHERE partner_id = v_partner_id AND product_id = v_product_id
    FOR UPDATE;

    IF v_inv_id IS NOT NULL THEN
      v_delivered := COALESCE(v_delivered, 0) + v_quantity;
      UPDATE public.consignment_inventory
      SET delivered_qty = v_delivered,
          remaining_qty = GREATEST(0, v_delivered - COALESCE(v_sold, 0) - COALESCE(v_returned, 0)),
          unit_price = COALESCE(v_unit_price, unit_price),
          product_name = COALESCE(v_item->>'product_name', product_name),
          product_code = COALESCE(v_item->>'product_code', product_code),
          category = COALESCE(v_item->>'category', category),
          unit = COALESCE(v_item->>'unit', unit),
          last_dispatch_at = v_now,
          updated_at = v_now
      WHERE id = v_inv_id;
    ELSE
      INSERT INTO public.consignment_inventory (
        partner_id, product_id, product_code, product_name, category, unit,
        delivered_qty, sold_qty, returned_qty, remaining_qty, unit_price,
        last_dispatch_at, updated_at
      )
      VALUES (
        v_partner_id, v_product_id, v_item->>'product_code', v_item->>'product_name',
        v_item->>'category', COALESCE(v_item->>'unit', 'Ədəd'),
        v_quantity, 0, 0, v_quantity, v_unit_price, v_now, v_now
      );
    END IF;
  END LOOP;

  SELECT COALESCE(company_name, name) INTO v_partner_name
  FROM public.consignment_partners WHERE id = v_partner_id;

  SELECT to_jsonb(d) || jsonb_build_object('partner_name', v_partner_name)
  INTO v_result
  FROM public.consignment_dispatches d
  WHERE d.id = v_dispatch_id;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.consignment_adjust_warehouse_stock(UUID, UUID, NUMERIC) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_consignment_dispatch_atomic(JSONB) TO authenticated, service_role;

-- ─── Monthly settlement (Aylıq hesablama: Satılan + Qaytarılan in one step) ──

CREATE OR REPLACE FUNCTION public.settle_consignment_partner_atomic(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_partner_id UUID := NULLIF(p_payload->>'partner_id', '')::uuid;
  v_period TEXT := p_payload->>'report_period';
  v_sales_rep_id UUID := NULLIF(p_payload->>'sales_rep_id', '')::uuid;
  v_sales_rep_name TEXT := NULLIF(p_payload->>'sales_rep_name', '');
  v_notes TEXT := NULLIF(btrim(p_payload->>'notes'), '');
  v_return_warehouse_id UUID := NULLIF(p_payload->>'return_warehouse_id', '')::uuid;
  v_report_no TEXT := NULLIF(btrim(p_payload->>'report_no'), '');
  v_lines JSONB := COALESCE(p_payload->'lines', '[]'::jsonb);
  v_line JSONB;
  v_product_id UUID;
  v_qty_sold NUMERIC;
  v_qty_returned NUMERIC;
  v_unit_price NUMERIC;
  v_inv RECORD;
  v_sold_items JSONB := '[]'::jsonb;
  v_returned_items JSONB := '[]'::jsonb;
  v_total_amount NUMERIC := 0;
  v_now TIMESTAMPTZ := NOW();
  v_partner RECORD;
  v_partner_name TEXT;
  v_sale_id UUID;
  v_invoice_no TEXT;
  v_journal_id UUID;
  v_report_id UUID;
  v_result JSONB;
  v_any_sold BOOLEAN := FALSE;
  v_any_returned BOOLEAN := FALSE;
  v_created_by UUID := NULLIF(p_payload->>'created_by', '')::uuid;
BEGIN
  -- Permission is checked in JS (requirePermissionAction) before this RPC is
  -- called via the service-role admin client - see create_consignment_dispatch_atomic.

  IF v_partner_id IS NULL THEN
    RAISE EXCEPTION 'partner_required' USING ERRCODE = '22023', MESSAGE = 'Tərəfdaş seçin';
  END IF;
  IF v_period IS NULL OR v_period !~ '^\d{4}-\d{2}$' THEN
    RAISE EXCEPTION 'invalid_period' USING ERRCODE = '22023', MESSAGE = 'Dövr YYYY-MM formatında olmalıdır';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.consignment_monthly_reports
    WHERE partner_id = v_partner_id AND report_period = v_period
  ) THEN
    RAISE EXCEPTION 'already_settled' USING ERRCODE = '22023', MESSAGE = 'Bu tərəfdaş üçün həmin ay artıq hesabat yazılıb';
  END IF;
  IF jsonb_array_length(v_lines) = 0 THEN
    RAISE EXCEPTION 'lines_required' USING ERRCODE = '22023', MESSAGE = 'Ən azı bir sətir daxil edin';
  END IF;

  SELECT * INTO v_partner FROM public.consignment_partners WHERE id = v_partner_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'partner_not_found' USING ERRCODE = 'P0002', MESSAGE = 'Tərəfdaş tapılmadı';
  END IF;
  v_partner_name := COALESCE(v_partner.company_name, v_partner.name);

  -- Validate + lock every touched consignment_inventory row up front.
  FOR v_line IN SELECT value FROM jsonb_array_elements(v_lines)
  LOOP
    v_product_id := NULLIF(v_line->>'product_id', '')::uuid;
    v_qty_sold := COALESCE((v_line->>'quantity_sold')::numeric, 0);
    v_qty_returned := COALESCE((v_line->>'quantity_returned')::numeric, 0);
    IF v_product_id IS NULL OR (v_qty_sold <= 0 AND v_qty_returned <= 0) THEN
      CONTINUE;
    END IF;

    SELECT * INTO v_inv FROM public.consignment_inventory
    WHERE partner_id = v_partner_id AND product_id = v_product_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'product_not_in_consignment' USING ERRCODE = '22023', MESSAGE = 'Məhsul tərəfdaş stokunda yoxdur';
    END IF;

    IF (v_qty_sold + v_qty_returned) - GREATEST(0, v_inv.delivered_qty - v_inv.sold_qty - v_inv.returned_qty) > 0.0001 THEN
      RAISE EXCEPTION 'qty_exceeds_remaining'
        USING ERRCODE = '22023',
              MESSAGE = format('%s: satılan + qaytarılan miqdar qalıqdan çoxdur', v_inv.product_name);
    END IF;
  END LOOP;

  IF v_return_warehouse_id IS NULL THEN
    FOR v_line IN SELECT value FROM jsonb_array_elements(v_lines)
    LOOP
      IF COALESCE((v_line->>'quantity_returned')::numeric, 0) > 0 THEN
        RAISE EXCEPTION 'return_warehouse_required' USING ERRCODE = '22023', MESSAGE = 'Qaytarılan mal üçün anbar seçin';
      END IF;
    END LOOP;
  END IF;

  -- Build sold/returned line snapshots and apply stock/inventory changes.
  FOR v_line IN SELECT value FROM jsonb_array_elements(v_lines)
  LOOP
    v_product_id := NULLIF(v_line->>'product_id', '')::uuid;
    v_qty_sold := COALESCE((v_line->>'quantity_sold')::numeric, 0);
    v_qty_returned := COALESCE((v_line->>'quantity_returned')::numeric, 0);
    IF v_product_id IS NULL OR (v_qty_sold <= 0 AND v_qty_returned <= 0) THEN
      CONTINUE;
    END IF;

    SELECT * INTO v_inv FROM public.consignment_inventory
    WHERE partner_id = v_partner_id AND product_id = v_product_id
    FOR UPDATE;

    v_unit_price := COALESCE((v_line->>'unit_price')::numeric, v_inv.unit_price);

    IF v_qty_sold > 0 THEN
      v_any_sold := TRUE;
      v_total_amount := v_total_amount + (v_qty_sold * v_unit_price);
      v_sold_items := v_sold_items || jsonb_build_array(jsonb_build_object(
        'product_id', v_product_id,
        'product_code', v_inv.product_code,
        'product_name', v_inv.product_name,
        'quantity_sold', v_qty_sold,
        'unit_price', v_unit_price,
        'total_price', v_qty_sold * v_unit_price
      ));
    END IF;

    IF v_qty_returned > 0 THEN
      v_any_returned := TRUE;
      v_returned_items := v_returned_items || jsonb_build_array(jsonb_build_object(
        'product_id', v_product_id,
        'product_code', v_inv.product_code,
        'product_name', v_inv.product_name,
        'quantity', v_qty_returned,
        'unit', v_inv.unit,
        'unit_price', v_unit_price
      ));

      PERFORM public.consignment_adjust_warehouse_stock(v_product_id, v_return_warehouse_id, v_qty_returned);

      INSERT INTO public.stock_movements (
        product_id, warehouse_id, movement_type, quantity, unit,
        reference_type, reference_id, description, created_by
      )
      VALUES (
        v_product_id, v_return_warehouse_id, 'in', v_qty_returned, COALESCE(v_inv.unit, 'Ədəd'),
        'consignment_return', v_partner_id,
        format('Əmanət hesablaşması qaytarma — %s %s', v_partner_name, v_period), v_created_by
      );
    END IF;

    UPDATE public.consignment_inventory
    SET sold_qty = sold_qty + v_qty_sold,
        returned_qty = returned_qty + v_qty_returned,
        remaining_qty = GREATEST(0, v_inv.delivered_qty - (v_inv.sold_qty + v_qty_sold) - (v_inv.returned_qty + v_qty_returned)),
        updated_at = v_now
    WHERE id = v_inv.id;
  END LOOP;

  IF NOT v_any_sold AND NOT v_any_returned THEN
    RAISE EXCEPTION 'nothing_to_settle' USING ERRCODE = '22023', MESSAGE = 'Satılan və ya qaytarılan məhsul daxil edin';
  END IF;

  IF v_any_sold THEN
    v_invoice_no := 'CNS-' || EXTRACT(YEAR FROM v_now)::text || '-' || floor(random() * 90000 + 10000)::int::text;

    INSERT INTO public.sales (
      doc_no, invoice_number, doc_date, customer_id, customer_name, warehouse_name,
      subtotal, discount_total, vat_total, total_amount, paid_amount, remaining_balance,
      note, notes
    )
    VALUES (
      v_invoice_no, v_invoice_no, (v_period || '-01')::date, v_partner.customer_id, v_partner_name,
      'Əmanət / ' || v_partner_name,
      v_total_amount, 0, 0, v_total_amount, 0, v_total_amount,
      format('Əmanət satış hesabatı %s', v_period), format('Consignment settlement %s', v_period)
    )
    RETURNING id INTO v_sale_id;

    INSERT INTO public.sale_items (
      sale_id, product_id, product_code, product_name, warehouse_id, warehouse_name,
      quantity, unit, unit_price, discount_percent, vat_rate, line_total, extra_info
    )
    SELECT
      v_sale_id,
      (item->>'product_id')::uuid,
      item->>'product_code',
      item->>'product_name',
      NULL,
      'Əmanət / ' || v_partner_name,
      (item->>'quantity_sold')::numeric,
      'Ədəd',
      (item->>'unit_price')::numeric,
      0, 0,
      (item->>'total_price')::numeric,
      NULL
    FROM jsonb_array_elements(v_sold_items) AS item;

    v_journal_id := public.post_sale_invoice_gl_journal(
      v_sale_id, v_invoice_no, v_total_amount, v_partner.customer_id,
      'consignment_settlement:' || v_sale_id::text
    );

    IF v_partner.customer_id IS NOT NULL THEN
      PERFORM public.refresh_customer_ar_balance(v_partner.customer_id);
    END IF;
  END IF;

  IF v_report_no IS NULL THEN
    v_report_no := 'CM-' || EXTRACT(YEAR FROM v_now)::text || '-' || floor(random() * 90000 + 10000)::int::text;
  END IF;

  INSERT INTO public.consignment_monthly_reports (
    report_no, partner_id, report_period, sold_items, returned_items, total_amount,
    invoice_id, notes, sales_rep_id, sales_rep_name, created_by
  )
  VALUES (
    v_report_no, v_partner_id, v_period, v_sold_items, v_returned_items, v_total_amount,
    v_sale_id, v_notes, v_sales_rep_id, v_sales_rep_name, v_created_by
  )
  RETURNING id INTO v_report_id;

  SELECT to_jsonb(r) || jsonb_build_object('partner_name', v_partner_name)
  INTO v_result
  FROM public.consignment_monthly_reports r
  WHERE r.id = v_report_id;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.settle_consignment_partner_atomic(JSONB) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
