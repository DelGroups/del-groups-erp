SELECT 'transactions' AS table_name, COUNT(*)::bigint AS n FROM public.transactions
UNION ALL SELECT 'production_orders', COUNT(*) FROM public.production_orders
UNION ALL SELECT 'production_expenses', COUNT(*) FROM public.production_expenses
UNION ALL SELECT 'production_materials', COUNT(*) FROM public.production_materials
UNION ALL SELECT 'purchase_requests', COUNT(*) FROM public.purchase_requests
UNION ALL SELECT 'purchases', COUNT(*) FROM public.purchases
UNION ALL SELECT 'purchase_items', COUNT(*) FROM public.purchase_items
UNION ALL SELECT 'products', COUNT(*) FROM public.products
UNION ALL SELECT 'polywood_pieces', COUNT(*) FROM public.polywood_pieces
UNION ALL SELECT 'warehouse_stocks', COUNT(*) FROM public.warehouse_stocks
UNION ALL SELECT 'payrolls', COUNT(*) FROM public.payrolls
UNION ALL SELECT 'employee_advances', COUNT(*) FROM public.employee_advances
UNION ALL SELECT 'deals', COUNT(*) FROM public.deals
UNION ALL SELECT 'quotations', COUNT(*) FROM public.quotations
UNION ALL SELECT 'accounts_nonzero', COUNT(*) FROM public.accounts WHERE COALESCE(balance, 0) <> 0
UNION ALL SELECT 'warehouses_kept', COUNT(*) FROM public.warehouses
UNION ALL SELECT 'roles_kept', COUNT(*) FROM public.roles
UNION ALL SELECT 'accounts_kept', COUNT(*) FROM public.accounts
ORDER BY 1;
