-- Checks supabase/migrations/20261115120000_lot_outbound.sql (LOT-3) on a database built with
-- scripts/db/build-fresh.sh --plain-postgres (CI: .github/workflows/db-baseline.yml), after LOT-1
-- and LOT-2.
-- Any failed check raises an exception; the last line prints ALL CHECKS PASSED.
-- Leaves test rows behind: run it on a throwaway database only.
--
-- Outbound and moving documents record their lots: a sale picks FEFO across two lots (never a
-- quarantined one), a sale with chosen lots, bad choices refused before any stock moves, cancel
-- and void give back the same lots, a write-off update (reverse + re-apply), production issue /
-- return / delivery, consignment dispatch / return, a transfer keeps lots (and a Polywood offcut),
-- a count shortage / unpost, a purchase reverse, a kit sale. After each: lots = stock.

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-03b7-00000000000a', 'lot3-a@example.test', '{"full_name": "Lot3 Test Admin", "role_name": "Admin"}'),
  ('00000000-0000-0000-03b7-00000000000b', 'lot3-b@example.test', '{"full_name": "Lot3 Test Clerk", "role_name": "Admin"}')
on conflict (id) do nothing;
update public.profiles set is_active = true, role_id = (select id from public.roles where name = 'Admin' order by is_system desc limit 1)
where id = '00000000-0000-0000-03b7-00000000000a';
-- The clerk has a role without lots.manage.
insert into public.roles (id, name, permissions) values ('00000000-0000-0000-03b7-0000000000f1', 'Lot3 clerk', '{}'::jsonb) on conflict (id) do nothing;
update public.profiles set is_active = true, role_id = '00000000-0000-0000-03b7-0000000000f1' where id = '00000000-0000-0000-03b7-00000000000b';

insert into public.warehouses (id, code, name, is_default, created_at) values
  ('00000000-0000-0000-03b7-0000000000e1', 'L3-W1', 'L3 anbar 1', false, now()),
  ('00000000-0000-0000-03b7-0000000000e2', 'L3-W2', 'L3 anbar 2', false, now())
on conflict (id) do nothing;
insert into public.customers (id, full_name) values ('00000000-0000-0000-03b7-0000000000c1', 'L3 customer') on conflict (id) do nothing;
insert into public.suppliers (id, full_name, entity_type) values ('00000000-0000-0000-03b7-0000000000d1', 'L3 supplier', 'legal') on conflict (id) do nothing;
do $$ begin
  if public.resolve_unified_partner_id(null, '00000000-0000-0000-03b7-0000000000d1') is null then
    insert into public.partners (name, entity_type, is_customer, is_supplier, supplier_id, created_at, credit_limit, is_deleted)
    values ('L3 supplier', 'legal', false, true, '00000000-0000-0000-03b7-0000000000d1', now(), 0, false);
  end if;
end $$;

-- A sold, B other product, C kit component, K kit of 2 x C, M material, F finished product,
-- G consignment, T transferred, W written off, N counted, U purchased, QP Polywood (4 m sheets).
insert into public.products (id, code, name, stock, buy_price, is_service, is_composite, inventory_mode, full_sheet_length_m, unit) values
  ('00000000-0000-0000-03b7-000000000001', 'L3-A', 'L3 sold', 0, 5, false, false, 'standard', 4, 'Ədəd'),
  ('00000000-0000-0000-03b7-000000000002', 'L3-B', 'L3 other', 0, 5, false, false, 'standard', 4, 'Ədəd'),
  ('00000000-0000-0000-03b7-000000000003', 'L3-C', 'L3 component', 0, 1, false, false, 'standard', 4, 'Ədəd'),
  ('00000000-0000-0000-03b7-000000000004', 'L3-K', 'L3 kit', 0, 0, false, true, 'standard', 4, 'Ədəd'),
  ('00000000-0000-0000-03b7-000000000005', 'L3-M', 'L3 material', 0, 1, false, false, 'standard', 4, 'Ədəd'),
  ('00000000-0000-0000-03b7-000000000006', 'L3-F', 'L3 finished', 0, 0, false, false, 'standard', 4, 'Ədəd'),
  ('00000000-0000-0000-03b7-000000000007', 'L3-G', 'L3 consigned', 0, 5, false, false, 'standard', 4, 'Ədəd'),
  ('00000000-0000-0000-03b7-000000000008', 'L3-T', 'L3 moved', 0, 5, false, false, 'standard', 4, 'Ədəd'),
  ('00000000-0000-0000-03b7-000000000009', 'L3-W', 'L3 written off', 0, 5, false, false, 'standard', 4, 'Ədəd'),
  ('00000000-0000-0000-03b7-000000000010', 'L3-N', 'L3 counted', 0, 5, false, false, 'standard', 4, 'Ədəd'),
  ('00000000-0000-0000-03b7-000000000011', 'L3-U', 'L3 purchased', 0, 5, false, false, 'standard', 4, 'Ədəd'),
  ('00000000-0000-0000-03b7-000000000012', 'L3-QP', 'L3 plywood', 0, 5, false, false, 'polywood', 4, 'Vərəq')
