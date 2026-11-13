-- Checks supabase/migrations/20261115100000_lot_core.sql (LOT-1) on a database built with
-- scripts/db/build-fresh.sh --plain-postgres (CI: .github/workflows/db-baseline.yml).
-- Any failed check raises an exception; the last line prints ALL CHECKS PASSED.
-- Leaves test rows behind: run it on a throwaway database only.
--
-- Warehouses W1, W2. Products: PB (backfill), PC (FEFO / chosen / reverse / mirror / shortage),
-- PW (Polywood), PE (an unexpected error), PD (date change), PX (deleted).

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-01a7-00000000000a', 'lot-a@example.test', '{"full_name": "Lot Test Admin", "role_name": "Admin"}'),
  ('00000000-0000-0000-01a7-00000000000b', 'lot-v@example.test', '{"full_name": "Lot Test Viewer"}'),
  ('00000000-0000-0000-01a7-00000000000c', 'lot-n@example.test', '{"full_name": "Lot Test None"}')
on conflict (id) do nothing;
insert into public.roles (id, name, permissions) values
  ('00000000-0000-0000-01a7-0000000000f1', 'LOT viewer', '{"can_view_lots": true}'),
  ('00000000-0000-0000-01a7-0000000000f2', 'LOT none', '{}')
on conflict (id) do nothing;
update public.profiles set is_active = true, role_id = case id
    when '00000000-0000-0000-01a7-00000000000a' then (select id from public.roles where name = 'Admin' order by is_system desc limit 1)
    when '00000000-0000-0000-01a7-00000000000b' then '00000000-0000-0000-01a7-0000000000f1'::uuid
    else '00000000-0000-0000-01a7-0000000000f2'::uuid end
where id::text like '00000000-0000-0000-01a7-%';

insert into public.warehouses (id, code, name, is_default, created_at) values
  ('00000000-0000-0000-01a7-0000000000e1', 'LOT-W1', 'LOT anbar 1', false, now()),
  ('00000000-0000-0000-01a7-0000000000e2', 'LOT-W2', 'LOT anbar 2', false, now())
on conflict (id) do nothing;
insert into public.customers (id, full_name) values ('00000000-0000-0000-01a7-0000000000c1', 'LOT customer') on conflict (id) do nothing;
insert into public.suppliers (id, full_name) values ('00000000-0000-0000-01a7-0000000000d1', 'LOT supplier') on conflict (id) do nothing;
insert into public.products (id, code, name, stock, buy_price, is_service, is_composite, inventory_mode, full_sheet_length_m) values
  ('00000000-0000-0000-01a7-000000000001', 'LOT-PB', 'LOT backfill', 0, 5, false, false, 'standard', 4),
  ('00000000-0000-0000-01a7-000000000002', 'LOT-PC', 'LOT fefo', 0, 5, false, false, 'standard', 4),
  ('00000000-0000-0000-01a7-000000000003', 'LOT-PW', 'LOT plywood', 0, 5, false, false, 'polywood', 4),
  ('00000000-0000-0000-01a7-000000000004', 'LOT-PE', 'LOT error', 0, 5, false, false, 'standard', 4),
  ('00000000-0000-0000-01a7-000000000005', 'LOT-PD', 'LOT date', 0, 5, false, false, 'standard', 4),
  ('00000000-0000-0000-01a7-000000000006', 'LOT-PX', 'LOT deleted', 0, 5, false, false, 'standard', 4),
  ('00000000-0000-0000-01a7-000000000007', 'LOT-SV', 'LOT service', 0, 5, true, false, 'standard', 4)
on conflict (id) do nothing;

create or replace function pg_temp.codes(p jsonb, p_kind text) returns text[] language sql as $$
  select coalesce(array_agg(x->>'code' order by x->>'code'), '{}') from jsonb_array_elements(p->p_kind) x;
$$;
-- Balance of a lot (by supplier batch no or lot id) in a warehouse.
create or replace function pg_temp.bal(p_lot uuid, p_wh uuid) returns numeric language sql as $$
  select coalesce((select qty from public.stock_lot_balances where lot_id = p_lot and warehouse_id = p_wh), 0);
$$;
create or replace function pg_temp.lot(p_batch text) returns uuid language sql as $$
  select id from public.stock_lots where supplier_batch_no = p_batch;
$$;
create or replace function pg_temp.unassigned(p_product uuid) returns uuid language sql as $$
  select id from public.stock_lots where product_id = p_product and origin_type = 'unassigned';
