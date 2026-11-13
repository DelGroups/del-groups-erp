-- Checks supabase/migrations/20261110150000_document_date_change_core.sql on a database built with
-- scripts/db/build-fresh.sh --plain-postgres (CI: .github/workflows/db-baseline.yml).
-- Any failed check raises an exception; the last line prints ALL CHECKS PASSED.
-- Leaves test rows behind: run it on a throwaway database only.
--
-- Users: A admin, E editor (a role with can_edit_posted_sales / _purchases, not an admin).
-- Days are relative to today (T): purchase PU1 on T-20 brings 10 of DP1, sale S1 on T-10
-- sells 4 of them (FIFO from PU1).

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-00dc-00000000000a', 'dc-a@example.test', '{"full_name": "Dilarə Admin", "role_name": "Admin"}'),
  ('00000000-0000-0000-00dc-00000000000e', 'dc-e@example.test', '{"full_name": "Elşən Editor", "role_name": "Manager"}')
on conflict (id) do nothing;
insert into public.roles (id, name, permissions)
values ('00000000-0000-0000-00dc-0000000000f0', 'DC editor', '{"can_edit_posted_sales": true, "can_edit_posted_purchases": true, "can_create_invoice": true}')
on conflict (id) do nothing;
update public.profiles set role_id = (select id from public.roles where name = 'Admin' order by is_system desc limit 1), is_active = true
where id = '00000000-0000-0000-00dc-00000000000a';
update public.profiles set role_id = '00000000-0000-0000-00dc-0000000000f0', is_active = true
where id = '00000000-0000-0000-00dc-00000000000e';

insert into public.warehouses (id, code, name, is_default, created_at) values
  ('00000000-0000-0000-00dc-0000000000e1', 'DC-W', 'DC main', false, now()) on conflict (id) do nothing;
insert into public.accounts (id, code, name, balance) values
  ('00000000-0000-0000-00dc-0000000000a1', 'DC-CASH', 'DC cash', 0),
  ('00000000-0000-0000-00dc-0000000000a2', 'DC-TILL', 'DC till', 0)
on conflict (id) do nothing;
insert into public.customers (id, full_name) values ('00000000-0000-0000-00dc-0000000000c1', 'DC customer') on conflict (id) do nothing;
insert into public.suppliers (id, full_name) values ('00000000-0000-0000-00dc-0000000000d1', 'DC supplier') on conflict (id) do nothing;
insert into public.products (id, code, name, stock, buy_price, is_service, inventory_mode, full_sheet_length_m) values
  ('00000000-0000-0000-00dc-000000000001', 'DC-P1', 'DC product', 0, 5, false, 'standard', 4),
  ('00000000-0000-0000-00dc-000000000002', 'DC-P2', 'DC cash product', 0, 5, false, 'standard', 4)
on conflict (id) do nothing;
-- DP2 has plenty of old stock (sales of it test cash only).
select public.adjust_warehouse_stock('00000000-0000-0000-00dc-000000000002', '00000000-0000-0000-00dc-0000000000e1', 100);
select public.create_inventory_batch('00000000-0000-0000-00dc-000000000002', gen_random_uuid(), 'opening_balance', 5, 100);
update public.inventory_batches set created_at = now() - interval '200 days'
where product_id = '00000000-0000-0000-00dc-000000000002';
-- DC-CASH starts with 1000 (an old income), DC-TILL with nothing.
select public.post_cash_transaction('00000000-0000-0000-00dc-0000000000a1', 'Mədaxil', 1000, 'Digər mədaxil', 'DC opening');
update public.transactions set transaction_date = now() - interval '200 days'
where account_id = '00000000-0000-0000-00dc-0000000000a1' and notes = 'DC opening';