on conflict (id) do nothing;
insert into public.product_bom (parent_product_id, component_product_id, quantity) values
  ('00000000-0000-0000-03b7-000000000004', '00000000-0000-0000-03b7-000000000003', 2);

create or replace function pg_temp.lot_by_no(p text) returns uuid language sql as $$
  select id from public.stock_lots where lot_no = p;
$$;
create or replace function pg_temp.bal(p text, w int) returns numeric language sql as $$
  select coalesce((select qty from public.stock_lot_balances where lot_id = (select id from public.stock_lots where lot_no = p)
    and warehouse_id = case w when 1 then '00000000-0000-0000-03b7-0000000000e1'::uuid else '00000000-0000-0000-03b7-0000000000e2'::uuid end), 0);
$$;
-- A named lot with stock: p_qty in warehouse w, expiring p_exp days from today.
create or replace function pg_temp.mk(p_product uuid, w int, p_qty numeric, p_no text, p_exp int) returns void language plpgsql as $$
begin
  perform public.lot_ctx_begin(jsonb_build_object('doc_type', 'test_in', 'doc_id', gen_random_uuid(), 'product_id', p_product,
    'new_lot', jsonb_build_object('lot_no', p_no, 'exp_date', case when p_exp is null then null else (public.document_today() + p_exp)::text end)));
  perform public.adjust_warehouse_stock(p_product,
    case w when 1 then '00000000-0000-0000-03b7-0000000000e1'::uuid else '00000000-0000-0000-03b7-0000000000e2'::uuid end, p_qty);
  perform public.lot_ctx_end();
end $$;
create or replace function pg_temp.assert_match(p_step text) returns void language plpgsql security definer as $$
begin
  if exists (select 1 from public._lot_mismatches() m where m.product_id::text like '00000000-0000-0000-03b7-%') then
    raise exception 'FAIL % lots <> stock: %', p_step,
      (select jsonb_agg(to_jsonb(m)) from public._lot_mismatches() m where m.product_id::text like '00000000-0000-0000-03b7-%');
  end if;
  if exists (select 1 from public.stock_lot_movements mv join public.stock_lots l on l.id = mv.lot_id
             where mv.product_id::text like '00000000-0000-0000-03b7-%' and l.origin_type = 'unassigned') then
    raise exception 'FAIL % a movement went to the unassigned lot', p_step;
  end if;
end $$;
-- The lot numbers a document line took: 'LOT:qty,...' (absolute, ordered by lot number).
create or replace function pg_temp.took(p_doc uuid, p_product uuid, p_sign int default -1) returns text language sql as $$
  select string_agg(l.lot_no || ':' || trim_scale(s.q), ',' order by l.lot_no)
  from (select lot_id, sum(abs(qty_delta)) q from public.stock_lot_movements
        where doc_id = p_doc and product_id = p_product and sign(qty_delta) = p_sign group by lot_id) s
  join public.stock_lots l on l.id = s.lot_id;
$$;

-- Lots. A: A-Q quarantined (earliest), A-1 (+30), A-2 (+60) in W1; A-X expired in W2.
select pg_temp.mk('00000000-0000-0000-03b7-000000000001', 1, 2, 'L3-A-Q', 5);
select pg_temp.mk('00000000-0000-0000-03b7-000000000001', 1, 5, 'L3-A-1', 30);
select pg_temp.mk('00000000-0000-0000-03b7-000000000001', 1, 5, 'L3-A-2', 60);
select pg_temp.mk('00000000-0000-0000-03b7-000000000001', 2, 3, 'L3-A-X', -2);
update public.stock_lots set status = 'quarantine' where lot_no = 'L3-A-Q';
select pg_temp.mk('00000000-0000-0000-03b7-000000000002', 1, 5, 'L3-B-1', 30);
select pg_temp.mk('00000000-0000-0000-03b7-000000000003', 1, 4, 'L3-C-1', 20);
select pg_temp.mk('00000000-0000-0000-03b7-000000000003', 1, 4, 'L3-C-2', 50);
select pg_temp.mk('00000000-0000-0000-03b7-000000000005', 1, 5, 'L3-M-1', 10);
select pg_temp.mk('00000000-0000-0000-03b7-000000000005', 1, 5, 'L3-M-2', 40);
select pg_temp.mk('00000000-0000-0000-03b7-000000000007', 1, 5, 'L3-G-1', 10);
select pg_temp.mk('00000000-0000-0000-03b7-000000000007', 1, 5, 'L3-G-2', 40);
select pg_temp.mk('00000000-0000-0000-03b7-000000000008', 1, 5, 'L3-T-1', 10);
select pg_temp.mk('00000000-0000-0000-03b7-000000000008', 1, 5, 'L3-T-2', 40);
select pg_temp.mk('00000000-0000-0000-03b7-000000000009', 1, 5, 'L3-W-1', 10);
select pg_temp.mk('00000000-0000-0000-03b7-000000000009', 1, 5, 'L3-W-2', 40);
select pg_temp.mk('00000000-0000-0000-03b7-000000000010', 1, 3, 'L3-N-1', 10);
select pg_temp.mk('00000000-0000-0000-03b7-000000000010', 1, 3, 'L3-N-2', 40);
select pg_temp.assert_match('setup');

create temp table l3_ids (k text primary key, id uuid);
grant all on l3_ids to authenticated;

