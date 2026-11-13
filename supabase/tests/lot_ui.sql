-- Checks supabase/migrations/20261115130000_lot_ui.sql (LOT-4) on a database built with
-- scripts/db/build-fresh.sh --plain-postgres (CI: .github/workflows/db-baseline.yml), after LOT-1..3.
-- Any failed check raises an exception; the last line prints ALL CHECKS PASSED.
-- Leaves test rows behind: run it on a throwaway database only.
--
-- The reads of the lot card: key figures (received, on hand, sold, written off, at consignment
-- partners, in production) net of a cancelled sale; one page of movements newest first with the
-- running balance and the total count; the forward trace per customer / partner; refusal without
-- lots.view; lots carry chatter.

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-04b7-00000000000a', 'lot4-a@example.test', '{"full_name": "Lot4 Test Admin", "role_name": "Admin"}'),
  ('00000000-0000-0000-04b7-00000000000b', 'lot4-b@example.test', '{"full_name": "Lot4 No Lots", "role_name": "Admin"}')
on conflict (id) do nothing;
update public.profiles set is_active = true, role_id = (select id from public.roles where name = 'Admin' order by is_system desc limit 1)
where id = '00000000-0000-0000-04b7-00000000000a';
-- A role without lots.view.
insert into public.roles (id, name, permissions) values ('00000000-0000-0000-04b7-0000000000f1', 'Lot4 no lots', '{}'::jsonb) on conflict (id) do nothing;
update public.profiles set is_active = true, role_id = '00000000-0000-0000-04b7-0000000000f1' where id = '00000000-0000-0000-04b7-00000000000b';

insert into public.warehouses (id, code, name, is_default, created_at) values
  ('00000000-0000-0000-04b7-0000000000e1', 'L4-W1', 'L4 anbar 1', false, now()),
  ('00000000-0000-0000-04b7-0000000000e2', 'L4-W2', 'L4 anbar 2', false, now())
on conflict (id) do nothing;
insert into public.customers (id, full_name) values
  ('00000000-0000-0000-04b7-0000000000c1', 'L4 customer 1'),
  ('00000000-0000-0000-04b7-0000000000c2', 'L4 customer 2')
on conflict (id) do nothing;
insert into public.products (id, code, name, stock, buy_price, is_service, is_composite, inventory_mode, full_sheet_length_m, unit) values
  ('00000000-0000-0000-04b7-000000000001', 'L4-A', 'L4 traced', 0, 5, false, false, 'standard', 4, 'Ədəd')
on conflict (id) do nothing;

-- A stock change of product A in warehouse w with a lot context (the documents' own path is
-- tested in lot_outbound.sql; here only the movements the card reads matter).
create or replace function pg_temp.move(p_qty numeric, w int, p_ctx jsonb) returns void language plpgsql as $$
begin
  perform public.lot_ctx_begin(p_ctx || jsonb_build_object('product_id', '00000000-0000-0000-04b7-000000000001'));
  perform public.adjust_warehouse_stock('00000000-0000-0000-04b7-000000000001',
    case w when 1 then '00000000-0000-0000-04b7-0000000000e1'::uuid else '00000000-0000-0000-04b7-0000000000e2'::uuid end, p_qty);
  perform public.lot_ctx_end();
end $$;

-- Receipt of 20 into W1 as lot L4-LOT-1.
select pg_temp.move(20, 1, jsonb_build_object('doc_type', 'test_in', 'doc_id', gen_random_uuid(), 'doc_no', 'L4-IN-1',
  'new_lot', jsonb_build_object('lot_no', 'L4-LOT-1', 'supplier_batch_no', 'L4-B-1', 'exp_date', (current_date + 90)::text)));

create temp table l4_lot as select id from public.stock_lots where lot_no = 'L4-LOT-1';
create temp table l4_ids (k text primary key, id uuid);
grant select on l4_lot to authenticated;
grant all on l4_ids to authenticated;

set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-04b7-00000000000a","role":"authenticated"}', false);

do $$
declare
  a  uuid := '00000000-0000-0000-04b7-000000000001';
  w1 uuid := '00000000-0000-0000-04b7-0000000000e1';
  v_sale1 uuid;
  v_sale2 uuid;
