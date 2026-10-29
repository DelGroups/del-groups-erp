-- Checks supabase/migrations/20261028181000_product_stock_integrity.sql and
-- 20261028182000_inventory_count_backdate_admin_edit.sql on a database built with
-- scripts/db/build-fresh.sh --plain-postgres (CI: .github/workflows/db-baseline.yml).
-- Any failed check raises an exception; the last line prints ALL CHECKS PASSED.
-- Leaves test rows behind: run it on a throwaway database only.
--
-- Users: A admin, M manager (may count, is not an admin).

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-00ab-00000000000a', 'ic-a@example.test', '{"full_name": "Arzu Admin", "role_name": "Admin"}'),
  ('00000000-0000-0000-00ab-00000000000b', 'ic-m@example.test', '{"full_name": "Mirzə Manager", "role_name": "Manager"}')
on conflict (id) do nothing;
update public.profiles set role_id = (select id from public.roles where name = 'Admin' order by is_system desc limit 1), is_active = true
where id = '00000000-0000-0000-00ab-00000000000a';
update public.profiles set role_id = (select id from public.roles where name = 'Manager' order by is_system desc limit 1), is_active = true
where id = '00000000-0000-0000-00ab-00000000000b';

-- Two warehouses; W1 is the default.
insert into public.warehouses (id, code, name, is_default, created_at) values
  ('00000000-0000-0000-00ab-0000000000e1', 'IC-W1', 'IC main', true, now() - interval '1 day'),
  ('00000000-0000-0000-00ab-0000000000e2', 'IC-W2', 'IC second', false, now())
on conflict (id) do nothing;

insert into public.categories (id, name) values ('00000000-0000-0000-00ab-0000000000c1', 'IC Category')
on conflict (id) do nothing;
insert into public.sub_categories (id, category_id, name, slug, created_at) values
  ('00000000-0000-0000-00ab-0000000000c2', '00000000-0000-0000-00ab-0000000000c1', 'IC Sub', 'ic-sub', now())
on conflict (id) do nothing;

insert into public.products (id, code, name, stock, buy_price, is_service, inventory_mode, full_sheet_length_m, category, subcategory, sub_category_id) values
  ('00000000-0000-0000-00ab-000000000001', 'IC-ZERO',  'IC zero stock',     0,  2, false, 'standard', 4, null, null, null),
  ('00000000-0000-0000-00ab-000000000002', 'IC-STOCK', 'IC stocked',        5,  2, false, 'standard', 4, null, null, null),
  ('00000000-0000-0000-00ab-000000000003', 'IC-SUB',   'IC subcategory',    0,  2, false, 'standard', 4, 'IC Category', null, '00000000-0000-0000-00ab-0000000000c2'),
  ('00000000-0000-0000-00ab-000000000004', 'IC-TWO',   'IC two warehouses', 10, 2, false, 'standard', 4, null, null, null),
  ('00000000-0000-0000-00ab-000000000005', 'IC-ASOF',  'IC as of',          10, 2, false, 'standard', 4, null, null, null),
  ('00000000-0000-0000-00ab-000000000006', 'IC-SURP',  'IC surplus',        10, 2, false, 'standard', 4, null, null, null),
  ('00000000-0000-0000-00ab-000000000007', 'IC-SHORT', 'IC shortage',       0,  2, false, 'standard', 4, null, null, null),
  ('00000000-0000-0000-00ab-000000000008', 'IC-PW',    'IC polywood',       0,  40, false, 'polywood', 4, null, null, null),
  ('00000000-0000-0000-00ab-000000000009', 'IC-SOLD',  'IC sold surplus',   10, 2, false, 'standard', 4, null, null, null),
  ('00000000-0000-0000-00ab-000000000010', 'IC-PWB',   'IC polywood past',  0,  40, false, 'polywood', 4, null, null, null),
  ('00000000-0000-0000-00ab-000000000011', 'IC-NULL',  'IC null row',       0,  2, false, 'standard', 4, null, null, null)
on conflict (id) do nothing;

