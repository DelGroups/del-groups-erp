-- İlkin Əmanət Qalığı (Consignment Initial/Opening Balance).
--
-- Partners who already had stock sitting at their location before this
-- system existed need a way to record that starting balance. Reusing
-- consignment_dispatches (same shape: partner + date + items jsonb) rather
-- than a new table - the only real difference from a normal dispatch is
-- that NOTHING physically leaves the main warehouse right now, since it
-- already left in the past. status = 'initial_balance' marks these rows;
-- warehouse_id/warehouse_name stay NULL (no source warehouse involved).

ALTER TABLE consignment_dispatches
  DROP CONSTRAINT IF EXISTS consignment_dispatches_status_check;

ALTER TABLE consignment_dispatches
  ADD CONSTRAINT consignment_dispatches_status_check
  CHECK (status IN ('pending', 'delivered', 'returned', 'initial_balance'));

CREATE OR REPLACE FUNCTION public.set_consignment_initial_balance_atomic(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_partner_id UUID := NULLIF(p_payload->>'partner_id', '')::uuid;
  v_balance_date DATE := COALESCE(NULLIF(p_payload->>'balance_date', '')::date, CURRENT_DATE);
  v_notes TEXT := NULLIF(btrim(p_payload->>'notes'), '');
  v_dispatch_no TEXT := NULLIF(btrim(p_payload->>'dispatch_no'), '');
  v_items JSONB := COALESCE(p_payload->'items', '[]'::jsonb);
  v_item JSONB;
  v_product_id UUID;
  v_quantity NUMERIC;
  v_unit_price NUMERIC;
  v_product_name TEXT;
  v_dispatch_id UUID;
  v_balance_ts TIMESTAMPTZ;
  v_inv_id UUID;
  v_delivered NUMERIC;
  v_sold NUMERIC;
  v_returned NUMERIC;
  v_partner_name TEXT;
  v_result JSONB;
  v_created_by UUID := NULLIF(p_payload->>'created_by', '')::uuid;
BEGIN
  -- Permission is checked in JS (requirePermissionAction) before this RPC is
  -- called via the service-role admin client - see create_consignment_dispatch_atomic.

  IF v_partner_id IS NULL THEN
    RAISE EXCEPTION 'partner_required' USING ERRCODE = '22023', MESSAGE = 'Tərəfdaş seçin';
  END IF;
  IF jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'items_required' USING ERRCODE = '22023', MESSAGE = 'Ən azı bir məhsul əlavə edin';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_items)
  LOOP
    v_product_id := NULLIF(v_item->>'product_id', '')::uuid;
    v_quantity := COALESCE((v_item->>'quantity')::numeric, 0);
    IF v_product_id IS NULL OR v_quantity <= 0 THEN
      RAISE EXCEPTION 'invalid_item' USING ERRCODE = '22023', MESSAGE = 'Sətirdə məhsul və ya miqdar yanlışdır';
    END IF;

    SELECT name INTO v_product_name FROM public.products WHERE id = v_product_id;
    IF v_product_name IS NULL THEN
      RAISE EXCEPTION 'product_not_found' USING ERRCODE = 'P0002', MESSAGE = 'Məhsul tapılmadı';
    END IF;
  END LOOP;

  IF v_dispatch_no IS NULL THEN
    v_dispatch_no := 'IB-' || EXTRACT(YEAR FROM v_balance_date)::text || '-' || floor(random() * 90000 + 10000)::int::text;
  END IF;

  -- Aging starts from the real-world balance date, not from today, so stock
  -- that has already been sitting with the partner for months shows up as
  -- aging immediately instead of resetting the clock on entry.
  v_balance_ts := v_balance_date::timestamptz;

  INSERT INTO public.consignment_dispatches (
    dispatch_no, partner_id, warehouse_id, warehouse_name, dispatch_date,
    status, items, notes, created_by
  )
  VALUES (
    v_dispatch_no, v_partner_id, NULL, NULL, v_balance_date,
    'initial_balance', v_items, v_notes, v_created_by
  )
  RETURNING id INTO v_dispatch_id;

  -- NOTE: no warehouse_stocks/products.stock adjustment and no stock_movements
  -- row here - that is the entire point of this RPC (see file header).
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_items)
  LOOP
    v_product_id := (v_item->>'product_id')::uuid;
    v_quantity := (v_item->>'quantity')::numeric;
    v_unit_price := COALESCE((v_item->>'unit_price')::numeric, 0);

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
          last_dispatch_at = LEAST(COALESCE(last_dispatch_at, v_balance_ts), v_balance_ts),
          updated_at = NOW()
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
        v_quantity, 0, 0, v_quantity, v_unit_price, v_balance_ts, NOW()
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

GRANT EXECUTE ON FUNCTION public.set_consignment_initial_balance_atomic(JSONB) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
