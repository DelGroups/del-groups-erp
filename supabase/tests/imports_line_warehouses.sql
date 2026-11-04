-- Checks supabase/migrations/20261104100000_imports_line_warehouses.sql (IMP-4: a line's warehouse,
-- and one line split over several warehouses) on a database built with
-- scripts/db/build-fresh.sh --plain-postgres.
-- Any failed check raises an exception; the last line prints ALL CHECKS PASSED.
-- Leaves test rows behind: run it on a throwaway database only.

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0e04-00000000000a', 'imp4-a@example.test', '{"full_name": "Aysel Admin", "role_name": "Admin"}'),
  ('00000000-0000-0000-0e04-00000000000b', 'imp4-b@example.test', '{"full_name": "Bəhruz Baxan"}')
on conflict (id) do nothing;
update public.profiles set is_active = true, role_id = (select id from public.roles where name = 'Admin' order by is_system desc limit 1)
where id = '00000000-0000-0000-0e04-00000000000a';
update public.profiles set is_active = true, role_id = null where id = '00000000-0000-0000-0e04-00000000000b';

insert into public.suppliers (id, full_name, entity_type) values ('00000000-0000-0000-0e04-0000000000d1', 'IMP4 Marmara', 'legal')
on conflict (id) do nothing;
insert into public.warehouses (id, code, name, is_default, created_at) values
  ('00000000-0000-0000-0e04-0000000000a1', 'IMP4-W1', 'IMP4 Bakı', false, now()),
  ('00000000-0000-0000-0e04-0000000000a2', 'IMP4-W2', 'IMP4 Sumqayıt', false, now()),
  ('00000000-0000-0000-0e04-0000000000a3', 'IMP4-W3', 'IMP4 Gəncə', false, now())
on conflict (id) do nothing;
insert into public.products (id, code, name, stock, is_service, is_composite, inventory_mode, full_sheet_length_m, unit) values
  ('00000000-0000-0000-0e04-000000000101', 'IMP4-PW', 'IMP4 101 PARLAQ DOUBLE', 0, false, false, 'polywood', 4, 'vərəq'),
  ('00000000-0000-0000-0e04-000000000102', 'IMP4-FT', 'IMP4 fittings', 0, false, false, 'standard', 4, 'Ədəd')
on conflict (id) do nothing;

create or replace function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', p), false);
$$;

-- 1. A draft with a sheet line split 60 / 40 sheets over two warehouses, and a line without a
--    split (it follows the header default); saved through the server's function (service role).
select public.import_shipment_save_draft(null,
  '{"supplier_id": "00000000-0000-0000-0e04-0000000000d1", "currency_code": "USD", "invoice_no": "INV-IMP4-1", "invoice_date": "2026-10-06", "invoice_rate": 1.7, "default_warehouse_id": "00000000-0000-0000-0e04-0000000000a1"}',
  '[{"position": 0, "product_id": "00000000-0000-0000-0e04-000000000101", "qty_purchase_unit": 100, "qty_stock_unit": 400, "unit_price_fc": 25,
     "warehouses": [{"warehouse_id": "00000000-0000-0000-0e04-0000000000a1", "qty_purchase": 60, "qty_stock_unit": 240, "sort_order": 0},
                    {"warehouse_id": "00000000-0000-0000-0e04-0000000000a2", "qty_purchase": 40, "qty_stock_unit": 160, "sort_order": 1}]},
    {"position": 1, "product_id": "00000000-0000-0000-0e04-000000000102", "qty_purchase_unit": 10, "qty_stock_unit": 10, "unit_price_fc": 5, "warehouses": []}]',
  '[]', '[]', '00000000-0000-0000-0e04-00000000000a');

do $$
declare
  v_id uuid := (select id from public.import_shipments where invoice_no = 'INV-IMP4-1');
  v_line uuid := (select id from public.import_shipment_lines where shipment_id = v_id and position = 0);