$$;
-- Lots = stock for the product (every warehouse).
create or replace function pg_temp.assert_match(p_product uuid, p_step text) returns void language plpgsql as $$
begin
  if exists (select 1 from public._lot_mismatches() m where m.product_id = p_product) then
    raise exception 'FAIL % lots <> stock: %', p_step, (select jsonb_agg(to_jsonb(m)) from public._lot_mismatches() m where m.product_id = p_product);
  end if;
end $$;
create temp table lot_ids (k text primary key, id uuid);
grant all on lot_ids to authenticated;

-- ── 1. Backfill: stock that existed before LOT-1 ────────────────────────────
-- The triggers are switched off (as before the migration) while PB gets a purchase of 6 and 4
-- more, and PW two 4 m pieces.
begin;
select set_config('erp.lot_backfill', 'on', true);
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-01a7-00000000000a","role":"authenticated"}', true);
set local role authenticated;
do $$
declare v_id uuid;
begin
  v_id := (public.save_purchase_invoice_draft(jsonb_build_object(
    'header', jsonb_build_object('supplier_id', '00000000-0000-0000-01a7-0000000000d1', 'doc_date', (public.document_today() - 40)::text,
      'warehouse_id', '00000000-0000-0000-01a7-0000000000e1', 'invoice_number', 'LOT-PU1', 'total_amount', 30, 'paid_amount', 0, 'debt_amount', 30),
    'items', jsonb_build_array(jsonb_build_object('product_id', '00000000-0000-0000-01a7-000000000001', 'product_name', 'LOT backfill',
      'quantity', 6, 'unit_price', 5, 'total', 30)),
    'payments', '[]'::jsonb)) ->> 'purchase_id')::uuid;
  perform public.post_purchase_invoice_draft(v_id);
  insert into lot_ids values ('pu1', v_id);
end $$;
reset role;
select public.adjust_warehouse_stock('00000000-0000-0000-01a7-000000000001', '00000000-0000-0000-01a7-0000000000e1', 4);
insert into public.polywood_pieces (product_id, warehouse_id, length_m, piece_type, status, notes) values
  ('00000000-0000-0000-01a7-000000000003', '00000000-0000-0000-01a7-0000000000e1', 4, 'full', 'available', 'LOT piece 1'),
  ('00000000-0000-0000-01a7-000000000003', '00000000-0000-0000-01a7-0000000000e1', 4, 'full', 'available', 'LOT piece 2');
commit;

do $$
declare
  pb uuid := '00000000-0000-0000-01a7-000000000001';
  pw uuid := '00000000-0000-0000-01a7-000000000003';
  w1 uuid := '00000000-0000-0000-01a7-0000000000e1';
  v_pl uuid;
  v_ol uuid;
  r jsonb;
begin
  if exists (select 1 from public.stock_lots where product_id in (pb, pw)) then raise exception 'FAIL setup: lots before the backfill'; end if;
  r := public._lot_backfill();
  select id into v_pl from public.stock_lots where product_id = pb and origin_type = 'purchase';
  select id into v_ol from public.stock_lots where product_id = pb and origin_type = 'opening';
  if v_pl is null or pg_temp.bal(v_pl, w1) <> 6 then raise exception 'FAIL backfill purchase lot: %', r; end if;
  if (select origin_doc_id from public.stock_lots where id = v_pl) <> (select id from lot_ids where k = 'pu1')
     or (select received_date from public.stock_lots where id = v_pl) <> public.document_today() - 40
     or not exists (select 1 from public.inventory_batches where lot_id = v_pl) then
    raise exception 'FAIL backfill purchase lot links';
  end if;
  if v_ol is null or pg_temp.bal(v_ol, w1) <> 4 then raise exception 'FAIL backfill opening lot: %', r; end if;
  if exists (select 1 from public.polywood_pieces where product_id = pw and status = 'available' and lot_id is null) then
    raise exception 'FAIL backfill pieces without a lot';
  end if;
  if (select count(distinct lot_id) from public.polywood_pieces where product_id = pw) <> 1 then raise exception 'FAIL backfill: one opening lot for the pieces'; end if;
  if not exists (select 1 from public.stock_lot_movements where lot_id = v_pl and pick_mode = 'backfill') then raise exception 'FAIL backfill movement'; end if;
  if (select lot_no from public.stock_lots where id = v_pl) !~ '^LOT-\d{4}-\d{5}$' then raise exception 'FAIL lot number format: %', (select lot_no from public.stock_lots where id = v_pl); end if;
  perform pg_temp.assert_match(pb, 'backfill PB');
  perform pg_temp.assert_match(pw, 'backfill PW');
  -- Run again: nothing more.
  r := public._lot_backfill();
  if (select count(*) from public.stock_lots where product_id in (pb, pw)) <> 3 then raise exception 'FAIL backfill not idempotent'; end if;
  perform pg_temp.assert_match(pb, 'backfill again');
