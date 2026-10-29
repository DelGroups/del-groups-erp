-- Checks supabase/migrations/20261029200000_stock_per_warehouse.sql on a database built with
-- scripts/db/build-fresh.sh --plain-postgres (CI: .github/workflows/db-baseline.yml).
-- Any failed check raises an exception; the last line prints ALL CHECKS PASSED.
-- Leaves test rows behind: run it on a throwaway database only.
--
-- Two warehouses: A (default) and B. After every step products.stock = SUM(warehouse rows).

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-00f3-00000000000a', 'spw-a@example.test', '{"full_name": "Anar Admin", "role_name": "Admin"}')
on conflict (id) do nothing;
update public.profiles set role_id = (select id from public.roles where name = 'Admin' order by is_system desc limit 1), is_active = true
where id = '00000000-0000-0000-00f3-00000000000a';

insert into public.warehouses (id, code, name, is_default, created_at) values
  ('00000000-0000-0000-00f3-0000000000a1', 'SPW-A', 'SPW anbar A', true, now() - interval '1 day'),
  ('00000000-0000-0000-00f3-0000000000b1', 'SPW-B', 'SPW anbar B', false, now())
on conflict (id) do nothing;
insert into public.customers (id, full_name) values ('00000000-0000-0000-00f3-0000000000c1', 'SPW customer') on conflict (id) do nothing;
insert into public.suppliers (id, full_name) values ('00000000-0000-0000-00f3-0000000000d1', 'SPW supplier') on conflict (id) do nothing;

-- P plain, C component, K kit of 2 x C, F finished product, M material.
insert into public.products (id, code, name, stock, buy_price, is_service, is_composite, inventory_mode, full_sheet_length_m) values
  ('00000000-0000-0000-00f3-000000000001', 'SPW-P', 'SPW plain',     0, 2, false, false, 'standard', 4),
  ('00000000-0000-0000-00f3-000000000002', 'SPW-C', 'SPW component', 0, 1, false, false, 'standard', 4),
  ('00000000-0000-0000-00f3-000000000003', 'SPW-K', 'SPW kit',       0, 0, false, true,  'standard', 4),
  ('00000000-0000-0000-00f3-000000000004', 'SPW-F', 'SPW finished',  0, 0, false, false, 'standard', 4),
  ('00000000-0000-0000-00f3-000000000005', 'SPW-M', 'SPW material',  0, 1, false, false, 'standard', 4)
on conflict (id) do nothing;
insert into public.product_bom (parent_product_id, component_product_id, quantity) values
  ('00000000-0000-0000-00f3-000000000003', '00000000-0000-0000-00f3-000000000002', 2);

select public.adjust_warehouse_stock('00000000-0000-0000-00f3-000000000001', '00000000-0000-0000-00f3-0000000000a1', 10);
select public.adjust_warehouse_stock('00000000-0000-0000-00f3-000000000001', '00000000-0000-0000-00f3-0000000000b1', 5);
select public.adjust_warehouse_stock('00000000-0000-0000-00f3-000000000002', '00000000-0000-0000-00f3-0000000000a1', 10);
select public.adjust_warehouse_stock('00000000-0000-0000-00f3-000000000002', '00000000-0000-0000-00f3-0000000000b1', 10);
select public.adjust_warehouse_stock('00000000-0000-0000-00f3-000000000005', '00000000-0000-0000-00f3-0000000000a1', 10);
select public.adjust_warehouse_stock('00000000-0000-0000-00f3-000000000005', '00000000-0000-0000-00f3-0000000000b1', 10);
select public.create_inventory_batch(p, gen_random_uuid(), 'purchase', 1, 100) from unnest(array[
  '00000000-0000-0000-00f3-000000000001', '00000000-0000-0000-00f3-000000000002', '00000000-0000-0000-00f3-000000000005']::uuid[]) p;

-- Stock of a product in A / B, and the invariant.
create or replace function pg_temp.qty(p uuid, w text) returns numeric language sql as $$
  select public.stock_available(p, case w when 'A' then '00000000-0000-0000-00f3-0000000000a1'::uuid else '00000000-0000-0000-00f3-0000000000b1'::uuid end);
