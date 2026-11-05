-- Checks supabase/migrations/20261105100000_imports_stages_pay.sql (IMP-5) on a database built with
-- scripts/db/build-fresh.sh --plain-postgres: the 100-sheet example from draft to closed, with the
-- freight paid in the draft from two accounts, and one sales invoice paid from two accounts.
-- Any failed check raises an exception; the last line prints ALL CHECKS PASSED.
-- Leaves test rows behind: run it on a throwaway database only.
--
-- 100 sheets × 25 USD at 1.70 = 4,250.00; freight 400 USD × 1.70 = 680.00 (paid in the draft at
-- 1.72 = 688.00: ABB 500 + Kassa 188 → 8.00 exchange loss on confirm); duty 5% of 4,930 = 246.50;
-- customs fee 30; customs VAT 931.77 (1410); local freight 200 + 36 VAT; later labour 100.
-- Landed 4,250 + 680 + 246.50 + 30 + 200 + 100 = 5,506.50.

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0e05-00000000000a', 'imp5-a@example.test', '{"full_name": "Aysel Admin", "role_name": "Admin"}')
on conflict (id) do nothing;
update public.profiles set is_active = true, role_id = (select id from public.roles where name = 'Admin' order by is_system desc limit 1)
where id = '00000000-0000-0000-0e05-00000000000a';

insert into public.suppliers (id, full_name, entity_type) values
  ('00000000-0000-0000-0e05-0000000000d1', 'IMP5 Marmara Board', 'legal'),
  ('00000000-0000-0000-0e05-0000000000d2', 'IMP5 Trans Kargo', 'legal'),
  ('00000000-0000-0000-0e05-0000000000d3', 'IMP5 Gömrük', 'legal'),
  ('00000000-0000-0000-0e05-0000000000d4', 'IMP5 Bakı Logistika', 'legal'),
  ('00000000-0000-0000-0e05-0000000000d5', 'IMP5 Fəhlə briqadası', 'legal')
on conflict (id) do nothing;
insert into public.warehouses (id, code, name, is_default, created_at) values
  ('00000000-0000-0000-0e05-0000000000a1', 'IMP5-W1', 'IMP5 Bakı', false, now())
on conflict (id) do nothing;
insert into public.accounts (id, code, name, type, balance, is_vat_account) values
  ('00000000-0000-0000-0e05-0000000000c1', 'IMP5-ABB', 'IMP5 ABB bank', 'bank', 100000, false),
  ('00000000-0000-0000-0e05-0000000000c2', 'IMP5-KASSA', 'IMP5 Kassa', 'cash', 100000, false)
on conflict (id) do nothing;
insert into public.products (id, code, name, stock, is_service, is_composite, inventory_mode, full_sheet_length_m, unit) values
  ('00000000-0000-0000-0e05-000000000101', 'IMP5-PW', 'IMP5 101 PARLAQ DOUBLE', 0, false, false, 'polywood', 4, 'vərəq')
on conflict (id) do nothing;
insert into public.customers (id, full_name) values ('00000000-0000-0000-0e05-0000000000e1', 'IMP5 customer') on conflict (id) do nothing;

create or replace function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', p), false);
$$;
-- Ledger checks read as the owner.
create or replace function pg_temp.coa_net(p_shipment uuid, p_code text) returns numeric language sql security definer as $$
  select coalesce(sum(jl.debit - jl.credit), 0)
  from public.journal_entries je join public.journal_entry_lines jl on jl.journal_entry_id = je.id
  join public.chart_of_accounts c on c.id = jl.coa_id
  where je.document_id = p_shipment and c.code = p_code;
$$;
create or replace function pg_temp.assert_balanced(p_doc uuid) returns void language plpgsql security definer as $$
declare r record;
begin
  for r in
    select je.id, je.document_type, sum(jl.debit) d, sum(jl.credit) c
    from public.journal_entries je join public.journal_entry_lines jl on jl.journal_entry_id = je.id
    where je.document_id = p_doc group by je.id, je.document_type
  loop
    if abs(r.d - r.c) > 0.001 then raise exception 'FAIL entry % (%) not balanced: % / %', r.id, r.document_type, r.d, r.c; end if;
  end loop;
