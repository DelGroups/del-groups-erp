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
select 'pending', '20261028140000_profile_display_names: user names for list columns',
       case when to_regprocedure('public.profile_display_names(uuid[])') is null then 'missing' else 'present' end
union all
select 'pending', '20261028141000_purchases_created_by: purchases.created_by',
       case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'purchases' and column_name = 'created_by') then 'present' else 'missing' end
union all
select 'pending', '20261028142000_inventory_writeoffs_created_by: inventory_writeoffs.created_by',
       case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'inventory_writeoffs' and column_name = 'created_by') then 'present' else 'missing' end
union all
select 'pending', '20261028143000_contracts_created_by: contracts.created_by',
       case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'contracts' and column_name = 'created_by') then 'present' else 'missing' end
union all
select 'pending', '20261029200000_stock_per_warehouse: functions (every stock exit per warehouse)',
       case when to_regprocedure('public.stock_move(uuid,uuid,numeric,boolean)') is null then 'missing' else 'present' end
union all
select 'pending', '20261029300000_duplicate_product_names: duplicate_name in the stock integrity report',
       case when coalesce(pg_get_functiondef(to_regprocedure('public.stock_integrity_report()')), '') like '%duplicate_name%'
            then 'present' else 'missing' end
union all
select 'pending', '20261030100000_imports_core: Imports module tables (import_shipments ...)',
       case when to_regclass('public.import_shipments') is null then 'missing' else 'present' end
union all
select 'pending', '20261030110000_imports_posting: Imports posting (import_payables, confirm_import_shipment ...)',
       case when to_regprocedure('public.confirm_import_shipment(uuid,date,text)') is null then 'missing' else 'present' end
union all
select 'pending', '20261030120000_imports_fx: Imports exchange differences and prepayments',
       case when to_regprocedure('public.prepay_import_supplier(uuid,date,text,numeric,numeric,jsonb,text)') is null then 'missing' else 'present' end
union all
select 'pending', '20261103100000_imports_delete_draft: Delete a draft import (nothing posted)',
       case when to_regprocedure('public.delete_import_draft(uuid)') is null then 'missing' else 'present' end
union all
select 'pending', '20261104100000_imports_line_warehouses: Warehouse split of import lines',
       case when to_regclass('public.import_shipment_line_warehouses') is null then 'missing' else 'present' end
union all
select 'pending', '20261105100000_imports_stages_pay: Payment lines, Pay on import costs, import stages',
       case when to_regclass('public.import_shipment_events') is null then 'missing' else 'present' end
union all
select 'pending', '20261106100000_imports_duty_override: Customs duty typed from the declaration',
       case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'import_cost_lines' and column_name = 'amount_typed') then 'present' else 'missing' end
union all
select 'pending', '20261107100000_gl_partner_cash_account: Partner payments on the cash account''s own ledger',
       case when to_regprocedure('public.gl_coa_for_cash_account(uuid, text)') is null then 'missing' else 'present' end
union all
select 'pending', '20261110100000_inventory_count_responsibles: Inventory count responsible people (employees)',
       case when to_regprocedure('public.inventory_count_set_responsibles(uuid, uuid[], uuid)') is null then 'missing' else 'present' end
union all
select 'pending', '20261111100000_partner_ledger: Partner ledger (read-only view and reports)',
       case when to_regprocedure('public.get_partner_statement(uuid, date, date, text)') is null then 'missing' else 'present' end
union all
select 'pending', '20261111200000_journal_entry_no_sequence: Journal entry numbers from a sequence (no collisions)',
       case when to_regclass('public.journal_entry_no_seq') is null then 'missing' else 'present' end
union all
select 'pending', '20261112100000_gl_partner_tags: Partner on every GL line on 1200 / 2100',
       case when to_regprocedure('public._gl_partner_for_source(text, uuid)') is null then 'missing' else 'present' end
union all
select 'pending', '20261113100000_partner_statement_details: Partner statement: contact fields, document and author per line',
       case when position('created_by_name' in coalesce(pg_get_functiondef(to_regprocedure('public.get_partner_statement(uuid, date, date, text)')), '')) = 0 then 'missing' else 'present' end
union all
select 'pending', '20261114100000_partner_debtor_reports: Debtor / creditor reports and turnover per partner',
       case when to_regprocedure('public.get_debtor_creditor_report(date, text, jsonb, text, text, integer, integer)') is null then 'missing' else 'present' end
union all
select 'pending', '20261110150000_document_date_change_core: change the date of a posted invoice in place (DATE-1)',
       case when to_regclass('public.document_date_changes') is null or to_regprocedure('public.apply_document_date_change(text, uuid, date, text, jsonb, text[])') is null then 'missing' else 'present' end
union all
select 'pending', '20261110151000_document_date_change_cash: change the date of payments, cash rows and expenses in place (DATE-2)',
       case when to_regprocedure('public.resolve_date_change_document(uuid)') is null then 'missing' else 'present' end
union all
select 'pending', '20261110152000_document_date_change_inventory: change the date of inventory and import documents in place (DATE-3)',
       case when to_regprocedure('public._date_change_extra_warnings(text, uuid, date, date)') is null then 'missing' else 'present' end
union all
select 'pending', '20261115100000_lot_core: lot tracking core, backfill and integrity (LOT-1)',
       case when to_regclass('public.stock_lots') is null or to_regprocedure('public.lot_integrity_report(integer)') is null then 'missing' else 'present' end
union all
select 'pending', '20261115110000_lot_inbound: inbound documents create named lots (LOT-2)',
       case when to_regprocedure('public.lot_post_inbound_line(jsonb, uuid, uuid, numeric, jsonb)') is null then 'missing' else 'present' end
union all
select 'pending', '20261115120000_lot_outbound: outbound and moving documents record their lots (LOT-3)',
       case when to_regprocedure('public._lot_check_choice(uuid, uuid, numeric, jsonb, uuid)') is null then 'missing' else 'present' end
union all
select 'pending', '20261115130000_lot_ui: reads of the lot screens (LOT-4)',
       case when to_regprocedure('public.lot_movements_page(uuid, integer, integer)') is null then 'missing' else 'present' end
union all
select 'pending', '20261120100000_accounting_guard_core: Accounting Guard rule engine and findings (GUARD-1)',
       case when to_regclass('public.guard_findings') is null or to_regprocedure('public.guard_scan(text[], text, timestamp with time zone)') is null then 'missing' else 'present' end
union all
select 'pending', '20261120110000_accounting_guard_products: product data and stock rules of the Accounting Guard (GUARD-2)',
       case when to_regprocedure('public.guard_normalize_name(text)') is null or to_regprocedure('public.guard_check_f2(jsonb, timestamp with time zone)') is null then 'missing' else 'present' end
union all
select 'pending', '20261120120000_accounting_guard_ui: Accounting Guard section, reports and bell (GUARD-3)',
       case when to_regclass('public.guard_reports') is null or to_regprocedure('public.guard_dashboard()') is null then 'missing' else 'present' end
union all
select 'pending', '20261120130000_accounting_guard_cron: Accounting Guard automatic scan (GUARD-4)',
       case when to_regprocedure('public.guard_scheduled_run(text)') is null or to_regprocedure('public.guard_set_schedule(boolean, integer, integer, integer)') is null then 'missing' else 'present' end
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
