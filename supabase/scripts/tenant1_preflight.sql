-- Tenant #1 cutover (prompt 11), step 1 and step 9: READ-ONLY state of the Del Groups database.
--
-- Run in the Supabase SQL Editor of the ERP project (or psql) before the cutover and again
-- after it, and keep both outputs. It changes nothing: one SELECT, no writes. Tables that do
-- not exist yet show NULL instead of failing.
--
--   section      what
--   history      supabase_migrations.schema_migrations: does it exist, how many rows, newest
--   pending      for each migration newer than supabase/baseline/VERSION: is its effect there?
--   data         row counts and stock total; must not drop between the two runs
--
-- docs/runbooks/tenant-1-cutover.md explains how to read it.

with
counted as (
  -- n(table): row count, or null when the table does not exist.
  select t.name,
         case when to_regclass('public.' || t.name) is not null then
           (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', t.name), false, true, '')))[1]::text::bigint
         end as n
    from unnest(array[
      'sales', 'sale_items', 'products', 'customers', 'suppliers', 'purchases', 'warehouses',
      'warehouse_stocks', 'transactions', 'journal_entries', 'employees', 'profiles', 'tenant_modules'
    ]) as t(name)
)
select 'history' as section, 'schema_migrations table' as item,
       case when to_regclass('supabase_migrations.schema_migrations') is null then 'missing' else 'present' end as value
union all
select 'history', 'schema_migrations rows',
       case when to_regclass('supabase_migrations.schema_migrations') is not null then
         (xpath('/row/c/text()', query_to_xml('select count(*) as c from supabase_migrations.schema_migrations', false, true, '')))[1]::text
       end
union all
select 'history', 'newest recorded version',
       case when to_regclass('supabase_migrations.schema_migrations') is not null then
         (xpath('/row/v/text()', query_to_xml('select max(version) as v from supabase_migrations.schema_migrations', false, true, '')))[1]::text
       end
union all
select 'pending', '20261011120000_company_profile: table',
       case when to_regclass('public.company_profile') is null then 'missing' else 'present' end
union all
select 'pending', '20261011120000_company_profile: display name',
       case when to_regclass('public.company_profile') is not null then
         coalesce((xpath('/row/d/text()', query_to_xml('select display_name as d from public.company_profile limit 1', false, true, '')))[1]::text, '(empty)')
       end
union all
select 'pending', '20261011130000_tenant_modules: table',
       case when to_regclass('public.tenant_modules') is null then 'missing (app treats every module as on)' else 'present' end
union all
select 'pending', '20261011140000_fix_is_admin_role_column: is_admin() uses user_is_admin()',
       case when exists (
         select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'is_admin' and p.prosrc like '%user_is_admin%'
       ) then 'yes' else 'no' end
union all
select 'pending', '20261011150000_enable_rls_on_remaining_tables: tables of that list still without RLS',
       (select count(*)::text
          from pg_class c join pg_namespace n on n.oid = c.relnamespace
         where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
           and c.relname in (
             'chart_of_accounts', 'document_expenses', 'erp_events', 'expense_categories',
             'financial_categories', 'inventory_batch_consumptions', 'inventory_batches',
             'inventory_initial_balance_items', 'inventory_initial_balances', 'journal_entries',
             'journal_entry_lines', 'n8n_chat_histories', 'partners', 'payments',
             'polywood_inventory_items', 'polywood_pieces', 'product_bom', 'production_contractors',
             'production_contracts', 'production_expenses', 'production_materials',
             'production_outsourcing', 'purchase_requests', 'sub_categories',
             'supplier_delivery_ratings', 'warehouse_stocks'))
union all
select 'data', 'rows in ' || name, n::text from counted
union all
select 'data', 'auth users', (select count(*)::text from auth.users)
union all
select 'data', 'stock total (sum of warehouse_stocks.current_stock)',
       case when to_regclass('public.warehouse_stocks') is not null then
         (xpath('/row/s/text()', query_to_xml('select coalesce(sum(current_stock), 0) as s from public.warehouse_stocks', false, true, '')))[1]::text
       end
union all
select 'data', 'newest sale',
       case when to_regclass('public.sales') is not null then
         (xpath('/row/s/text()', query_to_xml(
           'select coalesce(invoice_number, id::text) || '' at '' || created_at::text as s from public.sales order by created_at desc nulls last limit 1',
           false, true, '')))[1]::text
       end;