begin
  if (select count(*) from public.import_shipment_line_warehouses where shipment_line_id = v_line) <> 2 then raise exception 'FAIL split not saved'; end if;
  if (select string_agg(w.code || ':' || x.qty_purchase::int || '/' || x.qty_stock_unit::int, ',' order by x.sort_order)
        from public.import_shipment_line_warehouses x join public.warehouses w on w.id = x.warehouse_id where x.shipment_line_id = v_line)
     <> 'IMP4-W1:60/240,IMP4-W2:40/160' then raise exception 'FAIL split read back wrong'; end if;
  if exists (select 1 from public.import_shipment_line_warehouses x join public.import_shipment_lines l on l.id = x.shipment_line_id
             where l.shipment_id = v_id and l.position = 1) then raise exception 'FAIL an empty array made split rows'; end if;

  -- Saving again replaces the split (no duplicates), and a split that does not add up is refused.
  perform public.import_shipment_save_draft(v_id,
    '{"supplier_id": "00000000-0000-0000-0e04-0000000000d1", "currency_code": "USD", "invoice_no": "INV-IMP4-1", "invoice_date": "2026-10-06", "invoice_rate": 1.7, "default_warehouse_id": "00000000-0000-0000-0e04-0000000000a1"}',
    '[{"position": 0, "product_id": "00000000-0000-0000-0e04-000000000101", "qty_purchase_unit": 100, "qty_stock_unit": 400, "unit_price_fc": 25,
       "warehouses": [{"warehouse_id": "00000000-0000-0000-0e04-0000000000a1", "qty_purchase": 60, "qty_stock_unit": 240},
                      {"warehouse_id": "00000000-0000-0000-0e04-0000000000a2", "qty_purchase": 40, "qty_stock_unit": 160}]},
      {"position": 1, "product_id": "00000000-0000-0000-0e04-000000000102", "qty_purchase_unit": 10, "qty_stock_unit": 10, "unit_price_fc": 5}]',
    '[]', '[]', '00000000-0000-0000-0e04-00000000000a');
  if (select count(*) from public.import_shipment_line_warehouses x join public.import_shipment_lines l on l.id = x.shipment_line_id where l.shipment_id = v_id) <> 2 then
    raise exception 'FAIL re-save duplicated the split';
  end if;

  begin
    perform public.import_shipment_save_draft(v_id,
      '{"supplier_id": "00000000-0000-0000-0e04-0000000000d1", "currency_code": "USD", "invoice_rate": 1.7}',
      '[{"position": 0, "product_id": "00000000-0000-0000-0e04-000000000101", "qty_purchase_unit": 100, "qty_stock_unit": 400, "unit_price_fc": 25,
         "warehouses": [{"warehouse_id": "00000000-0000-0000-0e04-0000000000a1", "qty_purchase": 60, "qty_stock_unit": 240},
                        {"warehouse_id": "00000000-0000-0000-0e04-0000000000a2", "qty_purchase": 30, "qty_stock_unit": 120}]}]',
      '[]', '[]', '00000000-0000-0000-0e04-00000000000a');
    raise exception 'FAIL a split of 90 of 100 sheets was saved';
  exception when others then if sqlerrm not like '%imports_warehouse_split%' then raise; end if;
  end;
  begin
    perform public.import_shipment_save_draft(v_id,
      '{"supplier_id": "00000000-0000-0000-0e04-0000000000d1", "currency_code": "USD", "invoice_rate": 1.7}',
      '[{"position": 0, "product_id": "00000000-0000-0000-0e04-000000000101", "qty_purchase_unit": 100, "qty_stock_unit": 400, "unit_price_fc": 25,
         "warehouses": [{"warehouse_id": "00000000-0000-0000-0e04-0000000000a1", "qty_purchase": 60.5, "qty_stock_unit": 242},
                        {"warehouse_id": "00000000-0000-0000-0e04-0000000000a2", "qty_purchase": 39.5, "qty_stock_unit": 158}]}]',
      '[]', '[]', '00000000-0000-0000-0e04-00000000000a');
    raise exception 'FAIL half sheets were saved';
  exception when others then if sqlerrm not like '%imports_warehouse_split%tam vərəq%' then raise; end if;
  end;
  begin
    perform public.import_shipment_save_draft(v_id,
      '{"supplier_id": "00000000-0000-0000-0e04-0000000000d1", "currency_code": "USD", "invoice_rate": 1.7}',
      '[{"position": 0, "product_id": "00000000-0000-0000-0e04-000000000101", "qty_purchase_unit": 100, "qty_stock_unit": 400, "unit_price_fc": 25,
         "warehouses": [{"warehouse_id": "00000000-0000-0000-0e04-0000000000a1", "qty_purchase": 60, "qty_stock_unit": 240},
                        {"warehouse_id": "00000000-0000-0000-0e04-0000000000a1", "qty_purchase": 40, "qty_stock_unit": 160}]}]',
      '[]', '[]', '00000000-0000-0000-0e04-00000000000a');
    raise exception 'FAIL the same warehouse twice was saved';
  exception when unique_violation then null;
  end;
  -- The refused saves rolled back: the good split is still there.
  if (select count(*) from public.import_shipment_line_warehouses x join public.import_shipment_lines l on l.id = x.shipment_line_id where l.shipment_id = v_id) <> 2 then
    raise exception 'FAIL a refused save changed the split';
  end if;
