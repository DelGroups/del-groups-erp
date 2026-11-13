-- Checks supabase/migrations/20261110152000_document_date_change_inventory.sql (DATE-3) on a
-- database built with scripts/db/build-fresh.sh --plain-postgres (CI: .github/workflows/db-baseline.yml).
-- Any failed check raises an exception; the last line prints ALL CHECKS PASSED.
-- Leaves test rows behind: run it on a throwaway database only.
--
-- One passing and one blocked change per type: a stock transfer, an initial balance, a write-off,
-- a posted inventory count, an import receipt and an import payment. Days are relative to today (T).
--
-- Timeline of DI-P (product P) in warehouse A / B:
--   T-30 initial balance IB: +10 in A
--   T-10 transfer TR: 6 from A to B
--   T-8  sale S1: 5 from B
--   T-6  write-off WO: 1 from A
--   T-20 count CN0 (posted, P in A); T-3 count CN (posted, −1 of P in A)
-- Import of DI-Q: confirmed T-20, receipt IR T-15 (+10 in A), sale S2 T-12 (4 of Q from A),
-- payment IPY T-14 (100 AZN from cash account C, which got 150 on T-16).

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-00de-00000000000a', 'di-a@example.test', '{"full_name": "Dilarə Admin", "role_name": "Admin"}'),
  ('00000000-0000-0000-00de-00000000000e', 'di-e@example.test', '{"full_name": "Elşən Anbar", "role_name": "Manager"}')
on conflict (id) do nothing;
insert into public.roles (id, name, permissions)
values ('00000000-0000-0000-00de-0000000000f0', 'DI warehouse', '{"can_manage_inventory": true, "can_writeoff_inventory": true, "can_manage_imports": true}')
on conflict (id) do nothing;
update public.profiles set role_id = (select id from public.roles where name = 'Admin' order by is_system desc limit 1), is_active = true
where id = '00000000-0000-0000-00de-00000000000a';
update public.profiles set role_id = '00000000-0000-0000-00de-0000000000f0', is_active = true
where id = '00000000-0000-0000-00de-00000000000e';

insert into public.warehouses (id, code, name, is_default, created_at) values
  ('00000000-0000-0000-00de-0000000000a1', 'DI-A', 'DI anbar A', false, now()),
  ('00000000-0000-0000-00de-0000000000a2', 'DI-B', 'DI anbar B', false, now())
on conflict (id) do nothing;
insert into public.accounts (id, code, name, type, balance) values
  ('00000000-0000-0000-00de-0000000000c1', 'DI-C', 'DI kassa', 'cash', 0) on conflict (id) do nothing;
insert into public.customers (id, full_name) values ('00000000-0000-0000-00de-0000000000b1', 'DI customer') on conflict (id) do nothing;
insert into public.suppliers (id, full_name, entity_type) values ('00000000-0000-0000-00de-0000000000d1', 'DI supplier', 'legal') on conflict (id) do nothing;
do $$ begin
  if public.resolve_unified_partner_id(null, '00000000-0000-0000-00de-0000000000d1') is null then
    insert into public.partners (name, entity_type, is_customer, is_supplier, supplier_id, created_at, credit_limit, is_deleted)
    values ('DI supplier', 'legal', false, true, '00000000-0000-0000-00de-0000000000d1', now(), 0, false);
  end if;
end $$;
insert into public.products (id, code, name, stock, buy_price, is_service, is_composite, inventory_mode, full_sheet_length_m, unit) values
  ('00000000-0000-0000-00de-000000000001', 'DI-P', 'DI panel', 0, 5, false, false, 'standard', 4, 'Ədəd'),
  ('00000000-0000-0000-00de-000000000002', 'DI-Q', 'DI import', 0, 20, false, false, 'standard', 4, 'Ədəd')
on conflict (id) do nothing;