end $$;

-- ── 2. In with a document: new lots; out: FEFO, then FIFO ────────────────────
-- PC in W1: 5 expiring in 30 days (SB-30), 5 in 10 days (SB-10), 5 without a date (SB-0).
begin;
select public.lot_ctx_begin(jsonb_build_object('doc_type', 'test_in', 'doc_id', gen_random_uuid(), 'product_id', '00000000-0000-0000-01a7-000000000002',
  'counterparty_type', 'supplier', 'counterparty_id', '00000000-0000-0000-01a7-0000000000d1',
  'new_lot', jsonb_build_object('supplier_batch_no', 'SB-30', 'exp_date', (public.document_today() + 30)::text)));
select public.adjust_warehouse_stock('00000000-0000-0000-01a7-000000000002', '00000000-0000-0000-01a7-0000000000e1', 5);
select public.lot_ctx_begin(jsonb_build_object('doc_type', 'test_in', 'doc_id', gen_random_uuid(), 'product_id', '00000000-0000-0000-01a7-000000000002',
  'new_lot', jsonb_build_object('supplier_batch_no', 'SB-10', 'exp_date', (public.document_today() + 10)::text)));
select public.adjust_warehouse_stock('00000000-0000-0000-01a7-000000000002', '00000000-0000-0000-01a7-0000000000e1', 5);
select public.lot_ctx_begin(jsonb_build_object('doc_type', 'test_in', 'doc_id', gen_random_uuid(), 'product_id', '00000000-0000-0000-01a7-000000000002',
  'new_lot', jsonb_build_object('supplier_batch_no', 'SB-0')));
select public.adjust_warehouse_stock('00000000-0000-0000-01a7-000000000002', '00000000-0000-0000-01a7-0000000000e1', 5);
select public.lot_ctx_end();
commit;
insert into lot_ids values ('o1', gen_random_uuid()), ('o2', gen_random_uuid()), ('o3', gen_random_uuid()), ('v1', gen_random_uuid()), ('tr', gen_random_uuid()), ('o4', gen_random_uuid());

begin;
select public.lot_ctx_begin(jsonb_build_object('doc_type', 'test_out', 'doc_id', (select id from lot_ids where k = 'o1'),
  'product_id', '00000000-0000-0000-01a7-000000000002', 'counterparty_type', 'customer', 'counterparty_id', '00000000-0000-0000-01a7-0000000000c1'));
select public.adjust_warehouse_stock('00000000-0000-0000-01a7-000000000002', '00000000-0000-0000-01a7-0000000000e1', -7);
select public.lot_ctx_begin(jsonb_build_object('doc_type', 'test_out', 'doc_id', (select id from lot_ids where k = 'o2'),
  'product_id', '00000000-0000-0000-01a7-000000000002', 'counterparty_type', 'customer'));
select public.adjust_warehouse_stock('00000000-0000-0000-01a7-000000000002', '00000000-0000-0000-01a7-0000000000e1', -6);
select public.lot_ctx_end();
commit;

do $$
declare
  w1 uuid := '00000000-0000-0000-01a7-0000000000e1';
  o1 uuid := (select id from lot_ids where k = 'o1');
  o2 uuid := (select id from lot_ids where k = 'o2');
begin
  if pg_temp.lot('SB-30') is null or (select origin_type from public.stock_lots where id = pg_temp.lot('SB-30')) <> 'manual'
     or (select exp_date from public.stock_lots where id = pg_temp.lot('SB-30')) <> public.document_today() + 30 then
    raise exception 'FAIL new lot from the context';
  end if;
  -- o1 (7): 5 of SB-10 (expires first), 2 of SB-30, both FEFO.
  if (select string_agg(l.supplier_batch_no || ':' || m.qty_delta || ':' || m.pick_mode || ':' || m.kind || ':' || m.counterparty_type, ',' order by m.recorded_at)
      from public.stock_lot_movements m join public.stock_lots l on l.id = m.lot_id where m.doc_id = o1) is distinct from 'SB-10:-5:fefo:out:customer,SB-30:-2:fefo:out:customer' then
    raise exception 'FAIL FEFO: %', (select jsonb_agg(m) from public.stock_lot_movements m where m.doc_id = o1);
  end if;
  -- o2 (6): 3 of SB-30 (FEFO), 3 of SB-0 (no date: FIFO).
  if (select string_agg(l.supplier_batch_no || ':' || m.qty_delta || ':' || m.pick_mode, ',' order by m.recorded_at)
      from public.stock_lot_movements m join public.stock_lots l on l.id = m.lot_id where m.doc_id = o2) is distinct from 'SB-30:-3:fefo,SB-0:-3:fifo' then
    raise exception 'FAIL FIFO after FEFO: %', (select jsonb_agg(m) from public.stock_lot_movements m where m.doc_id = o2);
  end if;
  if exists (select 1 from public.stock_lot_movements m where m.doc_id in (o1, o2) and m.balance_after <> pg_temp.bal(m.lot_id, w1)
             and m.recorded_at = (select max(recorded_at) from public.stock_lot_movements x where x.lot_id = m.lot_id)) then
    raise exception 'FAIL balance_after';
  end if;
  perform pg_temp.assert_match('00000000-0000-0000-01a7-000000000002', 'FEFO');