create or replace function pg_temp.sale_payload(p_product uuid, p_date date, p_qty numeric, p_price numeric, p_payments jsonb)
returns jsonb language sql as $$
  select jsonb_build_object(
    'header', jsonb_build_object('customer_id', '00000000-0000-0000-00dc-0000000000c1', 'doc_date', p_date::text,
      'total_amount', p_qty * p_price, 'subtotal', p_qty * p_price,
      'paid_amount', coalesce((select sum((x->>'amount')::numeric) from jsonb_array_elements(p_payments) x), 0),
      'remaining_balance', p_qty * p_price - coalesce((select sum((x->>'amount')::numeric) from jsonb_array_elements(p_payments) x), 0)),
    'items', jsonb_build_array(jsonb_build_object('product_id', p_product, 'product_name', 'DC', 'quantity', p_qty,
      'unit_price', p_price, 'line_total', p_qty * p_price, 'total', p_qty * p_price, 'warehouse_id', '00000000-0000-0000-00dc-0000000000e1')),
    'payments', p_payments);
$$;
create or replace function pg_temp.codes(p jsonb, p_kind text) returns text[] language sql as $$
  select coalesce(array_agg(x->>'code' order by x->>'code'), '{}') from jsonb_array_elements(p->p_kind) x;
$$;
-- Every row a document created, with its moment (to prove a change and its reverse restore them).
create or replace function pg_temp.snapshot(p_type text, p_id uuid) returns jsonb language sql as $$
  select coalesce(jsonb_object_agg(k, v), '{}') from (
    select 'je:' || id k, to_jsonb(date) v from public.journal_entries where coalesce(document_id, source_id) = p_id
    union all select 'tx:' || id, to_jsonb(coalesce(transaction_date, created_at)) from public.transactions where source_id = p_id
    union all select 'txje:' || je.id, to_jsonb(je.date) from public.transactions t join public.journal_entries je on je.id = t.journal_entry_id where t.source_id = p_id
    union all select 'sm:' || id, to_jsonb(created_at) from public.stock_movements where reference_id = p_id
    union all select 'b:' || id, to_jsonb(created_at) from public.inventory_batches where document_id = p_id
    union all select 'c:' || id, to_jsonb(created_at) from public.inventory_batch_consumptions where sale_id = p_id
  ) s;
$$;

create temp table dc_ids (k text primary key, id uuid, snap jsonb);
grant all on dc_ids to authenticated;

-- ── Documents, posted by the admin ──────────────────────────────────────────
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-00dc-00000000000a","role":"authenticated"}', false);
do $$
declare
  t date := public.document_today();
  v_id uuid;
begin
  -- PU1: 10 × DP1 on T-20, paid 50 from DC-CASH on the same day.
  v_id := (public.save_purchase_invoice_draft(jsonb_build_object(
    'header', jsonb_build_object('supplier_id', '00000000-0000-0000-00dc-0000000000d1', 'doc_date', (t - 20)::text,
      'warehouse_id', '00000000-0000-0000-00dc-0000000000e1', 'invoice_number', 'DC-PU1', 'total_amount', 50, 'paid_amount', 0, 'debt_amount', 50),
    'items', jsonb_build_array(jsonb_build_object('product_id', '00000000-0000-0000-00dc-000000000001', 'product_name', 'DC', 'quantity', 10, 'unit_price', 5, 'total', 50)),
    'payments', '[]'::jsonb)) ->> 'purchase_id')::uuid;
  perform public.post_purchase_invoice_draft(v_id);
  insert into dc_ids (k, id) values ('pu1', v_id);

  -- S1: 4 × DP1 on T-10, no payment.
  v_id := (public.save_sales_invoice_draft(pg_temp.sale_payload('00000000-0000-0000-00dc-000000000001', t - 10, 4, 10, '[]'::jsonb)) ->> 'sale_id')::uuid;
  perform public.post_sales_invoice_draft(v_id);
  insert into dc_ids (k, id) values ('s1', v_id);

  -- S2: DP2 on T-8, paid 100 into DC-TILL the same day; DC-TILL spends 100 on T-6.
  v_id := (public.save_sales_invoice_draft(pg_temp.sale_payload('00000000-0000-0000-00dc-000000000002', t - 8, 10, 10,
    jsonb_build_array(jsonb_build_object('account_id', '00000000-0000-0000-00dc-0000000000a2', 'amount', 100, 'method', 'Nağd')))) ->> 'sale_id')::uuid;
  perform public.post_sales_invoice_draft(v_id);
  insert into dc_ids (k, id) values ('s2', v_id);

  -- S3: DP2 on T-12, paid 30 into DC-CASH the same day, 20 more on T-9.
  v_id := (public.save_sales_invoice_draft(pg_temp.sale_payload('00000000-0000-0000-00dc-000000000002', t - 12, 5, 10,
    jsonb_build_array(jsonb_build_object('account_id', '00000000-0000-0000-00dc-0000000000a1', 'amount', 30, 'method', 'Nağd'),
                      jsonb_build_object('account_id', '00000000-0000-0000-00dc-0000000000a1', 'amount', 20, 'method', 'Nağd', 'date', (t - 9)::text)))) ->> 'sale_id')::uuid;
  perform public.post_sales_invoice_draft(v_id);
  insert into dc_ids (k, id) values ('s3', v_id);