create or replace function pg_temp.codes(p jsonb, p_kind text) returns text[] language sql as $$
  select coalesce(array_agg(x->>'code' order by x->>'code'), '{}') from jsonb_array_elements(p->p_kind) x;
$$;
create or replace function pg_temp.day(p timestamptz) returns date language sql immutable as $$
  select (p at time zone 'Asia/Baku')::date;
$$;
-- A moment on day T-n, 10:15 Baku.
create or replace function pg_temp.at(p_days int) returns timestamptz language sql stable as $$
  select ((public.document_today() - p_days)::timestamp + time '10:15') at time zone 'Asia/Baku';
$$;
create temp table di_ids (k text primary key, id uuid);
grant all on di_ids to authenticated;

-- ── Documents written as the app writes them (owner) ────────────────────────
do $$
declare
  t date := public.document_today();
  p uuid := '00000000-0000-0000-00de-000000000001';
  wa uuid := '00000000-0000-0000-00de-0000000000a1';
  wb uuid := '00000000-0000-0000-00de-0000000000a2';
  v_id uuid;
begin
  -- IB: initial balance, 10 of P into A on T-30 (posted from the app server).
  insert into public.inventory_initial_balances (document_number, doc_date, warehouse_id, warehouse_name, status, total_amount, entry_type, posted_at, created_at, updated_at)
  values ('DI-IB-1', t - 30, wa, 'DI anbar A', 'posted', 50, 'opening_balance', now(), now(), now())
  returning id into v_id;
  insert into di_ids values ('ib', v_id);
  perform public.adjust_warehouse_stock(p, wa, 10);
  insert into public.stock_movements (product_id, warehouse_id, movement_type, quantity, unit, reference_type, reference_id, description, created_at)
  values (p, wa, 'in', 10, 'Ədəd', 'initial_balance', v_id, 'DI opening', pg_temp.at(30));
  perform public.create_inventory_batch(p, v_id, 'initial_balance', 5, 10);
  update public.inventory_batches set created_at = pg_temp.at(30) where document_id = v_id;

  -- TR: transfer of 6 from A to B on T-10.
  insert into public.stock_transfers (reference_number, from_warehouse_id, to_warehouse_id, transfer_date, status)
  values ('DI-TR-1', wa, wb, t - 10, 'completed') returning id into v_id;
  insert into di_ids values ('tr', v_id);
  insert into public.stock_transfer_items (transfer_id, product_id, quantity, product_code, product_name, unit)
  values (v_id, p, 6, 'DI-P', 'DI panel', 'Ədəd');
  perform public.adjust_warehouse_stock(p, wa, -6);
  perform public.adjust_warehouse_stock(p, wb, 6);
  insert into public.stock_movements (product_id, warehouse_id, movement_type, quantity, unit, reference_type, reference_id, description, created_at) values
    (p, wa, 'out', 6, 'Ədəd', 'TRANSFER_OUT', v_id, 'DI transfer', pg_temp.at(10)),
    (p, wb, 'in', 6, 'Ədəd', 'TRANSFER_IN', v_id, 'DI transfer', pg_temp.at(10));

  -- CN0 (posted on T-20, P in A, no change) and CN (posted on T-3: −1 of P in A).
  insert into public.inventory_counts (id, document_number, count_date, warehouse_id, warehouse_name, status, line_count, counted_count,
    total_surplus_value, total_shortage_value, total_variance_value, posted_at, created_at, updated_at) values
    ('00000000-0000-0000-00de-0000000000e0', 'DI-CNT-0', t - 20, wa, 'DI anbar A', 'posted', 1, 1, 0, 0, 0, now(), now(), now()),
    ('00000000-0000-0000-00de-0000000000e1', 'DI-CNT-1', t - 3, wa, 'DI anbar A', 'posted', 1, 1, 0, 5, -5, now(), now(), now());
  insert into public.inventory_count_items (id, count_id, line_no, product_id, product_name, is_metric, expected_qty, actual_qty,
    scanned_piece_ids, unit_cost, drift_qty, created_at, updated_at) values
    (gen_random_uuid(), '00000000-0000-0000-00de-0000000000e0', 1, p, 'DI panel', false, 10, 10, '[]'::jsonb, 5, 0, now(), now()),
    (gen_random_uuid(), '00000000-0000-0000-00de-0000000000e1', 1, p, 'DI panel', false, 4, 3, '[]'::jsonb, 5, 0, now(), now());
  insert into di_ids values ('cn', '00000000-0000-0000-00de-0000000000e1');
  perform public.adjust_warehouse_stock(p, wa, -1);
  insert into public.stock_movements (product_id, warehouse_id, movement_type, quantity, unit, reference_type, reference_id, description, created_at)
  values (p, wa, 'out', 1, 'Ədəd', 'inventory_adjustment', '00000000-0000-0000-00de-0000000000e1', 'DI count', pg_temp.at(3));

  -- The cash account gets 150 on T-16.
  perform public.post_cash_transaction('00000000-0000-0000-00de-0000000000c1', 'Mədaxil', 150, 'Digər mədaxil', 'DI cash in');
  update public.transactions set transaction_date = pg_temp.at(16) where notes = 'DI cash in';