end $$;

-- ── 3. Chosen lots; 4. reverse; 5. mirror (transfer) ─────────────────────────
begin;
select public.lot_ctx_begin(jsonb_build_object('doc_type', 'test_out', 'doc_id', (select id from lot_ids where k = 'o3'),
  'product_id', '00000000-0000-0000-01a7-000000000002', 'lots', jsonb_build_array(jsonb_build_object('lot_no', (select lot_no from public.stock_lots where supplier_batch_no = 'SB-0'), 'qty', 1))));
select public.adjust_warehouse_stock('00000000-0000-0000-01a7-000000000002', '00000000-0000-0000-01a7-0000000000e1', -1);
-- Void of o2 gives 4 back: to the lots o2 took, latest first (SB-0: 3, then SB-30: 1).
select public.lot_ctx_begin(jsonb_build_object('doc_type', 'test_void', 'doc_id', (select id from lot_ids where k = 'v1'),
  'product_id', '00000000-0000-0000-01a7-000000000002', 'mode', 'reverse',
  'reverse_of', jsonb_build_object('doc_type', 'test_out', 'doc_id', (select id from lot_ids where k = 'o2'))));
select public.adjust_warehouse_stock('00000000-0000-0000-01a7-000000000002', '00000000-0000-0000-01a7-0000000000e1', 4);
-- Transfer of 2 from W1 to W2: out FEFO (SB-30: 1, SB-0: 1), in mirrors the same lots.
select public.lot_ctx_begin(jsonb_build_object('doc_type', 'test_tr', 'doc_id', (select id from lot_ids where k = 'tr'),
  'product_id', '00000000-0000-0000-01a7-000000000002', 'counterparty_type', 'warehouse', 'counterparty_id', '00000000-0000-0000-01a7-0000000000e2'));
select public.adjust_warehouse_stock('00000000-0000-0000-01a7-000000000002', '00000000-0000-0000-01a7-0000000000e1', -2);
select public.lot_ctx_begin(jsonb_build_object('doc_type', 'test_tr', 'doc_id', (select id from lot_ids where k = 'tr'),
  'product_id', '00000000-0000-0000-01a7-000000000002', 'mode', 'mirror', 'counterparty_type', 'warehouse',
  'mirror_of', jsonb_build_object('doc_type', 'test_tr', 'doc_id', (select id from lot_ids where k = 'tr'))));
select public.adjust_warehouse_stock('00000000-0000-0000-01a7-000000000002', '00000000-0000-0000-01a7-0000000000e2', 2);
select public.lot_ctx_end();
commit;

do $$
declare
  w1 uuid := '00000000-0000-0000-01a7-0000000000e1';
  w2 uuid := '00000000-0000-0000-01a7-0000000000e2';
begin
  if (select string_agg(m.pick_mode || ':' || m.qty_delta, ',') from public.stock_lot_movements m where m.doc_id = (select id from lot_ids where k = 'o3'))
     is distinct from 'manual:-1' or not exists (select 1 from public.stock_lot_movements m where m.doc_id = (select id from lot_ids where k = 'o3') and m.lot_id = pg_temp.lot('SB-0')) then
    raise exception 'FAIL chosen lot';
  end if;
  if (select string_agg(l.supplier_batch_no || ':' || m.qty_delta || ':' || m.kind || ':' || m.pick_mode || ':' || (m.reverses_movement_id is not null), ',' order by m.recorded_at)
      from public.stock_lot_movements m join public.stock_lots l on l.id = m.lot_id where m.doc_id = (select id from lot_ids where k = 'v1'))
     is distinct from 'SB-0:3:reverse_in:reverse:true,SB-30:1:reverse_in:reverse:true' then
    raise exception 'FAIL reverse: %', (select jsonb_agg(m) from public.stock_lot_movements m where m.doc_id = (select id from lot_ids where k = 'v1'));
  end if;
  if (select string_agg(l.supplier_batch_no || ':' || m.qty_delta || ':' || m.kind || ':' || m.pick_mode, ',' order by m.recorded_at)
      from public.stock_lot_movements m join public.stock_lots l on l.id = m.lot_id where m.doc_id = (select id from lot_ids where k = 'tr'))
     is distinct from 'SB-30:-1:transfer_out:fefo,SB-0:-1:transfer_out:fifo,SB-30:1:transfer_in:mirror,SB-0:1:transfer_in:mirror' then
    raise exception 'FAIL mirror: %', (select jsonb_agg(m) from public.stock_lot_movements m where m.doc_id = (select id from lot_ids where k = 'tr'));
  end if;
  if pg_temp.bal(pg_temp.lot('SB-30'), w2) <> 1 or pg_temp.bal(pg_temp.lot('SB-0'), w2) <> 1 or pg_temp.bal(pg_temp.lot('SB-0'), w1) <> 3 then
    raise exception 'FAIL balances after the transfer';
  end if;
  perform pg_temp.assert_match('00000000-0000-0000-01a7-000000000002', 'mirror');
