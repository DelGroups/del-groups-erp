-- Database integrity, performance indexes, and finance RPC/trigger fixes.
-- Safe to re-run: uses IF NOT EXISTS / conditional DO blocks.

-- ─── P0: Fix manual expense RPC (wrong post_cash_transaction argument order) ───

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
    p_account_id,
    'Məxaric',
    p_amount,
    COALESCE(p_category, 'Digər'),
    v_desc,
    NULL,
    'manual_expense',
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

GRANT EXECUTE ON FUNCTION public.create_manual_expense_transaction(TEXT, NUMERIC, UUID, TEXT, TEXT, UUID) TO authenticated;

-- ─── P0: Production expense ledger sync (skip project-only / already posted) ───

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

    -- Project-only costs without a cash account must not create ledger rows.
    IF NEW.account_id IS NULL THEN
      RETURN NEW;
    END IF;

    v_category_id := resolve_financial_category_id(NEW.category, 'EXPENSE');
    v_description := COALESCE(
      NULLIF(trim(NEW.notes), ''),
      NULLIF(trim(NEW.category), ''),
      'İstehsalat xərci'
    );

    v_tx_id := post_cash_transaction(
      NEW.account_id,
      'Məxaric',
      COALESCE(NEW.amount, 0),
      COALESCE(NEW.category, 'İstehsalat xərci'),
      v_description,
      NEW.production_order_id,
      'production_expense',
      NEW.id
    );

    UPDATE transactions
    SET
      unified_type = 'EXPENSE',
      category_id = v_category_id,
      reference_type = 'production_expense',
      reference_id = NEW.id,
      source_type = 'production_expense',
      source_id = NEW.id,
      production_order_id = NEW.production_order_id,
      description = v_description
    WHERE id = v_tx_id;

    UPDATE production_expenses
    SET finance_transaction_id = v_tx_id,
        is_posted_to_finance = true
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

-- ─── P1: financial_categories — prevent accidental subtree wipe ─────────────────

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.financial_categories'::regclass
      AND contype = 'f'
      AND pg_get_constraintdef(oid) LIKE '%parent_id%'
      AND pg_get_constraintdef(oid) LIKE '%CASCADE%'
  ) THEN
    ALTER TABLE public.financial_categories
      DROP CONSTRAINT IF EXISTS financial_categories_parent_id_fkey;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'financial_categories_parent_id_fkey'
  ) THEN
    ALTER TABLE public.financial_categories
      ADD CONSTRAINT financial_categories_parent_id_fkey
      FOREIGN KEY (parent_id)
      REFERENCES public.financial_categories(id)
      ON DELETE RESTRICT;
  END IF;
END $$;

-- ─── P1: Drop duplicate foreign keys (keep *_fkey variants) ───────────────────

ALTER TABLE public.sales DROP CONSTRAINT IF EXISTS fk_sales_customer;
ALTER TABLE public.sale_items DROP CONSTRAINT IF EXISTS fk_sale_items_product;
ALTER TABLE public.purchase_items DROP CONSTRAINT IF EXISTS fk_purchase_items_product;
ALTER TABLE public.purchases DROP CONSTRAINT IF EXISTS fk_purchases_supplier;
ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS fk_transactions_account;

-- ─── P1: Add missing foreign keys when data is clean ───────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'sale_items_warehouse_id_fkey'
  ) AND NOT EXISTS (
    SELECT 1 FROM sale_items si
    LEFT JOIN warehouses w ON w.id = si.warehouse_id
    WHERE si.warehouse_id IS NOT NULL AND w.id IS NULL
  ) THEN
    ALTER TABLE public.sale_items
      ADD CONSTRAINT sale_items_warehouse_id_fkey
      FOREIGN KEY (warehouse_id)
      REFERENCES public.warehouses(id)
      ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'polywood_pieces_sale_item_id_fkey'
  ) AND NOT EXISTS (
    SELECT 1 FROM polywood_pieces pp
    LEFT JOIN sale_items si ON si.id = pp.sale_item_id
    WHERE pp.sale_item_id IS NOT NULL AND si.id IS NULL
  ) THEN
    ALTER TABLE public.polywood_pieces
      ADD CONSTRAINT polywood_pieces_sale_item_id_fkey
      FOREIGN KEY (sale_item_id)
      REFERENCES public.sale_items(id)
      ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'production_contractors_contractor_id_fkey'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'production_contractors'
      AND column_name = 'contractor_id'
  ) AND NOT EXISTS (
    SELECT 1 FROM production_contractors pc
    LEFT JOIN suppliers s ON s.id = pc.contractor_id
    WHERE pc.contractor_id IS NOT NULL AND s.id IS NULL
  ) THEN
    ALTER TABLE public.production_contractors
      ADD CONSTRAINT production_contractors_contractor_id_fkey
      FOREIGN KEY (contractor_id)
      REFERENCES public.suppliers(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- ─── P2: Preserve stock movement audit trail on product delete ────────────────

DO $$
DECLARE
  v_conname TEXT;
BEGIN
  SELECT c.conname INTO v_conname
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  WHERE t.relname = 'stock_movements'
    AND c.contype = 'f'
    AND pg_get_constraintdef(c.oid) LIKE '%product_id%'
    AND pg_get_constraintdef(c.oid) LIKE '%CASCADE%'
  LIMIT 1;

  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.stock_movements DROP CONSTRAINT %I', v_conname);
    ALTER TABLE public.stock_movements
      ADD CONSTRAINT stock_movements_product_id_fkey
      FOREIGN KEY (product_id)
      REFERENCES public.products(id)
      ON DELETE RESTRICT;
  END IF;
END $$;

-- ─── P3: Performance indexes ─────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_transactions_account_id
  ON public.transactions (account_id)
  WHERE account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_journal_entry_id
  ON public.transactions (journal_entry_id)
  WHERE journal_entry_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_transactions_created_at
  ON public.transactions (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_transactions_production_order
  ON public.transactions (production_order_id)
  WHERE production_order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_sales_customer_id
  ON public.sales (customer_id);

CREATE INDEX IF NOT EXISTS idx_sales_doc_date
  ON public.sales (doc_date DESC);

CREATE INDEX IF NOT EXISTS idx_sales_status
  ON public.sales (status);

CREATE INDEX IF NOT EXISTS idx_sale_items_warehouse_id
  ON public.sale_items (warehouse_id)
  WHERE warehouse_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_purchases_supplier_id
  ON public.purchases (supplier_id);

CREATE INDEX IF NOT EXISTS idx_production_materials_product
  ON public.production_materials (product_id);

CREATE INDEX IF NOT EXISTS idx_production_materials_warehouse
  ON public.production_materials (warehouse_id);

CREATE INDEX IF NOT EXISTS idx_production_expenses_order
  ON public.production_expenses (production_order_id);

CREATE INDEX IF NOT EXISTS idx_production_orders_customer
  ON public.production_orders (customer_id);

CREATE INDEX IF NOT EXISTS idx_production_orders_status
  ON public.production_orders (status);

CREATE INDEX IF NOT EXISTS idx_polywood_pieces_sale_item
  ON public.polywood_pieces (sale_item_id)
  WHERE sale_item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_stock_movements_warehouse_created
  ON public.stock_movements (warehouse_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_expenses_account_id
  ON public.expenses (account_id);

CREATE INDEX IF NOT EXISTS idx_accounts_coa_id
  ON public.accounts (coa_id)
  WHERE coa_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_employee_id
  ON public.profiles (employee_id)
  WHERE employee_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