end $$;

-- The import: 10 × DI-Q at 10 USD (rate 2), confirmed on T-20.
select public.import_shipment_save_draft(
  null,
  jsonb_build_object('supplier_id', '00000000-0000-0000-00de-0000000000d1', 'currency_code', 'USD', 'invoice_no', 'DI-INV-1',
                     'invoice_date', (public.document_today() - 25)::text, 'invoice_rate', 2, 'default_warehouse_id', '00000000-0000-0000-00de-0000000000a1'),
  '[{"position": 0, "product_id": "00000000-0000-0000-00de-000000000002", "qty_purchase_unit": 10, "qty_stock_unit": 10, "unit_price_fc": 10}]',
  '[]', '[]', '00000000-0000-0000-00de-00000000000a');

set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-00de-00000000000a","role":"authenticated"}', false);
do $$
declare
  t date := public.document_today();
  v_ship uuid := (select id from public.import_shipments where invoice_no = 'DI-INV-1');
  v_line uuid;
  v_id uuid;
  r jsonb;
begin
  perform public.confirm_import_shipment(v_ship, t - 20, 'di-confirm-1');
  v_line := (select id from public.import_shipment_lines where shipment_id = v_ship);
  r := public.receive_import_shipment(v_ship, jsonb_build_array(jsonb_build_object('shipment_line_id', v_line,
         'warehouse_id', '00000000-0000-0000-00de-0000000000a1', 'qty_stock_unit', 10)), t - 15, 'DI truck', 'di-receive-1');
  insert into di_ids values ('ir', (r->>'receipt_id')::uuid);
  -- IPY: 50 USD of the goods payable at 2 = 100 AZN, from C on T-14.
  r := to_jsonb(public.pay_import_payable((select id from public.import_payables where shipment_id = v_ship and source = 'goods'), t - 14, 'DI pay',
         '[{"account_id": "00000000-0000-0000-00de-0000000000c1", "amount": 100}]', 'di-payment-1', 50, 2));
  insert into di_ids select 'ipy', id from public.import_payments where shipment_id = v_ship;

  -- S1: 5 of P from B on T-8; S2: 4 of Q from A on T-12.
  v_id := (public.save_sales_invoice_draft(jsonb_build_object(
    'header', jsonb_build_object('customer_id', '00000000-0000-0000-00de-0000000000b1', 'doc_date', (t - 8)::text,
      'total_amount', 50, 'subtotal', 50, 'paid_amount', 0, 'remaining_balance', 50),
    'items', jsonb_build_array(jsonb_build_object('product_id', '00000000-0000-0000-00de-000000000001', 'product_name', 'DI panel',
      'quantity', 5, 'unit_price', 10, 'line_total', 50, 'total', 50, 'warehouse_id', '00000000-0000-0000-00de-0000000000a2')),
    'payments', '[]'::jsonb)) ->> 'sale_id')::uuid;
  perform public.post_sales_invoice_draft(v_id);
  insert into di_ids values ('s1', v_id);
  v_id := (public.save_sales_invoice_draft(jsonb_build_object(
    'header', jsonb_build_object('customer_id', '00000000-0000-0000-00de-0000000000b1', 'doc_date', (t - 12)::text,
      'total_amount', 120, 'subtotal', 120, 'paid_amount', 0, 'remaining_balance', 120),
    'items', jsonb_build_array(jsonb_build_object('product_id', '00000000-0000-0000-00de-000000000002', 'product_name', 'DI import',
      'quantity', 4, 'unit_price', 30, 'line_total', 120, 'total', 120, 'warehouse_id', '00000000-0000-0000-00de-0000000000a1')),
    'payments', '[]'::jsonb)) ->> 'sale_id')::uuid;
  perform public.post_sales_invoice_draft(v_id);
  insert into di_ids values ('s2', v_id);

  -- WO: write-off of 1 of P from A on T-6.
  r := public.post_inventory_writeoff(jsonb_build_object('document_number', 'DI-WO-1', 'writeoff_date', (t - 6)::text,
         'warehouse_id', '00000000-0000-0000-00de-0000000000a1', 'checker_name', 'DI',
         'items', jsonb_build_array(jsonb_build_object('product_id', '00000000-0000-0000-00de-000000000001', 'product_name', 'DI panel', 'quantity', 1, 'unit', 'Ədəd', 'issue_description', 'Cracked'))));
  insert into di_ids values ('wo', (r->>'id')::uuid);
