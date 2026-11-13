-- Checks supabase/migrations/20261115110000_lot_inbound.sql (LOT-2) on a database built with
-- scripts/db/build-fresh.sh --plain-postgres (CI: .github/workflows/db-baseline.yml).
-- Any failed check raises an exception; the last line prints ALL CHECKS PASSED.
-- Leaves test rows behind: run it on a throwaway database only.
--
-- Inbound documents create named lots: an import (planned lot, a second receipt on the same lot,
-- split lots, manual_required, Polywood sheets, cancel), a purchase (post / void), an initial
-- balance (post / unpost), a production order, an inventory count (surplus / unpost). After each:
-- lots = stock.

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-02b7-00000000000a', 'lot2-a@example.test', '{"full_name": "Lot2 Test Admin", "role_name": "Admin"}')
on conflict (id) do nothing;
update public.profiles set is_active = true, role_id = (select id from public.roles where name = 'Admin' order by is_system desc limit 1)
where id = '00000000-0000-0000-02b7-00000000000a';

insert into public.warehouses (id, code, name, is_default, created_at) values
  ('00000000-0000-0000-02b7-0000000000e1', 'L2-W1', 'L2 anbar 1', false, now()),
  ('00000000-0000-0000-02b7-0000000000e2', 'L2-W2', 'L2 anbar 2', false, now())
on conflict (id) do nothing;
insert into public.suppliers (id, full_name, entity_type) values ('00000000-0000-0000-02b7-0000000000d1', 'L2 supplier', 'legal') on conflict (id) do nothing;
do $$ begin
  if public.resolve_unified_partner_id(null, '00000000-0000-0000-02b7-0000000000d1') is null then
    insert into public.partners (name, entity_type, is_customer, is_supplier, supplier_id, created_at, credit_limit, is_deleted)
    values ('L2 supplier', 'legal', false, true, '00000000-0000-0000-02b7-0000000000d1', now(), 0, false);
  end if;
end $$;
-- QI import, QM import with manual_required + 365 days shelf life, QP Polywood import (4 m sheets),
-- PU purchase, PO opening, PF finished product, PC counted.
insert into public.products (id, code, name, stock, buy_price, is_service, is_composite, inventory_mode, full_sheet_length_m, unit, lot_policy, shelf_life_days) values
  ('00000000-0000-0000-02b7-000000000001', 'L2-QI', 'L2 import', 0, 5, false, false, 'standard', 4, 'Ədəd', 'auto', null),
  ('00000000-0000-0000-02b7-000000000002', 'L2-QM', 'L2 manual', 0, 5, false, false, 'standard', 4, 'Ədəd', 'manual_required', 365),
  ('00000000-0000-0000-02b7-000000000003', 'L2-QP', 'L2 plywood', 0, 5, false, false, 'polywood', 4, 'Vərəq', 'auto', null),
  ('00000000-0000-0000-02b7-000000000004', 'L2-PU', 'L2 purchase', 0, 5, false, false, 'standard', 4, 'Ədəd', 'auto', null),
  ('00000000-0000-0000-02b7-000000000005', 'L2-PO', 'L2 opening', 0, 5, false, false, 'standard', 4, 'Ədəd', 'auto', null),
  ('00000000-0000-0000-02b7-000000000006', 'L2-PF', 'L2 finished', 0, 5, false, false, 'standard', 4, 'Ədəd', 'auto', null),
  ('00000000-0000-0000-02b7-000000000007', 'L2-PC', 'L2 counted', 0, 5, false, false, 'standard', 4, 'Ədəd', 'auto', null)
on conflict (id) do nothing;

create or replace function pg_temp.lot_by_no(p text) returns uuid language sql as $$
  select id from public.stock_lots where lot_no = p;
$$;
create or replace function pg_temp.bal(p_lot uuid, p_wh uuid) returns numeric language sql as $$
  select coalesce((select qty from public.stock_lot_balances where lot_id = p_lot and warehouse_id = p_wh), 0);