end $$;

-- ── 6. No context: unassigned + alert; shortage: unassigned negative + alert ──
select public.adjust_warehouse_stock('00000000-0000-0000-01a7-000000000002', '00000000-0000-0000-01a7-0000000000e2', 3);
begin;
select set_config('erp.lot_backfill', 'on', true);
select public.adjust_warehouse_stock('00000000-0000-0000-01a7-000000000002', '00000000-0000-0000-01a7-0000000000e2', 4);
commit;
begin;
select public.lot_ctx_begin(jsonb_build_object('doc_type', 'test_out', 'doc_id', (select id from lot_ids where k = 'o4'), 'product_id', '00000000-0000-0000-01a7-000000000002'));
select public.adjust_warehouse_stock('00000000-0000-0000-01a7-000000000002', '00000000-0000-0000-01a7-0000000000e2', -9);
select public.lot_ctx_end();
commit;
do $$
declare
  pc uuid := '00000000-0000-0000-01a7-000000000002';
  w2 uuid := '00000000-0000-0000-01a7-0000000000e2';
  un uuid := pg_temp.unassigned('00000000-0000-0000-01a7-000000000002');
begin
  if un is null or not exists (select 1 from public.stock_lot_movements where lot_id = un and qty_delta = 3 and pick_mode = 'no_context') then
    raise exception 'FAIL no-context in to the unassigned lot';
  end if;
  if not exists (select 1 from public.audit_alerts where message like 'lot_unassigned_in:%' and record_id = un) then raise exception 'FAIL alert lot_unassigned_in'; end if;
  -- o4 (9): SB-30 1, SB-0 1, unassigned +3 used, then 4 short.
  if pg_temp.bal(un, w2) <> -4 then raise exception 'FAIL shortage on unassigned: %', pg_temp.bal(un, w2); end if;
  if not exists (select 1 from public.audit_alerts where message like 'lot_shortage:%' and record_id = un) then raise exception 'FAIL alert lot_shortage'; end if;
  if (select current_stock from public.warehouse_stocks where product_id = pc and warehouse_id = w2) <> 0 then raise exception 'FAIL stock W2'; end if;
end $$;

-- ── 7. Polywood: a cut inherits the lot ─────────────────────────────────────
begin;
update public.polywood_pieces set status = 'consumed', updated_at = now()
where id = (select id from public.polywood_pieces where product_id = '00000000-0000-0000-01a7-000000000003' and notes = 'LOT piece 1');
insert into public.polywood_pieces (product_id, warehouse_id, length_m, piece_type, status, notes)
values ('00000000-0000-0000-01a7-000000000003', '00000000-0000-0000-01a7-0000000000e1', 1.5, 'cut', 'available', 'LOT offcut');
commit;
update public.polywood_pieces set length_m = 1.0, updated_at = now() where notes = 'LOT offcut';
do $$
declare
  v_parent public.polywood_pieces%rowtype;
  v_cut public.polywood_pieces%rowtype;
begin
  select * into v_parent from public.polywood_pieces where notes = 'LOT piece 1';
  select * into v_cut from public.polywood_pieces where notes = 'LOT offcut';
  if v_cut.parent_piece_id is distinct from v_parent.id or v_cut.lot_id is distinct from v_parent.lot_id then
    raise exception 'FAIL offcut parent / lot: %', row_to_json(v_cut);
  end if;
  -- 8 m − 4 m (piece consumed) + 1.5 m (offcut) − 0.5 m (shortened) = 5 m.
  if pg_temp.bal(v_parent.lot_id, '00000000-0000-0000-01a7-0000000000e1') <> 5 then
    raise exception 'FAIL Polywood lot balance: %', pg_temp.bal(v_parent.lot_id, '00000000-0000-0000-01a7-0000000000e1');
  end if;
  perform pg_temp.assert_match('00000000-0000-0000-01a7-000000000003', 'Polywood');