insert into public.polywood_pieces (product_id, warehouse_id, length_m, piece_type, status, created_at, updated_at) values
  ('00000000-0000-0000-00ab-000000000008', '00000000-0000-0000-00ab-0000000000e1', 4, 'full', 'available', now(), now()),
  ('00000000-0000-0000-00ab-000000000008', '00000000-0000-0000-00ab-0000000000e1', 4, 'full', 'available', now(), now()),
  ('00000000-0000-0000-00ab-000000000008', '00000000-0000-0000-00ab-0000000000e1', 2, 'cut', 'available', now(), now()),
  ('00000000-0000-0000-00ab-000000000010', '00000000-0000-0000-00ab-0000000000e1', 1, 'cut', 'available', now() - interval '3 days', now()),
  ('00000000-0000-0000-00ab-000000000010', '00000000-0000-0000-00ab-0000000000e1', 2, 'cut', 'available', now() - interval '3 days', now()),
  ('00000000-0000-0000-00ab-000000000010', '00000000-0000-0000-00ab-0000000000e1', 4, 'full', 'available', now() - interval '3 days', now());
-- products.stock follows the pieces (as syncPolywoodProductStockFromPieces does).
update public.products set stock = 10 where id = '00000000-0000-0000-00ab-000000000008';
update public.products set stock = 7 where id = '00000000-0000-0000-00ab-000000000010';

-- ── Part A: the stock trigger ───────────────────────────────────────────────
do $$
declare
  w1 uuid := '00000000-0000-0000-00ab-0000000000e1';
  w2 uuid := '00000000-0000-0000-00ab-0000000000e2';
  p  uuid := '00000000-0000-0000-00ab-000000000004';
  v  numeric;
begin
  -- A new product's stock lands on the default warehouse.
  select current_stock into v from public.warehouse_stocks where product_id = p and warehouse_id = w1;
  if v is distinct from 10 then raise exception 'FAIL new product row in default warehouse: %', v; end if;

  -- The warehouse call moves one row and the total together.
  v := public.adjust_warehouse_stock(p, w2, 5);
  if v <> 5 or (select stock from public.products where id = p) <> 15 then raise exception 'FAIL adjust_warehouse_stock'; end if;
  if (select current_stock from public.warehouse_stocks where product_id = p and warehouse_id = w1) <> 10 then
    raise exception 'FAIL adjust touched the other warehouse';
  end if;

  -- A writer without a warehouse: the change goes to the default warehouse only.
  update public.products set stock = 12 where id = p;
  if (select current_stock from public.warehouse_stocks where product_id = p and warehouse_id = w1) <> 7
     or (select current_stock from public.warehouse_stocks where product_id = p and warehouse_id = w2) <> 5 then
    raise exception 'FAIL delta not applied to the default warehouse (old code copied the total onto one row)';
  end if;

  -- A writer that names its warehouse.
  perform public.stock_sync_use_warehouse(w2);
  update public.products set stock = 10 where id = p;
  perform public.stock_sync_use_warehouse(null);
  if (select current_stock from public.warehouse_stocks where product_id = p and warehouse_id = w2) <> 3
     or (select current_stock from public.warehouse_stocks where product_id = p and warehouse_id = w1) <> 7 then
    raise exception 'FAIL delta not applied to the named warehouse';
  end if;

  -- Invariant: total = sum of rows.
  if (select sum(current_stock) from public.warehouse_stocks where product_id = p) <> (select stock from public.products where id = p) then
    raise exception 'FAIL total differs from the warehouse rows';
  end if;

  -- Polywood rows follow the pieces.
  if (select current_stock from public.warehouse_stocks where product_id = '00000000-0000-0000-00ab-000000000008' and warehouse_id = w1) <> 10 then
    raise exception 'FAIL polywood row does not equal its pieces';
  end if;
end $$;

-- ── Part A: subcategory through sub_category_id ─────────────────────────────
do $$
begin
  if (select subcategory_name from public.product_category_paths where product_id = '00000000-0000-0000-00ab-000000000003') is distinct from 'IC Sub' then
    raise exception 'FAIL subcategory from sub_categories lost';
  end if;
end $$;

-- ── Part A: counts reach every stockable product ────────────────────────────
do $$
declare
  v_id uuid;
  v_cat uuid;