begin
  -- Two sales: 4 to customer 1, 3 to customer 2; the second is cancelled.
  v_sale1 := (public.save_sales_invoice_draft(jsonb_build_object(
    'header', jsonb_build_object('customer_id', '00000000-0000-0000-04b7-0000000000c1', 'total_amount', 40, 'subtotal', 40, 'paid_amount', 0, 'remaining_balance', 40),
    'items', jsonb_build_array(jsonb_build_object('product_id', a, 'product_name', 'L4 traced', 'quantity', 4, 'unit_price', 10, 'line_total', 40, 'total', 40, 'warehouse_id', w1)),
    'payments', '[]'::jsonb)) ->> 'sale_id')::uuid;
  perform public.post_sales_invoice_draft(v_sale1);
  v_sale2 := (public.save_sales_invoice_draft(jsonb_build_object(
    'header', jsonb_build_object('customer_id', '00000000-0000-0000-04b7-0000000000c2', 'total_amount', 30, 'subtotal', 30, 'paid_amount', 0, 'remaining_balance', 30),
    'items', jsonb_build_array(jsonb_build_object('product_id', a, 'product_name', 'L4 traced', 'quantity', 3, 'unit_price', 10, 'line_total', 30, 'total', 30, 'warehouse_id', w1)),
    'payments', '[]'::jsonb)) ->> 'sale_id')::uuid;
  perform public.post_sales_invoice_draft(v_sale2);
  perform public.cancel_sales_invoice_atomic(v_sale2, 'L4 test');
  insert into l4_ids values ('sale1', v_sale1), ('sale2', v_sale2);
end $$;

-- The other documents' movements (their own paths are tested in lot_outbound.sql).
reset role;
do $$
begin
  -- Write-off 1, consignment 2 to a partner (1 comes back), production issue 3 (1 returned), transfer 5 to W2.
  perform pg_temp.move(-1, 1, jsonb_build_object('doc_type', 'inventory_writeoff', 'doc_id', gen_random_uuid(), 'doc_no', 'L4-WO-1'));
  perform pg_temp.move(-2, 1, jsonb_build_object('doc_type', 'consignment_dispatch', 'doc_id', '00000000-0000-0000-04b7-0000000000a1', 'doc_no', 'L4-K-1',
    'counterparty_type', 'partner', 'counterparty_id', '00000000-0000-0000-04b7-0000000000b1'));
  perform pg_temp.move(1, 1, jsonb_build_object('doc_type', 'consignment_dispatch', 'doc_id', '00000000-0000-0000-04b7-0000000000a1', 'doc_no', 'L4-K-1',
    'counterparty_type', 'partner', 'counterparty_id', '00000000-0000-0000-04b7-0000000000b1', 'mode', 'reverse',
    'reverse_of', jsonb_build_object('doc_type', 'consignment_dispatch', 'doc_id', '00000000-0000-0000-04b7-0000000000a1')));
  perform pg_temp.move(-3, 1, jsonb_build_object('doc_type', 'production_order', 'doc_id', '00000000-0000-0000-04b7-0000000000a2', 'doc_no', 'L4-PO-1',
    'counterparty_type', 'none'));
  perform pg_temp.move(1, 1, jsonb_build_object('doc_type', 'production_order', 'doc_id', '00000000-0000-0000-04b7-0000000000a2', 'doc_no', 'L4-PO-1',
    'mode', 'reverse', 'reverse_of', jsonb_build_object('doc_type', 'production_order', 'doc_id', '00000000-0000-0000-04b7-0000000000a2')));
end $$;

set role authenticated;
do $$
declare
  v_sale1 uuid := (select id from l4_ids where k = 'sale1');
  v_sum jsonb;
  v_n bigint;
  r record;