$$;
create or replace function pg_temp.assert_match(p_step text) returns void language plpgsql security definer as $$
begin
  if exists (select 1 from public._lot_mismatches() m where m.product_id::text like '00000000-0000-0000-02b7-%') then
    raise exception 'FAIL % lots <> stock: %', p_step,
      (select jsonb_agg(to_jsonb(m)) from public._lot_mismatches() m where m.product_id::text like '00000000-0000-0000-02b7-%');
  end if;
end $$;
create temp table l2_ids (k text primary key, id uuid);
grant all on l2_ids to authenticated;

-- ── Imports: planned lots on the draft ───────────────────────────────────────
select public.import_shipment_save_draft(
  null,
  jsonb_build_object('supplier_id', '00000000-0000-0000-02b7-0000000000d1', 'currency_code', 'AZN', 'invoice_no', 'L2-INV-1',
                     'invoice_date', (public.document_today() - 10)::text, 'invoice_rate', 1,
                     'default_warehouse_id', '00000000-0000-0000-02b7-0000000000e1', 'customs_declaration_no', 'GBD-777'),
  jsonb_build_array(
    jsonb_build_object('position', 0, 'product_id', '00000000-0000-0000-02b7-000000000001', 'qty_purchase_unit', 10, 'qty_stock_unit', 10,
                       'unit_price_fc', 10, 'lot_no_planned', 'L2-LOT-A', 'supplier_batch_no', 'SB-A',
                       'exp_date', (public.document_today() + 200)::text),
    jsonb_build_object('position', 1, 'product_id', '00000000-0000-0000-02b7-000000000002', 'qty_purchase_unit', 5, 'qty_stock_unit', 5, 'unit_price_fc', 10),
    jsonb_build_object('position', 2, 'product_id', '00000000-0000-0000-02b7-000000000003', 'qty_purchase_unit', 2, 'qty_stock_unit', 8, 'unit_price_fc', 20)),
  '[]', '[]', '00000000-0000-0000-02b7-00000000000a');

do $$
declare v_ship uuid := (select id from public.import_shipments where invoice_no = 'L2-INV-1');
begin
  if (select string_agg(coalesce(lot_no_planned, '-') || '/' || coalesce(supplier_batch_no, '-'), ',' order by position)
      from public.import_shipment_lines where shipment_id = v_ship) is distinct from 'L2-LOT-A/SB-A,-/-,-/-' then
    raise exception 'FAIL planned lot fields not saved';
  end if;
  -- The same planned number on two lines is refused; old callers (no lot keys) keep working.
  begin
    perform public.import_shipment_save_draft(null,
      jsonb_build_object('supplier_id', '00000000-0000-0000-02b7-0000000000d1', 'currency_code', 'AZN', 'invoice_no', 'L2-INV-DUP', 'invoice_rate', 1),
      jsonb_build_array(
        jsonb_build_object('position', 0, 'product_id', '00000000-0000-0000-02b7-000000000001', 'qty_purchase_unit', 1, 'qty_stock_unit', 1, 'unit_price_fc', 1, 'lot_no_planned', 'L2-DUP'),
        jsonb_build_object('position', 1, 'product_id', '00000000-0000-0000-02b7-000000000004', 'qty_purchase_unit', 1, 'qty_stock_unit', 1, 'unit_price_fc', 1, 'lot_no_planned', 'L2-DUP')),
      '[]', '[]', '00000000-0000-0000-02b7-00000000000a');
    raise exception 'FAIL duplicate planned lot number accepted';
  exception when unique_violation then
    if sqlerrm not like 'lot_no_duplicate:%' then raise; end if;
  end;
end $$;

