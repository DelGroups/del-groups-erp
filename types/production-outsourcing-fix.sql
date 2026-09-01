-- Run once in the Supabase SQL editor to align legacy and current
-- production_outsourcing schemas used by the Xarici kəsim form.
ALTER TABLE production_outsourcing ADD COLUMN IF NOT EXISTS supplier_id UUID REFERENCES suppliers(id);
ALTER TABLE production_outsourcing ADD COLUMN IF NOT EXISTS supplier_name TEXT;
ALTER TABLE production_outsourcing ADD COLUMN IF NOT EXISTS material_description TEXT;
ALTER TABLE production_outsourcing ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE production_outsourcing ADD COLUMN IF NOT EXISTS sqm_quantity NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE production_outsourcing ADD COLUMN IF NOT EXISTS price_per_sqm NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE production_outsourcing ADD COLUMN IF NOT EXISTS total_cost NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE production_outsourcing ADD COLUMN IF NOT EXISTS notes TEXT;

UPDATE production_outsourcing
SET
  material_description = COALESCE(NULLIF(btrim(material_description), ''), NULLIF(btrim(description), ''), 'Xarici xidmət'),
  description = COALESCE(NULLIF(btrim(description), ''), NULLIF(btrim(material_description), ''), 'Xarici xidmət'),
  notes = COALESCE(NULLIF(btrim(notes), ''), NULLIF(btrim(description), ''), NULLIF(btrim(material_description), ''), 'Xarici xidmət');

ALTER TABLE production_outsourcing ALTER COLUMN material_description SET NOT NULL;

NOTIFY pgrst, 'reload schema';
