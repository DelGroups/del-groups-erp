-- Ensure dual price columns exist (whole-unit vs alternate unit rows).
-- Safe to re-run; fixes PostgREST schema cache errors on older databases.
ALTER TABLE products ADD COLUMN IF NOT EXISTS buy_price_cut NUMERIC DEFAULT 0;
ALTER TABLE products ADD COLUMN IF NOT EXISTS sell_price_cut NUMERIC DEFAULT 0;

COMMENT ON COLUMN products.buy_price_cut IS 'Secondary buy price row (unit stored in extra_info price meta)';
COMMENT ON COLUMN products.sell_price_cut IS 'Secondary sell price row (unit stored in extra_info price meta)';