set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-03b7-00000000000a","role":"authenticated"}', false);

-- ── Sales ───────────────────────────────────────────────────────────────────
do $$
declare
  a  uuid := '00000000-0000-0000-03b7-000000000001';
  w1 uuid := '00000000-0000-0000-03b7-0000000000e1';
  v_sale uuid;
  v_line uuid;
  v_msg text;
  v_mv record;
begin
  -- Auto (no lots key): FEFO across A-1 and A-2; the quarantined A-Q is never picked.
  v_sale := (public.save_sales_invoice_draft(jsonb_build_object(
    'header', jsonb_build_object('customer_id', '00000000-0000-0000-03b7-0000000000c1', 'total_amount', 70, 'subtotal', 70, 'paid_amount', 0, 'remaining_balance', 70),
    'items', jsonb_build_array(jsonb_build_object('product_id', a, 'product_name', 'L3 sold', 'quantity', 7, 'unit_price', 10, 'line_total', 70, 'total', 70, 'warehouse_id', w1)),
    'payments', '[]'::jsonb)) ->> 'sale_id')::uuid;
  if (select lots from public.sale_items where sale_id = v_sale) is not null then raise exception 'FAIL a sale line without lots stored lots'; end if;
  perform public.post_sales_invoice_draft(v_sale);
  if pg_temp.took(v_sale, a) is distinct from 'L3-A-1:5,L3-A-2:2' then raise exception 'FAIL sale FEFO: %', pg_temp.took(v_sale, a); end if;
  if pg_temp.bal('L3-A-Q', 1) <> 2 then raise exception 'FAIL FEFO picked the quarantined lot'; end if;
  v_line := (select id from public.sale_items where sale_id = v_sale);
  select * into v_mv from public.stock_lot_movements where doc_id = v_sale and product_id = a order by recorded_at limit 1;
  if (v_mv.doc_type, v_mv.doc_line_id, v_mv.counterparty_type, v_mv.counterparty_id, v_mv.pick_mode, v_mv.kind)
     is distinct from ('sale'::text, v_line, 'customer'::text, '00000000-0000-0000-03b7-0000000000c1'::uuid, 'fefo'::text, 'out'::text) then
    raise exception 'FAIL sale movement fields: %', row_to_json(v_mv);
  end if;
  if (select doc_no from public.stock_lot_movements where doc_id = v_sale limit 1) is distinct from (select doc_no from public.sales where id = v_sale) then
    raise exception 'FAIL sale movement doc_no';
  end if;
  perform pg_temp.assert_match('sale FEFO');

  -- Cancel: back to exactly those lots.
  perform public.cancel_sales_invoice_atomic(v_sale, 'L3 test');
  if pg_temp.bal('L3-A-1', 1) <> 5 or pg_temp.bal('L3-A-2', 1) <> 5 then raise exception 'FAIL cancel lots: % %', pg_temp.bal('L3-A-1', 1), pg_temp.bal('L3-A-2', 1); end if;
  if pg_temp.took(v_sale, a, 1) is distinct from 'L3-A-1:5,L3-A-2:2'
     or exists (select 1 from public.stock_lot_movements where doc_id = v_sale and qty_delta > 0 and (kind <> 'reverse_in' or reverses_movement_id is null)) then
    raise exception 'FAIL cancel movements: %', pg_temp.took(v_sale, a, 1);
  end if;
  perform pg_temp.assert_match('sale cancel');

  -- Chosen lots (split over two lots): A-2 x 3, A-1 x 1.
  v_sale := (public.save_sales_invoice_draft(jsonb_build_object(
    'header', jsonb_build_object('customer_id', '00000000-0000-0000-03b7-0000000000c1', 'total_amount', 40, 'subtotal', 40, 'paid_amount', 0, 'remaining_balance', 40),
    'items', jsonb_build_array(jsonb_build_object('product_id', a, 'product_name', 'L3 sold', 'quantity', 4, 'unit_price', 10, 'line_total', 40, 'total', 40, 'warehouse_id', w1,
      'lots', jsonb_build_array(jsonb_build_object('lot_id', pg_temp.lot_by_no('L3-A-2'), 'qty', 3), jsonb_build_object('lot_id', pg_temp.lot_by_no('L3-A-1'), 'qty', 1)))),
    'payments', '[]'::jsonb)) ->> 'sale_id')::uuid;
  if jsonb_array_length((select lots from public.sale_items where sale_id = v_sale)) <> 2 then raise exception 'FAIL chosen lots not saved on the line'; end if;
  perform public.post_sales_invoice_draft(v_sale);
  insert into l3_ids values ('sale_chosen', v_sale);
  if pg_temp.took(v_sale, a) is distinct from 'L3-A-1:1,L3-A-2:3'
     or exists (select 1 from public.stock_lot_movements where doc_id = v_sale and pick_mode <> 'manual') then
    raise exception 'FAIL chosen lots: %', pg_temp.took(v_sale, a);
  end if;
  perform pg_temp.assert_match('sale chosen');

  -- Void: back to the chosen lots.
  perform public.void_sale_atomic(v_sale, 'L3 void');
  if pg_temp.bal('L3-A-1', 1) <> 5 or pg_temp.bal('L3-A-2', 1) <> 5 then raise exception 'FAIL void lots: % %', pg_temp.bal('L3-A-1', 1), pg_temp.bal('L3-A-2', 1); end if;
  perform pg_temp.assert_match('sale void');

  -- Bad choices are refused before any stock moves.
  v_sale := (public.save_sales_invoice_draft(jsonb_build_object(
    'header', jsonb_build_object('customer_id', '00000000-0000-0000-03b7-0000000000c1', 'total_amount', 20, 'subtotal', 20, 'paid_amount', 0, 'remaining_balance', 20),
    'items', jsonb_build_array(
      jsonb_build_object('product_id', '00000000-0000-0000-03b7-000000000002', 'product_name', 'L3 other', 'quantity', 1, 'unit_price', 10, 'line_total', 10, 'total', 10, 'warehouse_id', w1),
      jsonb_build_object('product_id', a, 'product_name', 'L3 sold', 'quantity', 1, 'unit_price', 10, 'line_total', 10, 'total', 10, 'warehouse_id', w1,
        'lots', jsonb_build_array(jsonb_build_object('lot_id', pg_temp.lot_by_no('L3-B-1'), 'qty', 1)))),
    'payments', '[]'::jsonb)) ->> 'sale_id')::uuid;
  begin
    perform public.post_sales_invoice_draft(v_sale);
    raise exception 'FAIL a lot of another product was accepted';
  exception when others then v_msg := sqlerrm;
  end;
  if v_msg not like 'lot_choice_invalid:%L3-B-1%L3 sold%L3 anbar 1%' then raise exception 'FAIL other-product message: %', v_msg; end if;
  if pg_temp.bal('L3-B-1', 1) <> 5 or (select status from public.sales where id = v_sale) = 'posted'
     or exists (select 1 from public.stock_lot_movements where doc_id = v_sale) then
    raise exception 'FAIL stock moved before the lot check';
  end if;
  perform pg_temp.assert_match('bad choice');