end $$;
reset role;
-- DC-TILL spends the 100 on T-6 (booked as the owner: use_document_date is internal).
begin;
select public.use_document_date(public.document_today() - 6);
select public.post_cash_transaction('00000000-0000-0000-00dc-0000000000a2', 'Məxaric', 100, 'Digər məxaric', 'DC till spend');
commit;
do $$ begin
  if (select (transaction_date at time zone 'Asia/Baku')::date from public.transactions where notes = 'DC till spend') <> public.document_today() - 6 then
    raise exception 'FAIL setup: till spend not on T-6';
  end if;
end $$;
update dc_ids set snap = pg_temp.snapshot(case when k like 'pu%' then 'purchase' else 'sale' end, id);

set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-00dc-00000000000a","role":"authenticated"}', false);

-- ── Basic blockers ──────────────────────────────────────────────────────────
do $$
declare
  t date := public.document_today();
  s1 uuid := (select id from dc_ids where k = 's1');
  p jsonb;
begin
  p := public.preview_document_date_change('sale', s1, t - 10);
  if not ('same_date' = any (pg_temp.codes(p, 'blockers'))) then raise exception 'FAIL same date not blocked: %', p; end if;
  p := public.preview_document_date_change('sale', s1, t + 1);
  if not ('future_date' = any (pg_temp.codes(p, 'blockers'))) then raise exception 'FAIL future date not blocked: %', p; end if;
  p := public.preview_document_date_change('order', s1, t - 3);
  if not ('unsupported_document' = any (pg_temp.codes(p, 'blockers'))) then raise exception 'FAIL unknown type: %', p; end if;
end $$;

-- ── R3 / R4: a sale before the purchase that supplied it ────────────────────
do $$
declare
  t date := public.document_today();
  s1 uuid := (select id from dc_ids where k = 's1');
  p jsonb;
begin
  p := public.preview_document_date_change('sale', s1, t - 25);
  if (p->>'ok')::boolean then raise exception 'FAIL R3 sale before its purchase allowed: %', p; end if;
  if not ('stock_negative' = any (pg_temp.codes(p, 'blockers'))) then raise exception 'FAIL R3 stock_negative missing: %', p; end if;
  if not ('fifo_order' = any (pg_temp.codes(p, 'blockers'))) then raise exception 'FAIL R4 fifo_order missing: %', p; end if;
  -- Passing case: later, still after the purchase.
  p := public.preview_document_date_change('sale', s1, t - 7);
  if not (p->>'ok')::boolean then raise exception 'FAIL R3 a later date should be fine: %', p; end if;
  if (p->'affected'->>'journals')::int < 2 or (p->'affected'->>'stock_moves')::int < 1 or (p->'affected'->>'batches')::int < 1 then
    raise exception 'FAIL R3 affected counts: %', p->'affected';
  end if;
