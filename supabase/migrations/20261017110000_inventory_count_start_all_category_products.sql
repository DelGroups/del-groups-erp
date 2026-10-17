-- Inventory count: a count started for a category lists every product of that category.
--
-- inventory_count_start took its lines from inventory_warehouse_product_ids, which
-- only returns products with stock in the warehouse. A category count therefore
-- missed products whose book stock was 0 (e.g. 401 MATT in Polywood > MATT,
-- INV-2026-0009), and the counter could not enter what was found on the shelf.
--
-- Now: with a category chosen, every stockable product of that category (not a
-- service, not a composite) gets a line, stocked or not. Without a category the
-- list stays the stocked products of the warehouse. Everything else is unchanged:
-- authorise, lock, the open-count overlap check, line numbering, refresh of totals.

-- Module tables (inventory, polywood): only when those modules are installed (supabase/modules).
DO $guard$
BEGIN
  IF to_regclass('public.inventory_count_items') IS NOT NULL
     AND to_regclass('public.inventory_counts') IS NOT NULL
     AND to_regclass('public.polywood_pieces') IS NOT NULL THEN
    EXECUTE $fn$
    CREATE OR REPLACE FUNCTION public.inventory_count_start(p_count_id UUID)
    RETURNS JSONB
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
    AS $body$
    DECLARE
      v_doc   public.inventory_counts;
      v_lines INTEGER;
    BEGIN
      PERFORM public._inventory_count_authorize('can_writeoff_inventory');
      v_doc := public._inventory_count_lock(p_count_id, ARRAY['draft']);

      -- Two open counts over the same stock would each apply their variance.
      IF EXISTS (
        SELECT 1 FROM public.inventory_counts o
        WHERE o.id <> v_doc.id
          AND o.warehouse_id = v_doc.warehouse_id
          AND o.status IN ('in_progress', 'review')
          AND (
            o.category_name IS NULL OR v_doc.category_name IS NULL
            OR (
              lower(o.category_name) = lower(v_doc.category_name)
              AND (o.subcategory_name IS NULL OR v_doc.subcategory_name IS NULL
                   OR lower(o.subcategory_name) = lower(v_doc.subcategory_name))
            )
          )
      ) THEN
        RAISE EXCEPTION '%',
          'Bu anbar (və ya kateqoriya) üzrə artıq açıq inventarizasiya var. Əvvəlcə onu tamamlayın.'
          USING ERRCODE = '22023';
      END IF;

      -- Category count: every stockable product of the chosen category path, so
      -- products with zero book stock can be counted too. Whole-warehouse count:
      -- the products present in the warehouse; other stock is added by scanning.
      WITH scope AS (
        SELECT p.id AS product_id
        FROM public.products p
        JOIN public.product_category_paths cp ON cp.product_id = p.id
        WHERE v_doc.category_name IS NOT NULL
          AND NOT COALESCE(p.is_service, FALSE)
          AND NOT COALESCE(p.is_composite, FALSE)
          AND lower(cp.category_name) = lower(v_doc.category_name)
          AND (v_doc.subcategory_name IS NULL OR lower(cp.subcategory_name) = lower(v_doc.subcategory_name))
        UNION ALL
        SELECT w.product_id
        FROM public.inventory_warehouse_product_ids(v_doc.warehouse_id) w
        WHERE v_doc.category_name IS NULL
      ),
      candidates AS (
        SELECT
          p.*,
          p.inventory_mode = 'polywood' AS metric,
          public.inventory_count_book_qty(p.id, v_doc.warehouse_id) AS book_qty
        FROM scope s
        JOIN public.products p ON p.id = s.product_id
      )
      INSERT INTO public.inventory_count_items (
        count_id, line_no, product_id, product_code, product_name, unit, barcode,
        is_metric, full_sheet_length_m, expected_qty, expected_full_sheets, expected_cut_pieces, unit_cost
      )
      SELECT
        v_doc.id,
        ROW_NUMBER() OVER (ORDER BY c.name, c.code),
        c.id, c.code, c.name,
        CASE WHEN c.metric THEN 'Metr' ELSE COALESCE(c.unit, 'Ədəd') END,
        c.barcode,
        c.metric,
        CASE WHEN c.metric THEN COALESCE(NULLIF(c.full_sheet_length_m, 0), 4) END,
        c.book_qty,
        CASE WHEN c.metric THEN (
          SELECT COUNT(*)::int FROM public.polywood_pieces pp
          WHERE pp.product_id = c.id AND pp.warehouse_id = v_doc.warehouse_id
            AND pp.status = 'available' AND pp.piece_type = 'full'
        ) END,
        CASE WHEN c.metric THEN (
          SELECT COALESCE(jsonb_agg(pp.length_m ORDER BY pp.length_m DESC), '[]'::jsonb)
          FROM public.polywood_pieces pp
          WHERE pp.product_id = c.id AND pp.warehouse_id = v_doc.warehouse_id
            AND pp.status = 'available' AND pp.piece_type = 'cut'
        ) END,
        public.inventory_count_unit_cost(c.id)
      FROM candidates c;

      GET DIAGNOSTICS v_lines = ROW_COUNT;

      UPDATE public.inventory_counts
      SET status = 'in_progress', started_at = NOW(), updated_at = NOW()
      WHERE id = v_doc.id;

      PERFORM public.inventory_count_refresh_totals(v_doc.id);
      RETURN jsonb_build_object('lines', v_lines);
    END;
    $body$
    $fn$;

    EXECUTE 'REVOKE ALL ON FUNCTION public.inventory_count_start(UUID) FROM PUBLIC, anon';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.inventory_count_start(UUID) TO authenticated, service_role';
  END IF;
END;
$guard$;

NOTIFY pgrst, 'reload schema';
