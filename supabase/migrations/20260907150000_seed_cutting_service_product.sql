-- Seed default cutting service product for mixed dimensional sales invoices.
-- Idempotent: skips insert when a product with the same name already exists.

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
  inventory_mode
)
SELECT
  'SRV-KESIM',
  'Kəsim Xidməti',
  'Services',
  'Services',
  'Xidmət',
  0,
  5.00,
  0,
  0,
  c.id,
  FALSE,
  'standard'
FROM categories c
WHERE c.name = 'Services'
  AND c.parent_id IS NULL
  AND NOT EXISTS (
    SELECT 1
    FROM products p
    WHERE lower(trim(p.name)) = lower('Kəsim Xidməti')
  );