end $$;
reset role;

-- The helper itself (not callable by signed-in users; the documents call it).
do $$
declare
  a  uuid := '00000000-0000-0000-03b7-000000000001';
  w1 uuid := '00000000-0000-0000-03b7-0000000000e1';
begin
  if has_function_privilege('authenticated', 'public._lot_check_choice(uuid, uuid, numeric, jsonb, uuid)', 'execute') then
    raise exception 'FAIL _lot_check_choice is callable by authenticated';
  end if;
  -- Quarantined, short, wrong sum, expired (checked by the helper the documents call).
  begin
    perform public._lot_check_choice(a, w1, 1, jsonb_build_array(jsonb_build_object('lot_id', pg_temp.lot_by_no('L3-A-Q'), 'qty', 1)));
    raise exception 'FAIL quarantined lot accepted';
  exception when others then if sqlerrm not like 'lot_choice_blocked:%L3-A-Q%' then raise; end if;
  end;
  begin
    perform public._lot_check_choice(a, w1, 6, jsonb_build_array(jsonb_build_object('lot_id', pg_temp.lot_by_no('L3-A-1'), 'qty', 6)));
    raise exception 'FAIL short lot accepted';
  exception when others then if sqlerrm not like 'lot_choice_short:%L3-A-1%L3 anbar 1%' then raise; end if;
  end;
  begin
    perform public._lot_check_choice(a, w1, 4, jsonb_build_array(jsonb_build_object('lot_id', pg_temp.lot_by_no('L3-A-1'), 'qty', 3)));
    raise exception 'FAIL wrong sum accepted';
  exception when others then if sqlerrm not like 'lot_choice_sum:%' then raise; end if;
  end;
  -- A lot number works as well as an id; a single lot without qty takes the whole line.
  if public._lot_check_choice(a, w1, 2, '[{"lot_no": "L3-A-2"}]'::jsonb) -> 0 ->> 'lot_id' is distinct from pg_temp.lot_by_no('L3-A-2')::text then
    raise exception 'FAIL lot_no choice';
  end if;
  -- Expired: refused without lots.manage, allowed with it (the admin).
  begin
    perform public._lot_check_choice(a, '00000000-0000-0000-03b7-0000000000e2', 1,
      jsonb_build_array(jsonb_build_object('lot_id', pg_temp.lot_by_no('L3-A-X'), 'qty', 1)), '00000000-0000-0000-03b7-00000000000b');
    raise exception 'FAIL expired lot accepted without lots.manage';
  exception when others then if sqlerrm not like 'lot_choice_expired:%L3-A-X%' then raise; end if;
  end;
  perform public._lot_check_choice(a, '00000000-0000-0000-03b7-0000000000e2', 1,
    jsonb_build_array(jsonb_build_object('lot_id', pg_temp.lot_by_no('L3-A-X'), 'qty', 1)));
  perform pg_temp.assert_match('bad choices');
end $$;
set role authenticated;

-- ── Kit sale: the components pick automatically ─────────────────────────────
do $$
declare
  c  uuid := '00000000-0000-0000-03b7-000000000003';
  w1 uuid := '00000000-0000-0000-03b7-0000000000e1';
  v_sale uuid;
