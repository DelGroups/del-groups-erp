-- Checks supabase/migrations/20261112100000_gl_partner_tags.sql (LED-2) and the history scripts
-- on a database built with scripts/db/build-fresh.sh --plain-postgres. Movements are made by the
-- real RPCs. Any failed check raises an exception; the last line prints ALL CHECKS PASSED.
-- Leaves test rows behind: run it on a throwaway database only.

-- Other tests re-run older migrations (e.g. imports_stages_pay.sql re-applies
-- 20261105100000, which redefines _post_payment_lines without the partner tag): apply this
-- migration first, so the test checks its functions whatever ran before on this database.
\ir ../migrations/20261112100000_gl_partner_tags.sql

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0ed2-00000000000a', 'led2-a@example.test', '{"full_name": "Leyla Admin", "role_name": "Admin"}')
on conflict (id) do nothing;
update public.profiles set role_id = (select id from public.roles where name = 'Admin' order by is_system desc limit 1), is_active = true
where id = '00000000-0000-0000-0ed2-00000000000a';

insert into public.warehouses (id, code, name, is_default, created_at) values
  ('00000000-0000-0000-0ed2-0000000000e1', 'LED2-A', 'LED2 anbar', false, now()),
  ('00000000-0000-0000-0ed2-0000000000e2', 'LED2-B', 'LED2 mebel', false, now())
on conflict (id) do nothing;
insert into public.accounts (id, code, name, type, balance, is_vat_account) values
  ('00000000-0000-0000-0ed2-0000000000a1', 'LED2-K', 'LED2 Kassa', 'cash', 100000, false),
  ('00000000-0000-0000-0ed2-0000000000a2', 'LED2-B', 'LED2 Bank', 'bank', 100000, false)
on conflict (id) do nothing;
insert into public.customers (id, full_name) values
  ('00000000-0000-0000-0ed2-0000000000c1', 'LED2 paid at creation'),
  ('00000000-0000-0000-0ed2-0000000000c2', 'LED2 paid later, two accounts'),
  ('00000000-0000-0000-0ed2-0000000000c3', 'LED2 opening'),
  ('00000000-0000-0000-0ed2-0000000000c4', 'LED2 production customer')
on conflict (id) do nothing;
insert into public.suppliers (id, full_name, entity_type) values
  ('00000000-0000-0000-0ed2-0000000000d1', 'LED2 supplier paid later', 'legal'),
  ('00000000-0000-0000-0ed2-0000000000d2', 'LED2 supplier opening', 'legal')
on conflict (id) do nothing;
insert into public.products (id, code, name, stock, buy_price, is_service, inventory_mode, full_sheet_length_m, unit) values
  ('00000000-0000-0000-0ed2-000000000001', 'LED2-P1', 'LED2 sold', 0, 5, false, 'standard', 4, 'Ədəd'),
  ('00000000-0000-0000-0ed2-000000000002', 'LED2-P2', 'LED2 bought', 0, 5, false, 'standard', 4, 'Ədəd'),
  ('00000000-0000-0000-0ed2-000000000003', 'LED2-M', 'LED2 material', 0, 1, false, 'standard', 4, 'Ədəd'),
  ('00000000-0000-0000-0ed2-000000000004', 'LED2-F', 'LED2 furniture', 0, 0, false, 'standard', 4, 'Ədəd')
on conflict (id) do nothing;
select public.adjust_warehouse_stock('00000000-0000-0000-0ed2-000000000001', '00000000-0000-0000-0ed2-0000000000e1', 100);
select public.create_inventory_batch('00000000-0000-0000-0ed2-000000000001', gen_random_uuid(), 'purchase', 5, 100);
select public.adjust_warehouse_stock('00000000-0000-0000-0ed2-000000000003', '00000000-0000-0000-0ed2-0000000000e2', 10);
select public.create_inventory_batch('00000000-0000-0000-0ed2-000000000003', gen_random_uuid(), 'purchase', 1, 10);

create or replace function pg_temp.sale_payload(p_customer uuid, p_qty numeric, p_price numeric, p_payments jsonb)
returns jsonb language sql as $$
  select jsonb_build_object(
    'header', jsonb_build_object('customer_id', p_customer, 'doc_date', public.document_today()::text,
      'total_amount', p_qty * p_price, 'subtotal', p_qty * p_price,
      'paid_amount', coalesce((select sum((x->>'amount')::numeric) from jsonb_array_elements(p_payments) x), 0),
      'remaining_balance', p_qty * p_price - coalesce((select sum((x->>'amount')::numeric) from jsonb_array_elements(p_payments) x), 0)),
    'items', jsonb_build_array(jsonb_build_object('product_id', '00000000-0000-0000-0ed2-000000000001', 'product_name', 'LED2', 'quantity', p_qty,
      'unit_price', p_price, 'line_total', p_qty * p_price, 'total', p_qty * p_price, 'warehouse_id', '00000000-0000-0000-0ed2-0000000000e1')),
    'payments', p_payments);
