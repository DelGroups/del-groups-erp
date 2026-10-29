-- Checks supabase/migrations/20261029100000_backdated_invoices_payments.sql on a database built with
-- scripts/db/build-fresh.sh --plain-postgres (CI: .github/workflows/db-baseline.yml).
-- Any failed check raises an exception; the last line prints ALL CHECKS PASSED.
-- Leaves test rows behind: run it on a throwaway database only.
--
-- Users: A admin, M manager (may create and edit invoices, is not an admin).

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-00f1-00000000000a', 'bi-a@example.test', '{"full_name": "Aydan Admin", "role_name": "Admin"}'),
  ('00000000-0000-0000-00f1-00000000000b', 'bi-m@example.test', '{"full_name": "Mətin Manager", "role_name": "Manager"}')
on conflict (id) do nothing;
update public.profiles set role_id = (select id from public.roles where name = 'Admin' order by is_system desc limit 1), is_active = true
where id = '00000000-0000-0000-00f1-00000000000a';
update public.profiles set role_id = (select id from public.roles where name = 'Manager' order by is_system desc limit 1), is_active = true
where id = '00000000-0000-0000-00f1-00000000000b';

insert into public.warehouses (id, code, name, is_default, created_at) values
  ('00000000-0000-0000-00f1-0000000000e1', 'BI-W', 'BI main', true, now()) on conflict (id) do nothing;
insert into public.accounts (id, code, name, balance) values
  ('00000000-0000-0000-00f1-0000000000a1', 'BI-CASH', 'BI cash', 10000) on conflict (id) do nothing;
insert into public.customers (id, full_name) values
  ('00000000-0000-0000-00f1-0000000000c1', 'BI customer'),
  ('00000000-0000-0000-00f1-0000000000c2', 'BI customer amended'),
  ('00000000-0000-0000-00f1-0000000000c3', 'BI customer fresh')
on conflict (id) do nothing;
insert into public.suppliers (id, full_name) values ('00000000-0000-0000-00f1-0000000000d1', 'BI supplier') on conflict (id) do nothing;
-- P1 plain sales, PA amended sale, PB the same sale posted fresh, PP purchases.
insert into public.products (id, code, name, stock, buy_price, is_service, inventory_mode, full_sheet_length_m) values
  ('00000000-0000-0000-00f1-000000000001', 'BI-P1', 'BI product', 0, 5, false, 'standard', 4),
  ('00000000-0000-0000-00f1-0000000000aa', 'BI-PA', 'BI amended', 0, 5, false, 'standard', 4),
  ('00000000-0000-0000-00f1-0000000000bb', 'BI-PB', 'BI fresh',   0, 5, false, 'standard', 4),
  ('00000000-0000-0000-00f1-0000000000ff', 'BI-PP', 'BI bought',  0, 5, false, 'standard', 4)
on conflict (id) do nothing;
select public.adjust_warehouse_stock(p, '00000000-0000-0000-00f1-0000000000e1', 50) from unnest(array[
  '00000000-0000-0000-00f1-000000000001', '00000000-0000-0000-00f1-0000000000aa', '00000000-0000-0000-00f1-0000000000bb']::uuid[]) p;
select public.create_inventory_batch(p, gen_random_uuid(), 'purchase', 5, 50) from unnest(array[
  '00000000-0000-0000-00f1-000000000001', '00000000-0000-0000-00f1-0000000000aa', '00000000-0000-0000-00f1-0000000000bb']::uuid[]) p;

-- A closed month for the period check.
insert into public.accounting_periods (period_year, period_month, status) values (2025, 1, 'closed')
on conflict do nothing;

-- Builds a sales draft payload.
create or replace function pg_temp.sale_payload(p_customer uuid, p_product uuid, p_date date, p_qty numeric, p_price numeric, p_payments jsonb)
returns jsonb language sql as $$
  select jsonb_build_object(
    'header', jsonb_build_object('customer_id', p_customer, 'doc_date', p_date::text,
      'total_amount', p_qty * p_price, 'subtotal', p_qty * p_price,
      'paid_amount', coalesce((select sum((x->>'amount')::numeric) from jsonb_array_elements(p_payments) x), 0),
      'remaining_balance', p_qty * p_price - coalesce((select sum((x->>'amount')::numeric) from jsonb_array_elements(p_payments) x), 0)),
    'items', jsonb_build_array(jsonb_build_object('product_id', p_product, 'product_name', 'BI', 'quantity', p_qty,
      'unit_price', p_price, 'line_total', p_qty * p_price, 'total', p_qty * p_price, 'warehouse_id', '00000000-0000-0000-00f1-0000000000e1')),
    'payments', p_payments);
