-- Dual buy pricing for metric/dimensional products: whole-bar vs cut-piece cost per meter
ALTER TABLE products ADD COLUMN IF NOT EXISTS buy_price_cut NUMERIC DEFAULT 0;

COMMENT ON COLUMN products.buy_price IS 'Default buy price; for metric products this is the whole-bar price per meter';
COMMENT ON COLUMN products.buy_price_cut IS 'Cut/custom-length buy price per meter for metric products';
