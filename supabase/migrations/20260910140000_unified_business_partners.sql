-- Unified business partners (customers + suppliers) with net balance support.

CREATE TABLE IF NOT EXISTS partners (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  full_name TEXT,
  company_name TEXT,
  phone TEXT,
  address TEXT,
  voen TEXT,
  entity_type TEXT NOT NULL DEFAULT 'physical',
  code TEXT,
  is_customer BOOLEAN NOT NULL DEFAULT FALSE,
  is_supplier BOOLEAN NOT NULL DEFAULT FALSE,
  customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,
  supplier_id UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_partners_customer_id ON partners (customer_id);
CREATE INDEX IF NOT EXISTS idx_partners_supplier_id ON partners (supplier_id);
CREATE INDEX IF NOT EXISTS idx_partners_name ON partners (name);
CREATE UNIQUE INDEX IF NOT EXISTS idx_partners_customer_unique ON partners (customer_id) WHERE customer_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_partners_supplier_unique ON partners (supplier_id) WHERE supplier_id IS NOT NULL;

ALTER TABLE sales ADD COLUMN IF NOT EXISTS partner_id UUID REFERENCES partners(id);
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS partner_id UUID REFERENCES partners(id);

CREATE INDEX IF NOT EXISTS idx_sales_partner_id ON sales (partner_id);
CREATE INDEX IF NOT EXISTS idx_purchases_partner_id ON purchases (partner_id);

-- Backfill partners from existing customers.
INSERT INTO partners (
  name, full_name, company_name, phone, address, voen, entity_type, code,
  is_customer, is_supplier, customer_id
)
SELECT
  COALESCE(NULLIF(trim(c.full_name), ''), NULLIF(trim(c.name), ''), NULLIF(trim(c.company_name), ''), 'Partner'),
  c.full_name,
  c.company_name,
  c.phone,
  c.address,
  c.voen,
  COALESCE(c.entity_type, 'physical'),
  c.code,
  TRUE,
  FALSE,
  c.id
FROM customers c
WHERE NOT EXISTS (
  SELECT 1 FROM partners p WHERE p.customer_id = c.id
);

-- Backfill partners from existing suppliers.
INSERT INTO partners (
  name, full_name, company_name, phone, address, voen, entity_type, code,
  is_customer, is_supplier, supplier_id
)
SELECT
  COALESCE(NULLIF(trim(s.full_name), ''), NULLIF(trim(s.company_name), ''), 'Partner'),
  s.full_name,
  s.company_name,
  s.phone,
  s.address,
  s.voen,
  COALESCE(s.entity_type, 'physical'),
  s.code,
  FALSE,
  TRUE,
  s.id
FROM suppliers s
WHERE NOT EXISTS (
  SELECT 1 FROM partners p WHERE p.supplier_id = s.id
);

-- Link sales and purchases to partners.
UPDATE sales s
SET partner_id = p.id
FROM partners p
WHERE s.partner_id IS NULL
  AND s.customer_id IS NOT NULL
  AND p.customer_id = s.customer_id;

UPDATE purchases pu
SET partner_id = p.id
FROM partners p
WHERE pu.partner_id IS NULL
  AND pu.supplier_id IS NOT NULL
  AND p.supplier_id = pu.supplier_id;

CREATE OR REPLACE FUNCTION public.compute_partner_open_receivables(p_partner_id UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(GREATEST(COALESCE(s.remaining_balance, 0), 0)), 0)
  FROM sales s
  WHERE s.partner_id = p_partner_id
    AND COALESCE(lower(trim(s.status)), '') NOT IN ('void', 'voided', 'cancelled', 'ləğv edildi', 'legv edildi');
$$;

CREATE OR REPLACE FUNCTION public.compute_partner_open_payables(p_partner_id UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(GREATEST(COALESCE(pu.debt_amount, 0), 0)), 0)
  FROM purchases pu
  WHERE pu.partner_id = p_partner_id
    AND COALESCE(lower(trim(pu.status)), '') NOT IN ('void', 'voided', 'cancelled', 'ləğv edildi', 'legv edildi');
$$;

CREATE OR REPLACE FUNCTION public.compute_partner_net_balance(p_partner_id UUID)
RETURNS NUMERIC
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.compute_partner_open_receivables(p_partner_id)
    - public.compute_partner_open_payables(p_partner_id);
$$;

GRANT EXECUTE ON FUNCTION public.compute_partner_open_receivables(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.compute_partner_open_payables(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.compute_partner_net_balance(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.sync_sale_partner_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.partner_id IS NULL AND NEW.customer_id IS NOT NULL THEN
    SELECT p.id
    INTO NEW.partner_id
    FROM partners p
    WHERE p.customer_id = NEW.customer_id
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_purchase_partner_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.partner_id IS NULL AND NEW.supplier_id IS NOT NULL THEN
    SELECT p.id
    INTO NEW.partner_id
    FROM partners p
    WHERE p.supplier_id = NEW.supplier_id
    LIMIT 1;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_sale_partner_id ON sales;
CREATE TRIGGER trg_sync_sale_partner_id
  BEFORE INSERT OR UPDATE OF customer_id, partner_id ON sales
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_sale_partner_id();

DROP TRIGGER IF EXISTS trg_sync_purchase_partner_id ON purchases;
CREATE TRIGGER trg_sync_purchase_partner_id
  BEFORE INSERT OR UPDATE OF supplier_id, partner_id ON purchases
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_purchase_partner_id();

CREATE OR REPLACE FUNCTION public.ensure_partner_for_customer()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM partners p WHERE p.customer_id = NEW.id) THEN
    INSERT INTO partners (
      name, full_name, company_name, phone, address, voen, entity_type, code,
      is_customer, is_supplier, customer_id
    ) VALUES (
      COALESCE(NULLIF(trim(NEW.full_name), ''), NULLIF(trim(NEW.name), ''), NULLIF(trim(NEW.company_name), ''), 'Partner'),
      NEW.full_name,
      NEW.company_name,
      NEW.phone,
      NEW.address,
      NEW.voen,
      COALESCE(NEW.entity_type, 'physical'),
      NEW.code,
      TRUE,
      FALSE,
      NEW.id
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_partner_for_supplier()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM partners p WHERE p.supplier_id = NEW.id) THEN
    INSERT INTO partners (
      name, full_name, company_name, phone, address, voen, entity_type, code,
      is_customer, is_supplier, supplier_id
    ) VALUES (
      COALESCE(NULLIF(trim(NEW.full_name), ''), NULLIF(trim(NEW.company_name), ''), 'Partner'),
      NEW.full_name,
      NEW.company_name,
      NEW.phone,
      NEW.address,
      NEW.voen,
      COALESCE(NEW.entity_type, 'physical'),
      NEW.code,
      FALSE,
      TRUE,
      NEW.id
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ensure_partner_for_customer ON customers;
CREATE TRIGGER trg_ensure_partner_for_customer
  AFTER INSERT ON customers
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_partner_for_customer();

DROP TRIGGER IF EXISTS trg_ensure_partner_for_supplier ON suppliers;
CREATE TRIGGER trg_ensure_partner_for_supplier
  AFTER INSERT ON suppliers
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_partner_for_supplier();
