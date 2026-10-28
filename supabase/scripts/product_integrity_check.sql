-- ============================================================================
-- Product integrity check (read only).
--
-- Lists every product whose data disagrees between the product list, the
-- warehouse stock rows, polywood pieces and the category tree. These are the
-- reasons a product can be in the product list but missing from an
-- inventory count. Nothing is changed: run it in the SQL Editor and read the
-- result. Safe on production.
--
-- issue codes
--   no_stock_row            no warehouse_stocks row at all: never listed in a
--                           whole-warehouse count
--   null_warehouse_row      stock row without a warehouse: counted only in the
--                           default warehouse, invisible in every other one
--   null_row_no_default     stock row without a warehouse and no default
--                           warehouse exists: invisible in every count
--   total_mismatch          products.stock <> sum of its warehouse rows
--   stock_only_in_list      products.stock <> 0 but every warehouse row is 0:
--                           shown with stock in the list, skipped by the count
--   polywood_mismatch       polywood product: products.stock (metres) <> sum
--                           of available pieces; the count uses the pieces
--   polywood_no_pieces      polywood product with stock but no available
--                           piece in any warehouse
--   subcategory_lost        sub_category_id set but the subcategory text is
--                           empty: the count's subcategory filter misses it
--                           (product_category_paths joins the wrong table)
--   category_text_differs   linked category name differs from the text
--                           category the product list shows
--   no_category             no category at all: only a whole-warehouse
--                           count can reach it
--   service_or_composite    excluded from counts by design (shown for
--                           completeness)
--   duplicate_code          the same product code on several products
--   duplicate_barcode       the same barcode on several products
-- ============================================================================

WITH
default_wh AS (
  SELECT id FROM public.warehouses WHERE COALESCE(is_default, FALSE) ORDER BY id LIMIT 1
),
ws AS (
  SELECT
    product_id,
    COUNT(*)                                        AS rows,
    COUNT(*) FILTER (WHERE warehouse_id IS NULL)    AS null_rows,
    COALESCE(SUM(current_stock), 0)                 AS total,
    COALESCE(SUM(current_stock) FILTER (WHERE warehouse_id IS NULL), 0) AS null_total
  FROM public.warehouse_stocks
  GROUP BY product_id
),
pieces AS (
  SELECT product_id, ROUND(COALESCE(SUM(length_m), 0), 3) AS metres, COUNT(*) AS n
  FROM public.polywood_pieces
  WHERE status = 'available'
  GROUP BY product_id
),
p AS (
  SELECT
    pr.*,
    COALESCE(pr.is_service, FALSE)   AS svc,
    COALESCE(pr.is_composite, FALSE) AS comp,
    pr.inventory_mode = 'polywood'   AS metric
  FROM public.products pr
),
issues AS (
  SELECT p.id, 'service_or_composite' AS issue,
         CASE WHEN p.svc THEN 'service' ELSE 'composite' END AS details
  FROM p WHERE p.svc OR p.comp

  UNION ALL
  SELECT p.id, 'no_stock_row', 'products.stock = ' || COALESCE(p.stock, 0)
  FROM p LEFT JOIN ws ON ws.product_id = p.id
  WHERE NOT p.svc AND NOT p.comp AND NOT p.metric AND ws.product_id IS NULL

  UNION ALL
  SELECT p.id,
         CASE WHEN EXISTS (SELECT 1 FROM default_wh) THEN 'null_warehouse_row' ELSE 'null_row_no_default' END,
         'stock without warehouse = ' || ws.null_total
  FROM p JOIN ws ON ws.product_id = p.id
  WHERE NOT p.svc AND NOT p.comp AND NOT p.metric AND ws.null_rows > 0

  UNION ALL
  SELECT p.id, 'total_mismatch',
         format('products.stock = %s, warehouses sum = %s', COALESCE(p.stock, 0), ws.total)
  FROM p JOIN ws ON ws.product_id = p.id
  WHERE NOT p.svc AND NOT p.comp AND NOT p.metric
    AND abs(COALESCE(p.stock, 0) - ws.total) > 0.0005

  UNION ALL
  SELECT p.id, 'stock_only_in_list',
         format('products.stock = %s, every warehouse row = 0', p.stock)
  FROM p JOIN ws ON ws.product_id = p.id
  WHERE NOT p.svc AND NOT p.comp AND NOT p.metric
    AND COALESCE(p.stock, 0) <> 0
    AND NOT EXISTS (
      SELECT 1 FROM public.warehouse_stocks w
      WHERE w.product_id = p.id AND COALESCE(w.current_stock, 0) <> 0
    )

  UNION ALL
  SELECT p.id, 'polywood_mismatch',
         format('products.stock = %s m, available pieces = %s m', COALESCE(p.stock, 0), COALESCE(pc.metres, 0))
  FROM p LEFT JOIN pieces pc ON pc.product_id = p.id
  WHERE p.metric AND NOT p.svc AND NOT p.comp
    AND COALESCE(pc.n, 0) > 0
    AND abs(COALESCE(p.stock, 0) - pc.metres) > 0.0005

  UNION ALL
  SELECT p.id, 'polywood_no_pieces', format('products.stock = %s m', p.stock)
  FROM p LEFT JOIN pieces pc ON pc.product_id = p.id
  WHERE p.metric AND NOT p.svc AND NOT p.comp
    AND COALESCE(p.stock, 0) <> 0 AND COALESCE(pc.n, 0) = 0

  UNION ALL
  SELECT p.id, 'subcategory_lost', 'sub_categories.name = ' || sc.name
  FROM p JOIN public.sub_categories sc ON sc.id = p.sub_category_id
  WHERE NULLIF(btrim(COALESCE(p.subcategory, '')), '') IS NULL

  UNION ALL
  SELECT p.id, 'category_text_differs',
         format('category_id → %s, text = %s', COALESCE(pc.name, c.name), COALESCE(p.category, '∅'))
  FROM p
  JOIN public.categories c ON c.id = p.category_id
  LEFT JOIN public.categories pc ON pc.id = c.parent_id
  WHERE lower(btrim(COALESCE(pc.name, c.name))) <> lower(btrim(COALESCE(p.category, '')))

  UNION ALL
  SELECT p.id, 'no_category', ''
  FROM p
  WHERE NOT p.svc AND NOT p.comp
    AND p.category_id IS NULL
    AND NULLIF(btrim(COALESCE(p.category, '')), '') IS NULL

  UNION ALL
  SELECT p.id, 'duplicate_code', 'code = ' || p.code
  FROM p
  WHERE p.code IS NOT NULL
    AND (SELECT COUNT(*) FROM public.products o WHERE lower(btrim(o.code)) = lower(btrim(p.code))) > 1

  UNION ALL
  SELECT p.id, 'duplicate_barcode', 'barcode = ' || p.barcode
  FROM p
  WHERE NULLIF(btrim(COALESCE(p.barcode, '')), '') IS NOT NULL
    AND (SELECT COUNT(*) FROM public.products o WHERE btrim(o.barcode) = btrim(p.barcode)) > 1
)
SELECT i.issue, pr.code, pr.name, pr.category, pr.subcategory, i.details
FROM issues i
JOIN public.products pr ON pr.id = i.id
ORDER BY i.issue, pr.name;

-- Summary (run separately if you only want the counts):
-- SELECT issue, COUNT(*) FROM (<the query above>) t GROUP BY issue ORDER BY 2 DESC;