$$;

create temp table bi_ids (k text primary key, id uuid);
grant all on bi_ids to authenticated;

-- ── Backdated sale and purchase posted by a non-admin ──────────────────────
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-00f1-00000000000b","role":"authenticated"}', true);
do $$
declare
  v_doc date := public.document_today() - 10;
  v_sale uuid;
  v_pur uuid;
  v_bad text;
begin
  v_sale := (public.save_sales_invoice_draft(pg_temp.sale_payload('00000000-0000-0000-00f1-0000000000c1', '00000000-0000-0000-00f1-000000000001',
    v_doc, 3, 10, jsonb_build_array(jsonb_build_object('account_id', '00000000-0000-0000-00f1-0000000000a1', 'amount', 10, 'method', 'Nağd')))) ->> 'sale_id')::uuid;
  perform public.post_sales_invoice_draft(v_sale);
  insert into bi_ids values ('backdated_sale', v_sale);

  -- Purchase with an in-form payment dated after the invoice.
  v_pur := (public.save_purchase_invoice_draft(jsonb_build_object(
    'header', jsonb_build_object('supplier_id', '00000000-0000-0000-00f1-0000000000d1', 'doc_date', v_doc::text,
      'warehouse_id', '00000000-0000-0000-00f1-0000000000e1', 'invoice_number', 'BI-PUR-1', 'total_amount', 50, 'paid_amount', 10, 'debt_amount', 40),
    'items', jsonb_build_array(jsonb_build_object('product_id', '00000000-0000-0000-00f1-0000000000ff', 'product_name', 'BI', 'quantity', 10, 'unit_price', 5, 'total', 50)),
    'payments', jsonb_build_array(jsonb_build_object('account_id', '00000000-0000-0000-00f1-0000000000a1', 'amount', 10, 'payment_date', (v_doc + 2)::text))
  )) ->> 'purchase_id')::uuid;
  if v_pur is null then raise exception 'FAIL purchase draft not saved'; end if;
  perform public.post_purchase_invoice_draft(v_pur);
  insert into bi_ids values ('backdated_purchase', v_pur);
end $$;
commit;

-- Records are read back as the database owner (the manager may not read journal_entries).
do $$
declare
  v_doc date := public.document_today() - 10;
  v_sale uuid := (select id from bi_ids where k = 'backdated_sale');
  v_pur uuid := (select id from bi_ids where k = 'backdated_purchase');
  v_bad text;
begin
  select string_agg(x, ', ') into v_bad from (
    select 'journal ' || entry_date from public.journal_entries where document_id = v_sale and entry_date <> v_doc
    union all select 'cash ' || transaction_date from public.transactions where source_id = v_sale and (transaction_date at time zone 'Asia/Baku')::date <> v_doc
    union all select 'cash journal ' || je.entry_date from public.transactions t join public.journal_entries je on je.id = t.journal_entry_id where t.source_id = v_sale and je.entry_date <> v_doc
    union all select 'stock ' || created_at from public.stock_movements where reference_id = v_sale and (created_at at time zone 'Asia/Baku')::date <> v_doc
    union all select 'fifo ' || created_at from public.inventory_batch_consumptions where sale_id = v_sale and (created_at at time zone 'Asia/Baku')::date <> v_doc
  ) d(x);
  if v_bad is not null then raise exception 'FAIL backdated sale records not on the invoice date: %', v_bad; end if;
  if (select count(*) from public.journal_entries where document_id = v_sale) < 2 then raise exception 'FAIL sale journals missing (invoice + COGS)'; end if;
  if not exists (select 1 from public.transactions where source_id = v_sale) then raise exception 'FAIL in-form payment not booked'; end if;

  select string_agg(x, ', ') into v_bad from (
    select 'journal ' || entry_date from public.journal_entries where document_id = v_pur and entry_date <> v_doc
    union all select 'batch ' || created_at from public.inventory_batches where document_id = v_pur and (created_at at time zone 'Asia/Baku')::date <> v_doc
    union all select 'cash ' || transaction_date from public.transactions where source_id = v_pur and (transaction_date at time zone 'Asia/Baku')::date <> v_doc + 2
  ) d(x);
  if v_bad is not null then raise exception 'FAIL backdated purchase records: %', v_bad; end if;
  if (select status from public.purchases where id = v_pur) <> 'posted' then raise exception 'FAIL purchase not posted'; end if;