set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-02b7-00000000000a","role":"authenticated"}', false);
do $$
declare
  t date := public.document_today();
  v_ship uuid := (select id from public.import_shipments where invoice_no = 'L2-INV-1');
  l_qi uuid := (select id from public.import_shipment_lines where shipment_id = (select id from public.import_shipments where invoice_no = 'L2-INV-1') and position = 0);
  l_qm uuid := (select id from public.import_shipment_lines where shipment_id = (select id from public.import_shipments where invoice_no = 'L2-INV-1') and position = 1);
  l_qp uuid := (select id from public.import_shipment_lines where shipment_id = (select id from public.import_shipments where invoice_no = 'L2-INV-1') and position = 2);
  w1 uuid := '00000000-0000-0000-02b7-0000000000e1';
  r jsonb;
  v_lot uuid;
begin
  perform public.confirm_import_shipment(v_ship, t - 9, 'l2-confirm-1');

  -- Receipt 1: 4 of QI, no lot keys: the planned lot L2-LOT-A.
  r := public.receive_import_shipment(v_ship, jsonb_build_array(jsonb_build_object('shipment_line_id', l_qi, 'warehouse_id', w1, 'qty_stock_unit', 4)),
                                      t - 8, null, 'l2-receive-1');
  insert into l2_ids values ('r1', (r->>'receipt_id')::uuid);
  v_lot := pg_temp.lot_by_no('L2-LOT-A');
  if v_lot is null then raise exception 'FAIL planned lot not created'; end if;
  if (select (origin_type, supplier_batch_no, exp_date, import_shipment_id, customs_declaration_no, supplier_id)
      from public.stock_lots where id = v_lot) is distinct from
     ('import'::text, 'SB-A'::text, t + 200, v_ship, 'GBD-777'::text, '00000000-0000-0000-02b7-0000000000d1'::uuid) then
    raise exception 'FAIL import lot fields: %', (select row_to_json(l) from public.stock_lots l where id = v_lot);
  end if;
  if pg_temp.bal(v_lot, w1) <> 4 then raise exception 'FAIL lot balance after receipt 1'; end if;
  if (select lot_id from public.import_receipt_lines where receipt_id = (r->>'receipt_id')::uuid) is distinct from v_lot then raise exception 'FAIL receipt line lot'; end if;
  if not exists (select 1 from public.inventory_batches where lot_id = v_lot and document_id = (r->>'receipt_id')::uuid) then raise exception 'FAIL batch lot link'; end if;
  if (select doc_type || ':' || pick_mode || ':' || counterparty_type from public.stock_lot_movements where lot_id = v_lot)
     is distinct from 'import_receipt:manual:supplier' then
    raise exception 'FAIL receipt movement: %', (select jsonb_agg(m) from public.stock_lot_movements m where m.lot_id = v_lot);
  end if;

  -- Receipt 2: 3 more of the same line: the SAME lot.
  r := public.receive_import_shipment(v_ship, jsonb_build_array(jsonb_build_object('shipment_line_id', l_qi, 'warehouse_id', w1, 'qty_stock_unit', 3)),
                                      t - 7, null, 'l2-receive-2');
  if pg_temp.bal(v_lot, w1) <> 7 or (select qty_received from public.stock_lots where id = v_lot) <> 7 then
    raise exception 'FAIL second receipt not on the same lot';
  end if;

  -- A split that does not add up is refused.
  begin
    perform public.receive_import_shipment(v_ship, jsonb_build_array(jsonb_build_object('shipment_line_id', l_qi, 'warehouse_id', w1, 'qty_stock_unit', 3,
      'lots', jsonb_build_array(jsonb_build_object('qty_stock_unit', 1), jsonb_build_object('qty_stock_unit', 1)))), t - 6, null, 'l2-receive-bad');
    raise exception 'FAIL split sum accepted';
  exception when others then if sqlerrm not like 'lot_split_sum:%' then raise; end if;
  end;
  -- Receipt 3: the last 3 split: 1 into L2-LOT-B, 2 into a new auto-numbered lot with SB-C.
  r := public.receive_import_shipment(v_ship, jsonb_build_array(jsonb_build_object('shipment_line_id', l_qi, 'warehouse_id', w1, 'qty_stock_unit', 3,
    'expected_qty_stock_unit', 3,
    'lots', jsonb_build_array(jsonb_build_object('qty_stock_unit', 1, 'lot_no', 'L2-LOT-B'),
                              jsonb_build_object('qty_stock_unit', 2, 'supplier_batch_no', 'SB-C')))), t - 6, null, 'l2-receive-3');
  if (select count(*) from public.import_receipt_lines where receipt_id = (r->>'receipt_id')::uuid) <> 2 then raise exception 'FAIL split receipt lines'; end if;
  if pg_temp.bal(pg_temp.lot_by_no('L2-LOT-B'), w1) <> 1 then raise exception 'FAIL split lot B'; end if;
  if pg_temp.bal((select id from public.stock_lots where supplier_batch_no = 'SB-C'), w1) <> 2
     or (select lot_no from public.stock_lots where supplier_batch_no = 'SB-C') !~ '^LOT-\d{4}-\d{5}$' then
    raise exception 'FAIL split auto lot';
  end if;
  if (select sum(value_azn) from public.import_receipt_lines where receipt_id = (r->>'receipt_id')::uuid) <= 0
     or (select count(distinct batch_id) from public.import_receipt_lines where receipt_id = (r->>'receipt_id')::uuid) <> 2 then
    raise exception 'FAIL split value / layers';
  end if;

  -- manual_required: no supplier batch, then no dates, are refused; with mfg the expiry is mfg + 365.
  begin
    perform public.receive_import_shipment(v_ship, jsonb_build_array(jsonb_build_object('shipment_line_id', l_qm, 'warehouse_id', w1, 'qty_stock_unit', 5)), t - 5, null, 'l2-receive-qm1');
    raise exception 'FAIL manual_required without batch';
  exception when others then if sqlerrm not like 'lot_batch_required:%' then raise; end if;
  end;
  begin
    perform public.receive_import_shipment(v_ship, jsonb_build_array(jsonb_build_object('shipment_line_id', l_qm, 'warehouse_id', w1, 'qty_stock_unit', 5,
      'lots', jsonb_build_array(jsonb_build_object('qty_stock_unit', 5, 'supplier_batch_no', 'SB-M')))), t - 5, null, 'l2-receive-qm2');
    raise exception 'FAIL manual_required without expiry';
  exception when others then if sqlerrm not like 'lot_exp_required:%' then raise; end if;
  end;
  perform public.receive_import_shipment(v_ship, jsonb_build_array(jsonb_build_object('shipment_line_id', l_qm, 'warehouse_id', w1, 'qty_stock_unit', 5,
    'lots', jsonb_build_array(jsonb_build_object('qty_stock_unit', 5, 'supplier_batch_no', 'SB-M', 'mfg_date', (t - 30)::text)))), t - 5, null, 'l2-receive-qm3');
  if (select exp_date from public.stock_lots where supplier_batch_no = 'SB-M') is distinct from t - 30 + 365 then raise exception 'FAIL default expiry'; end if;

  -- Polywood: 2 sheets on one lot.
  r := public.receive_import_shipment(v_ship, jsonb_build_array(jsonb_build_object('shipment_line_id', l_qp, 'warehouse_id', w1, 'qty_stock_unit', 8,
    'lots', jsonb_build_array(jsonb_build_object('qty_stock_unit', 8, 'lot_no', 'L2-PLY')))), t - 5, null, 'l2-receive-qp');
  if (select count(*) from public.polywood_pieces where lot_id = pg_temp.lot_by_no('L2-PLY') and status = 'available') <> 2
     or pg_temp.bal(pg_temp.lot_by_no('L2-PLY'), w1) <> 8 then
    raise exception 'FAIL Polywood sheets on the lot';
  end if;
  perform pg_temp.assert_match('imports');

  -- Cancel: stock leaves exactly these lots.
  perform public.cancel_import_shipment(v_ship, 'L2 test cancel', 'l2-cancel-1');
  if exists (select 1 from public.stock_lot_balances b join public.stock_lots l on l.id = b.lot_id
             where l.import_shipment_id = v_ship and b.qty <> 0) then
    raise exception 'FAIL cancel left lot stock: %', (select jsonb_agg(b) from public.stock_lot_balances b join public.stock_lots l on l.id = b.lot_id where l.import_shipment_id = v_ship);
  end if;
  if exists (select 1 from public.stock_lot_movements m join public.stock_lots l on l.id = m.lot_id
             where l.import_shipment_id = v_ship and m.qty_delta < 0 and m.kind <> 'reverse_out' and m.lot_id <> pg_temp.lot_by_no('L2-PLY')) then
    raise exception 'FAIL cancel movements are not reversals';
  end if;
  if exists (select 1 from public.stock_lot_movements where pick_mode = 'unassigned' and product_id::text like '00000000-0000-0000-02b7-%') then
    raise exception 'FAIL something went to the unassigned lot';
  end if;
  perform pg_temp.assert_match('cancel');
