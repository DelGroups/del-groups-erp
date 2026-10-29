-- ============================================================================
-- Every stock movement that knows its warehouse changes THAT warehouse (fix F3).
--
-- Del (2026-10-29): "every exit from a warehouse must come out of that warehouse's stock".
-- F2 made products.stock = SUM(warehouse_stocks.current_stock) and moved a bare
-- products.stock change to the default warehouse; the writers below knew their warehouse but
-- never named it, so they always took from the default warehouse and checked the product
-- total. Now:
--
--   stock_move(product, warehouse, delta, strict)   one row + the total, one transaction;
--     strict refuses going below zero in THAT warehouse, naming product and warehouse.
--     NULL warehouse = default warehouse. Services and kit parents: no-op. Polywood moves
--     through its pieces: strict refuses it; the non-strict callers below keep today's
--     total-only update for polywood (the F2 trigger rebuilds its rows from the pieces).
--
--   write-offs     post_inventory_writeoff / update_inventory_writeoff (were browser-side)
--   sales          demand keyed "<product>:<warehouse>" (line warehouse, else default), kits
--                  exploded in the line's warehouse; cancel / void give each line back to it
--   production     material issue and return per material warehouse; finished goods into the
--                  furniture warehouse (else the order warehouse); delivery takes them from there
--   purchases      into the purchase warehouse; reversing takes them back from it
--
-- Warehouse fallback everywhere: line warehouse, then document warehouse, then default.
-- No feature flag (a bug fix, like F2). Safe to re-run.
-- ============================================================================

-- ─── 1. The core move ───────────────────────────────────────────────────────

-- Stock of a product in a warehouse (the warehouse-less legacy row counts for the default).
CREATE OR REPLACE FUNCTION public.stock_available(p_product_id UUID, p_warehouse_id UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT current_stock FROM public.warehouse_stocks
      WHERE product_id = p_product_id
        AND warehouse_id = COALESCE(p_warehouse_id, public.stock_default_warehouse())
      LIMIT 1),
    (SELECT current_stock FROM public.warehouse_stocks
      WHERE product_id = p_product_id AND warehouse_id IS NULL
        AND COALESCE(p_warehouse_id, public.stock_default_warehouse()) IS NOT DISTINCT FROM public.stock_default_warehouse()
      LIMIT 1),
    0);
$$;

CREATE OR REPLACE FUNCTION public.stock_shortage_message(p_product_id UUID, p_warehouse_id UUID, p_available NUMERIC, p_required NUMERIC)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT format(
    'Stok kifayət etmir: %s — «%s» anbarında mövcud %s, tələb %s',
    COALESCE((SELECT COALESCE(NULLIF(trim(code), '') || ' ', '') || name FROM public.products WHERE id = p_product_id), p_product_id::text),
    COALESCE((SELECT name FROM public.warehouses WHERE id = COALESCE(p_warehouse_id, public.stock_default_warehouse())), '—'),
    trim(to_char(COALESCE(p_available, 0), 'FM999999990.00')),
    trim(to_char(COALESCE(p_required, 0), 'FM999999990.00')));
$$;