end $$;
create or replace function pg_temp.balance(p_account uuid) returns numeric language sql security definer as $$
  select balance from public.accounts where id = p_account;
$$;

-- The draft, saved as the form does (service role, like the server action).
select public.import_shipment_save_draft(null,
  '{"supplier_id": "00000000-0000-0000-0e05-0000000000d1", "currency_code": "USD", "invoice_no": "INV-IMP5-1", "invoice_date": "2026-10-06", "invoice_rate": 1.7, "default_warehouse_id": "00000000-0000-0000-0e05-0000000000a1"}',
  '[{"position": 0, "product_id": "00000000-0000-0000-0e05-000000000101", "qty_purchase_unit": 100, "qty_stock_unit": 400, "unit_price_fc": 25, "duty_rate_pct": 5}]',
  '[{"position": 0, "cost_type": "freight_international", "partner_id": "00000000-0000-0000-0e05-0000000000d2", "description": "Freight", "amount": 400, "currency_code": "USD", "rate_to_azn": 1.7, "is_capitalized": true, "split_method": "by_value"},
    {"position": 1, "cost_type": "customs_duty", "partner_id": "00000000-0000-0000-0e05-0000000000d3", "amount": 246.5, "currency_code": "AZN", "rate_to_azn": 1, "is_capitalized": true, "split_method": "per_line_duty"},
    {"position": 2, "cost_type": "customs_fee", "partner_id": "00000000-0000-0000-0e05-0000000000d3", "amount": 30, "currency_code": "AZN", "rate_to_azn": 1, "is_capitalized": true, "split_method": "by_value"},
    {"position": 3, "cost_type": "customs_vat", "partner_id": "00000000-0000-0000-0e05-0000000000d3", "amount": 931.77, "currency_code": "AZN", "rate_to_azn": 1, "is_capitalized": false, "split_method": "by_value"},
    {"position": 4, "cost_type": "freight_local", "partner_id": "00000000-0000-0000-0e05-0000000000d4", "amount": 200, "currency_code": "AZN", "rate_to_azn": 1, "vat_amount_azn": 36, "is_capitalized": true, "split_method": "by_value"}]',
  '[{"cost_position": 0, "line_position": 0, "amount_azn": 680}, {"cost_position": 1, "line_position": 0, "amount_azn": 246.5},
    {"cost_position": 2, "line_position": 0, "amount_azn": 30}, {"cost_position": 4, "line_position": 0, "amount_azn": 200}]',
  '00000000-0000-0000-0e05-00000000000a');

create temp table ids (k text primary key, id uuid);
insert into ids select 'ship', id from public.import_shipments where invoice_no = 'INV-IMP5-1';
insert into ids select 'line', l.id from public.import_shipment_lines l join ids on ids.k = 'ship' and l.shipment_id = ids.id;
insert into ids select 'freight', c.id from public.import_cost_lines c join ids on ids.k = 'ship' and c.shipment_id = ids.id where c.position = 0;
grant all on ids to authenticated;

set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0e05-00000000000a');

-- 1. Pay the freight in the draft: 400 USD at 1.72 = 688.00 AZN from ABB 500 + Kassa 188, once.
do $$
declare
  v_ship uuid := (select id from ids where k = 'ship');
  v_cost uuid := (select id from ids where k = 'freight');
  r1 jsonb; r2 jsonb;