end $$;

-- ── Purchases: post and void ─────────────────────────────────────────────────
do $$
declare
  w1 uuid := '00000000-0000-0000-02b7-0000000000e1';
  v_id uuid;
  v_bad uuid;
begin
  v_id := (public.save_purchase_invoice_draft(jsonb_build_object(
    'header', jsonb_build_object('supplier_id', '00000000-0000-0000-02b7-0000000000d1', 'doc_date', (public.document_today() - 4)::text,
      'warehouse_id', w1, 'invoice_number', 'L2-PU1', 'total_amount', 30, 'paid_amount', 0, 'debt_amount', 30),
    'items', jsonb_build_array(jsonb_build_object('product_id', '00000000-0000-0000-02b7-000000000004', 'product_name', 'L2 purchase',
      'quantity', 6, 'unit_price', 5, 'total', 30, 'lot_no', 'L2-PUR-1', 'supplier_batch_no', 'SB-P', 'exp_date', (public.document_today() + 90)::text)),
    'payments', '[]'::jsonb)) ->> 'purchase_id')::uuid;
  if (select lot_no from public.purchase_items where purchase_id = v_id) is distinct from 'L2-PUR-1' then raise exception 'FAIL purchase line lot not saved'; end if;
  perform public.post_purchase_invoice_draft(v_id);
  insert into l2_ids values ('pu1', v_id);
  if (select (origin_type, supplier_batch_no, origin_doc_id) from public.stock_lots where lot_no = 'L2-PUR-1')
     is distinct from ('purchase'::text, 'SB-P'::text, v_id) or pg_temp.bal(pg_temp.lot_by_no('L2-PUR-1'), w1) <> 6 then
    raise exception 'FAIL purchase lot';
  end if;
  if not exists (select 1 from public.inventory_batches where document_id = v_id and lot_id = pg_temp.lot_by_no('L2-PUR-1')) then raise exception 'FAIL purchase batch link'; end if;
  perform pg_temp.assert_match('purchase post');

  perform public.cancel_purchase_invoice_atomic(v_id, 'L2 void test');
  if pg_temp.bal(pg_temp.lot_by_no('L2-PUR-1'), w1) <> 0
     or not exists (select 1 from public.stock_lot_movements where lot_id = pg_temp.lot_by_no('L2-PUR-1') and kind = 'reverse_out') then
    raise exception 'FAIL purchase void: lot';
  end if;
  perform pg_temp.assert_match('purchase void');

  -- Two lines of one product on different lots: refused at posting.
  v_bad := (public.save_purchase_invoice_draft(jsonb_build_object(
    'header', jsonb_build_object('supplier_id', '00000000-0000-0000-02b7-0000000000d1', 'doc_date', public.document_today()::text,
      'warehouse_id', w1, 'invoice_number', 'L2-PU2', 'total_amount', 20, 'paid_amount', 0, 'debt_amount', 20),
    'items', jsonb_build_array(
      jsonb_build_object('product_id', '00000000-0000-0000-02b7-000000000004', 'product_name', 'L2 purchase', 'quantity', 2, 'unit_price', 5, 'total', 10, 'lot_no', 'L2-X1'),
      jsonb_build_object('product_id', '00000000-0000-0000-02b7-000000000004', 'product_name', 'L2 purchase', 'quantity', 2, 'unit_price', 5, 'total', 10, 'lot_no', 'L2-X2')),
    'payments', '[]'::jsonb)) ->> 'purchase_id')::uuid;
  begin
    perform public.post_purchase_invoice_draft(v_bad);
    raise exception 'FAIL conflicting lots on one product accepted';
  exception when others then if sqlerrm not like 'lot_conflict:%' then raise; end if;
  end;