-- Moves one warehouse row and the product total by p_delta; returns the new warehouse quantity.
CREATE OR REPLACE FUNCTION public.stock_move(
  p_product_id   UUID,
  p_warehouse_id UUID,
  p_delta        NUMERIC,
  p_strict       BOOLEAN DEFAULT true
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product RECORD;
  v_wh      UUID := COALESCE(p_warehouse_id, public.stock_default_warehouse());
  v_row_id  UUID;
  v_current NUMERIC;
  v_next    NUMERIC;
BEGIN
  IF p_product_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT id, inventory_mode, COALESCE(is_service, FALSE) AS svc, COALESCE(is_composite, FALSE) AS kit
  INTO v_product
  FROM public.products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = format('Məhsul tapılmadı: %s', p_product_id);
  END IF;
  IF v_product.svc OR v_product.kit OR COALESCE(p_delta, 0) = 0 THEN
    RETURN NULL;
  END IF;
  IF v_product.inventory_mode = 'polywood' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = format(
      '%s Polywood məhsuludur: onun stoku hissələrlə hərəkət edir',
      (SELECT name FROM public.products WHERE id = p_product_id));
  END IF;

  v_row_id := public._stock_row_for(p_product_id, v_wh);
  SELECT current_stock INTO v_current FROM public.warehouse_stocks WHERE id = v_row_id FOR UPDATE;
  v_current := COALESCE(v_current, 0);
  v_next := v_current + p_delta;
  IF v_next < -0.000001 THEN
    IF p_strict THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = public.stock_shortage_message(p_product_id, v_wh, v_current, -p_delta);
    END IF;
    v_next := 0;
  END IF;

  UPDATE public.warehouse_stocks
  SET current_stock = v_next,
      warehouse_id = COALESCE(v_wh, warehouse_id),
      updated_at = NOW()
  WHERE id = v_row_id;

  IF v_next <> v_current THEN
    PERFORM public.stock_sync_skip(true);
    UPDATE public.products SET stock = COALESCE(stock, 0) + (v_next - v_current) WHERE id = p_product_id;
    PERFORM public.stock_sync_skip(false);
  END IF;

  RETURN v_next;
END;
$$;

-- For document flows that may carry Polywood on an ordinary line (sales, purchases): Polywood
-- keeps today's total-only update (its rows follow the pieces), everything else uses stock_move.
CREATE OR REPLACE FUNCTION public._stock_move_doc(
  p_product_id   UUID,
  p_warehouse_id UUID,
  p_delta        NUMERIC,
  p_strict       BOOLEAN DEFAULT true
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.products WHERE id = p_product_id AND inventory_mode = 'polywood') THEN
    UPDATE public.products SET stock = COALESCE(stock, 0) + COALESCE(p_delta, 0) WHERE id = p_product_id;
    RETURN NULL;
  END IF;
  RETURN public.stock_move(p_product_id, p_warehouse_id, p_delta, p_strict);
END;
$$;

-- Adds one sale line to a demand keyed "<product_id>:<warehouse_id>"; a kit becomes its
-- components (merge_stock_demand), taken from the same warehouse as the kit line.
CREATE OR REPLACE FUNCTION public._stock_demand_add(p_demand JSONB, p_product_id UUID, p_warehouse_id UUID, p_quantity NUMERIC)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_result JSONB := COALESCE(p_demand, '{}'::jsonb);
  v_parts  JSONB;
  v_comp   TEXT;
  v_key    TEXT;
  v_wh     TEXT := COALESCE(COALESCE(p_warehouse_id, public.stock_default_warehouse())::text, '');
BEGIN
  v_parts := public.merge_stock_demand('{}'::jsonb, p_product_id, p_quantity);
  FOR v_comp IN SELECT jsonb_object_keys(v_parts) LOOP
    v_key := v_comp || ':' || v_wh;
    v_result := jsonb_set(v_result, ARRAY[v_key],
      to_jsonb(COALESCE((v_result->>v_key)::numeric, 0) + (v_parts->>v_comp)::numeric), true);
  END LOOP;
  RETURN v_result;
END;
$$;

-- Applies one demand key ("<product>" alone = default warehouse, for old callers).
CREATE OR REPLACE FUNCTION public.stock_move_key(p_key TEXT, p_delta NUMERIC, p_strict BOOLEAN DEFAULT true)
RETURNS NUMERIC
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public._stock_move_doc(split_part(p_key, ':', 1)::uuid, NULLIF(split_part(p_key, ':', 2), '')::uuid, p_delta, p_strict);
$$;

REVOKE ALL ON FUNCTION public.stock_move(UUID, UUID, NUMERIC, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stock_move(UUID, UUID, NUMERIC, BOOLEAN) TO service_role;
REVOKE ALL ON FUNCTION public._stock_move_doc(UUID, UUID, NUMERIC, BOOLEAN) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.stock_move_key(TEXT, NUMERIC, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.stock_available(UUID, UUID) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.stock_shortage_message(UUID, UUID, NUMERIC, NUMERIC) FROM PUBLIC, anon;

-- Transfers, consignment and initial balances keep clamping at zero (F2 behaviour). Polywood
-- keeps F2's own path here: its rows follow the pieces.
CREATE OR REPLACE FUNCTION public.adjust_warehouse_stock(
  p_product_id   UUID,
  p_warehouse_id UUID,
  p_delta        NUMERIC
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row_id  UUID;
  v_current NUMERIC;
  v_next    NUMERIC;
BEGIN
  IF p_product_id IS NULL OR p_warehouse_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Məhsul və anbar göstərilməlidir';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.products WHERE id = p_product_id AND inventory_mode = 'polywood') THEN
    RETURN COALESCE(public.stock_move(p_product_id, p_warehouse_id, p_delta, false), 0);
  END IF;

  PERFORM 1 FROM public.products WHERE id = p_product_id FOR UPDATE;
  v_row_id := public._stock_row_for(p_product_id, p_warehouse_id);
  SELECT current_stock INTO v_current FROM public.warehouse_stocks WHERE id = v_row_id FOR UPDATE;
  v_next := GREATEST(COALESCE(v_current, 0) + COALESCE(p_delta, 0), 0);
  UPDATE public.warehouse_stocks
  SET current_stock = v_next, warehouse_id = p_warehouse_id, updated_at = NOW()
  WHERE id = v_row_id;
  IF v_next <> COALESCE(v_current, 0) THEN
    PERFORM public.stock_sync_skip(true);
    UPDATE public.products SET stock = COALESCE(stock, 0) + (v_next - COALESCE(v_current, 0)) WHERE id = p_product_id;
    PERFORM public.stock_sync_skip(false);
  END IF;
  RETURN v_next;
END;
$$;

REVOKE ALL ON FUNCTION public.adjust_warehouse_stock(UUID, UUID, NUMERIC) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.adjust_warehouse_stock(UUID, UUID, NUMERIC) TO service_role;

-- ─── 2. Sales demand per warehouse ──────────────────────────────────────────

-- Demand keyed "<product_id>:<warehouse_id>" (line warehouse, else default), validated against
-- that warehouse. Polywood on an ordinary line is checked against its total, as before.
CREATE OR REPLACE FUNCTION public.build_and_validate_sale_stock_demand(p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_item JSONB;
  v_product_id UUID;
  v_warehouse_id UUID;
  v_qty NUMERIC;
  v_polywood_mode TEXT;
  v_skip_stock BOOLEAN;
  v_stock_demand JSONB := '{}'::jsonb;
  v_key TEXT;
  v_available NUMERIC;
  v_required NUMERIC;
  v_mode TEXT;
BEGIN
  IF jsonb_typeof(p_items) <> 'array' THEN
    RETURN '{}'::jsonb;
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := NULLIF(v_item->>'product_id', '')::uuid;
    v_warehouse_id := NULLIF(v_item->>'warehouse_id', '')::uuid;
    v_qty := COALESCE(NULLIF(v_item->>'quantity', '')::numeric, 0);
    v_polywood_mode := NULLIF(trim(v_item->>'polywood_sale_mode'), '');
    v_skip_stock := COALESCE((v_item->>'skip_stock')::boolean, false);

    IF v_product_id IS NULL OR v_qty <= 0 OR v_polywood_mode IS NOT NULL OR v_skip_stock THEN
      CONTINUE;
    END IF;

    -- Services carry no stock.
    IF EXISTS (SELECT 1 FROM public.products WHERE id = v_product_id AND is_service) THEN
      CONTINUE;
    END IF;

    v_stock_demand := public._stock_demand_add(v_stock_demand, v_product_id, v_warehouse_id, v_qty);
  END LOOP;

  FOR v_key IN SELECT jsonb_object_keys(v_stock_demand)
  LOOP
    v_product_id := split_part(v_key, ':', 1)::uuid;
    v_warehouse_id := NULLIF(split_part(v_key, ':', 2), '')::uuid;
    v_required := COALESCE((v_stock_demand->>v_key)::numeric, 0);

    SELECT inventory_mode, stock INTO v_mode, v_available FROM public.products WHERE id = v_product_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = format('Məhsul tapılmadı: %s', v_product_id);
    END IF;
    IF v_mode IS DISTINCT FROM 'polywood' THEN
      v_available := public.stock_available(v_product_id, v_warehouse_id);
    END IF;

    IF COALESCE(v_available, 0) + 0.000001 < v_required THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = public.stock_shortage_message(v_product_id, v_warehouse_id, v_available, v_required);
    END IF;
  END LOOP;

  RETURN v_stock_demand;
END;
$function$;

-- Takes each "<product>:<warehouse>" of a demand out of that warehouse.
CREATE OR REPLACE FUNCTION public.apply_sale_stock_decrement(p_stock_demand jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_key TEXT;
BEGIN
  IF p_stock_demand IS NULL OR jsonb_typeof(p_stock_demand) <> 'object' THEN
    RETURN;
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(p_stock_demand)
  LOOP
    PERFORM public.stock_move_key(v_key, -COALESCE((p_stock_demand->>v_key)::numeric, 0), true);
  END LOOP;
END;
$function$;

-- Mixed (Polywood) invoices: an accessory line comes out of the warehouse the app sends.
CREATE OR REPLACE FUNCTION public.process_mixed_dimensional_sale(p_product_id uuid, p_warehouse_id uuid, p_item_type text, p_sale_mode text DEFAULT NULL::text, p_amount numeric DEFAULT 0, p_piece_count integer DEFAULT 1, p_sale_item_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_product RECORD;
  v_base_length NUMERIC;
  v_remaining NUMERIC;
  v_target INTEGER;
  v_piece RECORD;
  v_new_piece_id UUID;
  v_leftover NUMERIC;
  v_steps JSONB := '[]'::jsonb;
  v_scrap JSONB := '[]'::jsonb;
  v_i INTEGER;
BEGIN
  IF p_item_type IS NULL THEN
    RAISE EXCEPTION 'item_type is required';
  END IF;

  IF p_item_type = 'service' THEN
    RETURN jsonb_build_object('ok', true, 'item_type', 'service', 'steps', v_steps);
  END IF;

  IF p_product_id IS NULL THEN
    RAISE EXCEPTION 'product_id is required';
  END IF;

  SELECT * INTO v_product FROM products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product % not found', p_product_id;
  END IF;

  IF p_item_type = 'accessory' THEN
    IF p_amount IS NULL OR p_amount <= 0 THEN
      RAISE EXCEPTION 'Accessory quantity must be positive';
    END IF;
    IF COALESCE(v_product.stock, 0) < p_amount THEN
      RAISE EXCEPTION 'Insufficient stock for "%": have %, need %', v_product.name, v_product.stock, p_amount;
    END IF;
    -- Out of the line's warehouse (default when none is sent), fix F3.
    PERFORM public._stock_move_doc(p_product_id, p_warehouse_id, -p_amount, true);
    RETURN jsonb_build_object('ok', true, 'item_type', 'accessory', 'deducted', p_amount);
  END IF;

  IF p_item_type <> 'dimensional' THEN
    RAISE EXCEPTION 'Unknown item_type %', p_item_type;
  END IF;

  IF p_warehouse_id IS NULL THEN
    RAISE EXCEPTION 'warehouse_id is required for dimensional items';
  END IF;

  v_base_length := COALESCE(v_product.base_length, v_product.full_sheet_length_m, 4);

  IF p_sale_mode = 'full_sheet' THEN
    v_target := ROUND(COALESCE(p_amount, 0))::INTEGER;
    IF v_target <= 0 THEN
      RAISE EXCEPTION 'Full sheet quantity must be positive';
    END IF;

    FOR v_piece IN
      SELECT * FROM polywood_pieces
      WHERE product_id = p_product_id AND warehouse_id = p_warehouse_id
        AND status = 'available' AND piece_type = 'full'
        AND ABS(length_m - v_base_length) < 0.001
      ORDER BY created_at ASC
      LIMIT v_target
      FOR UPDATE
    LOOP
      UPDATE polywood_pieces
      SET status = 'sold', sale_item_id = p_sale_item_id, updated_at = NOW()
      WHERE id = v_piece.id;
      v_steps := v_steps || jsonb_build_object(
        'piece_id', v_piece.id, 'action', 'consume', 'used_length', v_base_length
      );
      v_target := v_target - 1;
    END LOOP;

    IF v_target > 0 THEN
      RAISE EXCEPTION 'Insufficient full sheets for "%": missing % sheet(s)', v_product.name, v_target;
    END IF;

  ELSIF p_sale_mode IN ('meter', 'linear_m') THEN
    IF p_amount IS NULL OR p_amount <= 0 THEN
      RAISE EXCEPTION 'Length must be positive';
    END IF;

    FOR v_i IN 1..GREATEST(COALESCE(p_piece_count, 1), 1) LOOP
      v_remaining := ROUND(p_amount, 3);

      -- 1) Exact-length piece first (prefer an off-cut over a full sheet).
      SELECT * INTO v_piece FROM polywood_pieces
      WHERE product_id = p_product_id AND warehouse_id = p_warehouse_id
        AND status = 'available' AND ABS(length_m - v_remaining) < 0.001
      ORDER BY (piece_type = 'cut') DESC, created_at ASC
      LIMIT 1
      FOR UPDATE;

      IF FOUND THEN
        UPDATE polywood_pieces
        SET status = 'sold', sale_item_id = p_sale_item_id, updated_at = NOW()
        WHERE id = v_piece.id;
        v_steps := v_steps || jsonb_build_object(
          'piece_id', v_piece.id, 'action', 'consume', 'used_length', v_remaining
        );
        CONTINUE;
      END IF;

      -- 2) Smallest larger off-cut, else smallest larger full sheet.
      SELECT * INTO v_piece FROM polywood_pieces
      WHERE product_id = p_product_id AND warehouse_id = p_warehouse_id
        AND status = 'available' AND piece_type = 'cut'
        AND length_m > v_remaining + 0.001
      ORDER BY length_m ASC
      LIMIT 1
      FOR UPDATE;

      IF NOT FOUND THEN
        SELECT * INTO v_piece FROM polywood_pieces
        WHERE product_id = p_product_id AND warehouse_id = p_warehouse_id
          AND status = 'available' AND piece_type = 'full'
          AND length_m > v_remaining + 0.001
        ORDER BY length_m ASC
        LIMIT 1
        FOR UPDATE;
      END IF;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Insufficient material for "%" (need %m more)', v_product.name, v_remaining;
      END IF;

      v_leftover := ROUND(v_piece.length_m - v_remaining, 3);

      IF v_piece.piece_type = 'full' THEN
        -- Full sheet is consumed as raw material; remnant becomes a new off-cut.
        UPDATE polywood_pieces
        SET status = 'consumed', sale_item_id = p_sale_item_id, updated_at = NOW()
        WHERE id = v_piece.id;
        v_steps := v_steps || jsonb_build_object(
          'piece_id', v_piece.id, 'action', 'split_full',
          'used_length', v_remaining, 'scrap_length', v_leftover
        );

        IF v_leftover > 0.001 THEN
          INSERT INTO polywood_pieces (product_id, warehouse_id, length_m, piece_type, status, notes)
          VALUES (
            p_product_id, p_warehouse_id, v_leftover, 'cut', 'available',
            'Auto remnant from sale item ' || COALESCE(p_sale_item_id::text, 'n/a')
          )
          RETURNING id INTO v_new_piece_id;
          v_scrap := v_scrap || jsonb_build_object('piece_id', v_new_piece_id, 'length_m', v_leftover);
        END IF;
      ELSE
        -- Off-cut: shrink the existing piece in place, no new row needed.
        UPDATE polywood_pieces
        SET length_m = v_leftover, updated_at = NOW()
        WHERE id = v_piece.id;
        v_steps := v_steps || jsonb_build_object(
          'piece_id', v_piece.id, 'action', 'partial',
          'used_length', v_remaining, 'remaining_on_piece', v_leftover
        );
      END IF;
    END LOOP;
  ELSE
    RAISE EXCEPTION 'Unknown sale_mode % for dimensional item', p_sale_mode;
  END IF;

  IF p_sale_item_id IS NOT NULL THEN
    UPDATE sale_items
    SET polywood_cut_details = jsonb_build_object('steps', v_steps, 'scrap_created', v_scrap)
    WHERE id = p_sale_item_id;
  END IF;

  -- Keep products.stock in sync as "total metres currently in stock" for dimensional items.
  UPDATE products
  SET stock = (
    SELECT COALESCE(SUM(length_m), 0)
    FROM polywood_pieces
    WHERE product_id = p_product_id AND warehouse_id = p_warehouse_id AND status = 'available'
  )
  WHERE id = p_product_id;

  RETURN jsonb_build_object('ok', true, 'item_type', 'dimensional', 'steps', v_steps, 'scrap_created', v_scrap);
END;
$function$;

-- ─── 3. Sales module: cancel / void give stock back to each line's warehouse ─

DO $guard$
BEGIN
  IF to_regprocedure('public.post_sales_invoice_draft(uuid)') IS NULL THEN
    RETURN;
  END IF;

  EXECUTE $fn$
CREATE OR REPLACE FUNCTION public._reverse_sales_invoice_posting(
  p_sale_id uuid, p_label text, p_reason text, p_keep_cash boolean DEFAULT false
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_label    TEXT := p_label;
  v_reason   TEXT := p_reason;
  v_line     RECORD;
  v_demand   JSONB := '{}'::jsonb;
  v_key      TEXT;
  v_units    NUMERIC;
  v_cash     INTEGER := 0;
  v_journals INTEGER := 0;
BEGIN
  -- 1. Stock lines (not dimensional, not services): give the quantity back,
  --    exploding kits through their BOM exactly as posting did.
  FOR v_line IN
    SELECT si.id, si.product_id, si.quantity, si.warehouse_id, si.unit, p.name AS product_name
    FROM public.sale_items si
    JOIN public.products p ON p.id = si.product_id
    WHERE si.sale_id = p_sale_id
      AND COALESCE(si.quantity, 0) > 0
      AND NULLIF(btrim(si.polywood_sale_mode), '') IS NULL
      AND COALESCE(si.sale_item_type, 'standard') <> 'service'
      AND NOT COALESCE(p.is_service, false)
  LOOP
    -- Back into the line's warehouse (fix F3); kits through their components.
    v_demand := public._stock_demand_add(v_demand, v_line.product_id, v_line.warehouse_id, v_line.quantity);

    INSERT INTO public.stock_movements (
      product_id, warehouse_id, movement_type, quantity, unit,
      reference_type, reference_id, source_line_id, description, created_by
    )
    VALUES (
      v_line.product_id, v_line.warehouse_id, 'in', v_line.quantity,
      COALESCE(v_line.unit, 'Ədəd'), 'sale_void', p_sale_id, v_line.id,
      format('Ləğv: satış fakturası %s — %s', v_label, COALESCE(v_line.product_name, '')),
      auth.uid()
    );
  END LOOP;

  FOR v_key IN SELECT jsonb_object_keys(v_demand)
  LOOP
    PERFORM public.stock_move_key(v_key, (v_demand->>v_key)::numeric, false);
  END LOOP;

  -- 2. Dimensional (Polywood) lines: put the cut pieces back.
  FOR v_line IN
    SELECT si.*, COALESCE(p.full_sheet_length_m, p.base_length, 4) AS sheet_length_m
    FROM public.sale_items si
    JOIN public.products p ON p.id = si.product_id
    WHERE si.sale_id = p_sale_id
      AND NULLIF(btrim(si.polywood_sale_mode), '') IS NOT NULL
  LOOP
    IF v_line.polywood_cut_details IS NOT NULL THEN
      PERFORM public.rollback_mixed_dimensional_sale(v_line.id);
      IF v_line.warehouse_id IS NOT NULL THEN
        UPDATE public.products
        SET stock = (
          SELECT COALESCE(SUM(length_m), 0)
          FROM public.polywood_pieces
          WHERE product_id = v_line.product_id
            AND status = 'available'
        )
        WHERE id = v_line.product_id;
      END IF;
    ELSE
      -- Sold before piece tracking: restore the metres.
      v_units := CASE
        WHEN v_line.polywood_sale_mode = 'full_sheet'
          THEN COALESCE(v_line.quantity, 0) * v_line.sheet_length_m
        WHEN v_line.sale_item_type = 'dimensional'
          THEN COALESCE(v_line.polywood_length_m, v_line.quantity, 0) * GREATEST(COALESCE(v_line.piece_count, 1), 1)
        ELSE COALESCE(v_line.polywood_length_m, v_line.quantity, 0)
      END;
      IF v_units > 0 THEN
        UPDATE public.products SET stock = COALESCE(stock, 0) + v_units WHERE id = v_line.product_id;
      END IF;
    END IF;
  END LOOP;

  -- 3. FIFO: give consumed quantities back to their layers.
  UPDATE public.inventory_batches b
  SET remaining_qty = b.remaining_qty + c.qty
  FROM (
    SELECT batch_id, SUM(quantity) AS qty
    FROM public.inventory_batch_consumptions
    WHERE sale_id = p_sale_id AND batch_id IS NOT NULL
    GROUP BY batch_id
  ) c
  WHERE b.id = c.batch_id;

  DELETE FROM public.inventory_batch_consumptions WHERE sale_id = p_sale_id;
  UPDATE public.sale_items SET cogs_amount = 0 WHERE sale_id = p_sale_id;

  -- 4. Cash received for the invoice (and paid additional expenses).
  IF NOT p_keep_cash THEN
    v_cash := public.reverse_document_cash_transactions('sale', p_sale_id, v_label, v_reason);
  END IF;

  -- 5. Pending warehouse slips for the invoice are void with it.
  DELETE FROM public.warehouse_slips
  WHERE source_type = 'sale' AND source_document_id = p_sale_id;

  -- 6. Invoice and COGS journals.
  v_journals := public.reverse_document_journals(p_sale_id, v_reason);

  RETURN jsonb_build_object('cash_reversed', v_cash, 'journals_reversed', v_journals);
END;
$function$;
  $fn$;
  EXECUTE $fn$
CREATE OR REPLACE FUNCTION public.create_sale_atomic(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_header JSONB;
  v_items JSONB;
  v_payments JSONB;
  v_decrement_stock BOOLEAN := true;
  v_customer_id UUID;
  v_customer_name TEXT;
  v_sale_id UUID;
  v_doc_no TEXT;
  v_total_amount NUMERIC;
  v_paid_amount NUMERIC;
  v_remaining NUMERIC;
  v_item JSONB;
  v_pay JSONB;
  v_product_id UUID;
  v_qty NUMERIC;
  v_stock NUMERIC;
  v_account_id UUID;
  v_pay_amount NUMERIC;
  v_pay_method TEXT;
  v_skip_stock BOOLEAN;
  v_polywood_mode TEXT;
  v_item_ids JSONB := '[]'::jsonb;
  v_item_id UUID;
  v_idx INT := 0;
  v_stock_demand JSONB := '{}'::jsonb;
  v_key TEXT;
BEGIN
  IF NOT public.require_permission('can_edit_sales') THEN
    RAISE EXCEPTION 'forbidden'
      USING ERRCODE = '42501',
            MESSAGE = 'Satış yaratmaq üçün icazəniz yoxdur';
  END IF;

  IF p_payload IS NULL THEN
    RAISE EXCEPTION 'invalid_payload'
      USING ERRCODE = '22023',
            MESSAGE = 'Satış məlumatları göndərilməyib';
  END IF;

  v_header := COALESCE(p_payload->'header', '{}'::jsonb);
  v_items := COALESCE(p_payload->'items', '[]'::jsonb);
  v_payments := COALESCE(p_payload->'payments', '[]'::jsonb);

  IF jsonb_typeof(v_items) <> 'array' OR jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'items_required'
      USING ERRCODE = '22023',
            MESSAGE = 'Ən azı bir satış sətri tələb olunur';
  END IF;

  IF (p_payload ? 'decrement_stock') THEN
    v_decrement_stock := COALESCE((p_payload->>'decrement_stock')::boolean, true);
  END IF;

  v_customer_id := NULLIF(v_header->>'customer_id', '')::uuid;
  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'customer_required'
      USING ERRCODE = '22023',
            MESSAGE = 'Müştəri seçilməlidir';
  END IF;

  SELECT COALESCE(NULLIF(trim(full_name), ''), NULLIF(trim(name), ''), NULLIF(trim(company_name), ''), '')
  INTO v_customer_name
  FROM customers
  WHERE id = v_customer_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'customer_not_found'
      USING ERRCODE = 'P0002',
            MESSAGE = 'Müştəri tapılmadı';
  END IF;

  v_total_amount := COALESCE(NULLIF(v_header->>'total_amount', '')::numeric, 0);
  v_paid_amount := COALESCE(NULLIF(v_header->>'paid_amount', '')::numeric, 0);
  v_remaining := GREATEST(
    COALESCE(
      NULLIF(v_header->>'remaining_balance', '')::numeric,
      v_total_amount - v_paid_amount
    ),
    0
  );

  IF v_paid_amount > v_total_amount + 0.0001 THEN
    RAISE EXCEPTION 'overpaid'
      USING ERRCODE = '22023',
            MESSAGE = 'Ödənilən məbləğ ümumi məbləğdən böyük ola bilməz';
  END IF;

  -- Stock demand per product and warehouse, checked against that warehouse (fix F3).
  IF v_decrement_stock THEN
    v_stock_demand := public.build_and_validate_sale_stock_demand(v_items);
  END IF;

  -- Validate payment accounts before writing
  IF jsonb_typeof(v_payments) = 'array' THEN
    FOR v_pay IN SELECT value FROM jsonb_array_elements(v_payments)
    LOOP
      v_pay_amount := COALESCE(NULLIF(v_pay->>'amount', '')::numeric, 0);
      IF v_pay_amount <= 0 THEN
        CONTINUE;
      END IF;

      v_account_id := NULLIF(v_pay->>'account_id', '')::uuid;
      IF v_account_id IS NULL THEN
        RAISE EXCEPTION 'account_required'
          USING ERRCODE = '22023',
                MESSAGE = 'Ödəniş üçün kassa/bank hesabı seçilməlidir';
      END IF;

      PERFORM id FROM accounts WHERE id = v_account_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'account_not_found'
          USING ERRCODE = 'P0002',
                MESSAGE = 'Seçilmiş kassa/bank hesabı tapılmadı';
      END IF;
    END LOOP;
  END IF;

  v_doc_no := NULLIF(trim(v_header->>'doc_no'), '');
  IF v_doc_no IS NULL THEN
    v_doc_no := 'SF-' || to_char(CURRENT_DATE, 'YYYY') || '-' || floor(10000 + random() * 90000)::int;
  END IF;

  INSERT INTO sales (
    doc_no,
    invoice_number,
    doc_date,
    customer_id,
    customer_name,
    seller_id,
    seller_name,
    warehouse_name,
    subtotal,
    discount_total,
    vat_total,
    total_amount,
    paid_amount,
    remaining_balance,
    delivery_address,
    delivery_type,
    delivery_fee,
    note,
    notes,
    payments,
    created_at
  )
  VALUES (
    v_doc_no,
    COALESCE(NULLIF(trim(v_header->>'invoice_number'), ''), v_doc_no),
    COALESCE(NULLIF(v_header->>'doc_date', '')::date, CURRENT_DATE),
    v_customer_id,
    COALESCE(NULLIF(trim(v_header->>'customer_name'), ''), v_customer_name),
    NULLIF(v_header->>'seller_id', '')::uuid,
    NULLIF(trim(v_header->>'seller_name'), ''),
    NULLIF(trim(v_header->>'warehouse_name'), ''),
    COALESCE(NULLIF(v_header->>'subtotal', '')::numeric, 0),
    COALESCE(NULLIF(v_header->>'discount_total', '')::numeric, 0),
    COALESCE(NULLIF(v_header->>'vat_total', '')::numeric, 0),
    v_total_amount,
    v_paid_amount,
    v_remaining,
    NULLIF(trim(v_header->>'delivery_address'), ''),
    COALESCE(NULLIF(trim(v_header->>'delivery_type'), ''), 'free'),
    COALESCE(NULLIF(v_header->>'delivery_fee', '')::numeric, 0),
    NULLIF(trim(v_header->>'note'), ''),
    NULLIF(trim(v_header->>'notes'), ''),
    COALESCE(v_header->'payments', v_payments, '[]'::jsonb),
    COALESCE(NULLIF(v_header->>'created_at', '')::timestamptz, NOW())
  )
  RETURNING id INTO v_sale_id;

  -- Insert line items
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_items)
  LOOP
    INSERT INTO sale_items (
      sale_id,
      product_id,
      product_code,
      product_name,
      warehouse_id,
      warehouse_name,
      quantity,
      unit,
      unit_price,
      discount_percent,
      vat_rate,
      line_total,
      extra_info,
      polywood_sale_mode,
      polywood_length_m
    )
    VALUES (
      v_sale_id,
      NULLIF(v_item->>'product_id', '')::uuid,
      NULLIF(trim(v_item->>'product_code'), ''),
      NULLIF(trim(v_item->>'product_name'), ''),
      NULLIF(v_item->>'warehouse_id', '')::uuid,
      NULLIF(trim(v_item->>'warehouse_name'), ''),
      COALESCE(NULLIF(v_item->>'quantity', '')::numeric, 0),
      COALESCE(NULLIF(trim(v_item->>'unit'), ''), 'Ədəd'),
      COALESCE(NULLIF(v_item->>'unit_price', '')::numeric, 0),
      COALESCE(NULLIF(v_item->>'discount_percent', '')::numeric, 0),
      COALESCE(NULLIF(v_item->>'vat_rate', '')::numeric, 0),
      COALESCE(
        NULLIF(v_item->>'line_total', '')::numeric,
        NULLIF(v_item->>'total', '')::numeric,
        0
      ),
      NULLIF(trim(v_item->>'extra_info'), ''),
      NULLIF(trim(v_item->>'polywood_sale_mode'), ''),
      NULLIF(v_item->>'polywood_length_m', '')::numeric
    )
    RETURNING id INTO v_item_id;

    v_item_ids := v_item_ids || jsonb_build_array(
      jsonb_build_object(
        'index', v_idx,
        'id', v_item_id,
        'product_id', NULLIF(v_item->>'product_id', '')::uuid,
        'polywood_sale_mode', NULLIF(trim(v_item->>'polywood_sale_mode'), '')
      )
    );
    v_idx := v_idx + 1;
  END LOOP;

  -- Deduct the stock of each line's warehouse
  IF v_decrement_stock THEN
    PERFORM public.apply_sale_stock_decrement(v_stock_demand);
  END IF;

  -- Cash payments: transactions + account balance
  IF jsonb_typeof(v_payments) = 'array' THEN
    FOR v_pay IN SELECT value FROM jsonb_array_elements(v_payments)
    LOOP
      v_pay_amount := COALESCE(NULLIF(v_pay->>'amount', '')::numeric, 0);
      IF v_pay_amount <= 0 THEN
        CONTINUE;
      END IF;

      v_account_id := NULLIF(v_pay->>'account_id', '')::uuid;
      v_pay_method := COALESCE(NULLIF(trim(v_pay->>'method'), ''), 'Ödəniş');

      SELECT balance INTO v_stock
      FROM accounts
      WHERE id = v_account_id
      FOR UPDATE;

      INSERT INTO transactions (account_id, type, amount, category, notes)
      VALUES (
        v_account_id,
        'Mədaxil',
        v_pay_amount,
        'Satış Ödənişi',
        format('Satış fakturası %s — %s', v_doc_no, v_pay_method)
      );

      UPDATE accounts
      SET balance = COALESCE(v_stock, 0) + v_pay_amount
      WHERE id = v_account_id;
    END LOOP;
  END IF;

  -- Accounts receivable on customer master
  IF v_remaining > 0.0001 THEN
    SELECT balance INTO v_stock
    FROM customers
    WHERE id = v_customer_id
    FOR UPDATE;

    UPDATE customers
    SET balance = COALESCE(v_stock, 0) + v_remaining
    WHERE id = v_customer_id;
  END IF;

  RETURN jsonb_build_object(
    'sale_id', v_sale_id,
    'doc_no', v_doc_no,
    'items', v_item_ids
  );
END;
$function$;
  $fn$;

  EXECUTE $fn$
  -- Gives the stock of a sale back to each line's warehouse (kits through their components).
  CREATE OR REPLACE FUNCTION public.restore_sale_stock(p_sale_id uuid)
   RETURNS integer
   LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path TO 'public'
  AS $function$
  DECLARE
    v_item RECORD;
    v_demand JSONB := '{}'::jsonb;
    v_key TEXT;
    v_restored INT := 0;
  BEGIN
    FOR v_item IN
      SELECT product_id, quantity, warehouse_id, polywood_sale_mode
      FROM sale_items
      WHERE sale_id = p_sale_id
    LOOP
      IF v_item.product_id IS NULL OR COALESCE(v_item.quantity, 0) <= 0 THEN
        CONTINUE;
      END IF;
      IF NULLIF(trim(COALESCE(v_item.polywood_sale_mode, '')), '') IS NOT NULL THEN
        CONTINUE;
      END IF;
      v_demand := public._stock_demand_add(v_demand, v_item.product_id, v_item.warehouse_id, v_item.quantity);
      v_restored := v_restored + 1;
    END LOOP;

    FOR v_key IN SELECT jsonb_object_keys(v_demand) LOOP
      PERFORM public.stock_move_key(v_key, (v_demand->>v_key)::numeric, false);
    END LOOP;

    RETURN v_restored;
  END;
  $function$;
  $fn$;
END;
$guard$;

-- ─── 4. Damaged-goods write-offs (inventory module) ─────────────────────────

DO $guard$
BEGIN
  IF to_regclass('public.inventory_writeoffs') IS NULL THEN
    RETURN;
  END IF;

  -- Takes every line of a write-off out of the document warehouse; one stock movement per line.
  EXECUTE $fn$
  CREATE OR REPLACE FUNCTION public._inventory_writeoff_apply(p_id uuid, p_doc_no text, p_warehouse_id uuid, p_items jsonb)
   RETURNS void
   LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path TO 'public'
  AS $function$
  DECLARE
    v_item JSONB;
    v_product UUID;
    v_qty NUMERIC;
    v_line UUID;
  BEGIN
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
      v_product := NULLIF(v_item->>'product_id', '')::uuid;
      v_qty := COALESCE(NULLIF(v_item->>'quantity', '')::numeric, 0);
      IF v_product IS NULL OR v_qty <= 0 THEN
        CONTINUE;
      END IF;
      PERFORM public.stock_move(v_product, p_warehouse_id, -v_qty, true);
      v_line := CASE WHEN COALESCE(v_item->>'id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                     THEN (v_item->>'id')::uuid END;
      INSERT INTO public.stock_movements (
        product_id, warehouse_id, movement_type, quantity, unit,
        reference_type, reference_id, source_line_id, description, created_by
      ) VALUES (
        v_product, p_warehouse_id, 'out', v_qty, COALESCE(NULLIF(v_item->>'unit', ''), 'Ədəd'),
        'writeoff', p_id, v_line, 'Zədələnmiş mal — ' || COALESCE(p_doc_no, ''), auth.uid()
      );
    END LOOP;
  END;
  $function$;
  $fn$;

  -- The same checks as the form: a warehouse, at least one product, a description per line.
  EXECUTE $fn$
  CREATE OR REPLACE FUNCTION public._inventory_writeoff_lines(p_payload jsonb)
   RETURNS jsonb
   LANGUAGE plpgsql
   STABLE
   SET search_path TO 'public'
  AS $function$
  DECLARE
    v_items JSONB;
    v_item JSONB;
  BEGIN
    IF NULLIF(p_payload->>'warehouse_id', '') IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Anbar seçilməlidir';
    END IF;
    SELECT COALESCE(jsonb_agg(value), '[]'::jsonb) INTO v_items
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_payload->'items') = 'array' THEN p_payload->'items' ELSE '[]'::jsonb END)
    WHERE NULLIF(value->>'product_id', '') IS NOT NULL AND COALESCE(NULLIF(value->>'quantity', '')::numeric, 0) > 0;
    IF jsonb_array_length(v_items) = 0 THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Ən azı bir məhsul əlavə edin';
    END IF;
    FOR v_item IN SELECT value FROM jsonb_array_elements(v_items) LOOP
      IF NULLIF(trim(COALESCE(v_item->>'issue_description', '')), '') IS NULL THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
          MESSAGE = format('"%s" üçün problem təsviri daxil edin', COALESCE(v_item->>'product_name', ''));
      END IF;
    END LOOP;
    RETURN v_items;
  END;
  $function$;
  $fn$;

  EXECUTE $fn$
  -- Records a damaged-goods write-off and takes its lines out of the document warehouse.
  CREATE OR REPLACE FUNCTION public.post_inventory_writeoff(p_payload jsonb)
   RETURNS jsonb
   LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path TO 'public'
  AS $function$
  DECLARE
    v_items JSONB;
    v_id UUID;
    v_wh UUID;
  BEGIN
    IF NOT public.require_permission('can_writeoff_inventory') THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Silinmə üçün icazəniz yoxdur';
    END IF;
    v_items := public._inventory_writeoff_lines(p_payload);
    v_wh := (p_payload->>'warehouse_id')::uuid;

    INSERT INTO public.inventory_writeoffs (document_number, writeoff_date, warehouse_id, checker_name, items, notes)
    VALUES (
      p_payload->>'document_number',
      COALESCE(NULLIF(p_payload->>'writeoff_date', '')::date, CURRENT_DATE),
      v_wh,
      COALESCE(trim(p_payload->>'checker_name'), ''),
      v_items,
      NULLIF(trim(COALESCE(p_payload->>'notes', '')), '')
    )
    RETURNING id INTO v_id;

    PERFORM public._inventory_writeoff_apply(v_id, p_payload->>'document_number', v_wh, v_items);
    RETURN jsonb_build_object('success', true, 'id', v_id);
  END;
  $function$;
  $fn$;

  EXECUTE $fn$
  -- Changes a write-off: the old lines go back to the OLD warehouse, the new lines come out of
  -- the NEW one, so changing the warehouse moves the stock. The movements are replaced.
  CREATE OR REPLACE FUNCTION public.update_inventory_writeoff(p_id uuid, p_payload jsonb)
   RETURNS jsonb
   LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path TO 'public'
  AS $function$
  DECLARE
    v_doc public.inventory_writeoffs%ROWTYPE;
    v_items JSONB;
    v_item JSONB;
    v_wh UUID;
  BEGIN
    IF NOT public.require_permission('can_writeoff_inventory') THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Silinmə üçün icazəniz yoxdur';
    END IF;
    SELECT * INTO v_doc FROM public.inventory_writeoffs WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Silinmə sənədi tapılmadı';
    END IF;
    v_items := public._inventory_writeoff_lines(p_payload);
    v_wh := (p_payload->>'warehouse_id')::uuid;

    FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(v_doc.items, '[]'::jsonb)) LOOP
      IF NULLIF(v_item->>'product_id', '') IS NOT NULL AND COALESCE(NULLIF(v_item->>'quantity', '')::numeric, 0) > 0 THEN
        PERFORM public.stock_move((v_item->>'product_id')::uuid, v_doc.warehouse_id, (v_item->>'quantity')::numeric, false);
      END IF;
    END LOOP;
    DELETE FROM public.stock_movements WHERE reference_type = 'writeoff' AND reference_id = p_id;

    UPDATE public.inventory_writeoffs
    SET writeoff_date = COALESCE(NULLIF(p_payload->>'writeoff_date', '')::date, writeoff_date),
        warehouse_id = v_wh,
        checker_name = COALESCE(trim(p_payload->>'checker_name'), checker_name),
        items = v_items,
        notes = NULLIF(trim(COALESCE(p_payload->>'notes', '')), '')
    WHERE id = p_id;

    PERFORM public._inventory_writeoff_apply(p_id, v_doc.document_number, v_wh, v_items);
    RETURN jsonb_build_object('success', true, 'id', p_id);
  END;
  $function$;
  $fn$;

  EXECUTE 'REVOKE ALL ON FUNCTION public._inventory_writeoff_apply(uuid, text, uuid, jsonb) FROM PUBLIC, anon, authenticated';
  EXECUTE 'REVOKE ALL ON FUNCTION public.post_inventory_writeoff(jsonb) FROM PUBLIC, anon';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.post_inventory_writeoff(jsonb) TO authenticated, service_role';
  EXECUTE 'REVOKE ALL ON FUNCTION public.update_inventory_writeoff(uuid, jsonb) FROM PUBLIC, anon';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.update_inventory_writeoff(uuid, jsonb) TO authenticated, service_role';
END;
$guard$;

-- ─── 5. Production (module) ─────────────────────────────────────────────────

DO $guard$
BEGIN
  IF to_regclass('public.production_orders') IS NULL OR to_regclass('public.production_materials') IS NULL THEN
    RETURN;
  END IF;

  EXECUTE $fn$
CREATE OR REPLACE FUNCTION public.create_production_warehouse_slip(p_order_id uuid, p_slip_type text, p_warehouse_id uuid, p_warehouse_name text, p_items jsonb, p_notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    p_slip_type::public.slip_type,
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
$function$;
  $fn$;
  EXECUTE $fn$
CREATE OR REPLACE FUNCTION public.process_production_material_issue_event(p_order_id uuid, p_material_ids uuid[] DEFAULT NULL::uuid[], p_update_status boolean DEFAULT NULL::boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_wh UUID;
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
      -- Out of the material's own warehouse (fix F3): material line, then the order's
      -- raw-material warehouse, then the order warehouse, then the default warehouse.
      v_wh := COALESCE(v_material.warehouse_id, v_order.raw_material_warehouse_id, v_order.warehouse_id,
                       public.stock_default_warehouse());
      PERFORM public.stock_move(v_material.product_id, v_wh, -COALESCE(v_material.quantity, 0), true);

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
        v_wh,
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
$function$;
  $fn$;
  EXECUTE $fn$
CREATE OR REPLACE FUNCTION public.process_production_ready_event(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- Into the furniture warehouse, else the order warehouse, else the default (fix F3).
  PERFORM public.stock_move(v_order.finished_product_id,
    COALESCE(v_order.furniture_warehouse_id, v_order.warehouse_id), v_qty, false);
  INSERT INTO stock_movements (
    product_id, warehouse_id, movement_type, quantity, unit,
    reference_type, reference_id, description, created_by
  ) VALUES (
    v_order.finished_product_id,
    COALESCE(v_order.furniture_warehouse_id, v_order.warehouse_id, public.stock_default_warehouse()),
    'in', v_qty, COALESCE((SELECT unit FROM products WHERE id = v_order.finished_product_id), 'Ədəd'),
    'production', p_order_id, 'Hazır məhsul — ' || COALESCE(v_order.order_no, ''), auth.uid()
  );

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
$function$;
  $fn$;
  EXECUTE $fn$
CREATE OR REPLACE FUNCTION public.process_production_delivery_event(p_order_id uuid, p_account_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
              MESSAGE = 'Hazır məhsul anbara yazılmayıb. Ævvəlcə «Hazır» statusuna keçin.';
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
        COALESCE(v_product_unit, 'Ædəd'),
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

    -- Out of the warehouse the finished goods went into (fix F3).
    PERFORM public.stock_move(v_product_id, COALESCE(v_order.furniture_warehouse_id, v_order.warehouse_id), -v_qty, true);

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
      v_product_unit := 'Ædəd';

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
    -- Make-to-order: in and out on the same warehouse (fix F3).
    PERFORM public.stock_move(v_product_id, COALESCE(v_order.furniture_warehouse_id, v_order.warehouse_id), v_qty, false);

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
      COALESCE(v_product_unit, 'Ædəd'),
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

    PERFORM public.stock_move(v_product_id, COALESCE(v_order.furniture_warehouse_id, v_order.warehouse_id), -v_qty, true);

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
$function$;
  $fn$;

  EXECUTE $fn$
  -- Gives an issued material back to the warehouse it came from (material, then the order's
  -- raw-material warehouse, then the order warehouse, then default). Removing a material or
  -- deleting an order calls it (src/modules/production/actions/production.ts).
  CREATE OR REPLACE FUNCTION public.return_production_material_stock(p_material_id uuid)
   RETURNS numeric
   LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path TO 'public'
  AS $function$
  DECLARE
    v_m RECORD;
    v_wh UUID;
  BEGIN
    IF auth.uid() IS NOT NULL AND NOT public.user_has_permission('can_manage_production') THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'İcazəniz yoxdur';
    END IF;
    SELECT pm.*, o.raw_material_warehouse_id, o.warehouse_id AS order_warehouse_id, o.order_no, p.inventory_mode
    INTO v_m
    FROM public.production_materials pm
    JOIN public.production_orders o ON o.id = pm.production_order_id
    LEFT JOIN public.products p ON p.id = pm.product_id
    WHERE pm.id = p_material_id;
    IF NOT FOUND OR v_m.product_id IS NULL OR NOT COALESCE(v_m.issued, false)
       OR v_m.inventory_mode = 'polywood' OR COALESCE(v_m.quantity, 0) <= 0 THEN
      RETURN NULL;
    END IF;
    v_wh := COALESCE(v_m.warehouse_id, v_m.raw_material_warehouse_id, v_m.order_warehouse_id);
    INSERT INTO public.stock_movements (
      product_id, warehouse_id, movement_type, quantity, unit,
      reference_type, reference_id, source_line_id, description, created_by
    ) VALUES (
      v_m.product_id, COALESCE(v_wh, public.stock_default_warehouse()), 'in', v_m.quantity, COALESCE(v_m.unit, 'Ədəd'),
      'production', v_m.production_order_id, v_m.id, 'İstehsalat materialı geri qaytarıldı — ' || COALESCE(v_m.order_no, ''), auth.uid()
    );
    RETURN public.stock_move(v_m.product_id, v_wh, v_m.quantity, false);
  END;
  $function$;
  $fn$;

  EXECUTE 'REVOKE ALL ON FUNCTION public.return_production_material_stock(uuid) FROM PUBLIC, anon';
  EXECUTE 'GRANT EXECUTE ON FUNCTION public.return_production_material_stock(uuid) TO authenticated, service_role';
END;
$guard$;

-- ─── 6. Purchases (module): into the purchase warehouse, back out of it ─────

DO $guard$
BEGIN
  IF to_regprocedure('public.post_purchase_invoice_draft(uuid)') IS NULL
     OR to_regclass('public.purchase_items') IS NULL THEN
    RETURN;
  END IF;

  EXECUTE $fn$
CREATE OR REPLACE FUNCTION public.post_purchase_invoice_draft(p_purchase_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_purchase RECORD;
  v_item RECORD;
  v_pay JSONB;
  v_product_id UUID;
  v_qty NUMERIC;
  v_unit_price NUMERIC;
  v_stock NUMERIC;
  v_account_id UUID;
  v_pay_amount NUMERIC;
  v_account_name TEXT;
  v_pay_note TEXT;
  v_stock_demand JSONB := '{}'::jsonb;
  v_price_map JSONB := '{}'::jsonb;
  v_key TEXT;
  v_journal_id UUID;
  v_add_exp_total NUMERIC;
  v_idempotency TEXT;
  v_result JSONB;
  v_event_id UUID;
  v_pay_date DATE;
BEGIN
  IF p_purchase_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload'
      USING ERRCODE = '22023',
            MESSAGE = 'Alış ID göndərilməyib';
  END IF;

  IF NOT (
    public.require_permission('can_edit_purchases')
    OR public.require_permission('can_create_purchase')
    OR public.require_permission('can_manage_finance')
  ) THEN
    RAISE EXCEPTION 'forbidden'
      USING ERRCODE = '42501',
            MESSAGE = 'Alış təsdiqləmək üçün icazəniz yoxdur';
  END IF;

  SELECT * INTO v_purchase FROM purchases WHERE id = p_purchase_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'purchase_not_found'
      USING ERRCODE = 'P0002',
            MESSAGE = 'Alış sənədi tapılmadı';
  END IF;

  -- Every record of this posting carries the invoice date (fix F1).
  PERFORM public.use_document_date(v_purchase.doc_date);

  IF v_purchase.status = 'posted' THEN
    RAISE EXCEPTION 'already_posted'
      USING ERRCODE = '22023',
            MESSAGE = 'Sənəd artıq təsdiqlənib';
  END IF;

  IF v_purchase.status IN ('cancelled', 'void', 'voided') THEN
    RAISE EXCEPTION 'cancelled_document'
      USING ERRCODE = '22023',
            MESSAGE = 'Ləğv edilmiş sənəd təsdiqlənə bilməz';
  END IF;

  IF COALESCE(v_purchase.total_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'invalid_total_amount'
      USING ERRCODE = '22023',
            MESSAGE = 'Alış məbləği sıfırdan böyük olmalıdır';
  END IF;

  IF COALESCE(v_purchase.paid_amount, 0) > COALESCE(v_purchase.total_amount, 0) + 0.0001 THEN
    RAISE EXCEPTION 'overpaid'
      USING ERRCODE = '22023',
            MESSAGE = 'Ödənilən məbləğ ümumi məbləğdən böyük ola bilməz';
  END IF;

  FOR v_item IN
    SELECT product_id, quantity, unit_price
    FROM purchase_items
    WHERE purchase_id = p_purchase_id
  LOOP
    v_product_id := v_item.product_id;
    v_qty := COALESCE(v_item.quantity, 0);
    v_unit_price := COALESCE(v_item.unit_price, 0);

    IF v_product_id IS NULL OR v_qty <= 0 OR v_unit_price <= 0 THEN
      RAISE EXCEPTION 'invalid_item'
        USING ERRCODE = '22023',
              MESSAGE = 'Hər sətirdə məhsul, miqdar və qiymət tələb olunur';
    END IF;

    v_key := v_product_id::text;
    v_stock_demand := jsonb_set(
      v_stock_demand,
      ARRAY[v_key],
      to_jsonb(COALESCE((v_stock_demand->>v_key)::numeric, 0) + v_qty),
      true
    );
    v_price_map := jsonb_set(v_price_map, ARRAY[v_key], to_jsonb(v_unit_price), true);
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM jsonb_object_keys(v_stock_demand)) THEN
    RAISE EXCEPTION 'items_required'
      USING ERRCODE = '22023',
            MESSAGE = 'Ən azı bir məhsul tələb olunur';
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(v_stock_demand)
  LOOP
    PERFORM id FROM products WHERE id = v_key::uuid;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'product_not_found'
        USING ERRCODE = 'P0002',
              MESSAGE = 'Məhsul tapılmadı: ' || v_key;
    END IF;
  END LOOP;

  IF jsonb_typeof(v_purchase.payments) = 'array' THEN
    FOR v_pay IN SELECT value FROM jsonb_array_elements(v_purchase.payments)
    LOOP
      v_pay_amount := COALESCE(NULLIF(v_pay->>'amount', '')::numeric, 0);
      IF v_pay_amount <= 0 THEN
        CONTINUE;
      END IF;

      v_account_id := NULLIF(v_pay->>'account_id', '')::uuid;
      IF v_account_id IS NULL THEN
        RAISE EXCEPTION 'account_required'
          USING ERRCODE = '22023',
                MESSAGE = 'Ödəniş üçün kassa/bank hesabı seçilməlidir';
      END IF;

      PERFORM id FROM accounts WHERE id = v_account_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'account_not_found'
          USING ERRCODE = 'P0002',
                MESSAGE = 'Seçilmiş kassa/bank hesabı tapılmadı';
      END IF;
    END LOOP;
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(v_stock_demand)
  LOOP
    v_product_id := v_key::uuid;
    v_qty := COALESCE((v_stock_demand->>v_key)::numeric, 0);
    v_unit_price := COALESCE((v_price_map->>v_key)::numeric, 0);

    SELECT stock INTO v_stock
    FROM products
    WHERE id = v_product_id
    FOR UPDATE;

    -- Into the purchase warehouse (fix F3); the buy price as before.
    PERFORM public._stock_move_doc(v_product_id, v_purchase.warehouse_id, v_qty, false);
    UPDATE products SET buy_price = v_unit_price WHERE id = v_product_id;

    PERFORM public.create_inventory_batch(
      v_product_id,
      p_purchase_id,
      'purchase',
      v_unit_price,
      v_qty
    );
  END LOOP;

  IF jsonb_typeof(v_purchase.payments) = 'array' THEN
    FOR v_pay IN SELECT value FROM jsonb_array_elements(v_purchase.payments)
    LOOP
      v_pay_amount := COALESCE(NULLIF(v_pay->>'amount', '')::numeric, 0);
      IF v_pay_amount <= 0 THEN
        CONTINUE;
      END IF;

      -- An admin amendment keeps the payments already booked (fix F1).
      IF public.invoice_amend_in_progress() THEN
        CONTINUE;
      END IF;

      v_account_id := NULLIF(v_pay->>'account_id', '')::uuid;
      v_pay_date := public.invoice_payment_date(v_pay, v_purchase.doc_date);
      PERFORM public.use_document_date(v_pay_date);

      SELECT name INTO v_account_name
      FROM accounts
      WHERE id = v_account_id;

      v_pay_note := COALESCE(
        NULLIF(trim(v_pay->>'note'), ''),
        format('Alış fakturası %s', v_purchase.invoice_number)
      );
      IF NULLIF(trim(v_pay->>'payment_date'), '') IS NOT NULL THEN
        v_pay_note := trim(v_pay->>'payment_date') || ' — ' || v_pay_note;
      END IF;
      IF v_account_name IS NOT NULL THEN
        v_pay_note := v_pay_note || ' — ' || v_account_name;
      END IF;

      PERFORM public.post_cash_transaction(
        v_account_id,
        'Məxaric',
        v_pay_amount,
        'Alış Ödənişi',
        v_pay_note,
        NULL,
        'purchase',
        p_purchase_id
      );
      PERFORM public.use_document_date(v_purchase.doc_date);
    END LOOP;
  END IF;

  v_add_exp_total := public.apply_document_additional_expenses(
    COALESCE(v_purchase.additional_expenses, '[]'::jsonb),
    'purchase',
    p_purchase_id,
    v_purchase.invoice_number
  );

  v_idempotency := 'purchase_receipt:' || p_purchase_id::text || public.invoice_revision_suffix(v_purchase.amend_revision);

  v_journal_id := public.post_purchase_bill_gl_journal(
    p_purchase_id,
    v_purchase.invoice_number,
    v_purchase.total_amount,
    v_purchase.supplier_id,
    v_idempotency
  );

  PERFORM public.refresh_supplier_ap_balance(v_purchase.supplier_id);

  UPDATE purchases
  SET status = 'posted',
      posted_at = NOW(),
      additional_expenses_total = v_add_exp_total
  WHERE id = p_purchase_id;

  PERFORM public.use_document_date(NULL);

  v_result := jsonb_build_object(
    'success', true,
    'event_type', 'purchase_invoice_post',
    'purchase_id', p_purchase_id,
    'invoice_number', v_purchase.invoice_number,
    'status', 'posted',
    'journal_entry_id', v_journal_id,
    'total_amount', v_purchase.total_amount,
    'paid_amount', v_purchase.paid_amount,
    'debt_amount', v_purchase.debt_amount
  );

  v_event_id := public.log_erp_event(
    'purchase_receipt',
    'purchases',
    p_purchase_id,
    jsonb_build_object('purchase_id', p_purchase_id, 'posted_from', 'draft'),
    v_journal_id,
    v_idempotency,
    v_result
  );

  RETURN v_result || jsonb_build_object('event_id', v_event_id);
END;
$function$;
  $fn$;
  EXECUTE $fn$
CREATE OR REPLACE FUNCTION public.process_purchase_receipt_event(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_doc_date DATE;
  v_pay_date DATE;
  v_idempotency TEXT;
  v_cached JSONB;
  v_header JSONB;
  v_items JSONB;
  v_payments JSONB;
  v_supplier_id UUID;
  v_purchase_id UUID;
  v_invoice_number TEXT;
  v_total_amount NUMERIC;
  v_paid_amount NUMERIC;
  v_debt_amount NUMERIC;
  v_item JSONB;
  v_pay JSONB;
  v_product_id UUID;
  v_qty NUMERIC;
  v_unit_price NUMERIC;
  v_stock NUMERIC;
  v_account_id UUID;
  v_pay_amount NUMERIC;
  v_account_name TEXT;
  v_pay_note TEXT;
  v_stock_demand JSONB := '{}'::jsonb;
  v_price_map JSONB := '{}'::jsonb;
  v_key TEXT;
  v_journal_id UUID;
  v_event_id UUID;
  v_result JSONB;
  v_add_exp_total NUMERIC;
BEGIN
  IF p_payload IS NULL THEN
    RAISE EXCEPTION 'invalid_payload'
      USING ERRCODE = '22023',
            MESSAGE = 'Alış event payload göndərilməyib';
  END IF;

  v_idempotency := NULLIF(trim(p_payload->>'idempotency_key'), '');
  IF v_idempotency IS NOT NULL THEN
    v_cached := public.find_erp_event_by_idempotency(v_idempotency);
    IF v_cached IS NOT NULL THEN
      RETURN v_cached->'result';
    END IF;
  END IF;

  IF NOT (
    public.require_permission('can_edit_purchases')
    OR public.require_permission('can_create_purchase')
    OR public.require_permission('can_manage_finance')
  ) THEN
    RAISE EXCEPTION 'forbidden'
      USING ERRCODE = '42501',
            MESSAGE = 'Alış yaratmaq üçün icazəniz yoxdur';
  END IF;

  v_header := COALESCE(p_payload->'header', '{}'::jsonb);
  v_items := COALESCE(p_payload->'items', '[]'::jsonb);
  v_payments := COALESCE(p_payload->'payments', '[]'::jsonb);

  IF jsonb_typeof(v_items) <> 'array' OR jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'items_required'
      USING ERRCODE = '22023',
            MESSAGE = 'Æn azı bir məhsul tələb olunur';
  END IF;

  v_supplier_id := NULLIF(v_header->>'supplier_id', '')::uuid;
  IF v_supplier_id IS NULL THEN
    RAISE EXCEPTION 'supplier_required'
      USING ERRCODE = '22023',
            MESSAGE = 'Təchizatçı seçilməlidir';
  END IF;

  PERFORM id FROM suppliers WHERE id = v_supplier_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'supplier_not_found'
      USING ERRCODE = 'P0002',
            MESSAGE = 'Təchizatçı tapılmadı';
  END IF;

  v_total_amount := COALESCE(NULLIF(v_header->>'total_amount', '')::numeric, 0);
  v_paid_amount := COALESCE(NULLIF(v_header->>'paid_amount', '')::numeric, 0);
  v_debt_amount := COALESCE(
    NULLIF(v_header->>'debt_amount', '')::numeric,
    GREATEST(v_total_amount - v_paid_amount, 0)
  );

  IF v_total_amount <= 0 THEN
    RAISE EXCEPTION 'invalid_total_amount'
      USING ERRCODE = '22023',
            MESSAGE = 'Alış məbləği sıfırdan böyük olmalıdır';
  END IF;

  IF v_paid_amount > v_total_amount + 0.0001 THEN
    RAISE EXCEPTION 'overpaid'
      USING ERRCODE = '22023',
            MESSAGE = 'Ödənilən məbləğ ümumi məbləğdən böyük ola bilməz';
  END IF;

  IF abs((v_paid_amount + v_debt_amount) - v_total_amount) > 0.01 THEN
    RAISE EXCEPTION 'amount_mismatch'
      USING ERRCODE = '22023',
            MESSAGE = 'Ödənilən və borc məbləğlərinin cəmi ümumi məbləğə bərabər olmalıdır';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_items)
  LOOP
    v_product_id := NULLIF(v_item->>'product_id', '')::uuid;
    v_qty := COALESCE(NULLIF(v_item->>'quantity', '')::numeric, 0);
    v_unit_price := COALESCE(NULLIF(v_item->>'unit_price', '')::numeric, 0);

    IF v_product_id IS NULL OR v_qty <= 0 OR v_unit_price <= 0 THEN
      RAISE EXCEPTION 'invalid_item'
        USING ERRCODE = '22023',
              MESSAGE = 'Hər sətirdə məhsul, miqdar və qiymət tələb olunur';
    END IF;

    v_key := v_product_id::text;
    v_stock_demand := jsonb_set(
      v_stock_demand,
      ARRAY[v_key],
      to_jsonb(COALESCE((v_stock_demand->>v_key)::numeric, 0) + v_qty),
      true
    );
    v_price_map := jsonb_set(v_price_map, ARRAY[v_key], to_jsonb(v_unit_price), true);
  END LOOP;

  FOR v_key IN SELECT jsonb_object_keys(v_stock_demand)
  LOOP
    PERFORM id FROM products WHERE id = v_key::uuid;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'product_not_found'
        USING ERRCODE = 'P0002',
              MESSAGE = 'Məhsul tapılmadı: ' || v_key;
    END IF;
  END LOOP;

  IF jsonb_typeof(v_payments) = 'array' THEN
    FOR v_pay IN SELECT value FROM jsonb_array_elements(v_payments)
    LOOP
      v_pay_amount := COALESCE(NULLIF(v_pay->>'amount', '')::numeric, 0);
      IF v_pay_amount <= 0 THEN
        CONTINUE;
      END IF;

      v_account_id := NULLIF(v_pay->>'account_id', '')::uuid;
      IF v_account_id IS NULL THEN
        RAISE EXCEPTION 'account_required'
          USING ERRCODE = '22023',
                MESSAGE = 'Ödəniş üçün kassa/bank hesabı seçilməlidir';
      END IF;

      PERFORM id FROM accounts WHERE id = v_account_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'account_not_found'
          USING ERRCODE = 'P0002',
                MESSAGE = 'Seçilmiş kassa/bank hesabı tapılmadı';
      END IF;
    END LOOP;
  END IF;

  v_invoice_number := COALESCE(
    NULLIF(trim(v_header->>'invoice_number'), ''),
    NULLIF(trim(p_payload->>'invoice_number'), ''),
    'PUR-' || to_char(CURRENT_DATE, 'YYYY') || '-' || floor(10000 + random() * 90000)::int
  );

  INSERT INTO purchases (
    invoice_number, supplier_id, warehouse_id, doc_date, responsible_id, responsible_name,
    total_amount, paid_amount, debt_amount, status, notes
  )
  VALUES (
    v_invoice_number,
    v_supplier_id,
    NULLIF(v_header->>'warehouse_id', '')::uuid,
    COALESCE(NULLIF(v_header->>'doc_date', '')::date, CURRENT_DATE),
    NULLIF(v_header->>'responsible_id', '')::uuid,
    NULLIF(trim(v_header->>'responsible_name'), ''),
    v_total_amount,
    v_paid_amount,
    v_debt_amount,
    'posted',
    NULLIF(trim(v_header->>'notes'), '')
  )
  RETURNING id INTO v_purchase_id;

  -- Every record of this posting carries the invoice date (fix F1).
  v_doc_date := COALESCE(NULLIF(v_header->>'doc_date', '')::date, CURRENT_DATE);
  PERFORM public.use_document_date(v_doc_date);

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_items)
  LOOP
    INSERT INTO purchase_items (
      purchase_id, product_id, product_code, product_name, quantity, unit, unit_price, total_price
    )
    VALUES (
      v_purchase_id,
      NULLIF(v_item->>'product_id', '')::uuid,
      NULLIF(trim(v_item->>'product_code'), ''),
      NULLIF(trim(v_item->>'product_name'), ''),
      COALESCE(NULLIF(v_item->>'quantity', '')::numeric, 0),
      COALESCE(NULLIF(trim(v_item->>'unit'), ''), 'Ædəd'),
      COALESCE(NULLIF(v_item->>'unit_price', '')::numeric, 0),
      COALESCE(
        NULLIF(v_item->>'total_price', '')::numeric,
        NULLIF(v_item->>'total', '')::numeric,
        0
      )
    );
  END LOOP;

  FOR v_key IN SELECT jsonb_object_keys(v_stock_demand)
  LOOP
    v_product_id := v_key::uuid;
    v_qty := COALESCE((v_stock_demand->>v_key)::numeric, 0);
    v_unit_price := COALESCE((v_price_map->>v_key)::numeric, 0);

    SELECT stock INTO v_stock
    FROM products
    WHERE id = v_product_id
    FOR UPDATE;

    -- Into the purchase warehouse (fix F3); the buy price as before.
    PERFORM public._stock_move_doc(v_product_id, NULLIF(v_header->>'warehouse_id', '')::uuid, v_qty, false);
    UPDATE products SET buy_price = v_unit_price WHERE id = v_product_id;

    PERFORM public.create_inventory_batch(
      v_product_id,
      v_purchase_id,
      'purchase',
      v_unit_price,
      v_qty
    );
  END LOOP;

  IF jsonb_typeof(v_payments) = 'array' THEN
    FOR v_pay IN SELECT value FROM jsonb_array_elements(v_payments)
    LOOP
      v_pay_amount := COALESCE(NULLIF(v_pay->>'amount', '')::numeric, 0);
      IF v_pay_amount <= 0 THEN
        CONTINUE;
      END IF;

      v_account_id := NULLIF(v_pay->>'account_id', '')::uuid;
      v_pay_date := public.invoice_payment_date(v_pay, v_doc_date);
      PERFORM public.use_document_date(v_pay_date);

      SELECT name INTO v_account_name
      FROM accounts
      WHERE id = v_account_id;

      v_pay_note := COALESCE(
        NULLIF(trim(v_pay->>'note'), ''),
        format('Alış fakturası %s', v_invoice_number)
      );
      IF NULLIF(trim(v_pay->>'payment_date'), '') IS NOT NULL THEN
        v_pay_note := trim(v_pay->>'payment_date') || ' — ' || v_pay_note;
      END IF;
      IF v_account_name IS NOT NULL THEN
        v_pay_note := v_pay_note || ' — ' || v_account_name;
      END IF;

      PERFORM public.post_cash_transaction(
        v_account_id,
        'Məxaric',
        v_pay_amount,
        'Alış Ödənişi',
        v_pay_note,
        NULL,
        'purchase',
        v_purchase_id
      );
      PERFORM public.use_document_date(v_doc_date);
    END LOOP;
  END IF;

  v_add_exp_total := public.apply_document_additional_expenses(
    COALESCE(p_payload->'additional_expenses', '[]'::jsonb),
    'purchase',
    v_purchase_id,
    v_invoice_number
  );

  UPDATE purchases
  SET additional_expenses = COALESCE(p_payload->'additional_expenses', '[]'::jsonb),
      additional_expenses_total = v_add_exp_total
  WHERE id = v_purchase_id;

  v_journal_id := public.post_purchase_bill_gl_journal(
    v_purchase_id,
    v_invoice_number,
    v_total_amount,
    v_supplier_id,
    v_idempotency
  );

  PERFORM public.refresh_supplier_ap_balance(v_supplier_id);

  PERFORM public.use_document_date(NULL);

  v_result := jsonb_build_object(
    'success', true,
    'event_type', 'purchase_receipt',
    'purchase_id', v_purchase_id,
    'invoice_number', v_invoice_number,
    'journal_entry_id', v_journal_id,
    'total_amount', v_total_amount,
    'paid_amount', v_paid_amount,
    'debt_amount', v_debt_amount
  );

  v_event_id := public.log_erp_event(
    'purchase_receipt',
    'purchases',
    v_purchase_id,
    p_payload,
    v_journal_id,
    v_idempotency,
    v_result
  );

  RETURN v_result || jsonb_build_object('event_id', v_event_id);
END;
$function$;
  $fn$;
  EXECUTE $fn$
CREATE OR REPLACE FUNCTION public._reverse_purchase_invoice_posting(
  p_purchase_id uuid, p_label text, p_reason text, p_keep_cash boolean DEFAULT false
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_label    TEXT := p_label;
  v_reason   TEXT := p_reason;
  v_line     RECORD;
  v_stock    NUMERIC;
  v_cash     INTEGER := 0;
  v_journals INTEGER := 0;
BEGIN
  -- Goods from this purchase that were already sold or used cannot be unbought.
  IF EXISTS (
    SELECT 1 FROM public.inventory_batches
    WHERE document_id = p_purchase_id
      AND remaining_qty + 0.0001 < initial_qty
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = format('%s: bu alışın malının bir hissəsi artıq satılıb və ya istifadə olunub — ləğv etmək olmaz. Qaytarma sənədi ilə düzəldin.', v_label);
  END IF;

  -- 1. Stock out, per product.
  FOR v_line IN
    SELECT pi.product_id, SUM(pi.quantity) AS qty, MAX(p.name) AS product_name
    FROM public.purchase_items pi
    JOIN public.products p ON p.id = pi.product_id
    WHERE pi.purchase_id = p_purchase_id AND COALESCE(pi.quantity, 0) > 0
    GROUP BY pi.product_id
  LOOP
    SELECT stock INTO v_stock FROM public.products WHERE id = v_line.product_id FOR UPDATE;
    IF COALESCE(v_stock, 0) + 0.0001 < v_line.qty THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = format('%s: %s üçün stok kifayət etmir (lazım: %s, mövcud: %s)',
                         v_label, v_line.product_name,
                         trim(to_char(v_line.qty, 'FM999999990.00')),
                         trim(to_char(COALESCE(v_stock, 0), 'FM999999990.00')));
    END IF;
    -- Back out of the purchase warehouse; refused when that warehouse no longer has it (fix F3).
    PERFORM public._stock_move_doc(v_line.product_id,
      (SELECT warehouse_id FROM public.purchases WHERE id = p_purchase_id), -v_line.qty, true);
  END LOOP;

  -- 2. Its FIFO layers (all unconsumed, checked above).
  DELETE FROM public.inventory_batches WHERE document_id = p_purchase_id;

  -- 3. Cash paid to the supplier (and paid additional expenses) comes back.
  IF NOT p_keep_cash THEN
    v_cash := public.reverse_document_cash_transactions('purchase', p_purchase_id, v_label, v_reason);
  END IF;

  DELETE FROM public.warehouse_slips
  WHERE source_type = 'purchase' AND source_document_id = p_purchase_id;

  -- 4. Bill journal.
  v_journals := public.reverse_document_journals(p_purchase_id, v_reason);

  RETURN jsonb_build_object('cash_reversed', v_cash, 'journals_reversed', v_journals);
END;
$function$;
  $fn$;

END;
$guard$;

NOTIFY pgrst, 'reload schema';
