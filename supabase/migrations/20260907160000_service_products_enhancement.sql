-- Service products: explicit flag + default billable services for mixed invoices.

ALTER TABLE products ADD COLUMN IF NOT EXISTS is_service BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_products_is_service ON products (is_service) WHERE is_service = TRUE;

INSERT INTO categories (name, parent_id)
SELECT 'Services', NULL
WHERE NOT EXISTS (
  SELECT 1 FROM categories c WHERE c.name = 'Services' AND c.parent_id IS NULL
);

INSERT INTO products (
  code,
  name,
  category,
  subcategory,
  unit,
  buy_price,
  sell_price,
  stock,
  min_stock,
  category_id,
  is_dimensional,
  is_service,
  inventory_mode
)
SELECT
  v.code,
  v.name,
  'Services',
  'Services',
  'Xidmət',
  0,
  v.sell_price,
  0,
  0,
  c.id,
  FALSE,
  TRUE,
  'standard'
FROM categories c
CROSS JOIN (
  VALUES
    ('SRV-KESIM', 'Kəsim Xidməti', 5.00),
    ('SRV-BANT', 'Kənar Bantlama Xidməti', 8.00)
) AS v(code, name, sell_price)
WHERE c.name = 'Services'
  AND c.parent_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM products p WHERE lower(trim(p.name)) = lower(v.name)
  );

UPDATE products p
SET is_service = TRUE,
    category_id = COALESCE(p.category_id, c.id),
    category = COALESCE(NULLIF(trim(p.category), ''), 'Services')
FROM categories c
WHERE c.name = 'Services'
  AND c.parent_id IS NULL
  AND p.is_service IS NOT TRUE
  AND (
    lower(trim(p.category)) IN ('services', 'service', 'xidmət', 'xidmet')
    OR lower(trim(p.subcategory)) IN ('services', 'service', 'xidmət', 'xidmet')
    OR lower(trim(p.name)) LIKE '%xidmət%'
    OR lower(trim(p.name)) LIKE '%xidmet%'
  );