end $$;
reset role;

-- ── Initial balance: post (server RPC) and unpost ────────────────────────────
do $$
declare
  w1 uuid := '00000000-0000-0000-02b7-0000000000e1';
  po uuid := '00000000-0000-0000-02b7-000000000005';
  v_doc uuid;
  v_item uuid := gen_random_uuid();
  r jsonb;
begin
  insert into public.inventory_initial_balances (document_number, doc_date, warehouse_id, warehouse_name, status, total_amount, entry_type, posted_at, created_at, updated_at)
  values ('L2-IB-1', public.document_today(), w1, 'L2 anbar 1', 'posted', 25, 'opening_balance', now(), now(), now()) returning id into v_doc;
  insert into public.inventory_initial_balance_items (id, document_id, line_no, product_id, product_name, quantity, unit_cost, unit, lot_no)
  values (v_item, v_doc, 1, po, 'L2 opening', 5, 5, 'Ədəd', 'L2-OPEN-1');
  r := public.lot_post_inbound_line(jsonb_build_object('doc_type', 'inventory_initial_balance', 'doc_id', v_doc, 'doc_line_id', v_item,
                                                       'doc_no', 'L2-IB-1', 'origin_type', 'opening'),
                                    po, w1, 5, jsonb_build_object('lot_no', 'L2-OPEN-1', 'supplier_batch_no', 'SB-O'));
  insert into public.stock_movements (product_id, warehouse_id, movement_type, quantity, unit, reference_type, reference_id, source_line_id, description)
  values (po, w1, 'in', 5, 'Ədəd', 'initial_balance', v_doc, v_item, 'L2-IB-1');
  perform public.create_inventory_batch(po, v_doc, 'initial_balance', 5, 5);
  if (select (origin_type, lot_no, origin_doc_id) from public.stock_lots where id = (r->>'lot_id')::uuid)
     is distinct from ('opening'::text, 'L2-OPEN-1'::text, v_doc) or pg_temp.bal((r->>'lot_id')::uuid, w1) <> 5 then
    raise exception 'FAIL initial balance lot: %', r;
  end if;
  perform pg_temp.assert_match('initial balance post');
  perform public.unpost_inventory_initial_balance(v_doc, 'L2 unpost', '00000000-0000-0000-02b7-00000000000a');
  if pg_temp.bal((r->>'lot_id')::uuid, w1) <> 0 then raise exception 'FAIL initial balance unpost: lot'; end if;
  perform pg_temp.assert_match('initial balance unpost');

  -- Polywood pieces through the server RPC get the line's lot.
  r := public.lot_insert_inbound_pieces(
    jsonb_build_object('doc_type', 'inventory_initial_balance', 'doc_id', v_doc, 'doc_no', 'L2-IB-1', 'origin_type', 'opening'),
    jsonb_build_object('lot_no', 'L2-OPEN-PLY'),
    jsonb_build_array(
      jsonb_build_object('product_id', '00000000-0000-0000-02b7-000000000003', 'warehouse_id', w1, 'length_m', 4, 'piece_type', 'full', 'source_document_id', v_doc),
      jsonb_build_object('product_id', '00000000-0000-0000-02b7-000000000003', 'warehouse_id', w1, 'length_m', 1.5, 'piece_type', 'cut', 'source_document_id', v_doc)));
  if (r->>'metres')::numeric <> 5.5 or pg_temp.bal(pg_temp.lot_by_no('L2-OPEN-PLY'), w1) <> 5.5 then raise exception 'FAIL pieces RPC: %', r; end if;
  perform public._stock_sync_polywood_rows('00000000-0000-0000-02b7-000000000003');
  perform pg_temp.assert_match('initial balance pieces');
