-- Go-live clean slate: wipe operational mock data, keep infrastructure.
-- KEEP: roles, profiles, settings, system_settings, company_settings,
--       warehouses, categories, financial_categories, expense_categories,
--       chart_of_accounts, accounts (rows), employees, customers, suppliers,
--       commission_rules.
-- RUN ONCE against the linked production database (not a replayable migration).

DO $$
DECLARE
  wipe text[] := ARRAY[
    'audit_alerts',
    'audit_logs',
    'salary_payments',
    'sales_commissions',
    'employee_advances',
    'employee_leaves',
    'payrolls',
    'journal_entry_lines',
    'journal_entries',
    'erp_events',
    'stock_movements',
    'warehouse_slip_items',
    'warehouse_slips',
    'inventory_audit_items',
    'inventory_audits',
    'inventory_adjustment_vouchers',
    'inventory_writeoffs',
    'consignment_returns',
    'consignment_monthly_reports',
    'consignment_inventory',
    'consignment_dispatches',
    'consignment_orders',
    'consignment_partners',
    'consignment_items',
    'sale_items',
    'sales',
    'purchase_items',
    'purchases',
    'purchase_requests',
    'expenses',
    'production_expenses',
    'production_stock_reservations',
    'production_materials',
    'production_outsourcing',
    'production_contractors',
    'production_contracts',
    'production_bom_items',
    'production_boms',
    'production_orders',
    'polywood_pieces',
    'warehouse_stocks',
    'supplier_delivery_ratings',
    'quotations',
    'deals',
    'contracts',
    'transactions',
    'products'
  ];
  existing text[] := ARRAY[]::text[];
  t text;
  stmt text;
BEGIN
  FOREACH t IN ARRAY wipe LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name = t
        AND table_type = 'BASE TABLE'
    ) THEN
      existing := array_append(existing, format('%I', t));
    END IF;
  END LOOP;

  IF existing IS NULL OR array_length(existing, 1) IS NULL THEN
    RAISE NOTICE 'go_live_wipe: no operational tables found';
    RETURN;
  END IF;

  stmt := 'TRUNCATE TABLE ' || array_to_string(existing, ', ') || ' RESTART IDENTITY CASCADE';
  EXECUTE stmt;
  RAISE NOTICE 'go_live_wipe: truncated % tables', array_length(existing, 1);
END $$;

UPDATE public.accounts SET balance = 0 WHERE COALESCE(balance, 0) <> 0;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'balance'
  ) THEN
    EXECUTE 'UPDATE public.customers SET balance = 0 WHERE COALESCE(balance, 0) <> 0';
  END IF;
END $$;