begin
  insert into public.inventory_counts (document_number, warehouse_id, warehouse_name, status)
  values ('IC-T-1', '00000000-0000-0000-00ab-0000000000e2', 'IC second', 'draft') returning id into v_id;
  perform public.inventory_count_start(v_id);
  if not exists (select 1 from public.inventory_count_items where count_id = v_id and product_id = '00000000-0000-0000-00ab-000000000001') then
    raise exception 'FAIL whole-warehouse count misses a zero-stock product';
  end if;
  if not exists (select 1 from public.inventory_count_items where count_id = v_id and product_id = '00000000-0000-0000-00ab-000000000002') then
    raise exception 'FAIL whole-warehouse count misses a product stocked in another warehouse';
  end if;
  delete from public.inventory_counts where id = v_id;

  insert into public.inventory_counts (document_number, warehouse_id, warehouse_name, status, category_name, subcategory_name)
  values ('IC-T-2', '00000000-0000-0000-00ab-0000000000e2', 'IC second', 'draft', 'IC Category', 'IC Sub') returning id into v_cat;
  perform public.inventory_count_start(v_cat);
  if (select count(*) from public.inventory_count_items where count_id = v_cat) <> 1 then
    raise exception 'FAIL subcategory count does not find the product set through sub_category_id';
  end if;
  delete from public.inventory_counts where id = v_cat;

  if not exists (select 1 from public.get_warehouse_active_categories('00000000-0000-0000-00ab-0000000000e2')
                 where category_name = 'IC Category' and subcategory_name = 'IC Sub') then
    raise exception 'FAIL category list misses a category without stock';
  end if;
end $$;

-- ── Part B: a non-admin cannot backdate ─────────────────────────────────────
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-00ab-00000000000b","role":"authenticated"}', true);
do $$
declare
  v_ok boolean := false;
  v_id uuid;
begin
  begin
    insert into public.inventory_counts (document_number, count_date, warehouse_id, status)
    values ('IC-M-PAST', public.inventory_count_today() - 3, '00000000-0000-0000-00ab-0000000000e1', 'draft');
  exception when others then v_ok := true;
  end;
  if not v_ok then raise exception 'FAIL a non-admin created a backdated count'; end if;

  insert into public.inventory_counts (document_number, count_date, warehouse_id, status)
  values ('IC-M-TODAY', public.inventory_count_today(), '00000000-0000-0000-00ab-0000000000e1', 'draft')
  returning id into v_id;

  v_ok := false;
  begin
    update public.inventory_counts set count_date = public.inventory_count_today() - 1 where id = v_id;
  exception when others then v_ok := true;
  end;
  if not v_ok then raise exception 'FAIL a non-admin moved a count into the past'; end if;

  v_ok := false;
  begin
    perform public.inventory_count_update_header(v_id, public.inventory_count_today() - 1, null, null);
  exception when others then v_ok := true;
  end;
  if not v_ok then raise exception 'FAIL a non-admin backdated through the header RPC'; end if;

  delete from public.inventory_counts where id = v_id;
end $$;
rollback;

begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-00ab-00000000000a","role":"authenticated"}', true);
do $$
declare
  v_ok boolean := false;
  v_doc public.inventory_counts;
begin
  begin
    insert into public.inventory_counts (document_number, count_date, warehouse_id, status)
    values ('IC-A-FUTURE', public.inventory_count_today() + 1, '00000000-0000-0000-00ab-0000000000e1', 'draft');
  exception when others then v_ok := true;
  end;
  if not v_ok then raise exception 'FAIL a future count date was accepted'; end if;

  insert into public.inventory_counts (document_number, count_date, warehouse_id, status)
  values ('IC-A-PAST', public.inventory_count_today() - 2, '00000000-0000-0000-00ab-0000000000e1', 'draft')
  returning * into v_doc;
  if v_doc.book_as_of is null then raise exception 'FAIL backdated count has no book_as_of'; end if;
  delete from public.inventory_counts where id = v_doc.id;
end $$;
rollback;

-- ── Part B: book quantity at the end of a past day ──────────────────────────
do $$
declare
  w1 uuid := '00000000-0000-0000-00ab-0000000000e1';
  p  uuid := '00000000-0000-0000-00ab-000000000005';
  v_as_of timestamptz := ((public.inventory_count_today() - 1 + 1)::timestamp at time zone 'Asia/Baku') - interval '1 microsecond';
  v_id uuid;
  v_exp numeric;
begin
  -- 3 sold today (after the date), 1 received two days ago (before it).
  insert into public.stock_movements (product_id, warehouse_id, movement_type, quantity, reference_type, created_at)
  values (p, w1, 'out', 3, 'sale', now()), (p, w1, 'in', 1, 'purchase', now() - interval '2 days');
  if public.inventory_count_book_qty_at(p, w1, v_as_of) <> 13 then
    raise exception 'FAIL as-of quantity: %', public.inventory_count_book_qty_at(p, w1, v_as_of);
  end if;

  insert into public.inventory_counts (document_number, count_date, warehouse_id, warehouse_name, status)
  values ('IC-T-ASOF', public.inventory_count_today() - 1, w1, 'IC main', 'draft') returning id into v_id;
  perform public.inventory_count_start(v_id);
  select expected_qty into v_exp from public.inventory_count_items where count_id = v_id and product_id = p;
  if v_exp <> 13 then raise exception 'FAIL backdated count expected %', v_exp; end if;
  if (select is_metric from public.inventory_count_items where count_id = v_id and product_id = '00000000-0000-0000-00ab-000000000010') then
    raise exception 'FAIL backdated polywood line should be counted in metres';
  end if;
  delete from public.inventory_counts where id = v_id;