end $$;

-- ── Production: finished goods on a 'production' lot ────────────────────────
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-02b7-00000000000a","role":"authenticated"}', false);
do $$
declare
  v_order uuid := gen_random_uuid();
  v_lot public.stock_lots%rowtype;
begin
  insert into public.production_orders (id, project_name, type, status, finished_product_id, quantity, order_no, warehouse_id, furniture_warehouse_id, finished_goods_posted, created_at, updated_at)
  values (v_order, 'L2 order', 'Series', 'In-Progress', '00000000-0000-0000-02b7-000000000006', 3, 'L2-PRD-001',
          '00000000-0000-0000-02b7-0000000000e1', '00000000-0000-0000-02b7-0000000000e2', false, now(), now());
  perform public.process_production_ready_event(v_order);
  select * into v_lot from public.stock_lots where origin_doc_id = v_order;
  if v_lot.lot_no is distinct from 'L2-PRD-001' or v_lot.origin_type <> 'production' or v_lot.custom_fields ->> 'material_lots' is null
     or pg_temp.bal(v_lot.id, '00000000-0000-0000-02b7-0000000000e2') <> 3 then
    raise exception 'FAIL production lot: %', row_to_json(v_lot);
  end if;
  perform pg_temp.assert_match('production');
end $$;
reset role;