begin
  -- Balance: 20 - 4 - 1 - 2 + 1 - 3 + 1 = 12.
  v_sum := public.lot_card_summary((select id from l4_lot));
  if (v_sum ->> 'received')::numeric <> 20 then raise exception 'FAIL received: %', v_sum; end if;
  if (v_sum ->> 'on_hand')::numeric <> 12 then raise exception 'FAIL on hand: %', v_sum; end if;
  if (v_sum ->> 'sold')::numeric <> 4 then raise exception 'FAIL sold (the cancelled sale must not count): %', v_sum; end if;
  if (v_sum ->> 'written_off')::numeric <> 1 then raise exception 'FAIL written off: %', v_sum; end if;
  if (v_sum ->> 'at_partners')::numeric <> 1 then raise exception 'FAIL at partners: %', v_sum; end if;
  if (v_sum ->> 'in_production')::numeric <> 2 then raise exception 'FAIL in production: %', v_sum; end if;
  v_n := (select count(*) from public.stock_lot_movements where lot_id = (select id from l4_lot));
  if (v_sum ->> 'movement_count')::bigint <> v_n then raise exception 'FAIL movement count: % vs %', v_sum, v_n; end if;

  -- Movements: newest first, running balance after each, total count on every row, paging.
  if (select count(*) from public.lot_movements_page((select id from l4_lot), 3, 0)) <> 3 then raise exception 'FAIL page size'; end if;
  select * into r from public.lot_movements_page((select id from l4_lot), 1, 0);
  if r.running_balance <> 12 or r.total_count <> v_n or r.qty_delta <> 1 or r.doc_type <> 'production_order' then
    raise exception 'FAIL newest movement: %', row_to_json(r);
  end if;
  select * into r from public.lot_movements_page((select id from l4_lot), 1, (v_n - 1)::int);
  if r.running_balance <> 20 or r.kind <> 'in' then raise exception 'FAIL oldest movement: %', row_to_json(r); end if;
  if exists (select 1 from public.lot_movements_page((select id from l4_lot), 50, v_n::int)) then raise exception 'FAIL page past the end'; end if;
  if (select count(*) from public.lot_movements_page((select id from l4_lot), 100000, 0)) <> least(v_n, 500) then raise exception 'FAIL page cap'; end if;
  -- Every page's running balances agree with the ledger.
  if exists (
    select 1 from public.lot_movements_page((select id from l4_lot), 500, 0) p
    where p.running_balance <> (select sum(m.qty_delta) from public.stock_lot_movements m where m.lot_id = (select id from l4_lot)
      and (m.movement_date, m.recorded_at, m.id) <= (p.movement_date, p.recorded_at, p.id))
  ) then raise exception 'FAIL running balance'; end if;

  -- Forward trace: customer 1 (4, sale 1); customer 2 is gone (cancelled); the partner keeps 1.
  if (select count(*) from public.lot_trace_forward((select id from l4_lot))) <> 2 then
    raise exception 'FAIL trace rows: %', (select jsonb_agg(to_jsonb(t)) from public.lot_trace_forward((select id from l4_lot)) t);
  end if;
  select * into r from public.lot_trace_forward((select id from l4_lot)) t where t.counterparty_type = 'customer';
  if r.counterparty_id <> '00000000-0000-0000-04b7-0000000000c1' or r.qty <> 4 or r.doc_id <> v_sale1 or r.doc_no is distinct from (select doc_no from public.sales where id = v_sale1) then
    raise exception 'FAIL customer trace: %', row_to_json(r);
  end if;
  select * into r from public.lot_trace_forward((select id from l4_lot)) t where t.counterparty_type = 'partner';
  if r.qty <> 1 or r.doc_type <> 'consignment' or r.doc_id is not null or r.doc_no <> 'L4-K-1' then raise exception 'FAIL partner trace: %', row_to_json(r); end if;

  -- Lots carry chatter.
  if not ('stock_lots' = any (public.chatter_models())) then raise exception 'FAIL stock_lots is not a chatter model'; end if;
end $$;

-- Without lots.view every read is refused.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-04b7-00000000000b","role":"authenticated"}', false);
do $$
declare
  v_lot uuid := (select id from l4_lot);
begin
  if v_lot is null then raise exception 'FAIL no lot id'; end if;
  begin
    perform public.lot_card_summary(v_lot);
    raise exception 'FAIL summary without lots.view';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.lot_movements_page(v_lot, 10, 0);
    raise exception 'FAIL movements without lots.view';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.lot_trace_forward(v_lot);
    raise exception 'FAIL trace without lots.view';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;
select 'ALL CHECKS PASSED';