end $$;

-- The remaining invoice RPCs check permissions: run them as the admin.
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-00f1-00000000000a","role":"authenticated"}', false);

-- ── Today's invoice: nothing changes ────────────────────────────────────────
do $$
declare
  v_sale uuid;
begin
  v_sale := (public.save_sales_invoice_draft(pg_temp.sale_payload('00000000-0000-0000-00f1-0000000000c1', '00000000-0000-0000-00f1-000000000001',
    public.document_today(), 1, 10, '[]'::jsonb)) ->> 'sale_id')::uuid;
  perform public.post_sales_invoice_draft(v_sale);
  if exists (select 1 from public.journal_entries where document_id = v_sale and date < now() - interval '1 minute') then
    raise exception 'FAIL a today invoice got a back-dated journal';
  end if;
  if exists (select 1 from public.stock_movements where reference_id = v_sale and created_at < now() - interval '1 minute') then
    raise exception 'FAIL a today invoice got a back-dated stock movement';
  end if;
end $$;

-- ── Payments: from the invoice date to today ────────────────────────────────
do $$
declare
  v_sale uuid;
  v_tx uuid;
  v_ok boolean := false;
  v_msg text;
begin
  v_sale := (public.save_sales_invoice_draft(pg_temp.sale_payload('00000000-0000-0000-00f1-0000000000c1', '00000000-0000-0000-00f1-000000000001',
    public.document_today() - 10, 2, 10, '[]'::jsonb)) ->> 'sale_id')::uuid;
  perform public.post_sales_invoice_draft(v_sale);

  v_tx := (public.process_invoice_payment_event(jsonb_build_object('document_type', 'sale', 'document_id', v_sale, 'amount', 5,
    'account_id', '00000000-0000-0000-00f1-0000000000a1', 'payment_date', (public.document_today() - 5)::text)) ->> 'transaction_id')::uuid;
  if (select (transaction_date at time zone 'Asia/Baku')::date from public.transactions where id = v_tx) <> public.document_today() - 5
     or (select je.entry_date from public.transactions t join public.journal_entries je on je.id = t.journal_entry_id where t.id = v_tx) <> public.document_today() - 5 then
    raise exception 'FAIL three-dot payment not dated 5 days ago';
  end if;

  begin
    perform public.process_invoice_payment_event(jsonb_build_object('document_type', 'sale', 'document_id', v_sale, 'amount', 1,
      'account_id', '00000000-0000-0000-00f1-0000000000a1', 'payment_date', (public.document_today() - 20)::text));
  exception when others then v_ok := true; v_msg := sqlerrm;
  end;
  if not v_ok or v_msg not like '%faktura tarixindən%' then raise exception 'FAIL payment before the invoice date: %', v_msg; end if;

  -- In-form payment dated before the invoice.
  v_ok := false;
  begin
    v_sale := (public.save_sales_invoice_draft(pg_temp.sale_payload('00000000-0000-0000-00f1-0000000000c1', '00000000-0000-0000-00f1-000000000001',
      public.document_today() - 3, 1, 10, jsonb_build_array(jsonb_build_object('account_id', '00000000-0000-0000-00f1-0000000000a1', 'amount', 5,
        'date', (public.document_today() - 4)::text)))) ->> 'sale_id')::uuid;
    perform public.post_sales_invoice_draft(v_sale);
  exception when others then v_ok := true; v_msg := sqlerrm;
  end;
  if not v_ok or v_msg not like '%faktura tarixindən%' then raise exception 'FAIL in-form payment before the invoice date: %', v_msg; end if;
end $$;