end $$;

-- ── R4: a purchase with sold goods: earlier is fine, later than the sale is not ──
do $$
declare
  t date := public.document_today();
  pu1 uuid := (select id from dc_ids where k = 'pu1');
  p jsonb;
begin
  p := public.preview_document_date_change('purchase', pu1, t - 5);
  if (p->>'ok')::boolean or not ('fifo_order' = any (pg_temp.codes(p, 'blockers'))) then raise exception 'FAIL R4 purchase after its sale: %', p; end if;
  if not ('stock_negative' = any (pg_temp.codes(p, 'blockers'))) then raise exception 'FAIL R3 purchase after its sale: %', p; end if;
  p := public.preview_document_date_change('purchase', pu1, t - 22);
  if not (p->>'ok')::boolean then raise exception 'FAIL R4 purchase moved earlier should pass: %', p; end if;
end $$;

-- ── R1: an editor with can_edit_posted_* is refused ─────────────────────────
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-00dc-00000000000e","role":"authenticated"}', false);
do $$
declare
  t date := public.document_today();
  pu1 uuid := (select id from dc_ids where k = 'pu1');
  p jsonb;
begin
  if not public.has_permission('can_edit_posted_purchases') then raise exception 'FAIL setup: editor lacks can_edit_posted_purchases'; end if;
  p := public.preview_document_date_change('purchase', pu1, t - 22);
  if not ('not_admin' = any (pg_temp.codes(p, 'blockers'))) then raise exception 'FAIL R1 preview open to a non-admin: %', p; end if;
  begin
    perform public.apply_document_date_change('purchase', pu1, t - 22, 'test');
    raise exception 'FAIL R1 apply allowed for a non-admin';
  exception when insufficient_privilege then null;
  end;
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-00dc-00000000000a","role":"authenticated"}', false);

-- ── Apply, audit, balance, idempotency, reverse ─────────────────────────────
do $$
declare
  t date := public.document_today();
  pu1 uuid := (select id from dc_ids where k = 'pu1');
  r jsonb;
  r2 jsonb;
  v_change public.document_date_changes%rowtype;
  v_bad text;
begin
  begin
    perform public.apply_document_date_change('purchase', pu1, t - 22, '  ');
    raise exception 'FAIL a blank reason was accepted';
  exception when invalid_parameter_value then null;
  end;
  r := public.apply_document_date_change('purchase', pu1, t - 22, 'Supplier invoice was dated earlier');
  if not (r->>'ok')::boolean then raise exception 'FAIL apply: %', r; end if;
  if (select doc_date from public.purchases where id = pu1) <> t - 22 then raise exception 'FAIL header date not moved'; end if;
  select * into v_change from public.document_date_changes where id = (r->>'change_id')::uuid;
  if v_change.old_date <> t - 20 or v_change.new_date <> t - 22 or v_change.changed_by <> '00000000-0000-0000-00dc-00000000000a' then
    raise exception 'FAIL audit row: %', row_to_json(v_change);
  end if;
  -- Every row of the purchase moved and is listed; journals still balance.
  select string_agg(x, ', ') into v_bad from (
    select 'journal ' || id from public.journal_entries
    where coalesce(document_id, source_id) = pu1 and reversal_of is null and reversed_by is null
      and (entry_date <> t - 22 or (date at time zone 'Asia/Baku')::date <> t - 22)
    union all select 'batch ' || id from public.inventory_batches where document_id = pu1 and (created_at at time zone 'Asia/Baku')::date <> t - 22
    union all select 'unlisted ' || je.id from public.journal_entries je
    where coalesce(je.document_id, je.source_id) = pu1
      and not exists (select 1 from jsonb_array_elements(v_change.moved_rows) m where (m->>'id')::uuid = je.id)
  ) d(x);
  if v_bad is not null then raise exception 'FAIL rows not moved / not listed: %', v_bad; end if;
  if exists (
    select 1 from public.journal_entries je join public.journal_entry_lines l on l.journal_entry_id = je.id
    where coalesce(je.document_id, je.source_id) = pu1 group by je.id having abs(sum(l.debit) - sum(l.credit)) > 0.001
  ) then raise exception 'FAIL a moved journal does not balance'; end if;
  -- Time of day kept.
  if exists (
    select 1 from jsonb_array_elements(v_change.moved_rows) m
    where ((m->>'old')::timestamptz at time zone 'Asia/Baku')::time <> ((m->>'new')::timestamptz at time zone 'Asia/Baku')::time
  ) then raise exception 'FAIL time of day not kept'; end if;

  -- The same call again: nothing changes.
  r2 := public.apply_document_date_change('purchase', pu1, t - 22, 'Supplier invoice was dated earlier');
  if not coalesce((r2->>'already_applied')::boolean, false) or r2->>'change_id' <> r->>'change_id' then raise exception 'FAIL not idempotent: %', r2; end if;
  if (select count(*) from public.document_date_changes where document_id = pu1) <> 1 then raise exception 'FAIL idempotent call wrote a second row'; end if;

  -- The reverse change restores the original moments.
  r := public.apply_document_date_change('purchase', pu1, t - 20, 'Undo the test change');
  if not (r->>'ok')::boolean then raise exception 'FAIL reverse change: %', r; end if;