begin
  v_sale := (public.save_sales_invoice_draft(jsonb_build_object(
    'header', jsonb_build_object('customer_id', '00000000-0000-0000-03b7-0000000000c1', 'total_amount', 30, 'subtotal', 30, 'paid_amount', 0, 'remaining_balance', 30),
    'items', jsonb_build_array(jsonb_build_object('product_id', '00000000-0000-0000-03b7-000000000004', 'product_name', 'L3 kit', 'quantity', 3, 'unit_price', 10,
      'line_total', 30, 'total', 30, 'warehouse_id', w1)),
    'payments', '[]'::jsonb)) ->> 'sale_id')::uuid;
  perform public.post_sales_invoice_draft(v_sale);
  if pg_temp.took(v_sale, c) is distinct from 'L3-C-1:4,L3-C-2:2' then raise exception 'FAIL kit components FEFO: %', pg_temp.took(v_sale, c); end if;
  if exists (select 1 from public.stock_lot_movements where doc_id = v_sale and (doc_type <> 'sale' or counterparty_type <> 'customer')) then
    raise exception 'FAIL kit component movement fields';
  end if;
  perform pg_temp.assert_match('kit sale');
  perform public.cancel_sales_invoice_atomic(v_sale, 'L3 kit cancel');
  if pg_temp.bal('L3-C-1', 1) <> 4 or pg_temp.bal('L3-C-2', 1) <> 4 then raise exception 'FAIL kit cancel lots'; end if;
  perform pg_temp.assert_match('kit cancel');
end $$;

-- ── Write-off: chosen lots, then an update (reverse + re-apply) ──────────────
do $$
declare
  p  uuid := '00000000-0000-0000-03b7-000000000009';
  w1 uuid := '00000000-0000-0000-03b7-0000000000e1';
  v_id uuid;
begin
  v_id := (public.post_inventory_writeoff(jsonb_build_object(
    'document_number', 'L3-WO-1', 'warehouse_id', w1, 'checker_name', 'test',
    'items', jsonb_build_array(jsonb_build_object('product_id', p, 'product_name', 'L3 written off', 'quantity', 3, 'unit', 'Ədəd', 'issue_description', 'broken',
      'lots', jsonb_build_array(jsonb_build_object('lot_id', pg_temp.lot_by_no('L3-W-2'), 'qty', 3)))))) ->> 'id')::uuid;
  if pg_temp.took(v_id, p) is distinct from 'L3-W-2:3' then raise exception 'FAIL write-off chosen lot: %', pg_temp.took(v_id, p); end if;
  if (select doc_type from public.stock_lot_movements where doc_id = v_id limit 1) is distinct from 'inventory_writeoff' then raise exception 'FAIL write-off doc type'; end if;
  perform pg_temp.assert_match('write-off');

  -- A bad choice leaves the document and stock as they were.
  begin
    perform public.update_inventory_writeoff(v_id, jsonb_build_object(
      'document_number', 'L3-WO-1', 'warehouse_id', w1, 'checker_name', 'test',
      'items', jsonb_build_array(jsonb_build_object('product_id', p, 'product_name', 'L3 written off', 'quantity', 2, 'issue_description', 'broken',
        'lots', jsonb_build_array(jsonb_build_object('lot_id', pg_temp.lot_by_no('L3-W-1'), 'qty', 9))))));
    raise exception 'FAIL write-off update with a short lot accepted';
  exception when others then if sqlerrm not like 'lot_choice_short:%' then raise; end if;
  end;
  if pg_temp.bal('L3-W-2', 1) <> 2 or pg_temp.bal('L3-W-1', 1) <> 5 then raise exception 'FAIL refused update moved stock'; end if;

  -- Update: 2 from W-1 instead. W-2 gets its 3 back.
  perform public.update_inventory_writeoff(v_id, jsonb_build_object(
    'document_number', 'L3-WO-1', 'warehouse_id', w1, 'checker_name', 'test',
    'items', jsonb_build_array(jsonb_build_object('product_id', p, 'product_name', 'L3 written off', 'quantity', 2, 'issue_description', 'broken',
      'lots', jsonb_build_array(jsonb_build_object('lot_id', pg_temp.lot_by_no('L3-W-1'), 'qty', 2))))));
  if pg_temp.bal('L3-W-2', 1) <> 5 or pg_temp.bal('L3-W-1', 1) <> 3 then
    raise exception 'FAIL write-off update lots: W-1 % W-2 %', pg_temp.bal('L3-W-1', 1), pg_temp.bal('L3-W-2', 1);
  end if;
  if not exists (select 1 from public.stock_lot_movements where doc_id = v_id and kind = 'reverse_in' and lot_id = pg_temp.lot_by_no('L3-W-2') and qty_delta = 3) then
    raise exception 'FAIL write-off update: no reverse to W-2';
  end if;
  perform pg_temp.assert_match('write-off update');
end $$;

-- ── Production: issue from a chosen lot, return, delivery ───────────────────
do $$
declare
  m  uuid := '00000000-0000-0000-03b7-000000000005';
  f  uuid := '00000000-0000-0000-03b7-000000000006';
  w1 uuid := '00000000-0000-0000-03b7-0000000000e1';
  v_order uuid := gen_random_uuid();
  v_mat uuid := gen_random_uuid();
  v_mat2 uuid := gen_random_uuid();