$$;
create or replace function pg_temp.partner_of(p_customer uuid, p_supplier uuid) returns uuid language sql as $$
  select public.resolve_unified_partner_id(p_customer, p_supplier);
$$;
create temp table led2_ids (k text primary key, id uuid);
grant all on led2_ids to authenticated;

-- ── Movements as the admin ──────────────────────────────────────────────────
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0ed2-00000000000a","role":"authenticated"}', false);
do $$
declare
  v_id uuid;
  v_order uuid := '00000000-0000-0000-0ed2-0000000000f1';
begin
  -- A sale paid at creation (the form's payment: post_cash_transaction).
  v_id := (public.save_sales_invoice_draft(pg_temp.sale_payload('00000000-0000-0000-0ed2-0000000000c1', 3, 10,
    jsonb_build_array(jsonb_build_object('account_id', '00000000-0000-0000-0ed2-0000000000a1', 'amount', 30, 'method', 'Nağd')))) ->> 'sale_id')::uuid;
  perform public.post_sales_invoice_draft(v_id);

  -- A sale paid later over two accounts (_post_payment_lines).
  v_id := (public.save_sales_invoice_draft(pg_temp.sale_payload('00000000-0000-0000-0ed2-0000000000c2', 5, 10, '[]'::jsonb)) ->> 'sale_id')::uuid;
  perform public.post_sales_invoice_draft(v_id);
  perform public.process_invoice_payment_event(jsonb_build_object('document_type', 'sale', 'document_id', v_id, 'idempotency_key', 'led2-sale-lines',
    'lines', jsonb_build_array(
      jsonb_build_object('account_id', '00000000-0000-0000-0ed2-0000000000a1', 'amount', 15, 'method', 'Nağd'),
      jsonb_build_object('account_id', '00000000-0000-0000-0ed2-0000000000a2', 'amount', 5, 'method', 'Bank'))));

  -- A purchase paid later from one account (post_cash_transaction, money out).
  v_id := (public.save_purchase_invoice_draft(jsonb_build_object(
    'header', jsonb_build_object('supplier_id', '00000000-0000-0000-0ed2-0000000000d1', 'doc_date', public.document_today()::text,
      'warehouse_id', '00000000-0000-0000-0ed2-0000000000e1', 'invoice_number', 'LED2-PUR-1', 'total_amount', 50, 'paid_amount', 0, 'debt_amount', 50),
    'items', jsonb_build_array(jsonb_build_object('product_id', '00000000-0000-0000-0ed2-000000000002', 'product_name', 'LED2', 'quantity', 10, 'unit_price', 5, 'total', 50)),
    'payments', '[]'::jsonb)) ->> 'purchase_id')::uuid;
  perform public.post_purchase_invoice_draft(v_id);
  perform public.process_invoice_payment_event(jsonb_build_object('document_type', 'purchase', 'document_id', v_id,
    'amount', 20, 'account_id', '00000000-0000-0000-0ed2-0000000000a1', 'method', 'Nağd', 'idempotency_key', 'led2-pur-pay'));

  -- Opening balances: set, then changed (two journals each).
  perform public.set_customer_opening_balance_atomic('00000000-0000-0000-0ed2-0000000000c3', 100);
  perform public.set_customer_opening_balance_atomic('00000000-0000-0000-0ed2-0000000000c3', 150);
  perform public.set_supplier_opening_balance_atomic('00000000-0000-0000-0ed2-0000000000d2', 70);
  perform public.set_supplier_opening_balance_atomic('00000000-0000-0000-0ed2-0000000000d2', 40);
end $$;
reset role;

-- A production order for a customer: advance (post_cash_transaction, source 'production'),
-- materials, finished goods, delivery (its sales invoice and the 1200 revenue line).
do $$
declare
  v_order uuid := '00000000-0000-0000-0ed2-0000000000f1';
begin
  insert into public.production_orders (id, project_name, type, status, customer_id, customer_name, finished_product_id, quantity,
    warehouse_id, furniture_warehouse_id, order_no, total_project_price)
  values (v_order, 'LED2 order', 'Series', 'Draft', '00000000-0000-0000-0ed2-0000000000c4', 'LED2 production customer',
    '00000000-0000-0000-0ed2-000000000004', 2, '00000000-0000-0000-0ed2-0000000000e1', '00000000-0000-0000-0ed2-0000000000e2', 'LED2-PO-1', 200);
  insert into public.production_materials (id, production_order_id, product_id, quantity, unit, warehouse_id, unit_cost)
  values (gen_random_uuid(), v_order, '00000000-0000-0000-0ed2-000000000003', 4, 'Ədəd', '00000000-0000-0000-0ed2-0000000000e2', 1);
  perform public.process_production_advance_payment_event(jsonb_build_object('order_id', v_order, 'amount', 60,
    'account_id', '00000000-0000-0000-0ed2-0000000000a1', 'idempotency_key', 'led2-advance'));
  perform public.process_production_material_issue_event(v_order, null, null);
  update public.production_orders set status = 'In-Progress' where id = v_order;
  perform public.process_production_ready_event(v_order);
  perform public.process_production_delivery_event(v_order, '00000000-0000-0000-0ed2-0000000000a1');
end $$;

-- ── Every 1200 / 2100 line of the fixtures carries the right partners.id ────
do $$
declare
  v_bad text;
  v_n int;
begin
  -- Every fixture has its partner (else the comparison below would prove nothing).
  if exists (select 1 from unnest(array['00000000-0000-0000-0ed2-0000000000c1', '00000000-0000-0000-0ed2-0000000000c2',
               '00000000-0000-0000-0ed2-0000000000c3', '00000000-0000-0000-0ed2-0000000000c4']::uuid[]) c where pg_temp.partner_of(c, null) is null)
     or exists (select 1 from unnest(array['00000000-0000-0000-0ed2-0000000000d1', '00000000-0000-0000-0ed2-0000000000d2']::uuid[]) s
                where pg_temp.partner_of(null, s) is null) then
    raise exception 'FAIL fixture without a partners row';
  end if;

  -- Each fixture entry and the ONE partner its 1200 / 2100 lines must carry.
  with expected as (
    -- Invoice journals and delivery revenue (document or source = the sale / purchase).
    select e.id as entry_id, pg_temp.partner_of(s.customer_id, null) as partner
    from public.journal_entries e join public.sales s on s.id in (e.document_id, e.source_id)
    where s.customer_id::text like '00000000-0000-0000-0ed2-%'
    union
    select e.id, pg_temp.partner_of(null, p.supplier_id)
    from public.journal_entries e join public.purchases p on p.id in (e.document_id, e.source_id)
    where p.supplier_id::text like '00000000-0000-0000-0ed2-%'
    union
    -- Cash journals (single and multi-account): the document the cash pays.
    select t.journal_entry_id, pg_temp.partner_of(s.customer_id, null)
    from public.transactions t join public.sales s on s.id = t.source_id
    where t.source_type = 'sale' and s.customer_id::text like '00000000-0000-0000-0ed2-%'
    union
    select t.journal_entry_id, pg_temp.partner_of(null, p.supplier_id)
    from public.transactions t join public.purchases p on p.id = t.source_id
    where t.source_type = 'purchase' and p.supplier_id::text like '00000000-0000-0000-0ed2-%'
    union
    select t.journal_entry_id, pg_temp.partner_of('00000000-0000-0000-0ed2-0000000000c4', null)
    from public.transactions t where t.source_type = 'production' and t.source_id = '00000000-0000-0000-0ed2-0000000000f1'
    union
    -- Opening balances.
    select e.id, pg_temp.partner_of(e.document_id, null) from public.journal_entries e
    where e.document_type = 'customer_opening_balance' and e.document_id = '00000000-0000-0000-0ed2-0000000000c3'
    union
    select e.id, pg_temp.partner_of(null, e.document_id) from public.journal_entries e
    where e.document_type = 'supplier_opening_balance' and e.document_id = '00000000-0000-0000-0ed2-0000000000d2'
  )
  select string_agg(format('%s %s/%s %s', e.document_type, a.code, coalesce(e.source_type, '-'), coalesce(l.partner_id::text, 'NULL')), '; '),
         count(*)
  into v_bad, v_n
  from expected x
  join public.journal_entries e on e.id = x.entry_id
  join public.journal_entry_lines l on l.journal_entry_id = e.id
  join public.chart_of_accounts a on a.id = l.coa_id
  where a.code in ('1200', '2100')
    and l.partner_id is distinct from x.partner;
  if v_bad is not null then raise exception 'FAIL % lines on 1200/2100 without their own partner: %', v_n, v_bad; end if;

  -- Each kind of posting was really checked.
  select count(*) into v_n from public.journal_entry_lines l join public.chart_of_accounts a on a.id = l.coa_id
  join public.journal_entries e on e.id = l.journal_entry_id
  where a.code in ('1200', '2100') and e.document_type in ('customer_opening_balance', 'supplier_opening_balance')
    and e.document_id in ('00000000-0000-0000-0ed2-0000000000c3', '00000000-0000-0000-0ed2-0000000000d2');
  if v_n <> 4 then raise exception 'FAIL opening balance journals: % (expected 4)', v_n; end if;
  if not exists (select 1 from public.journal_entries where source_type = 'payment_lines'
                 and id in (select journal_entry_id from public.transactions where source_type = 'sale')) then
    raise exception 'FAIL the multi-account payment was not posted';
  end if;
  if not exists (select 1 from public.transactions where source_type = 'production' and source_id = '00000000-0000-0000-0ed2-0000000000f1') then
    raise exception 'FAIL the production advance was not posted';
  end if;
  if not exists (select 1 from public.sales where customer_id = '00000000-0000-0000-0ed2-0000000000c4') then
    raise exception 'FAIL the delivery created no sale';
  end if;
  if exists (select 1 from public.journal_entry_lines where partner_type = 'customer' and partner_id = '00000000-0000-0000-0ed2-0000000000c4') then
    raise exception 'FAIL a customers.id is still used as partner_id';
  end if;
  -- Idempotency keys unchanged.
  if exists (select 1 from public.transactions t join public.journal_entries e on e.id = t.journal_entry_id
             where t.source_type in ('sale', 'purchase') and e.source_type = 'cash_transaction' and e.idempotency_key <> 'cash_tx:' || t.id::text
               and (t.source_id in (select id from public.sales where customer_id in ('00000000-0000-0000-0ed2-0000000000c1', '00000000-0000-0000-0ed2-0000000000c2'))
                 or t.source_id in (select id from public.purchases where supplier_id = '00000000-0000-0000-0ed2-0000000000d1'))) then
    raise exception 'FAIL cash journal idempotency key changed';
  end if;
end $$;

-- Opening balances: only for those who may set them (they were open to anyone, even anon).
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0ed2-00000000000b', 'led2-s@example.test', '{"full_name": "Səməd Sales"}')
on conflict (id) do nothing;
insert into public.roles (id, name, permissions, is_system)
values ('00000000-0000-0000-0ed2-0000000000f9', 'LED2 Sales only', '{"can_view_sales": true, "can_create_invoice": true}'::jsonb, false)
on conflict (id) do nothing;
update public.profiles set role_id = '00000000-0000-0000-0ed2-0000000000f9', is_active = true where id = '00000000-0000-0000-0ed2-00000000000b';
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0ed2-00000000000b","role":"authenticated"}', true);
do $$
declare
  v_ok boolean := false;
begin
  begin perform public.set_customer_opening_balance_atomic('00000000-0000-0000-0ed2-0000000000c3', 999999);
  exception when insufficient_privilege then v_ok := true; end;
  if not v_ok then raise exception 'FAIL a user without can_manage_settings set an opening balance'; end if;
end $$;
rollback;
begin;
set local role anon;
do $$
declare
  v_ok boolean := false;
begin
  begin perform public.set_supplier_opening_balance_atomic('00000000-0000-0000-0ed2-0000000000d2', 999999);
  exception when insufficient_privilege then v_ok := true; end;
  if not v_ok then raise exception 'FAIL anon set an opening balance'; end if;
end $$;
rollback;

-- A cash row with no document still posts, without a partner (backward compatible).
do $$
declare
  v_tx uuid := public.post_cash_transaction('00000000-0000-0000-0ed2-0000000000a1', 'Mədaxil', 7, 'Satış Ödənişi', 'LED2 manual', null, null, null);
begin
  if exists (select 1 from public.journal_entry_lines l join public.transactions t on t.journal_entry_id = l.journal_entry_id
             where t.id = v_tx and l.partner_id is not null) then
    raise exception 'FAIL a manual cash row got a partner';
  end if;
end $$;

-- ── LED-1 integrity: zero GL delta for every fixture partner ────────────────
do $$
declare
  r record;
  v_bad text;
begin
  select string_agg(format('%s ledger %s GL %s', partner_name, ledger_balance, gl_balance), '; ') into v_bad
  from public.check_partner_ledger_integrity()
  where partner_id in (
    select pg_temp.partner_of(c, null) from unnest(array['00000000-0000-0000-0ed2-0000000000c1', '00000000-0000-0000-0ed2-0000000000c2',
      '00000000-0000-0000-0ed2-0000000000c3', '00000000-0000-0000-0ed2-0000000000c4']::uuid[]) c
    union all select pg_temp.partner_of(null, s) from unnest(array['00000000-0000-0000-0ed2-0000000000d1', '00000000-0000-0000-0ed2-0000000000d2']::uuid[]) s)
    and abs(delta_gl) >= 0.01;
  if v_bad is not null then raise exception 'FAIL GL and partner ledger differ: %', v_bad; end if;
  -- And the balances are the expected ones (sale 30 paid 30; 50 - 20; opening 150; purchase -50 + 20;
  -- opening -40; production: invoice 200 - advance 60).
  select string_agg(format('%s %s', partner_name, ledger_balance), '; ') into v_bad
  from public.check_partner_ledger_integrity()
  where (partner_id, ledger_balance) in (
    (pg_temp.partner_of('00000000-0000-0000-0ed2-0000000000c2', null), 30),
    (pg_temp.partner_of('00000000-0000-0000-0ed2-0000000000c3', null), 150),
    (pg_temp.partner_of(null, '00000000-0000-0000-0ed2-0000000000d1'), -30),
    (pg_temp.partner_of(null, '00000000-0000-0000-0ed2-0000000000d2'), -40));
  if (select count(*) from public.check_partner_ledger_integrity()
      where (partner_id, ledger_balance) in (
        (pg_temp.partner_of('00000000-0000-0000-0ed2-0000000000c2', null), 30),
        (pg_temp.partner_of('00000000-0000-0000-0ed2-0000000000c3', null), 150),
        (pg_temp.partner_of(null, '00000000-0000-0000-0ed2-0000000000d1'), -30),
        (pg_temp.partner_of(null, '00000000-0000-0000-0ed2-0000000000d2'), -40))) <> 4 then
    raise exception 'FAIL fixture balances: %', (select string_agg(format('%s %s', partner_name, ledger_balance), '; ') from public.check_partner_ledger_integrity());
  end if;
end $$;

-- ── History: an old line without its partner is found and fixed by the scripts ──
create temp table led2_old as
select distinct l.id, l.partner_id from public.journal_entry_lines l
join public.chart_of_accounts a on a.id = l.coa_id
join public.transactions t on t.journal_entry_id = l.journal_entry_id
where a.code = '1200' and t.source_type = 'sale'
  and t.source_id in (select id from public.sales where customer_id = '00000000-0000-0000-0ed2-0000000000c2');
-- As posted before this migration: no partner.
update public.journal_entry_lines set partner_id = null, partner_type = null where id in (select id from led2_old);

-- The two read-only reports run (their rows go to the log).
\ir ../scripts/gl_partner_tags_report.sql
\ir ../scripts/opening_balance_journals_report.sql
\ir ../scripts/gl_partner_tags_backfill.sql

do $$
begin
  if exists (select 1 from public.journal_entry_lines l join led2_old o on o.id = l.id where l.partner_id is distinct from o.partner_id) then
    raise exception 'FAIL the backfill did not restore the partner';
  end if;
  if (select count(*) from public.audit_logs where table_name = 'journal_entry_lines' and new_values_json ->> 'event' = 'LED2_GL_PARTNER_BACKFILL'
        and record_id in (select id from led2_old)) <> (select count(*) from led2_old) then
    raise exception 'FAIL the backfill left no audit trail';
  end if;
end $$;

-- A second run changes nothing.
create temp table led2_audit_before as select count(*) as n from public.audit_logs where new_values_json ->> 'event' = 'LED2_GL_PARTNER_BACKFILL';
\ir ../scripts/gl_partner_tags_backfill.sql
do $$
begin
  if (select count(*) from public.audit_logs where new_values_json ->> 'event' = 'LED2_GL_PARTNER_BACKFILL'
        and record_id in (select id from led2_old)) <> (select count(*) from led2_old) then
    raise exception 'FAIL the backfill is not idempotent';
  end if;
end $$;

-- The migration runs twice without errors.
\ir ../migrations/20261112100000_gl_partner_tags.sql

select 'ALL CHECKS PASSED';