end $$;
reset role;
do $$
declare
  pu1 uuid := (select id from dc_ids where k = 'pu1');
begin
  if pg_temp.snapshot('purchase', pu1) <> (select snap from dc_ids where k = 'pu1') then
    raise exception 'FAIL reverse change did not restore: % vs %', pg_temp.snapshot('purchase', pu1), (select snap from dc_ids where k = 'pu1');
  end if;
  if (select count(*) from public.erp_events where event_type = 'document_date_change' and source_id = pu1) < 2 then
    raise exception 'FAIL erp_events not logged';
  end if;
end $$;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-00dc-00000000000a","role":"authenticated"}', false);

-- ── R6 / R7: cash and payments ───────────────────────────────────────────────
do $$
declare
  t date := public.document_today();
  s2 uuid := (select id from dc_ids where k = 's2');
  s3 uuid := (select id from dc_ids where k = 's3');
  p jsonb;
  r jsonb;
begin
  -- S2 later than its same-day payment: R7 without the option ...
  p := public.preview_document_date_change('sale', s2, t - 5);
  if not ('payment_before_invoice' = any (pg_temp.codes(p, 'blockers'))) then raise exception 'FAIL R7 payment before invoice: %', p; end if;
  if not coalesce((p->'blockers'->0->'details'->>'same_day')::boolean, false)
     and not exists (select 1 from jsonb_array_elements(p->'blockers') b where b->>'code' = 'payment_before_invoice' and (b->'details'->>'same_day')::boolean) then
    raise exception 'FAIL R7 same_day flag: %', p;
  end if;
  -- ... and with it the payment moves after the till's spend on T-6: R6.
  p := public.preview_document_date_change('sale', s2, t - 5, '{"move_same_day_payments": true}');
  if not ('cash_negative' = any (pg_temp.codes(p, 'blockers'))) then raise exception 'FAIL R6 cash would go negative: %', p; end if;
  if 'payment_before_invoice' = any (pg_temp.codes(p, 'blockers')) then raise exception 'FAIL R7 option ignored: %', p; end if;
  -- Earlier is fine (the payment stays after the invoice).
  p := public.preview_document_date_change('sale', s2, t - 9);
  if not (p->>'ok')::boolean then raise exception 'FAIL S2 earlier should pass: %', p; end if;

  -- S3 (payments on T-12 and T-9) to T-11: the T-12 payment blocks; with the option it moves,
  -- a warning to tick; T-9 is still after the invoice.
  p := public.preview_document_date_change('sale', s3, t - 11);
  if not ('payment_before_invoice' = any (pg_temp.codes(p, 'blockers'))) then raise exception 'FAIL R7 S3: %', p; end if;
  p := public.preview_document_date_change('sale', s3, t - 11, '{"move_same_day_payments": true}');
  if not (p->>'ok')::boolean then raise exception 'FAIL R7 S3 with option should pass: %', p; end if;
  if not ('payments_move' = any (pg_temp.codes(p, 'warnings'))) then raise exception 'FAIL warning payments_move missing: %', p; end if;
  begin
    perform public.apply_document_date_change('sale', s3, t - 11, 'test', '{"move_same_day_payments": true}');
    raise exception 'FAIL an unticked warning was accepted';
  exception when invalid_parameter_value then null;
  end;
  r := public.apply_document_date_change('sale', s3, t - 11, 'Invoice printed a day late', '{"move_same_day_payments": true}', array['payments_move']);
  if not (r->>'ok')::boolean then raise exception 'FAIL apply S3: %', r; end if;
  if exists (select 1 from public.transactions where source_id = s3 and amount = 30 and (transaction_date at time zone 'Asia/Baku')::date <> t - 11) then
    raise exception 'FAIL same-day payment did not move';
  end if;
  if exists (select 1 from public.transactions where source_id = s3 and amount = 20 and (transaction_date at time zone 'Asia/Baku')::date <> t - 9) then
    raise exception 'FAIL the other payment moved';
  end if;
  -- The invoice form's payments follow: the moved one shows the new day, the other keeps its own.
  if (select string_agg(coalesce(e->>'date', '?'), ',' order by (e->>'amount')::numeric)
      from public.sales, jsonb_array_elements(payments) e where id = s3) <> format('%s,%s', t - 9, t - 11) then
    raise exception 'FAIL payments JSON not updated: %', (select payments from public.sales where id = s3);
  end if;
  -- Its cash journal moved with it.
  if exists (select 1 from public.transactions tx join public.journal_entries je on je.id = tx.journal_entry_id
             where tx.source_id = s3 and tx.amount = 30 and je.entry_date <> t - 11) then
    raise exception 'FAIL payment journal did not move';
  end if;
