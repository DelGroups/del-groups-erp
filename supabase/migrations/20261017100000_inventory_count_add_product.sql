-- Inventory count: add a product to an open count by hand.
--
-- inventory_count_start only lists products that have stock in the warehouse,
-- so a product whose book stock is 0 (e.g. a polywood sheet with no available
-- pieces) never gets a line. Scanning its product code does not help either:
-- polywood products only accept piece barcodes. This function lets the counter
-- add any stockable product to an in-progress count, with its current book qty
-- (usually 0), so the quantity found on the shelf can be entered.

-- Module tables (inventory, polywood): only when those modules are installed (supabase/modules).
DO $guard$
BEGIN
  IF to_regclass('public.inventory_count_items') IS NOT NULL
     AND to_regclass('public.inventory_counts') IS NOT NULL
     AND to_regclass('public.polywood_pieces') IS NOT NULL THEN
    EXECUTE $fn$
    CREATE OR REPLACE FUNCTION public.inventory_count_add_product(
      p_count_id   UUID,
      p_product_id UUID
    )
    RETURNS JSONB
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
    AS $body$
    DECLARE
      v_doc     public.inventory_counts;
      v_product public.products;
      v_line_id UUID;
      v_metric  BOOLEAN;
    BEGIN
      PERFORM public._inventory_count_authorize('can_writeoff_inventory');
      v_doc := public._inventory_count_lock(p_count_id, ARRAY['in_progress']);

      SELECT * INTO v_product FROM public.products WHERE id = p_product_id;
      IF v_product.id IS NULL THEN
        RAISE EXCEPTION '%', 'Məhsul tapılmadı' USING ERRCODE = 'P0002';
      END IF;
      IF COALESCE(v_product.is_service, FALSE) OR COALESCE(v_product.is_composite, FALSE) THEN
        RAISE EXCEPTION '%', format('«%s» anbarda sayılmır (xidmət/komplekt)', v_product.name) USING ERRCODE = '22023';
      END IF;

      -- Already in the list: return the existing line instead of a duplicate.
      SELECT id INTO v_line_id FROM public.inventory_count_items
      WHERE count_id = v_doc.id AND product_id = v_product.id;
      IF v_line_id IS NOT NULL THEN
        RETURN jsonb_build_object('line_id', v_line_id, 'added', FALSE);
      END IF;

      v_metric := v_product.inventory_mode = 'polywood';

      INSERT INTO public.inventory_count_items (
        count_id, line_no, product_id, product_code, product_name, unit, barcode,
        is_metric, full_sheet_length_m, expected_qty, expected_full_sheets, expected_cut_pieces, unit_cost
      )
      VALUES (
        v_doc.id,
        COALESCE((SELECT MAX(line_no) FROM public.inventory_count_items WHERE count_id = v_doc.id), 0) + 1,
        v_product.id, v_product.code, v_product.name,
        CASE WHEN v_metric THEN 'Metr' ELSE COALESCE(v_product.unit, 'Ədəd') END,
        v_product.barcode, v_metric,
        CASE WHEN v_metric THEN COALESCE(NULLIF(v_product.full_sheet_length_m, 0), 4) END,
        public.inventory_count_book_qty(v_product.id, v_doc.warehouse_id),
        CASE WHEN v_metric THEN (
          SELECT COUNT(*)::int FROM public.polywood_pieces pp
          WHERE pp.product_id = v_product.id AND pp.warehouse_id = v_doc.warehouse_id
            AND pp.status = 'available' AND pp.piece_type = 'full'
        ) END,
        CASE WHEN v_metric THEN (
          SELECT COALESCE(jsonb_agg(pp.length_m ORDER BY pp.length_m DESC), '[]'::jsonb)
          FROM public.polywood_pieces pp
          WHERE pp.product_id = v_product.id AND pp.warehouse_id = v_doc.warehouse_id
            AND pp.status = 'available' AND pp.piece_type = 'cut'
        ) END,
        public.inventory_count_unit_cost(v_product.id)
      )
      RETURNING id INTO v_line_id;

      PERFORM public.inventory_count_refresh_totals(v_doc.id);
      RETURN jsonb_build_object('line_id', v_line_id, 'added', TRUE);
    END;
    $body$
    $fn$;

    EXECUTE 'REVOKE ALL ON FUNCTION public.inventory_count_add_product(UUID, UUID) FROM PUBLIC, anon';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.inventory_count_add_product(UUID, UUID) TO authenticated, service_role';
  END IF;
END;
$guard$;

NOTIFY pgrst, 'reload schema';