-- A purchase payment from the list works (the status is not overwritten with a value the check refuses).
do $$
begin
  perform public.process_invoice_payment_event(jsonb_build_object('document_type', 'purchase',
    'document_id', (select id from public.purchases where invoice_number = 'BI-PUR-1'), 'amount', 5,
    'account_id', '00000000-0000-0000-00f1-0000000000a1', 'payment_date', (public.document_today() - 1)::text));
  if (select status from public.purchases where invoice_number = 'BI-PUR-1') <> 'posted' then raise exception 'FAIL purchase status changed by a payment'; end if;
end $$;

-- A customer payment dated in the past: transaction and journal on that day (step 7).
do $$
declare
  v_partner uuid;
  v_pay jsonb;
  v_day date := public.document_today() - 6;
begin
  insert into public.partners (name, entity_type, is_customer, is_supplier, created_at, credit_limit, is_deleted)
  values ('BI partner', 'legal', true, false, now(), 0, false) returning id into v_partner;
  v_pay := public.create_partner_payment(jsonb_build_object('partner_id', v_partner, 'amount', 20, 'payment_type', 'in',
    'payment_method', 'cash', 'cash_account_id', '00000000-0000-0000-00f1-0000000000a1',
    'payment_date', (v_day::timestamp + time '10:00')::text));
  if (select entry_date from public.journal_entries where id = (v_pay->>'journal_entry_id')::uuid) <> v_day then
    raise exception 'FAIL partner payment journal dated %', (select entry_date from public.journal_entries where id = (v_pay->>'journal_entry_id')::uuid);
  end if;
end $$;

-- ── Closed period ───────────────────────────────────────────────────────────
do $$
declare
  v_sale uuid;
  v_ok boolean := false;
  v_msg text;
begin
  begin
    v_sale := (public.save_sales_invoice_draft(pg_temp.sale_payload('00000000-0000-0000-00f1-0000000000c1', '00000000-0000-0000-00f1-000000000001',
      date '2025-01-15', 1, 10, '[]'::jsonb)) ->> 'sale_id')::uuid;
    perform public.post_sales_invoice_draft(v_sale);
  exception when others then v_ok := true; v_msg := sqlerrm;
  end;
  if not v_ok or v_msg not like '%bağlı maliyyə dövrünə%' then raise exception 'FAIL closed period: %', v_msg; end if;
end $$;

-- ── Amending a posted invoice ───────────────────────────────────────────────
-- PA: qty 3 x 10 dated -10, paid 10 that day, then amended to qty 5 x 12 dated -12.
-- PB: qty 5 x 12 dated -12, paid 10, posted fresh. Everything must end up equal.
do $$
begin
  insert into bi_ids values ('amend', (public.save_sales_invoice_draft(pg_temp.sale_payload('00000000-0000-0000-00f1-0000000000c2', '00000000-0000-0000-00f1-0000000000aa',
    public.document_today() - 10, 3, 10, jsonb_build_array(jsonb_build_object('account_id', '00000000-0000-0000-00f1-0000000000a1', 'amount', 10, 'method', 'Nağd')))) ->> 'sale_id')::uuid);
  perform public.post_sales_invoice_draft((select id from bi_ids where k = 'amend'));
  insert into bi_ids values ('fresh', (public.save_sales_invoice_draft(pg_temp.sale_payload('00000000-0000-0000-00f1-0000000000c3', '00000000-0000-0000-00f1-0000000000bb',
    public.document_today() - 12, 5, 12, jsonb_build_array(jsonb_build_object('account_id', '00000000-0000-0000-00f1-0000000000a1', 'amount', 10, 'method', 'Nağd')))) ->> 'sale_id')::uuid);
  perform public.post_sales_invoice_draft((select id from bi_ids where k = 'fresh'));
end $$;

-- A non-admin cannot amend.
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-00f1-00000000000b","role":"authenticated"}', true);
do $$
declare v_ok boolean := false;
begin
  begin
    perform public.amend_posted_sales_invoice((select id from bi_ids where k = 'amend'),
      pg_temp.sale_payload('00000000-0000-0000-00f1-0000000000c2', '00000000-0000-0000-00f1-0000000000aa', public.document_today() - 8, 5, 12, '[]'::jsonb), 'test');
  exception when others then v_ok := sqlerrm like '%administrator%';
  end;
  if not v_ok then raise exception 'FAIL a non-admin amended a posted invoice'; end if;
end $$;
rollback;

begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-00f1-00000000000a","role":"authenticated"}', true);
do $$
declare
  v_id uuid := (select id from bi_ids where k = 'amend');
  v_ok boolean := false;
  v_msg text;
begin
  -- A reason is required; the total may not drop below what was paid (10).
  begin perform public.amend_posted_sales_invoice(v_id, pg_temp.sale_payload('00000000-0000-0000-00f1-0000000000c2', '00000000-0000-0000-00f1-0000000000aa', public.document_today() - 12, 5, 12, '[]'::jsonb), ' ');
  exception when others then v_ok := true; end;
  if not v_ok then raise exception 'FAIL amendment without a reason'; end if;
  v_ok := false;
  begin perform public.amend_posted_sales_invoice(v_id, pg_temp.sale_payload('00000000-0000-0000-00f1-0000000000c2', '00000000-0000-0000-00f1-0000000000aa', public.document_today() - 12, 1, 5, '[]'::jsonb), 'too low');
  exception when others then v_ok := true; v_msg := sqlerrm; end;
  if not v_ok or v_msg not like '%artıq ödənilmiş%' then raise exception 'FAIL amendment below the paid amount: %', v_msg; end if;
  -- The payment was made on the invoice date (-10): a new date after it is refused, naming the payment.
  v_ok := false;
  begin perform public.amend_posted_sales_invoice(v_id, pg_temp.sale_payload('00000000-0000-0000-00f1-0000000000c2', '00000000-0000-0000-00f1-0000000000aa', public.document_today() - 2, 5, 12, '[]'::jsonb), 'late');
  exception when others then v_ok := true; v_msg := sqlerrm; end;
  if not v_ok or v_msg not like '%10.00 AZN%' then raise exception 'FAIL amendment dated after a payment: %', v_msg; end if;

  perform public.amend_posted_sales_invoice(v_id, pg_temp.sale_payload('00000000-0000-0000-00f1-0000000000c2', '00000000-0000-0000-00f1-0000000000aa', public.document_today() - 12, 5, 12, '[]'::jsonb), 'wrong quantity and price');
end $$;
commit;

-- The amended invoice and the fresh copy must now be indistinguishable (read as the owner).
reset role;
do $$
declare
  v_a uuid := (select id from bi_ids where k = 'amend');
  v_b uuid := (select id from bi_ids where k = 'fresh');
  v_gl_a numeric;
  v_gl_b numeric;
