-- Sales invoices with a service line (Kəsim Xidməti, Kənar Bantlama Xidməti)
-- cannot be posted.
--
-- Verified on production 2026-10-05: both service products have stock 0, no
-- FIFO batch and buy_price 0. Posting treats a service line like a stock line:
--   build_and_validate_sale_stock_demand → "Stok kifayət etmir"
--   process_sale_fifo_cogs → fifo_deplete_product → insufficient_fifo_batches
-- so any invoice from the mixed dimensional form that includes cutting or edge
-- banding fails and stays a draft.
--
-- Fix: a line whose product is a service (products.is_service) has no stock
-- effect, no stock movement and no COGS. The three functions below are the
-- live versions with only that condition added.

BEGIN;

CREATE OR REPLACE FUNCTION public.build_and_validate_sale_stock_demand(p_items jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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

    -- Services carry no stock.
    IF EXISTS (SELECT 1 FROM public.products WHERE id = v_product_id AND is_service) THEN
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
$function$;

CREATE OR REPLACE FUNCTION public.process_sale_fifo_cogs(p_sale_id uuid, p_doc_no text DEFAULT NULL::text, p_idempotency text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
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
    SELECT si.id, si.product_id, si.quantity, si.polywood_sale_mode,
           COALESCE(p.is_service, false) AS is_service
    FROM public.sale_items si
    LEFT JOIN public.products p ON p.id = si.product_id
    WHERE si.sale_id = p_sale_id
    ORDER BY si.id
    FOR UPDATE OF si
  LOOP
    IF v_item.product_id IS NULL OR COALESCE(v_item.quantity, 0) <= 0 THEN
      CONTINUE;
    END IF;

    IF v_item.polywood_sale_mode IS NOT NULL THEN
      CONTINUE;
    END IF;

    -- Services have no cost layer.
    IF v_item.is_service THEN
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
$function$;

CREATE OR REPLACE FUNCTION public.handle_sales_posted_inventory()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_items JSONB := '[]'::jsonb;
  v_stock_demand JSONB := '{}'::jsonb;
  v_line RECORD;
BEGIN
  IF NEW.status IS DISTINCT FROM 'posted' THEN
    RETURN NEW;
  END IF;

  IF COALESCE(OLD.status, '') = 'posted' THEN
    RETURN NEW;
  END IF;

  IF OLD.inventory_deducted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'product_id', si.product_id,
        'quantity', si.quantity,
        'warehouse_id', si.warehouse_id,
        'polywood_sale_mode', si.polywood_sale_mode,
        'polywood_length_m', si.polywood_length_m,
        'skip_stock', (si.polywood_sale_mode IS NOT NULL AND btrim(si.polywood_sale_mode) <> '')
      )
      ORDER BY si.id
    ),
    '[]'::jsonb
  )
  INTO v_items
  FROM public.sale_items si
  WHERE si.sale_id = NEW.id;

  IF jsonb_array_length(v_items) = 0 THEN
    RETURN NEW;
  END IF;

  v_stock_demand := public.build_and_validate_sale_stock_demand(v_items);
  PERFORM public.apply_sale_stock_decrement(v_stock_demand);

  FOR v_line IN
    SELECT
      si.id,
      si.product_id,
      si.quantity,
      si.warehouse_id,
      si.unit,
      p.name AS product_name
    FROM public.sale_items si
    LEFT JOIN public.products p ON p.id = si.product_id
    WHERE si.sale_id = NEW.id
      AND si.product_id IS NOT NULL
      AND COALESCE(si.quantity, 0) > 0
      AND (si.polywood_sale_mode IS NULL OR btrim(si.polywood_sale_mode) = '')
      AND NOT COALESCE(p.is_service, false)
  LOOP
    INSERT INTO public.stock_movements (
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
      v_line.product_id,
      v_line.warehouse_id,
      'out',
      v_line.quantity,
      COALESCE(v_line.unit, 'Ədəd'),
      'sale',
      NEW.id,
      v_line.id,
      format('Satış fakturası %s — %s', COALESCE(NEW.doc_no, NEW.id::text), COALESCE(v_line.product_name, '')),
      auth.uid()
    );
  END LOOP;

  NEW.inventory_deducted_at := NOW();
  RETURN NEW;
END;
$function$;

COMMIT;

NOTIFY pgrst, 'reload schema';
