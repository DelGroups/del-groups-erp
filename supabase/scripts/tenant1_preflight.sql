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
select 'pending', '20261014100000_tenant_limits: table (no row = no limits)',
       case when to_regclass('public.tenant_limits') is null then 'missing' else 'present' end
union all
select 'pending', '20261014110000_view_favorites: table (saved searches of the new UI)',
       case when to_regclass('public.view_favorites') is null then 'missing' else 'present' end
union all
select 'pending', '20261015100000_activities_chatter: tables (chatter of the new UI)',
       case when to_regclass('public.mail_messages') is null or to_regclass('public.activities') is null then 'missing' else 'present' end
union all
select 'pending', '20261017100000_inventory_count_add_product: function (add a product to an open count)',
       case when to_regprocedure('public.inventory_count_add_product(uuid,uuid)') is null then 'missing' else 'present' end
union all
select 'pending', '20261017110000_inventory_count_start_all_category_products: category count lists every product of the category',
       case when exists (
         select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.proname = 'inventory_count_start' and p.prosrc like '%WITH scope AS%'
       ) then 'yes' else 'no' end
union all
select 'pending', '20261017120000_invoice_payment_date: function (invoice payments keep the chosen date)',
       case when to_regprocedure('public.apply_invoice_payment_date(uuid,uuid,date)') is null then 'missing' else 'present' end
union all
select 'pending', '20261024100000_calendar: tables (calendar of the new UI)',
       case when to_regclass('public.calendar_events') is null or to_regclass('public.calendar_attendees') is null
              or to_regclass('public.calendar_reminders') is null then 'missing' else 'present' end
union all
select 'pending', '20261024110000_todo: tables (to-do of the new UI)',
       case when to_regclass('public.todo_tasks') is null or to_regclass('public.todo_task_members') is null
              or to_regclass('public.todo_stages') is null then 'missing' else 'present' end
union all
select 'pending', '20261024120000_documents: tables (documents of the new UI)',
       case when to_regclass('public.documents') is null or to_regclass('public.document_folders') is null
              or to_regclass('public.document_requests') is null then 'missing' else 'present' end
union all
select 'pending', '20261025100000_crm_pipeline: tables and deals.stage_id (new CRM pipeline)',
       case when to_regclass('public.crm_stages') is null or to_regclass('public.crm_teams') is null
              or not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'deals' and column_name = 'stage_id')
            then 'missing' else 'present' end
union all
select 'pending', '20261025110000_home_layouts: tables (widget home)',
       case when to_regclass('public.home_layouts') is null or to_regclass('public.home_layout_defaults') is null then 'missing' else 'present' end
union all
select 'pending', '20261025120000_home_financial_rpcs: functions (widget home figures)',
       case when to_regprocedure('public.can_view_financials()') is null or to_regprocedure('public.home_financial_summary(date,date)') is null then 'missing' else 'present' end
union all
select 'pending', '20261028181000_product_stock_integrity: functions (stock trigger per warehouse, Settings > Stock integrity)',
       case when to_regprocedure('public.adjust_warehouse_stock(uuid,uuid,numeric)') is null or to_regprocedure('public.stock_integrity_report()') is null then 'missing' else 'present' end
union all
select 'pending', '20261028182000_inventory_count_backdate_admin_edit: functions (backdated counts, unpost)',
       case when to_regprocedure('public.inventory_count_today()') is null or to_regprocedure('public.inventory_count_unpost(uuid,text,uuid)') is null then 'missing' else 'present' end
union all
select 'pending', '20261029100000_backdated_invoices_payments: invoice date on every record, admin edit of posted invoices',
       case when to_regprocedure('public.document_timestamp()') is null or to_regclass('public.invoice_amendments') is null then 'missing' else 'present' end
union all
select 'pending', '20261029200000_stock_per_warehouse: functions (every stock exit per warehouse)',
       case when to_regprocedure('public.stock_move(uuid,uuid,numeric,boolean)') is null then 'missing' else 'present' end
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