begin
  -- More than the cost is refused.
  begin
    perform public.pay_import_cost_advance(v_cost, '2026-10-07', null, 401, 1.72,
      '[{"account_id": "00000000-0000-0000-0e05-0000000000c1", "amount": 689.72}]', 'imp5-adv-over');
    raise exception 'FAIL an overpayment of the cost was taken';
  exception when others then if sqlerrm not like '%imports_overpay%' then raise; end if;
  end;
  -- Before the invoice date is refused.
  begin
    perform public.pay_import_cost_advance(v_cost, '2026-10-01', null, 400, 1.72,
      '[{"account_id": "00000000-0000-0000-0e05-0000000000c1", "amount": 688}]', 'imp5-adv-early');
    raise exception 'FAIL a payment before the invoice date was taken';
  exception when others then if sqlerrm not like '%imports_payment_before_document%' then raise; end if;
  end;
  r1 := public.pay_import_cost_advance(v_cost, '2026-10-07', 'TIR freight', 400, 1.72,
    '[{"account_id": "00000000-0000-0000-0e05-0000000000c1", "amount": 500, "method": "transfer", "note": "ABB"},
      {"account_id": "00000000-0000-0000-0e05-0000000000c2", "amount": 188, "method": "cash"}]', 'imp5-adv-1');
  r2 := public.pay_import_cost_advance(v_cost, '2026-10-07', 'TIR freight', 400, 1.72,
    '[{"account_id": "00000000-0000-0000-0e05-0000000000c1", "amount": 500, "method": "transfer"},
      {"account_id": "00000000-0000-0000-0e05-0000000000c2", "amount": 188, "method": "cash"}]', 'imp5-adv-1');
  if r1 ->> 'journal_entry_id' is distinct from r2 ->> 'journal_entry_id' then raise exception 'FAIL the same key paid twice'; end if;
  if pg_temp.balance('00000000-0000-0000-0e05-0000000000c1') <> 99500 or pg_temp.balance('00000000-0000-0000-0e05-0000000000c2') <> 99812 then
    raise exception 'FAIL account balances after the advance: % / %', pg_temp.balance('00000000-0000-0000-0e05-0000000000c1'), pg_temp.balance('00000000-0000-0000-0e05-0000000000c2');
  end if;
  if (select count(*) from public.journal_entries where document_id = v_ship and document_type = 'import_cost_advance') <> 1 then
    raise exception 'FAIL one advance entry expected';
  end if;
  if pg_temp.coa_net(v_ship, '2100') <> 688 then raise exception 'FAIL Dt 2100 partner 688 expected, got %', pg_temp.coa_net(v_ship, '2100'); end if;
  if (select count(*) from public.payments where reference_note like '%Freight%' and payment_method = 'bank') <> 1
     or (select count(*) from public.payments where reference_note like '%Freight%' and payment_method = 'cash') <> 1 then
    raise exception 'FAIL one partner payment row per account with its method';
  end if;
  if pg_temp.coa_net(v_ship, '1360') <> 0 then raise exception 'FAIL nothing reaches 1360 before confirm'; end if;
end $$;

-- 2. The paid cost keeps its id through a draft save and cannot change or disappear.
reset role;
do $$
declare
  v_ship uuid := (select id from ids where k = 'ship');
  v_cost uuid := (select id from ids where k = 'freight');
  v_costs jsonb;
