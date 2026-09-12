-- Dual pricing for metric/dimensional products: whole-bar vs cut-piece sell price per meter
ALTER TABLE products ADD COLUMN IF NOT EXISTS sell_price_cut NUMERIC DEFAULT 0;

COMMENT ON COLUMN products.sell_price IS 'Default sell price; for metric products this is the whole-bar price per meter';
COMMENT ON COLUMN products.sell_price_cut IS 'Cut/custom-length sell price per meter for metric products';
