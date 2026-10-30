-- ============================================================================
-- Duplicate product names (fix prompt F4).
--
-- The database refuses a second product with the same code or barcode, but not
-- with the same name. Production has stockable products registered twice under
-- one name with different codes (for example "Konik bar": KON-S and "Konik bar");
-- the second row of each pair looks like an import that put the name into the
-- code column. If both rows are the same real item, its stock is counted twice.
--
-- stock_integrity_report() gets a new kind, duplicate_name:
--   - match on lower(btrim(name)), as duplicate_code does for codes;
--   - stockable products only (not services, not composites);
--   - products have no active / archived flag yet, so every product counts;
--   - never fixable: stock_integrity_fix() keeps refusing every kind except its
--     four safe ones, and a person decides which row is the real one;
--   - details = 'name = <normalised name>' (the group), stock_before = the
--     product's stock, so the page can list each group with code and stock.
--
-- The same name can be legitimate, so there is no unique constraint on name.
-- create or replace only, the rest of the function is unchanged from
-- 20261028181000_product_stock_integrity.sql; no data changes. Safe to re-run.
-- ============================================================================

-- The checks of supabase/scripts/product_integrity_check.sql, one row per
-- product and issue. fixable = stock_integrity_fix() can correct it safely;
-- stock_before / stock_after show what a fix would write.
CREATE OR REPLACE FUNCTION public.stock_integrity_report()
RETURNS TABLE (
  issue        TEXT,
  product_id   UUID,
  product_code TEXT,
  product_name TEXT,
  details      TEXT,
  fixable      BOOLEAN,
  stock_before NUMERIC,
  stock_after  NUMERIC
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._stock_integrity_authorize();

  RETURN QUERY
  WITH
  default_wh AS (SELECT public.stock_default_warehouse() AS id),
  ws AS (
    SELECT
      w.product_id,
      COUNT(*)                                       AS n_rows,
      COUNT(*) FILTER (WHERE w.warehouse_id IS NULL) AS null_rows,
      COALESCE(SUM(w.current_stock), 0)              AS total,
      COALESCE(SUM(w.current_stock) FILTER (WHERE w.warehouse_id IS NULL), 0) AS null_total
    FROM public.warehouse_stocks w
    GROUP BY w.product_id
  ),
  pieces AS (
    SELECT pp.product_id, ROUND(COALESCE(SUM(pp.length_m), 0), 3) AS metres, COUNT(*) AS n
    FROM public.polywood_pieces pp
    WHERE pp.status = 'available'
    GROUP BY pp.product_id
  ),
  p AS (
    SELECT
      pr.id, pr.code, pr.name, pr.stock, pr.category, pr.category_id, pr.subcategory, pr.sub_category_id, pr.barcode,
      COALESCE(pr.is_service, FALSE)   AS svc,
      COALESCE(pr.is_composite, FALSE) AS comp,
      pr.inventory_mode = 'polywood'   AS metric
    FROM public.products pr
  ),
  same_name AS (
    SELECT p.id, p.stock, lower(btrim(p.name)) AS name_key,
           COUNT(*) OVER (PARTITION BY lower(btrim(p.name))) AS n_same
    FROM p
    WHERE NOT p.svc AND NOT p.comp
      AND NULLIF(btrim(COALESCE(p.name, '')), '') IS NOT NULL
  ),
  issues AS (
    SELECT p.id, 'service_or_composite'::text AS issue,
           CASE WHEN p.svc THEN 'service' ELSE 'composite' END AS details,
           FALSE AS fixable, NULL::numeric AS before, NULL::numeric AS after
    FROM p WHERE p.svc OR p.comp

    UNION ALL
    SELECT p.id, 'no_stock_row', 'products.stock = ' || COALESCE(p.stock, 0), FALSE, NULL, NULL
    FROM p LEFT JOIN ws ON ws.product_id = p.id
    WHERE NOT p.svc AND NOT p.comp AND NOT p.metric AND ws.product_id IS NULL

    UNION ALL
    SELECT p.id,
           CASE WHEN (SELECT id FROM default_wh) IS NOT NULL THEN 'null_warehouse_row' ELSE 'null_row_no_default' END,
           'stock without warehouse = ' || ws.null_total,
           (SELECT id FROM default_wh) IS NOT NULL, NULL, NULL
    FROM p JOIN ws ON ws.product_id = p.id
    WHERE NOT p.svc AND NOT p.comp AND NOT p.metric AND ws.null_rows > 0

    UNION ALL
    SELECT p.id, 'total_mismatch',
           format('products.stock = %s, warehouses sum = %s', COALESCE(p.stock, 0), ws.total),
           TRUE, COALESCE(p.stock, 0), ws.total
    FROM p JOIN ws ON ws.product_id = p.id
    WHERE NOT p.svc AND NOT p.comp AND NOT p.metric
      AND abs(COALESCE(p.stock, 0) - ws.total) > 0.0005
      AND EXISTS (SELECT 1 FROM public.warehouse_stocks w WHERE w.product_id = p.id AND COALESCE(w.current_stock, 0) <> 0)

    UNION ALL
    SELECT p.id, 'stock_only_in_list',
           format('products.stock = %s, every warehouse row = 0', p.stock),
           TRUE, COALESCE(p.stock, 0), 0::numeric
    FROM p JOIN ws ON ws.product_id = p.id
    WHERE NOT p.svc AND NOT p.comp AND NOT p.metric
      AND COALESCE(p.stock, 0) <> 0
      AND NOT EXISTS (
        SELECT 1 FROM public.warehouse_stocks w
        WHERE w.product_id = p.id AND COALESCE(w.current_stock, 0) <> 0
      )

    UNION ALL
    SELECT p.id, 'polywood_mismatch',
           format('products.stock = %s m, available pieces = %s m', COALESCE(p.stock, 0), COALESCE(pc.metres, 0)),
           FALSE, COALESCE(p.stock, 0), pc.metres
    FROM p LEFT JOIN pieces pc ON pc.product_id = p.id
    WHERE p.metric AND NOT p.svc AND NOT p.comp
      AND COALESCE(pc.n, 0) > 0
      AND abs(COALESCE(p.stock, 0) - pc.metres) > 0.0005

    UNION ALL
    SELECT p.id, 'polywood_no_pieces', format('products.stock = %s m', p.stock), FALSE, NULL, NULL
    FROM p LEFT JOIN pieces pc ON pc.product_id = p.id
    WHERE p.metric AND NOT p.svc AND NOT p.comp
      AND COALESCE(p.stock, 0) <> 0 AND COALESCE(pc.n, 0) = 0

    UNION ALL
    SELECT p.id, 'subcategory_lost', 'sub_categories.name = ' || sc.name, TRUE, NULL, NULL
    FROM p JOIN public.sub_categories sc ON sc.id = p.sub_category_id
    WHERE NULLIF(btrim(COALESCE(p.subcategory, '')), '') IS NULL

    UNION ALL
    SELECT p.id, 'category_text_differs',
           format('category_id → %s, text = %s', COALESCE(pc.name, c.name), COALESCE(p.category, '∅')),
           FALSE, NULL, NULL
    FROM p
    JOIN public.categories c ON c.id = p.category_id
    LEFT JOIN public.categories pc ON pc.id = c.parent_id
    WHERE lower(btrim(COALESCE(pc.name, c.name))) <> lower(btrim(COALESCE(p.category, '')))

    UNION ALL
    SELECT p.id, 'no_category', '', FALSE, NULL, NULL
    FROM p
    WHERE NOT p.svc AND NOT p.comp
      AND p.category_id IS NULL
      AND NULLIF(btrim(COALESCE(p.category, '')), '') IS NULL

    UNION ALL
    SELECT p.id, 'duplicate_code', 'code = ' || p.code, FALSE, NULL, NULL
    FROM p
    WHERE p.code IS NOT NULL
      AND (SELECT COUNT(*) FROM public.products o WHERE lower(btrim(o.code)) = lower(btrim(p.code))) > 1

    UNION ALL
    SELECT p.id, 'duplicate_barcode', 'barcode = ' || p.barcode, FALSE, NULL, NULL
    FROM p
    WHERE NULLIF(btrim(COALESCE(p.barcode, '')), '') IS NOT NULL
      AND (SELECT COUNT(*) FROM public.products o WHERE btrim(o.barcode) = btrim(p.barcode)) > 1

    -- Fix F4: the same name on several stockable products (never fixed automatically).
    -- details carries the group key, stock_before the product's stock, for the page.
    UNION ALL
    SELECT n.id, 'duplicate_name', 'name = ' || n.name_key, FALSE, COALESCE(n.stock, 0), NULL
    FROM same_name n
    WHERE n.n_same > 1
  )
  SELECT i.issue, i.id, pr.code, pr.name, i.details, i.fixable, i.before, i.after
  FROM issues i
  JOIN public.products pr ON pr.id = i.id
  -- duplicate_name: the products of one name next to each other.
  ORDER BY i.issue, CASE WHEN i.issue = 'duplicate_name' THEN i.details END, pr.name, pr.code;
END;
$$;

REVOKE ALL ON FUNCTION public.stock_integrity_report() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.stock_integrity_report() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
