-- Unified financial ledger: global categories, extended transactions, production expense sync

-- ─── Legacy expense category table (optional source) ───────────────────────────

CREATE TABLE IF NOT EXISTS public.expense_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(200) NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_expense_categories_name
  ON public.expense_categories (lower(name));

-- ─── Global financial categories ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.financial_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(200) NOT NULL,
  type VARCHAR(20) NOT NULL CHECK (type IN ('INCOME', 'EXPENSE')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_financial_categories_name_type
  ON public.financial_categories (lower(name), type);

INSERT INTO public.expense_categories (name, is_active)
VALUES
  ('Nəqliyyat', true),
  ('Çatdırılma', true),
  ('Quraşdırma', true),
  ('Alət / Material', true),
  ('İcarə', true),
  ('Elektrik', true),
  ('Yanacaq', true),
  ('İnternet', true),
  ('Reklam', true),
  ('Təmir', true),
  ('Maaş', true),
  ('Digər', true)
ON CONFLICT DO NOTHING;

INSERT INTO public.financial_categories (name, type, is_active)
SELECT ec.name, 'EXPENSE', COALESCE(ec.is_active, true)
FROM public.expense_categories ec
WHERE NOT EXISTS (
  SELECT 1 FROM public.financial_categories fc
  WHERE lower(fc.name) = lower(ec.name) AND fc.type = 'EXPENSE'
);

INSERT INTO public.financial_categories (name, type, is_active)
SELECT v.name, v.type, true
FROM (VALUES
  ('Satış gəliri', 'INCOME'),
  ('Müştəri avansı', 'INCOME'),
  ('Digər gəlir', 'INCOME'),
  ('Satın alma', 'EXPENSE'),
  ('İstehsalat xərci', 'EXPENSE'),
  ('Əl ilə xərc', 'EXPENSE'),
  ('Digər', 'EXPENSE')
) AS v(name, type)
WHERE NOT EXISTS (
  SELECT 1 FROM public.financial_categories fc
  WHERE lower(fc.name) = lower(v.name) AND fc.type = v.type
);

-- ─── Extend transactions into unified ledger shape ───────────────────────────

ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS transaction_date TIMESTAMPTZ;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS unified_type VARCHAR(20);
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES public.financial_categories(id);
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS reference_type VARCHAR(80);
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS reference_id UUID;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS counterparty_id UUID;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE public.transactions ADD COLUMN IF NOT EXISTS created_by UUID;

UPDATE public.transactions
SET transaction_date = COALESCE(transaction_date, created_at, NOW())
WHERE transaction_date IS NULL;

UPDATE public.transactions
SET unified_type = CASE
  WHEN lower(COALESCE(type, '')) IN ('mədaxil', 'medaxil', 'income') THEN 'INCOME'
  WHEN lower(COALESCE(type, '')) IN ('məxaric', 'mexaric', 'expense') THEN 'EXPENSE'
  WHEN lower(COALESCE(type, '')) = 'transfer' THEN 'TRANSFER'
  WHEN amount < 0 THEN 'EXPENSE'
  ELSE 'INCOME'
END
WHERE unified_type IS NULL;

UPDATE public.transactions
SET reference_type = COALESCE(reference_type, source_type)
WHERE reference_type IS NULL AND source_type IS NOT NULL;

UPDATE public.transactions
SET reference_id = COALESCE(reference_id, source_id)
WHERE reference_id IS NULL AND source_id IS NOT NULL;

UPDATE public.transactions
SET description = COALESCE(description, notes, category)
WHERE description IS NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_unified_type
  ON public.transactions (unified_type, transaction_date DESC);

CREATE INDEX IF NOT EXISTS idx_transactions_reference
  ON public.transactions (reference_type, reference_id)
  WHERE reference_type IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_category_id
  ON public.transactions (category_id)
  WHERE category_id IS NOT NULL;

-- Link production expenses to ledger rows (reuse existing column when present)
ALTER TABLE public.production_expenses
  ADD COLUMN IF NOT EXISTS finance_transaction_id UUID REFERENCES public.transactions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_production_expenses_finance_tx
  ON public.production_expenses (finance_transaction_id)
  WHERE finance_transaction_id IS NOT NULL;

-- ─── Category resolver ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.resolve_financial_category_id(
  p_name TEXT,
  p_type TEXT DEFAULT 'EXPENSE'
)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_name TEXT := COALESCE(NULLIF(trim(p_name), ''), 'Digər');
  v_type TEXT := upper(COALESCE(NULLIF(trim(p_type), ''), 'EXPENSE'));
BEGIN
  SELECT id INTO v_id
  FROM financial_categories
  WHERE lower(name) = lower(v_name) AND type = v_type AND is_active = true
  LIMIT 1;

  IF v_id IS NOT NULL THEN
    RETURN v_id;
  END IF;

  INSERT INTO financial_categories (name, type, is_active)
  VALUES (v_name, v_type, true)
  ON CONFLICT DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT id INTO v_id
    FROM financial_categories
    WHERE lower(name) = lower(v_name) AND type = v_type
    LIMIT 1;
  END IF;

  RETURN v_id;
END;
$$;

-- ─── Production expense ↔ ledger sync ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.sync_production_expense_to_ledger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_category_id UUID;
  v_tx_id UUID;
  v_description TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.finance_transaction_id IS NOT NULL THEN
      RETURN NEW;
    END IF;

    v_category_id := resolve_financial_category_id(NEW.category, 'EXPENSE');
    v_description := COALESCE(NULLIF(trim(NEW.notes), ''), NULLIF(trim(NEW.category), ''), 'İstehsalat xərci');

    INSERT INTO transactions (
      account_id,
      amount,
      type,
      unified_type,
      category,
      category_id,
      notes,
      description,
      transaction_date,
      created_at,
      reference_type,
      reference_id,
      source_type,
      source_id,
      production_order_id
    ) VALUES (
      NULL,
      COALESCE(NEW.amount, 0),
      'Məxaric',
      'EXPENSE',
      COALESCE(NEW.category, 'İstehsalat xərci'),
      v_category_id,
      v_description,
      v_description,
      COALESCE(NEW.created_at, NOW()),
      COALESCE(NEW.created_at, NOW()),
      'production_expense',
      NEW.id,
      'production_expense',
      NEW.id,
      NEW.production_order_id
    )
    RETURNING id INTO v_tx_id;

    UPDATE production_expenses
    SET finance_transaction_id = v_tx_id
    WHERE id = NEW.id;

    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.finance_transaction_id IS NOT NULL THEN
      DELETE FROM transactions WHERE id = OLD.finance_transaction_id;
    END IF;
    RETURN OLD;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_production_expenses_sync_ledger ON public.production_expenses;
CREATE TRIGGER trg_production_expenses_sync_ledger
  AFTER INSERT OR DELETE ON public.production_expenses
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_production_expense_to_ledger();

-- ─── Manual expense → unified ledger (RPC fallback path) ─────────────────────

CREATE OR REPLACE FUNCTION public.create_manual_expense_transaction(
  p_category TEXT,
  p_amount NUMERIC,
  p_account_id UUID,
  p_description TEXT DEFAULT NULL,
  p_notes TEXT DEFAULT NULL,
  p_created_by UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tx_id UUID;
  v_category_id UUID;
  v_desc TEXT;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'invalid_amount' USING ERRCODE = '22023';
  END IF;
  IF p_account_id IS NULL THEN
    RAISE EXCEPTION 'account_required' USING ERRCODE = '22023';
  END IF;

  v_category_id := resolve_financial_category_id(p_category, 'EXPENSE');
  v_desc := COALESCE(NULLIF(trim(p_description), ''), NULLIF(trim(p_notes), ''), p_category, 'Əl ilə xərc');

  v_tx_id := post_cash_transaction(
    'Məxaric',
    p_amount,
    p_account_id,
    COALESCE(p_category, 'Digər'),
    v_desc,
    'manual_expense',
    NULL,
    NULL
  );

  UPDATE transactions
  SET
    unified_type = 'EXPENSE',
    category_id = v_category_id,
    reference_type = 'manual_expense',
    description = v_desc,
    transaction_date = COALESCE(transaction_date, created_at, NOW()),
    created_by = p_created_by
  WHERE id = v_tx_id;

  RETURN v_tx_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_financial_category_id(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_manual_expense_transaction(TEXT, NUMERIC, UUID, TEXT, TEXT, UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