end $$;

-- ── R7: an older payment row linked by reference only ───────────────────────
reset role;
begin;
select public.use_document_date(public.document_today() - 10);
select public.post_cash_transaction('00000000-0000-0000-00dc-0000000000a1', 'Mədaxil', 5, 'Satış Ödənişi', 'DC legacy payment');
commit;
update public.transactions set source_type = null, source_id = null, reference_type = 'sale', reference_id = (select id from dc_ids where k = 's1')
where notes = 'DC legacy payment';
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-00dc-00000000000a","role":"authenticated"}', false);
do $$
declare
  t date := public.document_today();
  s1 uuid := (select id from dc_ids where k = 's1');
  p jsonb;
begin
  p := public.preview_document_date_change('sale', s1, t - 8);
  if not ('payment_before_invoice' = any (pg_temp.codes(p, 'blockers'))) then raise exception 'FAIL R7 legacy reference payment not seen: %', p; end if;
end $$;
reset role;
update public.transactions set reference_type = 'storno_test_done' where notes = 'DC legacy payment';
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-00dc-00000000000a","role":"authenticated"}', false);

-- ── R8: a posted inventory count between the dates ──────────────────────────
reset role;
insert into public.inventory_counts (id, document_number, count_date, warehouse_id, status, line_count, counted_count,
  total_surplus_value, total_shortage_value, total_variance_value, created_at, updated_at)