end $$;

do $$
begin
  if (select count(*) from di_ids) <> 8 then raise exception 'FAIL setup: % documents', (select count(*) from di_ids); end if;
  if not exists (select 1 from public.inventory_batch_consumptions c join public.inventory_batches b on b.id = c.batch_id
                 where c.sale_id = (select id from di_ids where k = 's2') and b.document_id = (select id from di_ids where k = 'ir')) then
    raise exception 'FAIL setup: S2 did not use the import layer';
  end if;
end $$;

-- ── Stock transfer ───────────────────────────────────────────────────────────
do $$
declare
  t date := public.document_today();
  tr uuid := (select id from di_ids where k = 'tr');
  p jsonb;
  r jsonb;
begin
  -- Blocked: before the stock arrived in the source warehouse (IB on T-30).
  p := public.preview_document_date_change('stock_transfer', tr, t - 35);
  if (p->>'ok')::boolean or not ('stock_negative' = any (pg_temp.codes(p, 'blockers'))) then raise exception 'FAIL tr before stock arrived: %', p; end if;
  if not exists (select 1 from jsonb_array_elements(p->'blockers'->0->'details'->'items') i where (i->>'warehouse_id')::uuid = '00000000-0000-0000-00de-0000000000a1') then
    raise exception 'FAIL tr R3 not on the source warehouse: %', p;
  end if;
  -- Blocked: after B sold the goods (S1 on T-8): R3 on the target warehouse.
  p := public.preview_document_date_change('stock_transfer', tr, t - 5);
  if not exists (select 1 from jsonb_array_elements(p->'blockers') b, jsonb_array_elements(b->'details'->'items') i
                 where b->>'code' = 'stock_negative' and (i->>'warehouse_id')::uuid = '00000000-0000-0000-00de-0000000000a2') then
    raise exception 'FAIL tr R3 on the target warehouse: %', p;
  end if;
  -- Passes: T-12. Both legs and the header move.
  p := public.preview_document_date_change('stock_transfer', tr, t - 12);
  if not (p->>'ok')::boolean or (p->'affected'->>'stock_moves')::int <> 2 then raise exception 'FAIL tr T-12: %', p; end if;
  r := public.apply_document_date_change('stock_transfer', tr, t - 12, 'Truck left two days earlier');
  if not (r->>'ok')::boolean then raise exception 'FAIL tr apply: %', r; end if;
  if (select transfer_date from public.stock_transfers where id = tr) <> t - 12 then raise exception 'FAIL tr header'; end if;
  if exists (select 1 from public.stock_movements where reference_id = tr and pg_temp.day(created_at) <> t - 12) then raise exception 'FAIL tr legs'; end if;
  if exists (select 1 from public.stock_movements where reference_id = tr and (created_at at time zone 'Asia/Baku')::time <> time '10:15') then
    raise exception 'FAIL tr time of day not kept';
  end if;