end $$;

-- ── Part B: backdated polywood shortage consumes shortest pieces, splits the last ──
do $$
declare
  w1 uuid := '00000000-0000-0000-00ab-0000000000e1';
  p  uuid := '00000000-0000-0000-00ab-000000000010';
  v_id uuid;
begin
  insert into public.inventory_counts (document_number, count_date, warehouse_id, warehouse_name, status, category_name)
  values ('IC-T-PWB', public.inventory_count_today() - 1, w1, 'IC main', 'draft', null) returning id into v_id;
  -- Only the polywood line.
  update public.inventory_counts set status = 'in_progress' where id = v_id;
  perform public.inventory_count_add_product(v_id, p);
  perform public.save_count_progress(v_id, jsonb_build_array(jsonb_build_object(
    'line_id', (select id from public.inventory_count_items where count_id = v_id), 'kind', 'qty', 'actual_qty', 4.5)));
  perform public.inventory_count_submit(v_id);
  perform public.inventory_count_post(v_id, '00000000-0000-0000-00ab-00000000000a');

  if (select array_agg(length_m order by length_m) from public.polywood_pieces where product_id = p and status = 'available') <> array[0.5, 4]::numeric[] then
    raise exception 'FAIL backdated polywood pieces: %', (select array_agg(length_m order by length_m) from public.polywood_pieces where product_id = p and status = 'available');
  end if;
  if (select stock from public.products where id = p) <> 4.5 then raise exception 'FAIL backdated polywood total'; end if;

  -- Unpost puts the 1 m and 2 m pieces back and removes the 0.5 m remainder.
  perform public.inventory_count_unpost(v_id, 'test', '00000000-0000-0000-00ab-00000000000a');
  if (select array_agg(length_m order by length_m) from public.polywood_pieces where product_id = p and status = 'available') <> array[1, 2, 4]::numeric[]
     or (select stock from public.products where id = p) <> 7 then
    raise exception 'FAIL backdated polywood unpost';
  end if;
end $$;

-- ── Part C: unpost restores stock, batches, pieces and journal; re-post works ──
do $$
declare
  w1   uuid := '00000000-0000-0000-00ab-0000000000e1';
  a    uuid := '00000000-0000-0000-00ab-00000000000a';
  m    uuid := '00000000-0000-0000-00ab-00000000000b';
  ps   uuid := '00000000-0000-0000-00ab-000000000006';
  pt   uuid := '00000000-0000-0000-00ab-000000000007';
  pw   uuid := '00000000-0000-0000-00ab-000000000008';
  v_id uuid;
  v_doc public.inventory_counts;
  v_ok boolean := false;
  v_first_journal uuid;