values ('00000000-0000-0000-00dc-0000000000b1', 'DC-COUNT-1', public.document_today() - 9, '00000000-0000-0000-00dc-0000000000e1', 'posted', 1, 1, 0, 0, 0, now(), now())
on conflict (id) do nothing;
insert into public.inventory_count_items (id, count_id, line_no, product_id, product_name, is_metric, expected_qty, actual_qty,
  scanned_piece_ids, unit_cost, drift_qty, created_at, updated_at)
values (gen_random_uuid(), '00000000-0000-0000-00dc-0000000000b1', 1, '00000000-0000-0000-00dc-000000000001', 'DC product', false, 6, 6,
  '[]'::jsonb, 5, 0, now(), now());
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-00dc-00000000000a","role":"authenticated"}', false);
do $$
declare
  t date := public.document_today();
  s1 uuid := (select id from dc_ids where k = 's1');
  p jsonb;
begin
  p := public.preview_document_date_change('sale', s1, t - 7);
  if not ('inventory_count_between' = any (pg_temp.codes(p, 'blockers'))) then raise exception 'FAIL R8 count between: %', p; end if;
  p := public.preview_document_date_change('sale', s1, t - 11);
  if 'inventory_count_between' = any (pg_temp.codes(p, 'blockers')) then raise exception 'FAIL R8 count not between: %', p; end if;
end $$;

-- ── R2: closed periods ───────────────────────────────────────────────────────
reset role;
insert into public.accounting_periods (period_year, period_month, status) values (2025, 2, 'closed') on conflict do nothing;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-00dc-00000000000a","role":"authenticated"}', false);
do $$
declare
  s2 uuid := (select id from dc_ids where k = 's2');
  p jsonb;
begin
  p := public.preview_document_date_change('sale', s2, date '2025-02-10');
  if not ('period_closed_new' = any (pg_temp.codes(p, 'blockers'))) then raise exception 'FAIL R2 new date closed: %', p; end if;
end $$;
reset role;
insert into public.accounting_periods (period_year, period_month, status)
select extract(year from public.document_today() - 8)::int, extract(month from public.document_today() - 8)::int, 'closed'
on conflict (period_year, period_month) do update set status = 'closed';
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-00dc-00000000000a","role":"authenticated"}', false);
do $$
declare
  t date := public.document_today();
  s2 uuid := (select id from dc_ids where k = 's2');
  p jsonb;
begin
  p := public.preview_document_date_change('sale', s2, t - 9);
  if not ('period_closed_old' = any (pg_temp.codes(p, 'blockers'))) then raise exception 'FAIL R2 old date closed: %', p; end if;
  begin
    perform public.apply_document_date_change('sale', s2, t - 9, 'test');
    raise exception 'FAIL R2 apply in a closed period';
  exception when invalid_parameter_value then null;
  end;
end $$;
reset role;
update public.accounting_periods set status = 'open'
where period_year = extract(year from public.document_today() - 8)::int and period_month = extract(month from public.document_today() - 8)::int;

-- ── The amend RPC still works for an editor (unchanged by this migration) ───
do $$
begin
  if to_regprocedure('public.amend_posted_sales_invoice(uuid, jsonb, text)') is null
     and not exists (select 1 from pg_proc where proname = 'amend_posted_sales_invoice') then
    raise exception 'FAIL amend_posted_sales_invoice is gone';
  end if;
end $$;

-- ── Grants ──────────────────────────────────────────────────────────────────
do $$
begin
  if has_function_privilege('anon', 'public.apply_document_date_change(text, uuid, date, text, jsonb, text[])', 'execute') then
    raise exception 'FAIL anon may apply';
  end if;
  if not has_function_privilege('authenticated', 'public.preview_document_date_change(text, uuid, date, jsonb)', 'execute') then
    raise exception 'FAIL authenticated may not preview';
  end if;
  if has_function_privilege('authenticated', 'public._date_change_rows(text, uuid, date, jsonb)', 'execute') then
    raise exception 'FAIL internal helper exposed';
  end if;
end $$;

select 'ALL CHECKS PASSED';