begin
  insert into public.production_orders (id, project_name, type, status, finished_product_id, quantity, warehouse_id, furniture_warehouse_id, order_no, customer_id, total_project_price)
  values (v_order, 'L3 order', 'Series', 'Draft', f, 2, w1, w1, 'L3-PO-1', '00000000-0000-0000-03b7-0000000000c1', 20);
  insert into public.production_materials (id, production_order_id, product_id, quantity, unit, warehouse_id, unit_cost, lots)
  values (v_mat, v_order, m, 3, 'Ədəd', w1, 1, jsonb_build_array(jsonb_build_object('lot_id', pg_temp.lot_by_no('L3-M-2'), 'qty', 3))),
         (v_mat2, v_order, m, 2, 'Ədəd', w1, 1, null);
  perform public.process_production_material_issue_event(v_order, null, null);
  if pg_temp.bal('L3-M-2', 1) <> 2 or pg_temp.bal('L3-M-1', 1) <> 3 then
    raise exception 'FAIL material issue lots: M-1 % M-2 %', pg_temp.bal('L3-M-1', 1), pg_temp.bal('L3-M-2', 1);
  end if;
  if exists (select 1 from public.stock_lot_movements where doc_id = v_order and product_id = m and (doc_type <> 'production_order' or doc_line_id not in (v_mat, v_mat2))) then
    raise exception 'FAIL material issue movement fields';
  end if;
  perform pg_temp.assert_match('material issue');

  perform public.return_production_material_stock(v_mat);
  if pg_temp.bal('L3-M-2', 1) <> 5 or pg_temp.bal('L3-M-1', 1) <> 3 then raise exception 'FAIL material return lots'; end if;
  perform pg_temp.assert_match('material return');

  update public.production_orders set status = 'In-Progress' where id = v_order;
  perform public.process_production_ready_event(v_order);
  if (select custom_fields -> 'material_lots' from public.stock_lots where origin_doc_id = v_order and origin_type = 'production') is null then
    raise exception 'FAIL production lot lists no material lots';
  end if;
  perform public.process_production_delivery_event(v_order);
  if not exists (select 1 from public.stock_lot_movements where doc_id = v_order and product_id = f and doc_type = 'production_delivery'
                 and counterparty_type = 'customer' and qty_delta = -2) then
    raise exception 'FAIL delivery movement';
  end if;
  perform pg_temp.assert_match('delivery');
end $$;

-- ── Purchase reverse: the purchase's lot leaves ─────────────────────────────
do $$
declare
  w1 uuid := '00000000-0000-0000-03b7-0000000000e1';
  v_id uuid;
begin
  v_id := (public.save_purchase_invoice_draft(jsonb_build_object(
    'header', jsonb_build_object('supplier_id', '00000000-0000-0000-03b7-0000000000d1', 'doc_date', public.document_today()::text,
      'warehouse_id', w1, 'invoice_number', 'L3-PU1', 'total_amount', 20, 'paid_amount', 0, 'debt_amount', 20),
    'items', jsonb_build_array(jsonb_build_object('product_id', '00000000-0000-0000-03b7-000000000011', 'product_name', 'L3 purchased',
      'quantity', 4, 'unit_price', 5, 'total', 20, 'lot_no', 'L3-PUR-1')),
    'payments', '[]'::jsonb)) ->> 'purchase_id')::uuid;
  perform public.post_purchase_invoice_draft(v_id);
  if pg_temp.bal('L3-PUR-1', 1) <> 4 then raise exception 'FAIL purchase lot'; end if;
  perform public.cancel_purchase_invoice_atomic(v_id, 'L3 void');
  if pg_temp.bal('L3-PUR-1', 1) <> 0 then raise exception 'FAIL purchase reverse lot'; end if;
  perform pg_temp.assert_match('purchase reverse');
end $$;
reset role;

-- ── Consignment: dispatch from a chosen lot, return to it ───────────────────
do $$
declare
  g  uuid := '00000000-0000-0000-03b7-000000000007';
  w1 uuid := '00000000-0000-0000-03b7-0000000000e1';
  v_partner uuid := '00000000-0000-0000-03b7-0000000000a7';
  r jsonb;
