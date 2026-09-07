-- Official vs Unofficial transactions: contracts, VAT fields, treasury VAT accounts

CREATE TABLE IF NOT EXISTS contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_number VARCHAR NOT NULL UNIQUE,
  party_id UUID NOT NULL,
  party_name TEXT,
  type VARCHAR NOT NULL CHECK (type IN ('sale', 'purchase')),
  title VARCHAR NOT NULL,
  total_amount NUMERIC NOT NULL DEFAULT 0,
  status VARCHAR NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'cancelled')),
  voen TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contracts_party_type_status
  ON contracts (party_id, type, status);

CREATE INDEX IF NOT EXISTS idx_contracts_contract_number
  ON contracts (contract_number);

-- Extend sales
ALTER TABLE sales ADD COLUMN IF NOT EXISTS is_official BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS contract_id UUID REFERENCES contracts(id);
ALTER TABLE sales ADD COLUMN IF NOT EXISTS vat_mode VARCHAR NOT NULL DEFAULT 'none';
ALTER TABLE sales ADD COLUMN IF NOT EXISTS subtotal_amount NUMERIC;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS vat_rate NUMERIC NOT NULL DEFAULT 18.00;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS vat_amount NUMERIC NOT NULL DEFAULT 0.00;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS grand_total NUMERIC;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sales_vat_mode_check'
  ) THEN
    ALTER TABLE sales ADD CONSTRAINT sales_vat_mode_check
      CHECK (vat_mode IN ('exclusive', 'inclusive', 'none'));
  END IF;
END $$;

-- Extend purchases
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS is_official BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS contract_id UUID REFERENCES contracts(id);
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS vat_mode VARCHAR NOT NULL DEFAULT 'none';
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS subtotal_amount NUMERIC;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS vat_rate NUMERIC NOT NULL DEFAULT 18.00;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS vat_amount NUMERIC NOT NULL DEFAULT 0.00;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS grand_total NUMERIC;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'purchases_vat_mode_check'
  ) THEN
    ALTER TABLE purchases ADD CONSTRAINT purchases_vat_mode_check
      CHECK (vat_mode IN ('exclusive', 'inclusive', 'none'));
  END IF;
END $$;

-- Treasury accounts (canonical table: accounts; user spec: bank_accounts)
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS is_vat_account BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_accounts_is_vat_account
  ON accounts (is_vat_account)
  WHERE is_vat_account = true;

-- RLS for contracts
ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS contracts_select ON contracts;
CREATE POLICY contracts_select ON contracts
  FOR SELECT USING (
    public.user_has_permission('can_view_sales')
    OR public.user_has_permission('can_view_purchases')
  );

DROP POLICY IF EXISTS contracts_insert ON contracts;
CREATE POLICY contracts_insert ON contracts
  FOR INSERT WITH CHECK (
    public.user_has_permission('can_create_invoice')
    OR public.user_has_permission('can_view_purchases')
  );

DROP POLICY IF EXISTS contracts_update ON contracts;
CREATE POLICY contracts_update ON contracts
  FOR UPDATE USING (
    public.user_has_permission('can_create_invoice')
    OR public.user_has_permission('can_view_purchases')
  );

DROP POLICY IF EXISTS contracts_delete ON contracts;
CREATE POLICY contracts_delete ON contracts
  FOR DELETE USING (public.user_has_permission('can_manage_settings'));

GRANT SELECT, INSERT, UPDATE, DELETE ON contracts TO authenticated;
GRANT SELECT ON contracts TO anon;

NOTIFY pgrst, 'reload schema';