end $$;

-- ── Initial balance ──────────────────────────────────────────────────────────
do $$
declare
  t date := public.document_today();
  ib uuid := (select id from di_ids where k = 'ib');
  p jsonb;
  r jsonb;
begin
  -- Blocked: after the transfer took 6 of it (T-12) and the sale used its layer (T-8).
  p := public.preview_document_date_change('inventory_initial_balance', ib, t - 7);
  if (p->>'ok')::boolean or not ('stock_negative' = any (pg_temp.codes(p, 'blockers'))) or not ('fifo_order' = any (pg_temp.codes(p, 'blockers'))) then
    raise exception 'FAIL ib blocked: %', p;
  end if;
  -- Blocked (R8): CN0 on T-20 lies between T-30 and T-19.
  p := public.preview_document_date_change('inventory_initial_balance', ib, t - 19);
  if not ('inventory_count_between' = any (pg_temp.codes(p, 'blockers'))) then raise exception 'FAIL ib R8: %', p; end if;
  -- Passes: T-31. Movement, FIFO layer and header move.
  r := public.apply_document_date_change('inventory_initial_balance', ib, t - 31, 'Opening stock was counted a day earlier', '{}', array['other_month']);
  if not (r->>'ok')::boolean then raise exception 'FAIL ib apply: %', r; end if;
  if (select doc_date from public.inventory_initial_balances where id = ib) <> t - 31 then raise exception 'FAIL ib header'; end if;
  if exists (select 1 from public.inventory_batches where document_id = ib and pg_temp.day(created_at) <> t - 31) then raise exception 'FAIL ib layer'; end if;
  if exists (select 1 from public.stock_movements where reference_id = ib and pg_temp.day(created_at) <> t - 31) then raise exception 'FAIL ib movement'; end if;
end $$;

-- ── Write-off ────────────────────────────────────────────────────────────────
do $$
declare
  t date := public.document_today();
  wo uuid := (select id from di_ids where k = 'wo');
  p jsonb;
  r jsonb;
begin
  -- Blocked: before any stock was in A.
  p := public.preview_document_date_change('inventory_writeoff', wo, t - 35);
  if (p->>'ok')::boolean or not ('stock_negative' = any (pg_temp.codes(p, 'blockers'))) then raise exception 'FAIL wo blocked: %', p; end if;
  -- Passes: T-4 (its movement was typed in today: it moves to T-4 too).
  r := public.apply_document_date_change('inventory_writeoff', wo, t - 4, 'Damage found on the 4th');
  if not (r->>'ok')::boolean then raise exception 'FAIL wo apply: %', r; end if;
  if (select writeoff_date from public.inventory_writeoffs where id = wo) <> t - 4 then raise exception 'FAIL wo header'; end if;
  if exists (select 1 from public.stock_movements where reference_id = wo and pg_temp.day(created_at) <> t - 4) then raise exception 'FAIL wo movement'; end if;
end $$;

-- ── Posted inventory count ──────────────────────────────────────────────────
do $$
declare
  t date := public.document_today();
  cn uuid := (select id from di_ids where k = 'cn');
  p jsonb;
  r jsonb;