begin
  insert into public.consignment_partners (id, code, name, is_active, created_at) values (v_partner, 'L3-CP', 'L3 partner', true, now()) on conflict (id) do nothing;
  r := public.create_consignment_dispatch_atomic(jsonb_build_object(
    'partner_id', v_partner, 'warehouse_id', w1, 'dispatch_no', 'L3-CD-1', 'created_by', '00000000-0000-0000-03b7-00000000000a',
    'items', jsonb_build_array(jsonb_build_object('product_id', g, 'product_name', 'L3 consigned', 'product_code', 'L3-G', 'quantity', 3, 'unit_price', 10,
      'lots', jsonb_build_array(jsonb_build_object('lot_id', pg_temp.lot_by_no('L3-G-2'), 'qty', 3))))));
  if pg_temp.bal('L3-G-2', 1) <> 2 or pg_temp.bal('L3-G-1', 1) <> 5 then raise exception 'FAIL dispatch lots: %', r; end if;
  if not exists (select 1 from public.stock_lot_movements where product_id = g and doc_type = 'consignment_dispatch' and counterparty_type = 'partner'
                 and counterparty_id = v_partner and pick_mode = 'manual') then
    raise exception 'FAIL dispatch movement fields';
  end if;
  perform pg_temp.assert_match('consignment dispatch');

  -- A bad choice: nothing dispatched.
  begin
    perform public.create_consignment_dispatch_atomic(jsonb_build_object(
      'partner_id', v_partner, 'warehouse_id', w1, 'dispatch_no', 'L3-CD-2',
      'items', jsonb_build_array(jsonb_build_object('product_id', g, 'product_name', 'L3 consigned', 'product_code', 'L3-G', 'quantity', 1, 'unit_price', 10,
        'lots', jsonb_build_array(jsonb_build_object('lot_id', pg_temp.lot_by_no('L3-A-1'), 'qty', 1))))));
    raise exception 'FAIL dispatch with another product''s lot accepted';
  exception when others then if sqlerrm not like 'lot_choice_invalid:%' then raise; end if;
  end;

  -- Settlement: 1 sold, 2 returned: back to G-2 (the lot that went to this partner).
  r := public.settle_consignment_partner_atomic(jsonb_build_object(
    'partner_id', v_partner, 'report_period', to_char(public.document_today(), 'YYYY-MM'), 'return_warehouse_id', w1, 'report_no', 'L3-CR-1',
    'created_by', '00000000-0000-0000-03b7-00000000000a',
    'lines', jsonb_build_array(jsonb_build_object('product_id', g, 'quantity_sold', 1, 'quantity_returned', 2, 'unit_price', 10))));
  if pg_temp.bal('L3-G-2', 1) <> 4 or pg_temp.bal('L3-G-1', 1) <> 5 then
    raise exception 'FAIL consignment return lots: G-1 % G-2 % (%)', pg_temp.bal('L3-G-1', 1), pg_temp.bal('L3-G-2', 1), r;
  end if;
  if public._lot_partner_return_lots(v_partner, g, 5) is distinct from jsonb_build_array(jsonb_build_object('lot_id', pg_temp.lot_by_no('L3-G-2'), 'qty', 1)) then
    raise exception 'FAIL partner open lots: %', public._lot_partner_return_lots(v_partner, g, 5);
  end if;
  perform pg_temp.assert_match('consignment settle');
end $$;

-- ── Transfer: lots go along (chosen, automatic, Polywood offcut) ─────────────
do $$
declare
  t  uuid := '00000000-0000-0000-03b7-000000000008';
  qp uuid := '00000000-0000-0000-03b7-000000000012';
  w1 uuid := '00000000-0000-0000-03b7-0000000000e1';
  w2 uuid := '00000000-0000-0000-03b7-0000000000e2';
  r jsonb;
  v_tr uuid;
  v_lot uuid;
  v_piece uuid;