end $$;

-- ── 8. An unexpected error does not block stock_move ─────────────────────────
begin;
select set_config('erp.lot_ctx', '{not json', true);
select public.stock_move('00000000-0000-0000-01a7-000000000004', '00000000-0000-0000-01a7-0000000000e1', 5, true);
commit;
do $$
begin
  if (select current_stock from public.warehouse_stocks where product_id = '00000000-0000-0000-01a7-000000000004'
      and warehouse_id = '00000000-0000-0000-01a7-0000000000e1') <> 5 then
    raise exception 'FAIL stock_move was blocked';
  end if;
  if not exists (select 1 from public.audit_alerts where message like 'lot_error:%' and message like '%00000000-0000-0000-01a7-000000000004%') then
    raise exception 'FAIL alert lot_error';
  end if;
  -- Services are not tracked.
  perform public.adjust_warehouse_stock('00000000-0000-0000-01a7-000000000007', '00000000-0000-0000-01a7-0000000000e1', 3);
  if exists (select 1 from public.stock_lots where product_id = '00000000-0000-0000-01a7-000000000007') then raise exception 'FAIL a service got a lot'; end if;
end $$;

-- ── 9. Integrity report and fix ──────────────────────────────────────────────
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-01a7-00000000000b","role":"authenticated"}', false);
do $$
begin
  if not exists (select 1 from public.lot_integrity_report() r where r.check_code = 'sum_mismatch' and r.product_id = '00000000-0000-0000-01a7-000000000004') then
    raise exception 'FAIL report: PE mismatch missing';
  end if;
  if not exists (select 1 from public.lot_integrity_report() r where r.check_code = 'sum_mismatch' and r.product_id = '00000000-0000-0000-01a7-000000000002') then
    raise exception 'FAIL report: PC mismatch missing';
  end if;
  if not exists (select 1 from public.lot_integrity_report() r where r.check_code = 'no_context' and r.product_id = '00000000-0000-0000-01a7-000000000002') then
    raise exception 'FAIL report: no_context missing';
  end if;
  if (select count(*) from public.stock_lots where product_id = '00000000-0000-0000-01a7-000000000002') = 0 then raise exception 'FAIL viewer cannot read lots'; end if;
  begin
    perform public.lot_integrity_fix('00000000-0000-0000-01a7-000000000004', '00000000-0000-0000-01a7-0000000000e1', 'test');
    raise exception 'FAIL a viewer fixed lots';
  exception when insufficient_privilege then null;
  end;
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-01a7-00000000000c","role":"authenticated"}', false);
do $$
begin
  begin
    perform * from public.lot_integrity_report();
    raise exception 'FAIL report open to a user without lots.view';
  exception when insufficient_privilege then null;
  end;
  if exists (select 1 from public.stock_lots) then raise exception 'FAIL RLS: lots visible without lots.view'; end if;
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-01a7-00000000000a","role":"authenticated"}', false);
do $$
declare r jsonb;
begin
  r := public.lot_integrity_fix('00000000-0000-0000-01a7-000000000004', '00000000-0000-0000-01a7-0000000000e1', 'Stock moved before lots existed');
  if (r->>'difference')::numeric <> 5 then raise exception 'FAIL fix PE: %', r; end if;
  r := public.lot_integrity_fix('00000000-0000-0000-01a7-000000000002', '00000000-0000-0000-01a7-0000000000e2', 'Shortage after a stock change without lots');
  if (r->>'difference')::numeric <> 4 then raise exception 'FAIL fix PC: %', r; end if;
  if exists (select 1 from public.lot_integrity_report() x where x.check_code = 'sum_mismatch'
             and x.product_id in ('00000000-0000-0000-01a7-000000000004', '00000000-0000-0000-01a7-000000000002')) then
    raise exception 'FAIL still mismatched after the fix';
  end if;
  if not exists (select 1 from public.stock_lot_events where event = 'corrected' and lot_id = pg_temp.unassigned('00000000-0000-0000-01a7-000000000004')) then
    raise exception 'FAIL fix event';
  end if;
  if not exists (select 1 from public.stock_lot_movements where kind = 'correction' and lot_id = pg_temp.unassigned('00000000-0000-0000-01a7-000000000004')) then
    raise exception 'FAIL fix movement';
  end if;
end $$;