begin
  -- Blocked (R8): CN0 on T-20 lies between.
  p := public.preview_document_date_change('inventory_count', cn, t - 25);
  if (p->>'ok')::boolean or not ('inventory_count_between' = any (pg_temp.codes(p, 'blockers'))) then raise exception 'FAIL cn R8: %', p; end if;
  -- Passes: T-2, through the F2 date rule.
  r := public.apply_document_date_change('inventory_count', cn, t - 2, 'Count finished the next morning');
  if not (r->>'ok')::boolean then raise exception 'FAIL cn apply: %', r; end if;
  if (select count_date from public.inventory_counts where id = cn) <> t - 2 then raise exception 'FAIL cn header'; end if;
  if exists (select 1 from public.stock_movements where reference_id = cn and pg_temp.day(created_at) <> t - 2) then raise exception 'FAIL cn movement'; end if;
  -- F2 still refuses a posted count's date outside the engine.
  begin
    update public.inventory_counts set count_date = t - 1 where id = cn;
    raise exception 'FAIL a posted count date changed outside the engine';
  exception when invalid_parameter_value then null;
  end;
  -- A count that was unposted and posted again is refused.
end $$;
reset role;
update public.inventory_counts set post_revision = 1 where id = '00000000-0000-0000-00de-0000000000e0';
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-00de-00000000000a","role":"authenticated"}', false);
do $$
declare p jsonb;
begin
  p := public.preview_document_date_change('inventory_count', '00000000-0000-0000-00de-0000000000e0', public.document_today() - 21);
  if not ('reposted_document' = any (pg_temp.codes(p, 'blockers'))) then raise exception 'FAIL cn reposted: %', p; end if;
end $$;

-- ── Import receipt ───────────────────────────────────────────────────────────
do $$
declare
  t date := public.document_today();
  ir uuid := (select id from di_ids where k = 'ir');
  p jsonb;
  r jsonb;
begin
  -- Blocked (R4): after a sale of its goods (S2 on T-12).
  p := public.preview_document_date_change('import_receipt', ir, t - 10);
  if (p->>'ok')::boolean or not ('fifo_order' = any (pg_temp.codes(p, 'blockers'))) then raise exception 'FAIL ir R4: %', p; end if;
  -- Blocked (R7): before the shipment was confirmed (T-20).
  p := public.preview_document_date_change('import_receipt', ir, t - 21);
  if not ('import_before_confirm' = any (pg_temp.codes(p, 'blockers'))) then raise exception 'FAIL ir R7: %', p; end if;
  -- Passes: T-18, with the W3 warning (USD: the rates stay).
  p := public.preview_document_date_change('import_receipt', ir, t - 18);
  if not (p->>'ok')::boolean or not ('fx_rate_kept' = any (pg_temp.codes(p, 'warnings'))) then raise exception 'FAIL ir T-18: %', p; end if;
  begin
    perform public.apply_document_date_change('import_receipt', ir, t - 18, 'test');
    raise exception 'FAIL ir unticked W3 accepted';
  exception when invalid_parameter_value then null;
  end;
  r := public.apply_document_date_change('import_receipt', ir, t - 18, 'Truck arrived earlier', '{}', array['fx_rate_kept', 'other_month']);
  if not (r->>'ok')::boolean then raise exception 'FAIL ir apply: %', r; end if;
  if (select receipt_date from public.import_receipts where id = ir) <> t - 18 then raise exception 'FAIL ir header'; end if;
  if exists (select 1 from public.import_receipts ir2 join public.journal_entries je on je.id = ir2.journal_entry_id where ir2.id = ir and je.entry_date <> t - 18) then
    raise exception 'FAIL ir journal';
  end if;
  if exists (select 1 from public.inventory_batches where document_id = ir and pg_temp.day(created_at) <> t - 18) then raise exception 'FAIL ir layer'; end if;
end $$;