$$;
create or replace function pg_temp.check_totals(p_step text) returns void language plpgsql as $$
declare v_bad text;
begin
  select string_agg(p.code || ' ' || p.stock || ' <> ' || coalesce(s.total, 0), ', ') into v_bad
  from public.products p
  left join (select product_id, sum(current_stock) total from public.warehouse_stocks group by product_id) s on s.product_id = p.id
  where p.code like 'SPW-%' and not p.is_composite and abs(p.stock - coalesce(s.total, 0)) > 0.0001;
  if v_bad is not null then raise exception 'FAIL % — total differs from the warehouse rows: %', p_step, v_bad; end if;
end $$;
select pg_temp.check_totals('setup');

create temp table spw_ids (k text primary key, id uuid);
grant all on spw_ids to authenticated;

set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-00f3-00000000000a","role":"authenticated"}', false);

-- ── Write-offs ──────────────────────────────────────────────────────────────
do $$
declare
  p uuid := '00000000-0000-0000-00f3-000000000001';
  v_ok boolean := false;
  v_msg text;
  v_id uuid;
begin
  v_id := (public.post_inventory_writeoff(jsonb_build_object(
    'document_number', 'SPW-WO-1', 'warehouse_id', '00000000-0000-0000-00f3-0000000000b1', 'checker_name', 'test',
    'items', jsonb_build_array(jsonb_build_object('product_id', p, 'product_name', 'SPW plain', 'quantity', 3, 'unit', 'Ədəd', 'issue_description', 'broken')))) ->> 'id')::uuid;
  insert into spw_ids values ('writeoff', v_id);
  if pg_temp.qty(p, 'B') <> 2 or pg_temp.qty(p, 'A') <> 10 then raise exception 'FAIL write-off from B: A % B %', pg_temp.qty(p, 'A'), pg_temp.qty(p, 'B'); end if;
  if not exists (select 1 from public.stock_movements where reference_type = 'writeoff' and reference_id = v_id and warehouse_id = '00000000-0000-0000-00f3-0000000000b1') then
    raise exception 'FAIL write-off movement missing';
  end if;
  perform pg_temp.check_totals('write-off');

  -- More than B has, although A has enough: refused, naming the warehouse.
  begin
    perform public.post_inventory_writeoff(jsonb_build_object(
      'document_number', 'SPW-WO-2', 'warehouse_id', '00000000-0000-0000-00f3-0000000000b1', 'checker_name', 'test',
      'items', jsonb_build_array(jsonb_build_object('product_id', p, 'product_name', 'SPW plain', 'quantity', 4, 'issue_description', 'broken'))));
  exception when others then v_ok := true; v_msg := sqlerrm;
  end;
  if not v_ok or v_msg not like '%SPW anbar B%' then raise exception 'FAIL write-off over B: %', v_msg; end if;

  -- Validation messages of the form.
  v_ok := false;
  begin
    perform public.post_inventory_writeoff(jsonb_build_object('document_number', 'SPW-WO-3', 'warehouse_id', '00000000-0000-0000-00f3-0000000000b1',
      'items', jsonb_build_array(jsonb_build_object('product_id', p, 'product_name', 'SPW plain', 'quantity', 1, 'issue_description', ' '))));
  exception when others then v_ok := sqlerrm like '%problem təsviri%';
  end;
  if not v_ok then raise exception 'FAIL write-off without a description'; end if;

  -- Moving the write-off from B to A: B gets its 3 back, A loses 3.
  perform public.update_inventory_writeoff(v_id, jsonb_build_object(
    'document_number', 'SPW-WO-1', 'warehouse_id', '00000000-0000-0000-00f3-0000000000a1', 'checker_name', 'test',
    'items', jsonb_build_array(jsonb_build_object('product_id', p, 'product_name', 'SPW plain', 'quantity', 3, 'issue_description', 'broken'))));
  if pg_temp.qty(p, 'B') <> 5 or pg_temp.qty(p, 'A') <> 7 then raise exception 'FAIL write-off moved to A: A % B %', pg_temp.qty(p, 'A'), pg_temp.qty(p, 'B'); end if;
  if (select count(*) from public.stock_movements where reference_type = 'writeoff' and reference_id = v_id) <> 1 then raise exception 'FAIL write-off movements not replaced'; end if;
  perform pg_temp.check_totals('write-off edit');