begin
  v_costs := format('[{"id": "%s", "position": 0, "cost_type": "freight_international", "partner_id": "00000000-0000-0000-0e05-0000000000d2", "description": "Freight", "amount": 400, "currency_code": "USD", "rate_to_azn": 1.7, "is_capitalized": true, "split_method": "by_value"},
    {"position": 1, "cost_type": "customs_duty", "partner_id": "00000000-0000-0000-0e05-0000000000d3", "amount": 246.5, "currency_code": "AZN", "rate_to_azn": 1, "is_capitalized": true, "split_method": "per_line_duty"},
    {"position": 2, "cost_type": "customs_fee", "partner_id": "00000000-0000-0000-0e05-0000000000d3", "amount": 30, "currency_code": "AZN", "rate_to_azn": 1, "is_capitalized": true, "split_method": "by_value"},
    {"position": 3, "cost_type": "customs_vat", "partner_id": "00000000-0000-0000-0e05-0000000000d3", "amount": 931.77, "currency_code": "AZN", "rate_to_azn": 1, "is_capitalized": false, "split_method": "by_value"},
    {"position": 4, "cost_type": "freight_local", "partner_id": "00000000-0000-0000-0e05-0000000000d4", "amount": 200, "currency_code": "AZN", "rate_to_azn": 1, "vat_amount_azn": 36, "is_capitalized": true, "split_method": "by_value"}]', v_cost)::jsonb;
  perform public.import_shipment_save_draft(v_ship,
    '{"supplier_id": "00000000-0000-0000-0e05-0000000000d1", "currency_code": "USD", "invoice_no": "INV-IMP5-1", "invoice_date": "2026-10-06", "invoice_rate": 1.7, "default_warehouse_id": "00000000-0000-0000-0e05-0000000000a1"}',
    '[{"position": 0, "product_id": "00000000-0000-0000-0e05-000000000101", "qty_purchase_unit": 100, "qty_stock_unit": 400, "unit_price_fc": 25, "duty_rate_pct": 5}]',
    v_costs,
    '[{"cost_position": 0, "line_position": 0, "amount_azn": 680}, {"cost_position": 1, "line_position": 0, "amount_azn": 246.5},
      {"cost_position": 2, "line_position": 0, "amount_azn": 30}, {"cost_position": 4, "line_position": 0, "amount_azn": 200}]',
    '00000000-0000-0000-0e05-00000000000a');
  if not exists (select 1 from public.import_cost_lines where id = v_cost and shipment_id = v_ship) then
    raise exception 'FAIL the paid cost lost its id on a draft save';
  end if;
  update ids set id = (select id from public.import_shipment_lines where shipment_id = v_ship) where k = 'line';
  begin
    perform public.import_shipment_save_draft(v_ship, '{"supplier_id": "00000000-0000-0000-0e05-0000000000d1", "currency_code": "USD", "invoice_rate": 1.7}',
      '[]', jsonb_set(v_costs, '{0,amount}', '450'), '[]', '00000000-0000-0000-0e05-00000000000a');
    raise exception 'FAIL the amount of a paid cost was changed';
  exception when others then if sqlerrm not like '%imports_cost_paid_locked%' then raise; end if;
  end;
  begin
    perform public.import_shipment_save_draft(v_ship, '{"supplier_id": "00000000-0000-0000-0e05-0000000000d1", "currency_code": "USD", "invoice_rate": 1.7}',
      '[]', v_costs - 0, '[]', '00000000-0000-0000-0e05-00000000000a');
    raise exception 'FAIL a paid cost was removed';
  exception when others then if sqlerrm not like '%imports_cost_paid_locked%' then raise; end if;
  end;
end $$;

-- 3. Confirm: goods and costs on 1360, the advance settles the freight payable, 8.00 loss.
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0e05-00000000000a');
do $$
declare
  v_ship uuid := (select id from ids where k = 'ship');
  v_cost uuid := (select id from ids where k = 'freight');
  v_p public.import_payables;
  r1 jsonb; r2 jsonb;
begin
  r1 := public.confirm_import_shipment(v_ship, '2026-10-08', 'imp5-confirm');
  r2 := public.confirm_import_shipment(v_ship, '2026-10-08', 'imp5-confirm');
  if r1 ->> 'journal_entry_id' is distinct from r2 ->> 'journal_entry_id' then raise exception 'FAIL confirm ran twice'; end if;
  perform pg_temp.assert_balanced(v_ship);
  if pg_temp.coa_net(v_ship, '1360') <> 5406.50 then raise exception 'FAIL 1360 after confirm: %', pg_temp.coa_net(v_ship, '1360'); end if;
  if pg_temp.coa_net(v_ship, '1410') <> 967.77 then raise exception 'FAIL 1410: %', pg_temp.coa_net(v_ship, '1410'); end if;
  if pg_temp.coa_net(v_ship, '6260') <> 8 then raise exception 'FAIL 6260 exchange loss: %', pg_temp.coa_net(v_ship, '6260'); end if;
  select * into v_p from public.import_payables where cost_line_id = v_cost and status <> 'cancelled';
  if v_p.status <> 'paid' or v_p.paid_azn <> 680 or v_p.paid_fc <> 400 then raise exception 'FAIL freight payable %', row_to_json(v_p); end if;
  if (select paid_fc from public.import_payables where shipment_id = v_ship and source = 'goods') <> 0 then
    raise exception 'FAIL the cost advance was applied to the goods';
  end if;
  if exists (select 1 from public.import_prepayments where cost_line_id = v_cost and status <> 'applied') then raise exception 'FAIL advance not applied'; end if;
  -- Paid while a draft, the freight partner owes nothing: Dt 688 advance, Cr 680 payable, Cr 8 difference.
  if pg_temp.coa_net(v_ship, '2100') <> -(4250 + 246.50 + 30 + 931.77 + 236) then
    raise exception 'FAIL 2100 after confirm: %', pg_temp.coa_net(v_ship, '2100');
  end if;