begin
  -- Shortage product: 10 received through a FIFO layer.
  perform public.adjust_warehouse_stock(pt, w1, 10);
  perform public.create_inventory_batch(pt, gen_random_uuid(), 'purchase', 2, 10);

  insert into public.inventory_counts (document_number, warehouse_id, warehouse_name, status)
  values ('IC-T-POST', w1, 'IC main', 'draft') returning id into v_id;
  update public.inventory_counts set status = 'in_progress' where id = v_id;
  perform public.inventory_count_add_product(v_id, ps);
  perform public.inventory_count_add_product(v_id, pt);
  perform public.inventory_count_add_product(v_id, pw);
  perform public.save_count_progress(v_id, (
    select jsonb_agg(case
      when i.product_id = ps then jsonb_build_object('line_id', i.id, 'kind', 'qty', 'actual_qty', 12)
      when i.product_id = pt then jsonb_build_object('line_id', i.id, 'kind', 'qty', 'actual_qty', 7)
      else jsonb_build_object('line_id', i.id, 'kind', 'pieces', 'full_sheets', 1, 'cut_pieces', jsonb_build_array(2))
    end) from public.inventory_count_items i where i.count_id = v_id));
  perform public.inventory_count_submit(v_id);

  -- An admin edits a line in review without reopening; a non-admin may not.
  begin
    perform public.save_count_progress(v_id, jsonb_build_array(jsonb_build_object(
      'line_id', (select id from public.inventory_count_items where count_id = v_id and product_id = ps), 'kind', 'qty', 'actual_qty', 13)), m);
  exception when others then v_ok := true;
  end;
  if not v_ok then raise exception 'FAIL a non-admin edited a count in review'; end if;
  perform public.save_count_progress(v_id, jsonb_build_array(jsonb_build_object(
    'line_id', (select id from public.inventory_count_items where count_id = v_id and product_id = ps), 'kind', 'qty', 'actual_qty', 12)), a);

  perform public.inventory_count_post(v_id, a);
  select * into v_doc from public.inventory_counts where id = v_id;
  v_first_journal := v_doc.journal_entry_id;
  if v_doc.status <> 'posted' or v_first_journal is null then raise exception 'FAIL post'; end if;
  if (select stock from public.products where id = ps) <> 12 or (select stock from public.products where id = pt) <> 7
     or (select stock from public.products where id = pw) <> 6 then
    raise exception 'FAIL posted stock';
  end if;
  if (select sum(remaining_qty) from public.inventory_batches where product_id = pt) <> 7 then raise exception 'FAIL FIFO consumption on post'; end if;

  -- Non-admins never unpost; a reason is required.
  v_ok := false;
  begin perform public.inventory_count_unpost(v_id, 'x', m); exception when others then v_ok := true; end;
  if not v_ok then raise exception 'FAIL a non-admin unposted'; end if;
  v_ok := false;
  begin perform public.inventory_count_unpost(v_id, '  ', a); exception when others then v_ok := true; end;
  if not v_ok then raise exception 'FAIL unpost without a reason'; end if;
  v_ok := false;
  begin delete from public.inventory_counts where id = v_id; exception when others then v_ok := true; end;
  if not v_ok then raise exception 'FAIL a posted count was deleted'; end if;

  perform public.inventory_count_unpost(v_id, 'wrong shelf', a);
  select * into v_doc from public.inventory_counts where id = v_id;
  if v_doc.status <> 'review' or v_doc.post_revision <> 1 or v_doc.journal_entry_id is not null or v_doc.unpost_reason <> 'wrong shelf' then
    raise exception 'FAIL unpost header: %', row_to_json(v_doc);
  end if;
  if (select stock from public.products where id = ps) <> 10 or (select stock from public.products where id = pt) <> 10
     or (select stock from public.products where id = pw) <> 10 then
    raise exception 'FAIL unpost stock: % % %', (select stock from public.products where id = ps),
      (select stock from public.products where id = pt), (select stock from public.products where id = pw);
  end if;
  if (select current_stock from public.warehouse_stocks where product_id = ps and warehouse_id = w1) <> 10 then
    raise exception 'FAIL unpost warehouse row';
  end if;
  if exists (select 1 from public.inventory_batches where document_id = v_id) then raise exception 'FAIL surplus layer kept'; end if;
  if (select sum(remaining_qty) from public.inventory_batches where product_id = pt) <> 10
     or exists (select 1 from public.inventory_batch_consumptions where source_id = v_id) then
    raise exception 'FAIL shortage consumption not returned';
  end if;
  if (select count(*) from public.polywood_pieces where product_id = pw and status = 'available') <> 3 then
    raise exception 'FAIL consumed pieces not restored';
  end if;
  if (select reversed_by from public.journal_entries where id = v_first_journal) is null then raise exception 'FAIL journal not reversed'; end if;
  if (select coalesce(sum(case when movement_type = 'in' then quantity else -quantity end), 0)
      from public.stock_movements where reference_id = v_id) <> 0 then
    raise exception 'FAIL movements do not net to zero after unpost';
  end if;
  if not exists (select 1 from public.mail_messages where res_model = 'inventory_counts' and res_id = v_id and kind = 'log')
     or not exists (select 1 from public.audit_logs where record_id = v_id and new_values_json->>'event' = 'INVENTORY_COUNT_UNPOST') then
    raise exception 'FAIL unpost not logged';
  end if;

  -- Re-post: a new journal entry, stock back to the counted quantities.
  perform public.inventory_count_post(v_id, a);
  select * into v_doc from public.inventory_counts where id = v_id;
  if v_doc.status <> 'posted' or v_doc.journal_entry_id is null or v_doc.journal_entry_id = v_first_journal then
    raise exception 'FAIL re-post journal';
  end if;
  if (select stock from public.products where id = ps) <> 12 or (select stock from public.products where id = pw) <> 6 then
    raise exception 'FAIL re-post stock';
  end if;
  if (select sum(current_stock) from public.warehouse_stocks where product_id = ps) <> 12 then raise exception 'FAIL re-post rows'; end if;