end $$;

-- ── Sales ───────────────────────────────────────────────────────────────────
do $$
declare
  p uuid := '00000000-0000-0000-00f3-000000000001';
  c uuid := '00000000-0000-0000-00f3-000000000002';
  v_sale uuid;
  v_ok boolean := false;
  v_msg text;
begin
  -- One plain line and one kit line, both from B.
  v_sale := (public.save_sales_invoice_draft(jsonb_build_object(
    'header', jsonb_build_object('customer_id', '00000000-0000-0000-00f3-0000000000c1', 'total_amount', 30, 'subtotal', 30, 'paid_amount', 0, 'remaining_balance', 30),
    'items', jsonb_build_array(
      jsonb_build_object('product_id', p, 'product_name', 'SPW plain', 'quantity', 2, 'unit_price', 10, 'line_total', 20, 'total', 20, 'warehouse_id', '00000000-0000-0000-00f3-0000000000b1'),
      jsonb_build_object('product_id', '00000000-0000-0000-00f3-000000000003', 'product_name', 'SPW kit', 'quantity', 1, 'unit_price', 10, 'line_total', 10, 'total', 10, 'warehouse_id', '00000000-0000-0000-00f3-0000000000b1')),
    'payments', '[]'::jsonb)) ->> 'sale_id')::uuid;
  perform public.post_sales_invoice_draft(v_sale);
  insert into spw_ids values ('sale', v_sale);
  if pg_temp.qty(p, 'B') <> 3 or pg_temp.qty(p, 'A') <> 7 then raise exception 'FAIL sale from B: A % B %', pg_temp.qty(p, 'A'), pg_temp.qty(p, 'B'); end if;
  if pg_temp.qty(c, 'B') <> 8 or pg_temp.qty(c, 'A') <> 10 then raise exception 'FAIL kit sale from B: A % B %', pg_temp.qty(c, 'A'), pg_temp.qty(c, 'B'); end if;
  perform pg_temp.check_totals('sale');

  -- More than B has, while A has enough: refused, naming B.
  begin
    perform public.post_sales_invoice_draft((public.save_sales_invoice_draft(jsonb_build_object(
      'header', jsonb_build_object('customer_id', '00000000-0000-0000-00f3-0000000000c1', 'total_amount', 40, 'subtotal', 40, 'paid_amount', 0, 'remaining_balance', 40),
      'items', jsonb_build_array(jsonb_build_object('product_id', p, 'product_name', 'SPW plain', 'quantity', 4, 'unit_price', 10, 'line_total', 40, 'total', 40,
        'warehouse_id', '00000000-0000-0000-00f3-0000000000b1')),
      'payments', '[]'::jsonb)) ->> 'sale_id')::uuid);
  exception when others then v_ok := true; v_msg := sqlerrm;
  end;
  if not v_ok or v_msg not like '%SPW anbar B%' then raise exception 'FAIL sale over B: %', v_msg; end if;

  -- Cancel returns everything to B.
  perform public.cancel_sales_invoice_atomic(v_sale, 'test');
  if pg_temp.qty(p, 'B') <> 5 or pg_temp.qty(c, 'B') <> 10 or pg_temp.qty(p, 'A') <> 7 then
    raise exception 'FAIL cancel: P A % B %, C B %', pg_temp.qty(p, 'A'), pg_temp.qty(p, 'B'), pg_temp.qty(c, 'B');
  end if;
  perform pg_temp.check_totals('sale cancel');
end $$;

-- ── Production ──────────────────────────────────────────────────────────────
do $$
declare
  m uuid := '00000000-0000-0000-00f3-000000000005';
  f uuid := '00000000-0000-0000-00f3-000000000004';
  v_order uuid := gen_random_uuid();
  v_mat uuid := gen_random_uuid();