end $$;

-- 4. Clear: needs the declaration; ETA changes are logged.
do $$
declare v_ship uuid := (select id from ids where k = 'ship');
begin
  begin
    perform public.clear_import_shipment(v_ship, '2026-10-21', 'imp5-clear-early');
    raise exception 'FAIL cleared without a declaration';
  exception when others then if sqlerrm not like '%imports_declaration_required%' then raise; end if;
  end;
  perform public.update_import_tracking(v_ship, '{"transport_mode": "road", "carrier_id": "00000000-0000-0000-0e05-0000000000d2", "tracking_no": "CMR 4471203", "eta": "2026-10-24", "departed_on": "2026-10-09"}');
  perform public.update_import_tracking(v_ship, '{"eta": "2026-10-27", "note": "border queue"}');
  perform public.log_import_event(v_ship, 'arrived_customs', '2026-10-20', 'Baku terminal');
  perform public.update_import_tracking(v_ship, '{"customs_declaration_no": "D-2026-77", "customs_declaration_date": "2026-10-20"}');
  perform public.clear_import_shipment(v_ship, '2026-10-21', 'imp5-clear');
  if (select status from public.import_shipments where id = v_ship) <> 'cleared' then raise exception 'FAIL not cleared'; end if;
  if (select customs_rate from public.import_shipments where id = v_ship) <> 1.7 then raise exception 'FAIL customs rate not stored'; end if;
end $$;

-- 5. Receive 60 %, a late labour cost, the rest, close.
do $$
declare
  v_ship uuid := (select id from ids where k = 'ship');
  v_line uuid := (select id from ids where k = 'line');
  r jsonb;
begin
  r := public.receive_import_shipment(v_ship, jsonb_build_array(jsonb_build_object('shipment_line_id', v_line,
    'warehouse_id', '00000000-0000-0000-0e05-0000000000a1', 'qty_stock_unit', 240)), '2026-10-22', null, 'imp5-recv-1');
  if (r ->> 'value_azn')::numeric <> 3243.90 then raise exception 'FAIL 60%% receipt value %', r ->> 'value_azn'; end if;
  perform public.add_import_cost(v_ship, jsonb_build_object('cost_type', 'labour', 'partner_id', '00000000-0000-0000-0e05-0000000000d5',
    'description', 'Fəhlə', 'amount', 100, 'currency_code', 'AZN', 'is_capitalized', true, 'split_method', 'by_quantity',
    'allocations', jsonb_build_array(jsonb_build_object('shipment_line_id', v_line, 'amount_azn', 100))), null, '2026-10-23', 'imp5-labour');
  perform public.add_import_cost(v_ship, jsonb_build_object('cost_type', 'labour', 'partner_id', '00000000-0000-0000-0e05-0000000000d5',
    'description', 'Fəhlə', 'amount', 100, 'currency_code', 'AZN', 'is_capitalized', true, 'split_method', 'by_quantity',
    'allocations', jsonb_build_array(jsonb_build_object('shipment_line_id', v_line, 'amount_azn', 100))), null, '2026-10-23', 'imp5-labour');
  if (select count(*) from public.import_cost_lines where shipment_id = v_ship and cost_type = 'labour') <> 1 then raise exception 'FAIL labour added twice'; end if;
  r := public.receive_import_shipment(v_ship, jsonb_build_array(jsonb_build_object('shipment_line_id', v_line,
    'warehouse_id', '00000000-0000-0000-0e05-0000000000a1', 'qty_stock_unit', 160)), '2026-10-24', null, 'imp5-recv-2');
  if r ->> 'status' <> 'received' then raise exception 'FAIL not fully received'; end if;
  perform public.close_import_shipment(v_ship, 'imp5-close');
  if (select status from public.import_shipments where id = v_ship) <> 'closed' then raise exception 'FAIL not closed'; end if;
end $$;

-- 6. The books: 1360 = 0, stock = landed cost, payables, accounts, nothing posted twice, events.
reset role;
do $$
declare
  v_ship uuid := (select id from ids where k = 'ship');
  v_stock numeric;
  v_kinds text;