end $$;

-- ── Part C: unpost refused once the surplus is sold ─────────────────────────
do $$
declare
  w1   uuid := '00000000-0000-0000-00ab-0000000000e1';
  p    uuid := '00000000-0000-0000-00ab-000000000009';
  v_id uuid;
  v_ok boolean := false;
begin
  insert into public.inventory_counts (document_number, warehouse_id, warehouse_name, status)
  values ('IC-T-SOLD', w1, 'IC main', 'draft') returning id into v_id;
  update public.inventory_counts set status = 'in_progress' where id = v_id;
  perform public.inventory_count_add_product(v_id, p);
  perform public.save_count_progress(v_id, jsonb_build_array(jsonb_build_object(
    'line_id', (select id from public.inventory_count_items where count_id = v_id), 'kind', 'qty', 'actual_qty', 12)));
  perform public.inventory_count_submit(v_id);
  perform public.inventory_count_post(v_id, '00000000-0000-0000-00ab-00000000000a');

  -- A sale takes one unit out of the count's surplus layer.
  update public.inventory_batches set remaining_qty = remaining_qty - 1 where document_id = v_id;
  begin
    perform public.inventory_count_unpost(v_id, 'test', '00000000-0000-0000-00ab-00000000000a');
  exception when others then
    v_ok := sqlerrm like '%IC-SOLD%';
  end;
  if not v_ok then raise exception 'FAIL unpost after the surplus was sold (or the product is not named)'; end if;
  if (select status from public.inventory_counts where id = v_id) <> 'posted' then raise exception 'FAIL refused unpost changed the count'; end if;
end $$;

-- ── Part A: integrity page fixes ────────────────────────────────────────────
do $$
declare
  p uuid := '00000000-0000-0000-00ab-000000000011';
  s uuid := '00000000-0000-0000-00ab-000000000003';
begin
  -- A legacy row without a warehouse, and a total that disagrees with the rows.
  update public.warehouse_stocks set warehouse_id = null, current_stock = 4 where product_id = p;
  perform public.stock_sync_skip(true);
  update public.products set stock = 9 where id = p;
  perform public.stock_sync_skip(false);

  if not exists (select 1 from public.stock_integrity_report() where product_id = p and issue = 'null_warehouse_row' and fixable) then
    raise exception 'FAIL null_warehouse_row not reported';
  end if;
  if not exists (select 1 from public.stock_integrity_report() where product_id = p and issue = 'total_mismatch' and stock_after = 4) then
    raise exception 'FAIL total_mismatch not reported with the sum';
  end if;
  if not exists (select 1 from public.stock_integrity_report() where product_id = s and issue = 'subcategory_lost') then
    raise exception 'FAIL subcategory_lost not reported';
  end if;

  perform public.stock_integrity_fix('null_warehouse_row', null, '00000000-0000-0000-00ab-00000000000a');
  perform public.stock_integrity_fix('total_mismatch', array[p], '00000000-0000-0000-00ab-00000000000a');
  perform public.stock_integrity_fix('subcategory_lost', null, '00000000-0000-0000-00ab-00000000000a');

  if exists (select 1 from public.warehouse_stocks where product_id = p and warehouse_id is null) then raise exception 'FAIL null row not moved'; end if;
  if (select stock from public.products where id = p) <> 4 then raise exception 'FAIL total not set to the rows'; end if;
  if (select subcategory from public.products where id = s) is distinct from 'IC Sub' then raise exception 'FAIL subcategory not copied'; end if;
  if exists (select 1 from public.stock_integrity_report() where fixable and product_id in (p, s)) then
    raise exception 'FAIL fixable issues remain after fixing';
  end if;
  if not exists (select 1 from public.audit_logs where record_id = p and new_values_json->>'event' = 'stock_integrity_fix') then
    raise exception 'FAIL fix not audited';
  end if;
end $$;

-- Only admins read the report.
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-00ab-00000000000b","role":"authenticated"}', true);
do $$
declare v_ok boolean := false;
begin
  begin perform 1 from public.stock_integrity_report(); exception when others then v_ok := true; end;
  if not v_ok then raise exception 'FAIL a non-admin read the integrity report'; end if;
end $$;
rollback;

select 'ALL CHECKS PASSED';