end $$;

-- 2. RLS like the lines: an admin reads and (while a draft) writes the split; a user without the
--    imports rights sees nothing and writes nothing.
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0e04-00000000000a');
do $$
declare
  v_id uuid := (select id from public.import_shipments where invoice_no = 'INV-IMP4-1');
  v_n int;
begin
  perform pg_temp.as_user('00000000-0000-0000-0e04-00000000000a');
  if (select count(*) from public.import_shipment_line_warehouses x join public.import_shipment_lines l on l.id = x.shipment_line_id where l.shipment_id = v_id) <> 2 then
    raise exception 'FAIL admin cannot read the split';
  end if;
  update public.import_shipment_line_warehouses x set sort_order = sort_order
  from public.import_shipment_lines l where l.id = x.shipment_line_id and l.shipment_id = v_id;
  get diagnostics v_n = row_count;
  if v_n <> 2 then raise exception 'FAIL admin cannot change a draft''s split (%)', v_n; end if;

  perform pg_temp.as_user('00000000-0000-0000-0e04-00000000000b');
  if exists (select 1 from public.import_shipment_line_warehouses) then raise exception 'FAIL a user without rights reads splits'; end if;
  delete from public.import_shipment_line_warehouses;
  get diagnostics v_n = row_count;
  if v_n <> 0 then raise exception 'FAIL a user without rights deleted splits'; end if;
end $$;

-- 3. Confirm, then receive by the plan: one entry per split row, stock lands in each warehouse.
--    After confirmation the split is read-only, like the line itself.
select pg_temp.as_user('00000000-0000-0000-0e04-00000000000a');
do $$
declare
  v_id uuid := (select id from public.import_shipments where invoice_no = 'INV-IMP4-1');
  v_line uuid := (select id from public.import_shipment_lines where shipment_id = v_id and position = 0);
  v_line2 uuid := (select id from public.import_shipment_lines where shipment_id = v_id and position = 1);
  v_n int;
  r jsonb;
begin
  perform pg_temp.as_user('00000000-0000-0000-0e04-00000000000a');
  perform public.confirm_import_shipment(v_id, '2026-10-06', 'imp4-confirm');
  update public.import_shipment_line_warehouses set qty_purchase = 1 where shipment_line_id = v_line;
  get diagnostics v_n = row_count;
  if v_n <> 0 then raise exception 'FAIL a confirmed split was changed'; end if;

  r := public.receive_import_shipment(v_id,
    (select jsonb_agg(jsonb_build_object('shipment_line_id', x.shipment_line_id, 'warehouse_id', x.warehouse_id,
                                         'qty_stock_unit', x.qty_stock_unit, 'expected_qty_stock_unit', x.qty_stock_unit) order by x.sort_order)
       from public.import_shipment_line_warehouses x where x.shipment_line_id = v_line)
    || jsonb_build_array(jsonb_build_object('shipment_line_id', v_line2, 'qty_stock_unit', 10)),
    '2026-10-07', null, 'imp4-receive');
  if r ->> 'status' <> 'received' then raise exception 'FAIL not fully received: %', r; end if;
  if (select string_agg(w.code || ':' || rl.qty_stock_unit::int, ',' order by w.code, rl.qty_stock_unit)
        from public.import_receipt_lines rl join public.warehouses w on w.id = rl.warehouse_id
       where rl.receipt_id = (r ->> 'receipt_id')::uuid) <> 'IMP4-W1:10,IMP4-W1:240,IMP4-W2:160' then
    raise exception 'FAIL receipt rows not by the plan';
  end if;
  if (select count(*) from public.polywood_pieces where source_document_id = (r ->> 'receipt_id')::uuid and warehouse_id = '00000000-0000-0000-0e04-0000000000a2') <> 40 then
    raise exception 'FAIL 40 sheets not in the second warehouse';
  end if;
end $$;

reset role;
select set_config('request.jwt.claims', '', false);
select 'ALL CHECKS PASSED';