begin
  if (select status from public.sales where id = v_a) <> 'posted' or (select doc_no from public.sales where id = v_a) is null then raise exception 'FAIL amended invoice not posted'; end if;
  if (select total_amount from public.sales where id = v_a) <> 60 or (select paid_amount from public.sales where id = v_a) <> 10 then
    raise exception 'FAIL amended totals: % / %', (select total_amount from public.sales where id = v_a), (select paid_amount from public.sales where id = v_a);
  end if;
  if (select count(*) from public.transactions where source_id = v_a and category = 'Satış Ödənişi' and coalesce(reference_type, '') <> 'storno') <> 1 then
    raise exception 'FAIL payment booked twice or lost';
  end if;
  -- Stock and FIFO equal the fresh posting (both sold 5 of 50).
  if (select stock from public.products where id = '00000000-0000-0000-00f1-0000000000aa') <> (select stock from public.products where id = '00000000-0000-0000-00f1-0000000000bb') then
    raise exception 'FAIL stock: % vs %', (select stock from public.products where id = '00000000-0000-0000-00f1-0000000000aa'), (select stock from public.products where id = '00000000-0000-0000-00f1-0000000000bb');
  end if;
  if (select sum(remaining_qty) from public.inventory_batches where product_id = '00000000-0000-0000-00f1-0000000000aa')
     <> (select sum(remaining_qty) from public.inventory_batches where product_id = '00000000-0000-0000-00f1-0000000000bb') then
    raise exception 'FAIL FIFO remaining differs';
  end if;
  -- GL 1300 (inventory) net over all entries of each invoice, reversals included.
  select coalesce(sum(l.debit - l.credit), 0) into v_gl_a from public.journal_entry_lines l join public.journal_entries e on e.id = l.journal_entry_id
    join public.chart_of_accounts c on c.id = l.coa_id where e.document_id = v_a and c.code = '1300';
  select coalesce(sum(l.debit - l.credit), 0) into v_gl_b from public.journal_entry_lines l join public.journal_entries e on e.id = l.journal_entry_id
    join public.chart_of_accounts c on c.id = l.coa_id where e.document_id = v_b and c.code = '1300';
  if v_gl_a <> v_gl_b then raise exception 'FAIL GL 1300: % vs %', v_gl_a, v_gl_b; end if;
  -- Customer balance equal (both owe 60 - 10).
  if (select balance from public.customers where id = '00000000-0000-0000-00f1-0000000000c2') <> (select balance from public.customers where id = '00000000-0000-0000-00f1-0000000000c3') then
    raise exception 'FAIL customer balance: % vs %', (select balance from public.customers where id = '00000000-0000-0000-00f1-0000000000c2'), (select balance from public.customers where id = '00000000-0000-0000-00f1-0000000000c3');
  end if;
  -- Old entries reversed, new ones on the invoice date.
  if exists (select 1 from public.journal_entries where document_id = v_a and reversal_of is null and reversed_by is null and entry_date <> public.document_today() - 12) then
    raise exception 'FAIL live journal of the amended invoice not on its date';
  end if;
  if (select count(*) from public.journal_entries where document_id = v_a and reversed_by is not null) < 2 then raise exception 'FAIL old journals not reversed'; end if;
  -- History.
  if not exists (select 1 from public.invoice_amendments where document_id = v_a and reason = 'wrong quantity and price' and (old_values->>'total_amount')::numeric = 30) then
    raise exception 'FAIL amendment history';
  end if;
  if not exists (select 1 from public.mail_messages where res_model = 'sales' and res_id = v_a and kind = 'log') then raise exception 'FAIL amendment not in chatter'; end if;
  if not exists (select 1 from public.erp_events where source_id = v_a and event_type = 'sales_invoice_amend') then raise exception 'FAIL amendment not in erp_events'; end if;
end $$;

-- ── Amending a posted purchase ──────────────────────────────────────────────
set role authenticated;
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-00f1-00000000000a","role":"authenticated"}', true);
do $$
declare
  v_pur uuid := (select id from public.purchases where invoice_number = 'BI-PUR-1');
  v_stock numeric := (select stock from public.products where id = '00000000-0000-0000-00f1-0000000000ff');
begin
  perform public.amend_posted_purchase_invoice(v_pur, jsonb_build_object(
    'header', jsonb_build_object('supplier_id', '00000000-0000-0000-00f1-0000000000d1', 'doc_date', (public.document_today() - 12)::text,
      'warehouse_id', '00000000-0000-0000-00f1-0000000000e1', 'total_amount', 60),
    'items', jsonb_build_array(jsonb_build_object('product_id', '00000000-0000-0000-00f1-0000000000ff', 'product_name', 'BI', 'quantity', 12, 'unit_price', 5, 'total', 60))),
    'twelve, not ten');
  if (select stock from public.products where id = '00000000-0000-0000-00f1-0000000000ff') <> v_stock + 2 then raise exception 'FAIL purchase amendment stock'; end if;
  if (select sum(remaining_qty) from public.inventory_batches where document_id = v_pur) <> 12 then raise exception 'FAIL purchase amendment FIFO layer'; end if;
  if (select doc_date from public.purchases where id = v_pur) <> public.document_today() - 12
     or (select invoice_number from public.purchases where id = v_pur) <> 'BI-PUR-1' then
    raise exception 'FAIL purchase amendment header';
  end if;
  if exists (select 1 from public.journal_entries where document_id = v_pur and reversal_of is null and reversed_by is null and entry_date <> public.document_today() - 12) then
    raise exception 'FAIL purchase amendment journal date';
  end if;
end $$;
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-00f1-00000000000b","role":"authenticated"}', true);
do $$
declare v_ok boolean := false;
begin
  begin
    perform public.amend_posted_purchase_invoice((select id from public.purchases where invoice_number = 'BI-PUR-1'), '{}'::jsonb, 'x');
  exception when others then v_ok := sqlerrm like '%administrator%';
  end;
  if not v_ok then raise exception 'FAIL a non-admin amended a posted purchase'; end if;
end $$;
rollback;
reset role;

select 'ALL CHECKS PASSED';