-- ── Import payment ───────────────────────────────────────────────────────────
do $$
declare
  t date := public.document_today();
  ipy uuid := (select id from di_ids where k = 'ipy');
  p jsonb;
  r jsonb;
begin
  if (public.resolve_date_change_document((select transaction_id from public.import_payment_splits where payment_id = ipy)))->>'type' <> 'import_payment' then
    raise exception 'FAIL resolve import payment';
  end if;
  -- Blocked (R6): before the cash came in (T-16).
  p := public.preview_document_date_change('import_payment', ipy, t - 17);
  if (p->>'ok')::boolean or not ('cash_negative' = any (pg_temp.codes(p, 'blockers'))) then raise exception 'FAIL ipy R6: %', p; end if;
  -- Blocked (R7): before the payable exists (confirmed T-20).
  p := public.preview_document_date_change('import_payment', ipy, t - 21);
  if not ('import_payment_before_payable' = any (pg_temp.codes(p, 'blockers'))) then raise exception 'FAIL ipy R7: %', p; end if;
  -- Passes: T-15. The cash row, the partner payment row and the journal move.
  r := public.apply_document_date_change('import_payment', ipy, t - 15, 'Bank value date', '{}', array['fx_rate_kept', 'other_month']);
  if not (r->>'ok')::boolean then raise exception 'FAIL ipy apply: %', r; end if;
  if (select payment_date from public.import_payments where id = ipy) <> t - 15 then raise exception 'FAIL ipy header'; end if;
  if exists (select 1 from public.import_payment_splits sp join public.transactions tx on tx.id = sp.transaction_id
             where sp.payment_id = ipy and pg_temp.day(tx.transaction_date) <> t - 15) then raise exception 'FAIL ipy cash'; end if;
  if exists (select 1 from public.import_payment_splits sp join public.payments py on py.transaction_id = sp.transaction_id
             where sp.payment_id = ipy and pg_temp.day(py.payment_date) <> t - 15) then raise exception 'FAIL ipy partner payment'; end if;
  if exists (select 1 from public.import_payments ip join public.journal_entries je on je.id = ip.journal_entry_id
             where ip.id = ipy and je.entry_date <> t - 15) then raise exception 'FAIL ipy journal'; end if;
end $$;

-- ── R1 and R2 ────────────────────────────────────────────────────────────────
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-00de-00000000000e","role":"authenticated"}', false);
do $$
declare p jsonb;
begin
  p := public.preview_document_date_change('stock_transfer', (select id from di_ids where k = 'tr'), public.document_today() - 11);
  if not ('not_admin' = any (pg_temp.codes(p, 'blockers'))) then raise exception 'FAIL R1: %', p; end if;
  begin
    perform public.apply_document_date_change('inventory_writeoff', (select id from di_ids where k = 'wo'), public.document_today() - 5, 'test');
    raise exception 'FAIL R1 apply allowed for a non-admin';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
insert into public.accounting_periods (period_year, period_month, status) values (2025, 4, 'closed') on conflict do nothing;
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-00de-00000000000a","role":"authenticated"}', false);
do $$
declare p jsonb;
begin
  p := public.preview_document_date_change('import_receipt', (select id from di_ids where k = 'ir'), date '2025-04-10');
  if not ('period_closed_new' = any (pg_temp.codes(p, 'blockers'))) then raise exception 'FAIL R2: %', p; end if;
end $$;
reset role;

do $$
begin
  if (select count(*) from public.document_date_changes where document_type in
      ('stock_transfer', 'inventory_initial_balance', 'inventory_writeoff', 'inventory_count', 'import_receipt', 'import_payment')) <> 6 then
    raise exception 'FAIL audit rows: %', (select count(*) from public.document_date_changes);
  end if;
  if has_function_privilege('authenticated', 'public._date_change_extra_warnings(text, uuid, date, date)', 'execute') then
    raise exception 'FAIL internal helper exposed';
  end if;
end $$;

select 'ALL CHECKS PASSED';
