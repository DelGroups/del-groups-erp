-- Polywood category / sub-category hierarchy and grouped initial stock items.

-- ─── categories: add slug ───────────────────────────────────────────────────
ALTER TABLE categories ADD COLUMN IF NOT EXISTS slug TEXT;

UPDATE categories
SET slug = lower(regexp_replace(trim(name), '[^a-zA-Z0-9]+', '-', 'g'))
WHERE slug IS NULL OR trim(slug) = '';

CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_slug_unique
  ON categories (slug)
  WHERE slug IS NOT NULL AND trim(slug) <> '';

-- ─── sub_categories ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sub_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (category_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_sub_categories_category_id ON sub_categories (category_id);

-- Backfill sub_categories from legacy self-referential categories rows.
INSERT INTO sub_categories (category_id, name, slug)
SELECT
  c.parent_id,
  c.name,
  lower(regexp_replace(trim(c.name), '[^a-zA-Z0-9]+', '-', 'g'))
FROM categories c
WHERE c.parent_id IS NOT NULL
ON CONFLICT (category_id, slug) DO NOTHING;

-- ─── products: sub_category_id ──────────────────────────────────────────────
ALTER TABLE products ADD COLUMN IF NOT EXISTS sub_category_id UUID REFERENCES sub_categories(id);

CREATE INDEX IF NOT EXISTS idx_products_sub_category_id ON products (sub_category_id);

-- Backfill sub_category_id from free-text subcategory where possible.
UPDATE products p
SET sub_category_id = sc.id
FROM sub_categories sc
JOIN categories c ON c.id = sc.category_id
WHERE p.sub_category_id IS NULL
  AND p.subcategory IS NOT NULL
  AND trim(p.subcategory) <> ''
  AND lower(trim(p.subcategory)) = lower(trim(sc.name))
  AND (
    p.category_id IS NULL
    OR p.category_id = sc.category_id
    OR lower(trim(coalesce(p.category, ''))) = lower(trim(c.name))
  );

-- ─── grouped initial stock ledger ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS polywood_inventory_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  length_m NUMERIC NOT NULL CHECK (length_m > 0),
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  is_full_sheet BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_polywood_inventory_items_product
  ON polywood_inventory_items (product_id);