begin
  r := public.post_stock_transfer(jsonb_build_object(
    'from_warehouse_id', w1, 'to_warehouse_id', w2, 'transfer_date', public.document_today()::text, 'created_by', '00000000-0000-0000-03b7-00000000000a',
    'items', jsonb_build_array(
      jsonb_build_object('product_id', t, 'quantity', 3, 'product_name', 'L3 moved', 'unit', 'Ədəd',
        'lots', jsonb_build_array(jsonb_build_object('lot_id', pg_temp.lot_by_no('L3-T-2'), 'qty', 3))),
      jsonb_build_object('product_id', t, 'quantity', 6, 'product_name', 'L3 moved', 'unit', 'Ədəd'))));
  v_tr := (r ->> 'transfer_id')::uuid;
  if not (r ->> 'success')::boolean or (r ->> 'reference_number') not like 'TRN-%' then raise exception 'FAIL transfer result: %', r; end if;
  -- Line 1: T-2 x 3. Line 2 FEFO: T-1 x 5, T-2 x 1.
  if pg_temp.bal('L3-T-1', 1) <> 0 or pg_temp.bal('L3-T-2', 1) <> 1 or pg_temp.bal('L3-T-1', 2) <> 5 or pg_temp.bal('L3-T-2', 2) <> 4 then
    raise exception 'FAIL transfer lots: W1 % %, W2 % %', pg_temp.bal('L3-T-1', 1), pg_temp.bal('L3-T-2', 1), pg_temp.bal('L3-T-1', 2), pg_temp.bal('L3-T-2', 2);
  end if;
  if exists (select 1 from public.stock_lot_movements where doc_id = v_tr and (doc_type <> 'stock_transfer' or counterparty_type <> 'warehouse'
             or kind not in ('transfer_out', 'transfer_in') or doc_line_id is null))
     or (select count(*) from public.stock_lot_movements where doc_id = v_tr and kind = 'transfer_in' and pick_mode = 'mirror') <> 3 then
    raise exception 'FAIL transfer movement fields';
  end if;
  if (select count(*) from public.stock_transfer_items where transfer_id = v_tr) <> 2
     or (select count(*) from public.stock_movements where reference_id = v_tr) <> 4 then
    raise exception 'FAIL transfer rows';
  end if;
  perform pg_temp.assert_match('transfer');

  -- Refused before anything moves: too much, a bad lot; nothing is written.
  begin
    perform public.post_stock_transfer(jsonb_build_object('from_warehouse_id', w1, 'to_warehouse_id', w2, 'reference_number', 'L3-TR-BAD',
      'items', jsonb_build_array(jsonb_build_object('product_id', t, 'quantity', 1, 'product_name', 'L3 moved',
        'lots', jsonb_build_array(jsonb_build_object('lot_id', pg_temp.lot_by_no('L3-T-1'), 'qty', 1))))));
    raise exception 'FAIL transfer from an empty lot accepted';
  exception when others then if sqlerrm not like 'lot_choice_short:%' then raise; end if;
  end;
  begin
    perform public.post_stock_transfer(jsonb_build_object('from_warehouse_id', w1, 'to_warehouse_id', w2, 'reference_number', 'L3-TR-BAD',
      'items', jsonb_build_array(jsonb_build_object('product_id', t, 'quantity', 2, 'product_name', 'L3 moved'))));
    raise exception 'FAIL transfer over stock accepted';
  exception when others then if sqlerrm not like 'L3 moved: transfer miqdarı%' then raise; end if;
  end;
  begin
    perform public.post_stock_transfer(jsonb_build_object('from_warehouse_id', w1, 'to_warehouse_id', w1,
      'items', jsonb_build_array(jsonb_build_object('product_id', t, 'quantity', 1))));
    raise exception 'FAIL transfer to the same warehouse accepted';
  exception when others then if sqlerrm not like 'Çıxış və giriş anbarı eyni%' then raise; end if;
  end;
  if exists (select 1 from public.stock_transfers where reference_number = 'L3-TR-BAD') then raise exception 'FAIL a refused transfer was written'; end if;

  -- Polywood offcut: the piece moves with its lot.
  v_lot := public._lot_create(qp, jsonb_build_object('lot_no', 'L3-QP-1', 'origin_type', 'manual'));
  insert into public.polywood_pieces (product_id, warehouse_id, length_m, piece_type, status, notes, lot_id)
  values (qp, w1, 1.5, 'cut', 'available', 'L3 offcut', v_lot) returning id into v_piece;
  r := public.post_stock_transfer(jsonb_build_object('from_warehouse_id', w1, 'to_warehouse_id', w2,
    'items', jsonb_build_array(jsonb_build_object('product_id', qp, 'offcut_id', v_piece, 'quantity', 1.5, 'product_name', 'L3 plywood'))));
  if (select warehouse_id from public.polywood_pieces where id = v_piece) <> w2 or pg_temp.bal('L3-QP-1', 1) <> 0 or pg_temp.bal('L3-QP-1', 2) <> 1.5 then
    raise exception 'FAIL offcut transfer: piece % lot W1 % W2 %', (select warehouse_id from public.polywood_pieces where id = v_piece), pg_temp.bal('L3-QP-1', 1), pg_temp.bal('L3-QP-1', 2);
  end if;
  if (select lot_id from public.polywood_pieces where id = v_piece) <> v_lot then raise exception 'FAIL offcut lost its lot'; end if;
  perform pg_temp.assert_match('offcut transfer');
end $$;

-- ── Count shortage, then unpost ─────────────────────────────────────────────
do $$
declare
  n  uuid := '00000000-0000-0000-03b7-000000000010';
  w1 uuid := '00000000-0000-0000-03b7-0000000000e1';
  a  uuid := '00000000-0000-0000-03b7-00000000000a';
  v_id uuid;
begin
  insert into public.inventory_counts (document_number, warehouse_id, warehouse_name, status)
  values ('L3-CNT-1', w1, 'L3 anbar 1', 'draft') returning id into v_id;
  update public.inventory_counts set status = 'in_progress' where id = v_id;
  perform public.inventory_count_add_product(v_id, n);
  perform public.save_count_progress(v_id, jsonb_build_array(jsonb_build_object(
    'line_id', (select id from public.inventory_count_items where count_id = v_id), 'kind', 'qty', 'actual_qty', 2)));
  perform public.inventory_count_submit(v_id);
  perform public.inventory_count_post(v_id, a);
  -- Shortage of 4: FEFO N-1 x 3, N-2 x 1.
  if pg_temp.bal('L3-N-1', 1) <> 0 or pg_temp.bal('L3-N-2', 1) <> 2 then raise exception 'FAIL count shortage lots'; end if;
  perform pg_temp.assert_match('count shortage');
  perform public.inventory_count_unpost(v_id, 'L3 unpost', a);
  if pg_temp.bal('L3-N-1', 1) <> 3 or pg_temp.bal('L3-N-2', 1) <> 3 then raise exception 'FAIL count unpost lots'; end if;
  perform pg_temp.assert_match('count unpost');
end $$;

do $$
begin
  if exists (select 1 from public.audit_alerts where message like 'lot_error%' and created_at > now() - interval '1 hour'
             and message like '%03b7%') then
    raise exception 'FAIL a lot_error was written: %', (select string_agg(message, ' | ') from public.audit_alerts where message like 'lot_error%' and message like '%03b7%');
  end if;
end $$;

select 'ALL CHECKS PASSED';
