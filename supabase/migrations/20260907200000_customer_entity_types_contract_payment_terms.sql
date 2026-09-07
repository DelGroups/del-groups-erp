-- Customer/supplier entity types and contract payment terms refactor

ALTER TABLE customers ADD COLUMN IF NOT EXISTS entity_type VARCHAR NOT NULL DEFAULT 'physical';
ALTER TABLE customers ADD COLUMN IF NOT EXISTS voen TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'customers_entity_type_check'
  ) THEN
    ALTER TABLE customers ADD CONSTRAINT customers_entity_type_check
      CHECK (entity_type IN ('legal', 'physical'));
  END IF;
END $$;

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS entity_type VARCHAR NOT NULL DEFAULT 'physical';
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS voen TEXT;
ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS address TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'suppliers_entity_type_check'
  ) THEN
    ALTER TABLE suppliers ADD CONSTRAINT suppliers_entity_type_check
      CHECK (entity_type IN ('legal', 'physical'));
  END IF;
END $$;

-- Contracts: extend type, nullable amount, payment terms, dates
ALTER TABLE contracts DROP CONSTRAINT IF EXISTS contracts_type_check;
ALTER TABLE contracts ADD CONSTRAINT contracts_type_check
  CHECK (type IN ('sale', 'purchase', 'service'));

ALTER TABLE contracts ALTER COLUMN total_amount DROP NOT NULL;
ALTER TABLE contracts ALTER COLUMN total_amount DROP DEFAULT;

ALTER TABLE contracts ADD COLUMN IF NOT EXISTS advance_percentage NUMERIC;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS payment_stages INTEGER;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS payment_terms_notes TEXT;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS contract_date DATE DEFAULT CURRENT_DATE;
ALTER TABLE contracts ADD COLUMN IF NOT EXISTS expiry_date DATE;

CREATE OR REPLACE FUNCTION public.validate_contract_legal_party()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.type IN ('sale', 'service') THEN
    IF NOT EXISTS (
      SELECT 1
      FROM customers c
      WHERE c.id = NEW.party_id
        AND c.entity_type = 'legal'
        AND COALESCE(TRIM(c.voen), '') <> ''
    ) THEN
      RAISE EXCEPTION 'contract_requires_legal_customer_with_voen';
    END IF;
  ELSIF NEW.type = 'purchase' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM suppliers s
      WHERE s.id = NEW.party_id
        AND s.entity_type = 'legal'
        AND COALESCE(TRIM(s.voen), '') <> ''
    ) THEN
      RAISE EXCEPTION 'contract_requires_legal_supplier_with_voen';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_contracts_validate_legal_party ON contracts;
CREATE TRIGGER trg_contracts_validate_legal_party
  BEFORE INSERT OR UPDATE OF party_id, type ON contracts
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_contract_legal_party();

NOTIFY pgrst, 'reload schema';