-- ── 10. Lot header; the ledger is append-only ────────────────────────────────
do $$
declare l10 uuid := pg_temp.lot('SB-10');
begin
  -- SB-10 has an out movement: renaming needs an admin and a reason.
  begin
    perform public.lot_update(l10, jsonb_build_object('lot_no', 'LOT-RENAMED-1'), null);
    raise exception 'FAIL renamed without a reason';
  exception when insufficient_privilege then null;
  end;
  perform public.lot_update(l10, jsonb_build_object('lot_no', 'LOT-RENAMED-1', 'mfg_date', (public.document_today() - 100)::text, 'notes', 'checked'), 'Label misprinted');
  if (select lot_no from public.stock_lots where id = l10) <> 'LOT-RENAMED-1' then raise exception 'FAIL rename'; end if;
  if (select string_agg(event, ',' order by event) from public.stock_lot_events where lot_id = l10 and event <> 'created') is distinct from 'dates_changed,note,renamed' then
    raise exception 'FAIL lot events: %', (select string_agg(event, ',') from public.stock_lot_events where lot_id = l10);
  end if;
  perform public.lot_set_status(pg_temp.lot('SB-30'), 'quarantine', 'Damaged pallet');
  if not exists (select 1 from public.stock_lot_events where lot_id = pg_temp.lot('SB-30') and event = 'status_changed') then raise exception 'FAIL status event'; end if;
  if not exists (select 1 from public.audit_logs where new_values_json->>'operation' = 'lot_set_status' and record_id = pg_temp.lot('SB-30')) then raise exception 'FAIL status audit log'; end if;
end $$;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-01a7-00000000000b","role":"authenticated"}', false);
do $$
begin
  begin
    perform public.lot_update(pg_temp.lot('SB-0'), '{"notes": "x"}', null);
    raise exception 'FAIL a viewer edited a lot';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
-- A quarantined lot is not picked automatically: an out from W1 takes SB-0, not SB-30.
begin;
select public.lot_ctx_begin(jsonb_build_object('doc_type', 'test_out', 'doc_id', gen_random_uuid(), 'product_id', '00000000-0000-0000-01a7-000000000002'));
select public.adjust_warehouse_stock('00000000-0000-0000-01a7-000000000002', '00000000-0000-0000-01a7-0000000000e1', -1);
select public.lot_ctx_end();
commit;
do $$
begin
  if (select lot_id from public.stock_lot_movements where product_id = '00000000-0000-0000-01a7-000000000002' order by recorded_at desc limit 1)
     is distinct from pg_temp.lot('SB-0') then
    raise exception 'FAIL a quarantined lot was picked';
  end if;
  begin
    update public.stock_lot_movements set qty_delta = 100 where lot_id = pg_temp.lot('SB-0');
    raise exception 'FAIL the ledger was edited';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.stock_lot_movements where lot_id = pg_temp.lot('SB-0');
    raise exception 'FAIL the ledger was deleted';
  exception when insufficient_privilege then null;
  end;
end $$;

-- ── 11. Date change: lot rows move, and a lot may not go negative at any date ──
-- PD: lot L1 on T-20 (5, no expiry), lot L2 on T-5 (5, expires T+5); a sale on T-3 takes 2 of L2 (FEFO).
begin;
select public.use_document_date(public.document_today() - 20);
select public.lot_ctx_begin(jsonb_build_object('doc_type', 'test_in', 'doc_id', gen_random_uuid(), 'product_id', '00000000-0000-0000-01a7-000000000005',
  'new_lot', jsonb_build_object('supplier_batch_no', 'SB-D1')));
select public.adjust_warehouse_stock('00000000-0000-0000-01a7-000000000005', '00000000-0000-0000-01a7-0000000000e1', 5);
commit;
begin;
select public.use_document_date(public.document_today() - 5);
select public.lot_ctx_begin(jsonb_build_object('doc_type', 'test_in', 'doc_id', gen_random_uuid(), 'product_id', '00000000-0000-0000-01a7-000000000005',
  'new_lot', jsonb_build_object('supplier_batch_no', 'SB-D2', 'exp_date', (public.document_today() + 5)::text)));
select public.adjust_warehouse_stock('00000000-0000-0000-01a7-000000000005', '00000000-0000-0000-01a7-0000000000e1', 5);
commit;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-01a7-00000000000a","role":"authenticated"}', false);
do $$
declare v_id uuid;
begin
  v_id := (public.save_sales_invoice_draft(jsonb_build_object(
    'header', jsonb_build_object('customer_id', '00000000-0000-0000-01a7-0000000000c1', 'doc_date', (public.document_today() - 3)::text,
      'total_amount', 20, 'subtotal', 20, 'paid_amount', 0, 'remaining_balance', 20),
    'items', jsonb_build_array(jsonb_build_object('product_id', '00000000-0000-0000-01a7-000000000005', 'product_name', 'LOT date',
      'quantity', 2, 'unit_price', 10, 'line_total', 20, 'total', 20, 'warehouse_id', '00000000-0000-0000-01a7-0000000000e1')),
    'payments', '[]'::jsonb)) ->> 'sale_id')::uuid;
  insert into lot_ids values ('sale', v_id);