begin
  perform pg_temp.assert_balanced(v_ship);
  if public.import_shipment_transit_balance(v_ship) <> 0 or pg_temp.coa_net(v_ship, '1360') <> 0 then
    raise exception 'FAIL 1360 not zero: %', pg_temp.coa_net(v_ship, '1360');
  end if;
  if pg_temp.coa_net(v_ship, '1300') <> 5506.50 then raise exception 'FAIL 1300 = %', pg_temp.coa_net(v_ship, '1300'); end if;
  select sum(b.remaining_qty * b.unit_cost) into v_stock
  from public.inventory_batches b where b.product_id = '00000000-0000-0000-0e05-000000000101';
  if abs(v_stock - 5506.50) > 0.05 then raise exception 'FAIL FIFO stock value % (landed 5,506.50)', v_stock; end if;
  if (select sum(value_azn) from public.import_receipt_lines rl join public.import_receipts rc on rc.id = rl.receipt_id where rc.shipment_id = v_ship)
     + (select coalesce(sum(to_stock_azn), 0) from public.import_late_postings where shipment_id = v_ship) <> 5506.50 then
    raise exception 'FAIL receipts + late postings <> landed cost';
  end if;
  -- Payables: goods 4,250 open; freight paid (in the draft); customs 1,208.27, local 236, labour 100 open.
  if (select string_agg(s.full_name || ':' || p.amount_azn || '/' || p.paid_azn || '/' || p.status, ', ' order by s.full_name, p.amount_azn)
        from public.import_payables p join public.suppliers s on s.id = p.partner_id where p.shipment_id = v_ship)
     <> 'IMP5 Bakı Logistika:236.00/0.00/open, IMP5 Fəhlə briqadası:100.00/0.00/open, IMP5 Gömrük:30.00/0.00/open, IMP5 Gömrük:246.50/0.00/open, IMP5 Gömrük:931.77/0.00/open, IMP5 Marmara Board:4250.00/0.00/open, IMP5 Trans Kargo:680.00/680.00/paid' then
    raise exception 'FAIL payables: %', (select string_agg(s.full_name || ':' || p.amount_azn || '/' || p.paid_azn || '/' || p.status, ', ' order by s.full_name, p.amount_azn)
        from public.import_payables p join public.suppliers s on s.id = p.partner_id where p.shipment_id = v_ship);
  end if;
  if pg_temp.balance('00000000-0000-0000-0e05-0000000000c1') <> 99500 or pg_temp.balance('00000000-0000-0000-0e05-0000000000c2') <> 99812 then
    raise exception 'FAIL account balances at the end';
  end if;
  if exists (select idempotency_key from public.journal_entries where document_id = v_ship group by idempotency_key having count(*) > 1) then
    raise exception 'FAIL an entry was posted twice';
  end if;
  if (select string_agg(document_type || '×' || n, ',' order by document_type) from (
        select document_type, count(*) n from public.journal_entries where document_id = v_ship group by document_type) x)
     <> 'import_confirm×1,import_cost×1,import_cost_advance×1,import_late_cost×1,import_receipt×2' then
    raise exception 'FAIL entries per kind: %', (select string_agg(document_type || '×' || n, ',' order by document_type) from (
        select document_type, count(*) n from public.journal_entries where document_id = v_ship group by document_type) x);
  end if;
  select string_agg(kind, ',' order by kind) into v_kinds from public.import_shipment_events where shipment_id = v_ship;
  if v_kinds is distinct from 'arrived_customs,cleared,closed,confirmed,cost_added,cost_paid,created,departed,eta_changed,received,received_partial' then
    raise exception 'FAIL events: %', v_kinds;
  end if;
end $$;

-- 7. A sales invoice paid from two accounts: one payment event, one journal entry, once.
insert into public.sales (id, doc_no, doc_date, customer_id, total_amount, paid_amount, remaining_balance, status) values
  ('00000000-0000-0000-0e05-0000000005a1', 'IMP5-S1', '2026-10-25', '00000000-0000-0000-0e05-0000000000e1', 150, 0, 150, 'posted')
