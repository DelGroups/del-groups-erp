-- DB audit fixes: permission alias, performance indexes, RPC grants, role permissions
-- Addresses: missing user_has_permission(), index gaps, service_role EXECUTE on financial RPCs

-- ─── 1. Permission helper alias (production RLS/RPC reference user_has_permission) ─

CREATE OR REPLACE FUNCTION public.user_has_permission(perm TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.has_permission(perm);
$$;

GRANT EXECUTE ON FUNCTION public.user_has_permission(TEXT) TO authenticated, service_role;

-- Ensure production permissions exist on system roles (safe re-run)
UPDATE roles
SET permissions = COALESCE(permissions, '{}'::jsonb)
  || jsonb_build_object(
    'can_view_production',
      COALESCE(
        (permissions->>'can_view_production')::boolean,
        (permissions->>'can_view_products')::boolean,
        name = 'Admin'
      ),
    'can_manage_production',
      COALESCE(
        (permissions->>'can_manage_production')::boolean,
        (permissions->>'can_manage_products')::boolean,
        name = 'Admin'
      )
  );

-- ─── 2. Warehouse schema alignment (live DB had is_polywood; app uses warehouse_type) ─

ALTER TABLE public.warehouses
  ADD COLUMN IF NOT EXISTS warehouse_type TEXT;

UPDATE public.warehouses
SET warehouse_type = CASE
  WHEN COALESCE(is_polywood, false) THEN 'polywood'
  ELSE COALESCE(NULLIF(trim(warehouse_type), ''), 'general')
END
WHERE warehouse_type IS NULL OR trim(warehouse_type) = '';

ALTER TABLE public.warehouses
  ALTER COLUMN warehouse_type SET DEFAULT 'general';

UPDATE public.warehouses
SET warehouse_type = 'general'
WHERE warehouse_type IS NULL;

-- ─── 3. Performance indexes (high-frequency lookups & joins) ───────────────────

CREATE INDEX IF NOT EXISTS idx_journal_entries_source
  ON public.journal_entries (source_type, source_id);

CREATE INDEX IF NOT EXISTS idx_journal_entry_lines_entry
  ON public.journal_entry_lines (journal_entry_id);

CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id
  ON public.sale_items (sale_id);

CREATE INDEX IF NOT EXISTS idx_sale_items_product_id
  ON public.sale_items (product_id);

CREATE INDEX IF NOT EXISTS idx_purchase_items_purchase_id
  ON public.purchase_items (purchase_id);

CREATE INDEX IF NOT EXISTS idx_purchase_items_product_id
  ON public.purchase_items (product_id);

CREATE INDEX IF NOT EXISTS idx_warehouses_warehouse_type
  ON public.warehouses (warehouse_type);

CREATE INDEX IF NOT EXISTS idx_warehouses_is_polywood
  ON public.warehouses (is_polywood)
  WHERE is_polywood IS TRUE;

CREATE INDEX IF NOT EXISTS idx_warehouses_polywood_type
  ON public.warehouses (warehouse_type)
  WHERE warehouse_type = 'polywood';

-- ─── 4. Transaction production linkage (app post_cash_transaction expects column) ─

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS production_order_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'transactions_production_order_id_fkey'
  ) THEN
    ALTER TABLE public.transactions
      ADD CONSTRAINT transactions_production_order_id_fkey
      FOREIGN KEY (production_order_id)
      REFERENCES public.production_orders(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_transactions_production_order
  ON public.transactions (production_order_id)
  WHERE production_order_id IS NOT NULL;

-- ─── 5. FK hardening (nullable product lines keep RESTRICT on master data) ─────

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.purchase_items'::regclass
      AND contype = 'f'
      AND pg_get_constraintdef(oid) LIKE '%product_id%REFERENCES%products%'
  ) THEN
    ALTER TABLE public.purchase_items
      ADD CONSTRAINT purchase_items_product_id_fkey
      FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE RESTRICT;
  END IF;
END $$;

-- ─── 6. EXECUTE grants: authenticated + service_role (all overloads that exist) ─
-- Note: anon is intentionally excluded from financial mutation RPCs.

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS func
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = ANY(ARRAY[
        'user_has_permission',
        'has_permission',
        'require_permission',
        'is_active_user',
        'post_journal_entry',
        'post_cash_transaction',
        'apply_document_additional_expenses',
        'compute_customer_open_ar',
        'refresh_customer_ar_balance',
        'check_customer_ar_discrepancies',
        'reconcile_customer_ar_balances',
        'void_sale_atomic',
        'compute_supplier_open_ap',
        'refresh_supplier_ap_balance',
        'find_erp_event_by_idempotency',
        'log_erp_event',
        'process_sales_invoice_event',
        'process_invoice_payment_event',
        'process_purchase_receipt_event',
        'create_account_atomic',
        'set_account_opening_balance_atomic',
        'reconcile_account_balance_atomic',
        'create_production_expense_atomic',
        'production_material_line_cost',
        'compute_production_issued_material_cost',
        'compute_production_wip_cost',
        'process_production_material_issue_event',
        'process_production_ready_event',
        'process_production_delivery_event'
      ])
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.func);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