end $$;
reset role;
begin;
select public.lot_ctx_begin(jsonb_build_object('doc_type', 'sale', 'doc_id', (select id from lot_ids where k = 'sale'),
  'product_id', '00000000-0000-0000-01a7-000000000005', 'counterparty_type', 'customer', 'counterparty_id', '00000000-0000-0000-01a7-0000000000c1'));
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-01a7-00000000000a","role":"authenticated"}', true);
set local role authenticated;
select public.post_sales_invoice_draft((select id from lot_ids where k = 'sale'));
reset role;
select public.lot_ctx_end();
commit;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-01a7-00000000000a","role":"authenticated"}', false);
do $$
declare
  t date := public.document_today();
  s uuid := (select id from lot_ids where k = 'sale');
  p jsonb;
  r jsonb;
begin
  if (select string_agg(l.supplier_batch_no || ':' || trim_scale(m.qty_delta), ',') from public.stock_lot_movements m join public.stock_lots l on l.id = m.lot_id
      where m.doc_type = 'sale' and m.doc_id = s) is distinct from 'SB-D2:-2' then
    raise exception 'FAIL sale lot: %', (select jsonb_agg(m) from public.stock_lot_movements m where m.doc_id = s);
  end if;
  if (select (movement_date at time zone 'Asia/Baku')::date from public.stock_lot_movements where doc_id = s) is distinct from t - 3 then
    raise exception 'FAIL movement_date is not the document date';
  end if;
  -- Before SB-D2 arrived (T-5): blocked by the lot timeline.
  p := public.preview_document_date_change('sale', s, t - 10);
  if not ('lot_negative' = any (pg_temp.codes(p, 'blockers'))) then raise exception 'FAIL lot timeline blocker: %', p; end if;
  -- T-4 passes; the lot movement moves with the sale.
  p := public.preview_document_date_change('sale', s, t - 4);
  if 'lot_negative' = any (pg_temp.codes(p, 'blockers')) then raise exception 'FAIL lot timeline false positive: %', p; end if;
  r := public.apply_document_date_change('sale', s, t - 4, 'Lot test', '{}', (select coalesce(array_agg(w->>'code'), '{}') from jsonb_array_elements(p->'warnings') w));
  if not (r->>'ok')::boolean then raise exception 'FAIL apply: %', r; end if;
  if (select (movement_date at time zone 'Asia/Baku')::date from public.stock_lot_movements where doc_id = s) is distinct from t - 4 then
    raise exception 'FAIL lot movement did not move';
  end if;
  if not exists (select 1 from public.document_date_changes d, jsonb_array_elements(d.moved_rows) m
                 where d.id = (r->>'change_id')::uuid and m->>'table' = 'stock_lot_movements') then
    raise exception 'FAIL moved_rows lists no lot movement';
  end if;
end $$;
reset role;

-- ── 12. A deleted product takes its lots along; grants ───────────────────────
select public.adjust_warehouse_stock('00000000-0000-0000-01a7-000000000006', '00000000-0000-0000-01a7-0000000000e1', 2);
delete from public.warehouse_stocks where product_id = '00000000-0000-0000-01a7-000000000006';
delete from public.products where id = '00000000-0000-0000-01a7-000000000006';
do $$
begin
  if exists (select 1 from public.stock_lots where product_id = '00000000-0000-0000-01a7-000000000006')
     or exists (select 1 from public.stock_lot_movements where product_id = '00000000-0000-0000-01a7-000000000006') then
    raise exception 'FAIL lots of a deleted product remain';
  end if;
  if has_function_privilege('authenticated', 'public._lot_apply(uuid, uuid, numeric, uuid, text, text)', 'execute')
     or has_function_privilege('authenticated', 'public.lot_ctx_begin(jsonb)', 'execute')
     or has_function_privilege('anon', 'public.lot_integrity_report(integer)', 'execute') then
    raise exception 'FAIL internal function exposed';
  end if;
  if not has_function_privilege('authenticated', 'public.lot_integrity_report(integer)', 'execute') then raise exception 'FAIL report not granted'; end if;
  if exists (select 1 from pg_policies where tablename in ('stock_lots', 'stock_lot_balances', 'stock_lot_movements', 'stock_lot_events') and cmd <> 'SELECT') then
    raise exception 'FAIL a write policy exists';
  end if;
end $$;

select 'ALL CHECKS PASSED';