on conflict (id) do nothing;
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0e05-00000000000a');
do $$
declare
  r1 jsonb; r2 jsonb;
  v_payload jsonb := jsonb_build_object('idempotency_key', 'imp5-sale-pay-1', 'document_type', 'sale',
    'document_id', '00000000-0000-0000-0e05-0000000005a1', 'payment_date', '2026-10-25', 'payment_id', 'imp5-sale-p1',
    'lines', jsonb_build_array(
      jsonb_build_object('account_id', '00000000-0000-0000-0e05-0000000000c1', 'amount', 100, 'method', 'Köçürmə'),
      jsonb_build_object('account_id', '00000000-0000-0000-0e05-0000000000c2', 'amount', 50, 'method', 'Nağd')));
begin
  r1 := public.process_invoice_payment_event(v_payload);
  r2 := public.process_invoice_payment_event(v_payload);
  if r1 ->> 'journal_entry_id' is distinct from r2 ->> 'journal_entry_id' then raise exception 'FAIL the sale was paid twice'; end if;
  if jsonb_array_length(r1 -> 'transaction_ids') <> 2 then raise exception 'FAIL two cash transactions expected: %', r1; end if;
end $$;
reset role;
do $$
declare
  v_je uuid;
begin
  if (select paid_amount from public.sales where id = '00000000-0000-0000-0e05-0000000005a1') <> 150
     or (select remaining_balance from public.sales where id = '00000000-0000-0000-0e05-0000000005a1') <> 0
     or (select jsonb_array_length(payments) from public.sales where id = '00000000-0000-0000-0e05-0000000005a1') <> 2 then
    raise exception 'FAIL sale not paid as two lines';
  end if;
  if (select count(distinct journal_entry_id) from public.transactions where source_type = 'sale' and source_id = '00000000-0000-0000-0e05-0000000005a1') <> 1
     or (select count(*) from public.transactions where source_type = 'sale' and source_id = '00000000-0000-0000-0e05-0000000005a1') <> 2 then
    raise exception 'FAIL two transactions on one journal entry expected';
  end if;
  select journal_entry_id into v_je from public.transactions where source_type = 'sale' and source_id = '00000000-0000-0000-0e05-0000000005a1' limit 1;
  if (select count(*) from public.journal_entry_lines where journal_entry_id = v_je) <> 3
     or (select sum(debit) from public.journal_entry_lines where journal_entry_id = v_je) <> 150
     or (select sum(credit) from public.journal_entry_lines where journal_entry_id = v_je) <> 150 then
    raise exception 'FAIL the sale entry is not Dt ABB 100 + Dt Kassa 50 / Kt 150';
  end if;
  if (select count(*) from public.erp_events where idempotency_key = 'imp5-sale-pay-1') <> 1 then raise exception 'FAIL one payment event expected'; end if;
  if pg_temp.balance('00000000-0000-0000-0e05-0000000000c1') <> 99600 or pg_temp.balance('00000000-0000-0000-0e05-0000000000c2') <> 99862 then
    raise exception 'FAIL account balances after the sale';
  end if;
end $$;

-- 8. One account, as before (old calls unchanged).
insert into public.sales (id, doc_no, doc_date, customer_id, total_amount, paid_amount, remaining_balance, status) values
  ('00000000-0000-0000-0e05-0000000005a2', 'IMP5-S2', '2026-10-25', '00000000-0000-0000-0e05-0000000000e1', 40, 0, 40, 'posted')
on conflict (id) do nothing;
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0e05-00000000000a');
do $$
declare r jsonb;
begin
  r := public.process_invoice_payment_event(jsonb_build_object('idempotency_key', 'imp5-sale-pay-2', 'document_type', 'sale',
    'document_id', '00000000-0000-0000-0e05-0000000005a2', 'payment_date', '2026-10-25', 'amount', 40,
    'account_id', '00000000-0000-0000-0e05-0000000000c2', 'method', 'Nağd'));
  if r ->> 'transaction_id' is null or (r ->> 'remaining_balance')::numeric <> 0 then raise exception 'FAIL single-account payment %', r; end if;
end $$;

reset role;
select set_config('request.jwt.claims', '', false);
select 'ALL CHECKS PASSED';