-- ── Count: a surplus lot, then unpost ────────────────────────────────────────
do $$
declare
  w1 uuid := '00000000-0000-0000-02b7-0000000000e1';
  pc uuid := '00000000-0000-0000-02b7-000000000007';
  a  uuid := '00000000-0000-0000-02b7-00000000000a';
  v_id uuid;
  v_sur uuid;
begin
  perform public.lot_ctx_begin(jsonb_build_object('doc_type', 'test_in', 'doc_id', gen_random_uuid(), 'product_id', pc, 'new_lot', jsonb_build_object('lot_no', 'L2-CNT-BASE')));
  perform public.adjust_warehouse_stock(pc, w1, 4);
  perform public.lot_ctx_end();
  insert into public.inventory_counts (document_number, warehouse_id, warehouse_name, status)
  values ('L2-CNT-1', w1, 'L2 anbar 1', 'draft') returning id into v_id;
  update public.inventory_counts set status = 'in_progress' where id = v_id;
  perform public.inventory_count_add_product(v_id, pc);
  perform public.save_count_progress(v_id, jsonb_build_array(jsonb_build_object(
    'line_id', (select id from public.inventory_count_items where count_id = v_id), 'kind', 'qty', 'actual_qty', 6)));
  perform public.inventory_count_submit(v_id);
  perform public.inventory_count_post(v_id, a);
  select id into v_sur from public.stock_lots where origin_doc_id = v_id and origin_type = 'count_surplus';
  if v_sur is null or pg_temp.bal(v_sur, w1) <> 2 or pg_temp.bal(pg_temp.lot_by_no('L2-CNT-BASE'), w1) <> 4 then
    raise exception 'FAIL count surplus lot';
  end if;
  perform pg_temp.assert_match('count post');
  perform public.inventory_count_unpost(v_id, 'L2 unpost', a);
  if pg_temp.bal(v_sur, w1) <> 0 or pg_temp.bal(pg_temp.lot_by_no('L2-CNT-BASE'), w1) <> 4 then raise exception 'FAIL count unpost: lots'; end if;
  perform pg_temp.assert_match('count unpost');
  if exists (select 1 from public.audit_alerts where message like 'lot_error%' and created_at > now() - interval '1 hour'
             and message like '%02b7%') then
    raise exception 'FAIL a lot_error was written';
  end if;
end $$;

select 'ALL CHECKS PASSED';