begin
  insert into public.production_orders (id, project_name, type, status, finished_product_id, quantity, warehouse_id, furniture_warehouse_id, order_no)
  values (v_order, 'SPW order', 'Series', 'Draft', f, 2, '00000000-0000-0000-00f3-0000000000a1', '00000000-0000-0000-00f3-0000000000b1', 'SPW-PO-1');
  insert into public.production_materials (id, production_order_id, product_id, quantity, unit, warehouse_id, unit_cost)
  values (v_mat, v_order, m, 4, 'Ədəd', '00000000-0000-0000-00f3-0000000000b1', 1);

  perform public.process_production_material_issue_event(v_order, null, null);
  if pg_temp.qty(m, 'B') <> 6 or pg_temp.qty(m, 'A') <> 10 then raise exception 'FAIL material issue from B: A % B %', pg_temp.qty(m, 'A'), pg_temp.qty(m, 'B'); end if;
  perform pg_temp.check_totals('material issue');

  -- A removed material goes back to B.
  perform public.return_production_material_stock(v_mat);
  if pg_temp.qty(m, 'B') <> 10 then raise exception 'FAIL material return to B: %', pg_temp.qty(m, 'B'); end if;
  -- The material is issued again (a new line), for the next steps.
  insert into public.production_materials (id, production_order_id, product_id, quantity, unit, warehouse_id, unit_cost)
  values (gen_random_uuid(), v_order, m, 4, 'Ədəd', '00000000-0000-0000-00f3-0000000000b1', 1);
  delete from public.production_materials where id = v_mat;
  perform public.process_production_material_issue_event(v_order,
    array(select id from public.production_materials where production_order_id = v_order and not coalesce(issued, false)), false);
  if pg_temp.qty(m, 'B') <> 6 then raise exception 'FAIL second material issue from B: %', pg_temp.qty(m, 'B'); end if;
  perform pg_temp.check_totals('material return');

  update public.production_orders set status = 'In-Progress' where id = v_order;
  perform public.process_production_ready_event(v_order);
  if pg_temp.qty(f, 'B') <> 2 or pg_temp.qty(f, 'A') <> 0 then raise exception 'FAIL finished goods into the furniture warehouse: A % B %', pg_temp.qty(f, 'A'), pg_temp.qty(f, 'B'); end if;
  if not exists (select 1 from public.stock_movements where reference_id = v_order and product_id = f and movement_type = 'in') then
    raise exception 'FAIL finished goods movement missing';
  end if;
  perform pg_temp.check_totals('finished goods');

  perform public.process_production_delivery_event(v_order);
  if pg_temp.qty(f, 'B') <> 0 then raise exception 'FAIL delivery from the furniture warehouse: B %', pg_temp.qty(f, 'B'); end if;
  perform pg_temp.check_totals('delivery');
end $$;

-- ── Purchases ───────────────────────────────────────────────────────────────
do $$
declare
  p uuid := '00000000-0000-0000-00f3-000000000001';
  v_pur uuid;
begin
  v_pur := (public.save_purchase_invoice_draft(jsonb_build_object(
    'header', jsonb_build_object('supplier_id', '00000000-0000-0000-00f3-0000000000d1', 'warehouse_id', '00000000-0000-0000-00f3-0000000000b1',
      'invoice_number', 'SPW-PUR-1', 'total_amount', 20, 'paid_amount', 0, 'debt_amount', 20),
    'items', jsonb_build_array(jsonb_build_object('product_id', p, 'product_name', 'SPW plain', 'quantity', 4, 'unit_price', 5, 'total', 20)),
    'payments', '[]'::jsonb)) ->> 'purchase_id')::uuid;
  perform public.post_purchase_invoice_draft(v_pur);
  if pg_temp.qty(p, 'B') <> 9 or pg_temp.qty(p, 'A') <> 7 then raise exception 'FAIL purchase into B: A % B %', pg_temp.qty(p, 'A'), pg_temp.qty(p, 'B'); end if;
  perform pg_temp.check_totals('purchase');

  perform public.cancel_purchase_invoice_atomic(v_pur, 'test');
  if pg_temp.qty(p, 'B') <> 5 or pg_temp.qty(p, 'A') <> 7 then raise exception 'FAIL purchase cancel: A % B %', pg_temp.qty(p, 'A'), pg_temp.qty(p, 'B'); end if;
  perform pg_temp.check_totals('purchase cancel');
end $$;

reset role;

-- stock_move is not callable by signed-in users.
do $$
begin
  if has_function_privilege('authenticated', 'public.stock_move(uuid, uuid, numeric, boolean)', 'execute') then
    raise exception 'FAIL authenticated may call stock_move';
  end if;
end $$;

select 'ALL CHECKS PASSED';
