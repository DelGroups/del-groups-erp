-- Checks supabase/migrations/20261030110000_imports_posting.sql (Imports module, IMP-2) on a
-- database built with scripts/db/build-fresh.sh --plain-postgres (CI: .github/workflows/db-baseline.yml).
-- Any failed check raises an exception; the last line prints ALL CHECKS PASSED.
-- Leaves test rows behind: run it on a throwaway database only.

-- A admin (approves); M manages imports and sees money; V only views.
insert into public.roles (id, name, permissions) values
  ('00000000-0000-0000-02a2-0000000000f1', 'IMP2 manager', '{"can_view_imports": true, "can_manage_imports": true, "can_view_financials": true}'),
  ('00000000-0000-0000-02a2-0000000000f2', 'IMP2 viewer', '{"can_view_imports": true, "can_view_financials": true}')
on conflict (id) do nothing;
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-02a2-00000000000a', 'imp2-a@example.test', '{"full_name": "Aysel Admin", "role_name": "Admin"}'),
  ('00000000-0000-0000-02a2-00000000000b', 'imp2-m@example.test', '{"full_name": "Murad Manager"}'),
  ('00000000-0000-0000-02a2-00000000000c', 'imp2-v@example.test', '{"full_name": "Vüsal Viewer"}')
on conflict (id) do nothing;
update public.profiles set is_active = true, role_id = case id
    when '00000000-0000-0000-02a2-00000000000a' then (select id from public.roles where name = 'Admin' order by is_system desc limit 1)
    when '00000000-0000-0000-02a2-00000000000b' then '00000000-0000-0000-02a2-0000000000f1'::uuid
    else '00000000-0000-0000-02a2-0000000000f2'::uuid end
where id::text like '00000000-0000-0000-02a2-%';

insert into public.suppliers (id, full_name, entity_type) values
  ('00000000-0000-0000-02a2-0000000000d1', 'IMP2 Kronospan', 'legal'),
  ('00000000-0000-0000-02a2-0000000000d2', 'IMP2 Gömrük', 'legal')
on conflict (id) do nothing;
-- Creating a supplier creates its partner record (the payables and payments carry it).
do $$ begin
  if public.resolve_unified_partner_id(null, '00000000-0000-0000-02a2-0000000000d1') is null then
    insert into public.partners (name, entity_type, is_customer, is_supplier, supplier_id, created_at, credit_limit, is_deleted)
    values ('IMP2 Kronospan', 'legal', false, true, '00000000-0000-0000-02a2-0000000000d1', now(), 0, false);
  end if;
end $$;
insert into public.warehouses (id, code, name, is_default, created_at) values
  ('00000000-0000-0000-02a2-0000000000a1', 'IMP2-W1', 'IMP2 anbar 1', false, now()),
  ('00000000-0000-0000-02a2-0000000000a2', 'IMP2-W2', 'IMP2 anbar 2', false, now())
on conflict (id) do nothing;
insert into public.accounts (id, code, name, type, balance, is_vat_account) values
  ('00000000-0000-0000-02a2-0000000000c1', 'IMP2-K', 'IMP2 Kassa', 'cash', 10000, false),
  ('00000000-0000-0000-02a2-0000000000c2', 'IMP2-B', 'IMP2 Bank', 'bank', 10000, false)
on conflict (id) do nothing;
insert into public.products (id, code, name, stock, is_service, is_composite, inventory_mode, full_sheet_length_m, unit) values
  ('00000000-0000-0000-02a2-000000000101', 'IMP2-P1', 'IMP2 edge band', 0, false, false, 'standard', 4, 'Ədəd'),
  ('00000000-0000-0000-02a2-000000000102', 'IMP2-P2', 'IMP2 plywood', 0, false, false, 'polywood', 4, 'Vərəq')
on conflict (id) do nothing;

-- Helpers: act as a user; check that every entry of a shipment balances; 1360 of a shipment.
create or replace function pg_temp.as_user(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, false);
$$;
-- The checks read the ledger as the owner (the manager's role cannot read journal lines).
create or replace function pg_temp.assert_balanced(p_shipment uuid) returns void language plpgsql security definer as $$
declare r record;
begin
  for r in
    select je.id, je.document_type, sum(jl.debit) d, sum(jl.credit) c
    from public.journal_entries je join public.journal_entry_lines jl on jl.journal_entry_id = je.id
    where je.document_id = p_shipment group by je.id, je.document_type
  loop
    if abs(r.d - r.c) > 0.001 then raise exception 'FAIL entry % (%) not balanced: % / %', r.id, r.document_type, r.d, r.c; end if;
  end loop;
end $$;
create or replace function pg_temp.coa_net(p_shipment uuid, p_code text) returns numeric language sql security definer as $$
  select coalesce(sum(jl.debit - jl.credit), 0)
  from public.journal_entries je join public.journal_entry_lines jl on jl.journal_entry_id = je.id
  join public.chart_of_accounts c on c.id = jl.coa_id
  where je.document_id = p_shipment and c.code = p_code;
$$;

-- Accounts exist.
do $$ begin
  if (select count(*) from public.chart_of_accounts where code in ('1360', '4960', '6260') and is_active) <> 3 then
    raise exception 'FAIL accounts 1360 / 4960 / 6260 missing';
  end if;
  if (select account_type from public.chart_of_accounts where code = '1360') <> 'asset' then raise exception 'FAIL 1360 not an asset'; end if;
end $$;

-- Shipment 1 (draft, saved like the form does): P1 10 pcs × 10 USD, P2 5 sheets (20 m) × 20 USD,
-- rate 2 → goods 200 + 200 AZN. Freight 100 AZN by value (to customs partner), customs VAT 36,
-- local freight 50 + 9 VAT paid now from the cash desk, split 25 / 25. Landed 275 + 275.
select public.import_shipment_save_draft(
  null,
  '{"supplier_id": "00000000-0000-0000-02a2-0000000000d1", "currency_code": "USD", "invoice_no": "INV-IMP2-1", "invoice_date": "2026-10-01", "invoice_rate": 2, "default_warehouse_id": "00000000-0000-0000-02a2-0000000000a1"}',
  '[{"position": 0, "product_id": "00000000-0000-0000-02a2-000000000101", "qty_purchase_unit": 10, "qty_stock_unit": 10, "unit_price_fc": 10},
    {"position": 1, "product_id": "00000000-0000-0000-02a2-000000000102", "qty_purchase_unit": 5, "qty_stock_unit": 20, "unit_price_fc": 20}]',
  '[{"position": 0, "cost_type": "freight_international", "amount": 100, "currency_code": "AZN", "rate_to_azn": 1, "is_capitalized": true, "split_method": "by_value", "partner_id": "00000000-0000-0000-02a2-0000000000d2"},
    {"position": 1, "cost_type": "customs_vat", "amount": 36, "currency_code": "AZN", "rate_to_azn": 1, "is_capitalized": false, "split_method": "by_value", "partner_id": "00000000-0000-0000-02a2-0000000000d2"},
    {"position": 2, "cost_type": "freight_local", "amount": 50, "currency_code": "AZN", "rate_to_azn": 1, "vat_amount_azn": 9, "is_capitalized": true, "split_method": "by_value", "paid_now": true, "cash_account_id": "00000000-0000-0000-02a2-0000000000c1"}]',
  '[{"cost_position": 0, "line_position": 0, "amount_azn": 50}, {"cost_position": 0, "line_position": 1, "amount_azn": 50},
    {"cost_position": 2, "line_position": 0, "amount_azn": 25}, {"cost_position": 2, "line_position": 1, "amount_azn": 25}]',
  '00000000-0000-0000-02a2-00000000000b');

set role authenticated;

-- 1. Confirm: approve needed; balanced; payables; cash; idempotent.
select pg_temp.as_user('00000000-0000-0000-02a2-00000000000c');
do $$
declare v_id uuid := (select id from public.import_shipments where invoice_no = 'INV-IMP2-1');
begin
  begin
    perform public.confirm_import_shipment(v_id, null, 'imp2-confirm-viewer');
    raise exception 'FAIL a viewer confirmed';
  exception when insufficient_privilege then null;
  end;
end $$;

select pg_temp.as_user('00000000-0000-0000-02a2-00000000000a');
do $$
declare
  v_id uuid := (select id from public.import_shipments where invoice_no = 'INV-IMP2-1');
  v1 jsonb;
  v2 jsonb;
begin
  v1 := public.confirm_import_shipment(v_id, null, 'imp2-confirm-1');
  v2 := public.confirm_import_shipment(v_id, null, 'imp2-confirm-1');
  if v1 ->> 'journal_entry_id' is distinct from v2 ->> 'journal_entry_id' or (v2 ->> 'idempotent') is distinct from 'true' then
    raise exception 'FAIL confirm is not idempotent';
  end if;
  begin
    perform public.confirm_import_shipment(v_id, null, 'imp2-confirm-2');
    raise exception 'FAIL confirmed twice';
  exception when others then if sqlerrm not like '%imports_not_draft%' then raise; end if;
  end;
  perform pg_temp.assert_balanced(v_id);
  if pg_temp.coa_net(v_id, '1360') <> 550 then raise exception 'FAIL 1360 after confirm = %', pg_temp.coa_net(v_id, '1360'); end if;
  if pg_temp.coa_net(v_id, '1410') <> 45 then raise exception 'FAIL 1410 after confirm = %', pg_temp.coa_net(v_id, '1410'); end if;
  if pg_temp.coa_net(v_id, '2100') <> -536 then raise exception 'FAIL 2100 after confirm = %', pg_temp.coa_net(v_id, '2100'); end if;
  if pg_temp.coa_net(v_id, '1100') <> -59 then raise exception 'FAIL cash after confirm = %', pg_temp.coa_net(v_id, '1100'); end if;
  if (select balance from public.accounts where id = '00000000-0000-0000-02a2-0000000000c1') <> 9941 then raise exception 'FAIL cash balance not reduced'; end if;
  if (select status from public.import_shipments where id = v_id) <> 'confirmed' then raise exception 'FAIL not confirmed'; end if;
  if (select count(*) from public.import_payables where shipment_id = v_id) <> 3 then raise exception 'FAIL payables not opened'; end if;
  if not exists (select 1 from public.import_payables where shipment_id = v_id and source = 'goods' and amount_azn = 400 and amount_fc = 200 and booking_rate = 2 and currency_code = 'USD') then
    raise exception 'FAIL goods payable does not keep the currency and rate';
  end if;
  if (select partner_id from public.journal_entry_lines jl join public.journal_entries je on je.id = jl.journal_entry_id
      join public.chart_of_accounts c on c.id = jl.coa_id
      where je.document_id = v_id and c.code = '2100' and jl.credit = 400) is distinct from public.resolve_unified_partner_id(null, '00000000-0000-0000-02a2-0000000000d1') then
    raise exception 'FAIL goods payable not on the supplier partner';
  end if;
end $$;

-- 2. A confirmed shipment cannot be edited directly any more.
select pg_temp.as_user('00000000-0000-0000-02a2-00000000000b');
do $$
declare v_id uuid := (select id from public.import_shipments where invoice_no = 'INV-IMP2-1');
begin
  begin
    insert into public.import_cost_lines (shipment_id, position, cost_type, amount) values (v_id, 50, 'other', 1);
    raise exception 'FAIL a cost was written directly into a confirmed shipment';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.import_shipments set status = 'closed' where id = v_id;
    if (select status from public.import_shipments where id = v_id) = 'closed' then raise exception 'FAIL status changed directly'; end if;
  exception when insufficient_privilege then null;
  end;
end $$;

-- 3. Receive: partial into two warehouses, then the rest with one line split over both.
select pg_temp.as_user('00000000-0000-0000-02a2-00000000000a');
do $$
declare
  v_id uuid := (select id from public.import_shipments where invoice_no = 'INV-IMP2-1');
  l1 uuid := (select id from public.import_shipment_lines where shipment_id = (select id from public.import_shipments where invoice_no = 'INV-IMP2-1') and position = 0);
  l2 uuid := (select id from public.import_shipment_lines where shipment_id = (select id from public.import_shipments where invoice_no = 'INV-IMP2-1') and position = 1);
  r jsonb;
begin
  begin
    perform public.receive_import_shipment(v_id, jsonb_build_array(jsonb_build_object('shipment_line_id', l2, 'warehouse_id', '00000000-0000-0000-02a2-0000000000a2', 'qty_stock_unit', 5)), null, null, 'imp2-recv-bad');
    raise exception 'FAIL a part sheet was received';
  exception when others then if sqlerrm not like '%imports_whole_sheets%' then raise; end if;
  end;

  r := public.receive_import_shipment(v_id, jsonb_build_array(
    jsonb_build_object('shipment_line_id', l1, 'warehouse_id', '00000000-0000-0000-02a2-0000000000a1', 'qty_stock_unit', 6),
    jsonb_build_object('shipment_line_id', l2, 'warehouse_id', '00000000-0000-0000-02a2-0000000000a2', 'qty_stock_unit', 8)
  ), null, 'first truck', 'imp2-recv-1');
  if (public.receive_import_shipment(v_id, '[]', null, null, 'imp2-recv-1') ->> 'receipt_id') is distinct from r ->> 'receipt_id' then
    raise exception 'FAIL receive is not idempotent';
  end if;
  if r ->> 'status' <> 'partially_received' then raise exception 'FAIL status after partial receipt %', r ->> 'status'; end if;
  if (r ->> 'value_azn')::numeric <> 275 then raise exception 'FAIL partial receipt value % (expected 165 + 110)', r ->> 'value_azn'; end if;
  if (select current_stock from public.warehouse_stocks where product_id = '00000000-0000-0000-02a2-000000000101' and warehouse_id = '00000000-0000-0000-02a2-0000000000a1') <> 6 then
    raise exception 'FAIL edge band not in warehouse 1';
  end if;
  if (select count(*) from public.polywood_pieces where product_id = '00000000-0000-0000-02a2-000000000102' and warehouse_id = '00000000-0000-0000-02a2-0000000000a2' and status = 'available') <> 2 then
    raise exception 'FAIL two plywood sheets not in warehouse 2';
  end if;
  if (select unit_cost from public.inventory_batches where document_id = (r ->> 'receipt_id')::uuid and product_id = '00000000-0000-0000-02a2-000000000101') <> 27.5 then
    raise exception 'FAIL edge band batch not at the landed unit cost';
  end if;
  if not exists (select 1 from public.stock_movements where reference_type = 'import' and reference_id = (r ->> 'receipt_id')::uuid and movement_type = 'in') then
    raise exception 'FAIL no stock movement';
  end if;

  begin
    perform public.receive_import_shipment(v_id, jsonb_build_array(jsonb_build_object('shipment_line_id', l1, 'qty_stock_unit', 5)), null, null, 'imp2-recv-over');
    raise exception 'FAIL over-receipt accepted';
  exception when others then if sqlerrm not like '%imports_over_receipt%' then raise; end if;
  end;

  r := public.receive_import_shipment(v_id, jsonb_build_array(
    jsonb_build_object('shipment_line_id', l1, 'warehouse_id', '00000000-0000-0000-02a2-0000000000a1', 'qty_stock_unit', 2),
    jsonb_build_object('shipment_line_id', l1, 'warehouse_id', '00000000-0000-0000-02a2-0000000000a2', 'qty_stock_unit', 2),
    jsonb_build_object('shipment_line_id', l2, 'warehouse_id', '00000000-0000-0000-02a2-0000000000a1', 'qty_stock_unit', 12)
  ), null, null, 'imp2-recv-2');
  if r ->> 'status' <> 'received' then raise exception 'FAIL status after the rest %', r ->> 'status'; end if;
  if pg_temp.coa_net(v_id, '1360') <> 0 then raise exception 'FAIL 1360 not zero after full receipt: %', pg_temp.coa_net(v_id, '1360'); end if;
  if pg_temp.coa_net(v_id, '1300') <> 550 then raise exception 'FAIL 1300 after receipt %', pg_temp.coa_net(v_id, '1300'); end if;
  perform pg_temp.assert_balanced(v_id);
end $$;

-- 4. Late cost with half the edge band sold: 40 AZN onto P1 → 20 to stock (1300), 20 to 5100.
reset role;
do $$
begin
  -- A sale took 5 of the 10 edge bands from the first layer (6 → 1) and from warehouse 1.
  update public.inventory_batches set remaining_qty = 1
  where product_id = '00000000-0000-0000-02a2-000000000101' and document_type = 'import' and initial_qty = 6;
  perform public.stock_move('00000000-0000-0000-02a2-000000000101', '00000000-0000-0000-02a2-0000000000a1', -5, true);
  if (select sum(remaining_qty) from public.inventory_batches where product_id = '00000000-0000-0000-02a2-000000000101' and document_type = 'import') <> 5 then
    raise exception 'FAIL setup: half of the edge band should remain';
  end if;
end $$;

set role authenticated;
select pg_temp.as_user('00000000-0000-0000-02a2-00000000000b');
do $$
declare
  v_id uuid := (select id from public.import_shipments where invoice_no = 'INV-IMP2-1');
  l1 uuid := (select id from public.import_shipment_lines where shipment_id = (select id from public.import_shipments where invoice_no = 'INV-IMP2-1') and position = 0);
  v_1300 numeric := pg_temp.coa_net((select id from public.import_shipments where invoice_no = 'INV-IMP2-1'), '1300');
  r jsonb;
  v_cost numeric;
begin
  r := public.add_import_cost(v_id, jsonb_build_object(
      'cost_type', 'other', 'description', 'Late handling', 'amount', 40, 'currency_code', 'AZN', 'is_capitalized', true,
      'split_method', 'manual', 'partner_id', '00000000-0000-0000-02a2-0000000000d2',
      'allocations', jsonb_build_array(jsonb_build_object('shipment_line_id', l1, 'amount_azn', 40))),
    null, null, 'imp2-late-1');
  if r ->> 'late_journal_entry_id' is null then raise exception 'FAIL late cost not applied to received stock'; end if;
  if pg_temp.coa_net(v_id, '1300') - v_1300 <> 20 then raise exception 'FAIL stock share of the late cost %', pg_temp.coa_net(v_id, '1300') - v_1300; end if;
  if pg_temp.coa_net(v_id, '5100') <> 20 then raise exception 'FAIL sold share of the late cost %', pg_temp.coa_net(v_id, '5100'); end if;
  if pg_temp.coa_net(v_id, '1360') <> 0 then raise exception 'FAIL 1360 after the late cost %', pg_temp.coa_net(v_id, '1360'); end if;
  select sum(remaining_qty * unit_cost) into v_cost from public.inventory_batches where product_id = '00000000-0000-0000-02a2-000000000101' and document_type = 'import' and remaining_qty > 0;
  if abs(v_cost - (5 * 27.5 + 20)) > 0.01 then raise exception 'FAIL remaining layers not raised by the stock share: %', v_cost; end if;
  if not exists (select 1 from public.import_payables where cost_line_id = (r ->> 'cost_line_id')::uuid and amount_azn = 40 and status = 'open') then
    raise exception 'FAIL late cost payable';
  end if;
  perform pg_temp.assert_balanced(v_id);
end $$;

-- 5. An estimate (10 on the plywood) becomes 16: only the difference posts; close waits for it.
do $$
declare
  v_id uuid := (select id from public.import_shipments where invoice_no = 'INV-IMP2-1');
  l2 uuid := (select id from public.import_shipment_lines where shipment_id = (select id from public.import_shipments where invoice_no = 'INV-IMP2-1') and position = 1);
  v_1300 numeric;
  r jsonb;
begin
  r := public.add_import_cost(v_id, jsonb_build_object(
      'cost_type', 'storage', 'amount', 10, 'currency_code', 'AZN', 'is_capitalized', true, 'is_estimate', true,
      'split_method', 'manual', 'partner_id', '00000000-0000-0000-02a2-0000000000d2',
      'allocations', jsonb_build_array(jsonb_build_object('shipment_line_id', l2, 'amount_azn', 10))),
    null, null, 'imp2-est-1');
  v_1300 := pg_temp.coa_net(v_id, '1300');
  perform public.finalize_import_cost((r ->> 'cost_line_id')::uuid, jsonb_build_object(
    'amount', 16, 'currency_code', 'AZN', 'vat_amount_azn', 0,
    'allocations', jsonb_build_array(jsonb_build_object('shipment_line_id', l2, 'amount_azn', 16))), null, 'imp2-est-final');
  if pg_temp.coa_net(v_id, '1300') - v_1300 <> 6 then raise exception 'FAIL estimate difference not in stock: %', pg_temp.coa_net(v_id, '1300') - v_1300; end if;
  if (select amount_azn from public.import_payables where cost_line_id = (r ->> 'cost_line_id')::uuid) <> 16 then raise exception 'FAIL estimate payable not adjusted'; end if;
  if pg_temp.coa_net(v_id, '1360') <> 0 then raise exception 'FAIL 1360 after the estimate %', pg_temp.coa_net(v_id, '1360'); end if;
  perform pg_temp.assert_balanced(v_id);
end $$;

-- 6. Pay the supplier 250 of 400 from two accounts in one entry; date and overpay rules.
-- As the admin, who may also read the ledger rows checked below.
select pg_temp.as_user('00000000-0000-0000-02a2-00000000000a');
do $$
declare
  v_id uuid := (select id from public.import_shipments where invoice_no = 'INV-IMP2-1');
  v_payable uuid := (select id from public.import_payables where shipment_id = (select id from public.import_shipments where invoice_no = 'INV-IMP2-1') and source = 'goods');
  r jsonb;
begin
  begin
    perform public.pay_import_payable(v_payable, '2026-09-30', null,
      '[{"account_id": "00000000-0000-0000-02a2-0000000000c1", "amount": 10}]', 'imp2-pay-early');
    raise exception 'FAIL a payment before the document date';
  exception when others then if sqlerrm not like '%imports_payment_before_document%' then raise; end if;
  end;
  begin
    perform public.pay_import_payable(v_payable, '2026-10-05', null,
      '[{"account_id": "00000000-0000-0000-02a2-0000000000c1", "amount": 300}, {"account_id": "00000000-0000-0000-02a2-0000000000c2", "amount": 101}]', 'imp2-pay-over');
    raise exception 'FAIL an overpayment';
  exception when others then if sqlerrm not like '%imports_overpay%' then raise; end if;
  end;
  r := public.pay_import_payable(v_payable, '2026-10-05', 'First part',
    '[{"account_id": "00000000-0000-0000-02a2-0000000000c1", "amount": 150}, {"account_id": "00000000-0000-0000-02a2-0000000000c2", "amount": 100}]', 'imp2-pay-1');
  if (public.pay_import_payable(v_payable, '2026-10-05', null, '[]', 'imp2-pay-1') ->> 'payment_id') is distinct from r ->> 'payment_id' then
    raise exception 'FAIL payment not idempotent';
  end if;
  if (r ->> 'remaining_azn')::numeric <> 150 then raise exception 'FAIL remaining after payment %', r ->> 'remaining_azn'; end if;
  if (select count(*) from public.journal_entries where id = (r ->> 'journal_entry_id')::uuid) <> 1 then raise exception 'FAIL not one entry'; end if;
  if (select count(*) from public.journal_entry_lines where journal_entry_id = (r ->> 'journal_entry_id')::uuid) <> 3 then raise exception 'FAIL payment entry lines'; end if;
  if (select count(*) from public.transactions where reference_type = 'import_payment' and reference_id = (r ->> 'payment_id')::uuid and journal_entry_id = (r ->> 'journal_entry_id')::uuid) <> 2 then
    raise exception 'FAIL one cash transaction per account';
  end if;
  if (select count(*) from public.payments where journal_entry_id = (r ->> 'journal_entry_id')::uuid and partner_id = public.resolve_unified_partner_id(null, '00000000-0000-0000-02a2-0000000000d1')) <> 2 then
    raise exception 'FAIL payments rows for the partner';
  end if;
  if (select balance from public.accounts where id = '00000000-0000-0000-02a2-0000000000c2') <> 9900 then raise exception 'FAIL bank balance'; end if;
  if (select paid_azn from public.import_payables where id = v_payable) <> 250 or (select status from public.import_payables where id = v_payable) <> 'open' then
    raise exception 'FAIL partial payment left the wrong balance';
  end if;
  if (select entry_date from public.journal_entries where id = (r ->> 'journal_entry_id')::uuid) <> '2026-10-05' then raise exception 'FAIL payment not back-dated'; end if;
  perform pg_temp.assert_balanced(v_id);
end $$;

-- 7. Close (approve), and nothing more is added afterwards.
select pg_temp.as_user('00000000-0000-0000-02a2-00000000000a');
do $$
declare v_id uuid := (select id from public.import_shipments where invoice_no = 'INV-IMP2-1');
begin
  perform public.close_import_shipment(v_id, 'imp2-close-1');
  if (select status from public.import_shipments where id = v_id) <> 'closed' then raise exception 'FAIL not closed'; end if;
  begin
    perform public.add_import_cost(v_id, '{"cost_type": "other", "amount": 1, "currency_code": "AZN", "partner_id": "00000000-0000-0000-02a2-0000000000d2"}', null, null, 'imp2-after-close');
    raise exception 'FAIL a cost was added to a closed shipment';
  exception when others then if sqlerrm not like '%imports_closed%' then raise; end if;
  end;
  begin
    perform public.cancel_import_shipment(v_id, 'test', 'imp2-cancel-closed');
    raise exception 'FAIL a closed shipment was cancelled';
  exception when others then if sqlerrm not like '%imports_cannot_cancel%' then raise; end if;
  end;
  perform public.reopen_import_shipment(v_id);
  if (select status from public.import_shipments where id = v_id) <> 'received' then raise exception 'FAIL not reopened'; end if;
end $$;

-- 8. Shipment 2: confirm, receive, cancel. Refused while stock is used, then everything reverses.
reset role;
select public.import_shipment_save_draft(
  null,
  '{"supplier_id": "00000000-0000-0000-02a2-0000000000d1", "currency_code": "AZN", "invoice_no": "INV-IMP2-2", "invoice_date": "2026-10-02", "invoice_rate": 1}',
  '[{"position": 0, "product_id": "00000000-0000-0000-02a2-000000000101", "qty_purchase_unit": 4, "qty_stock_unit": 4, "unit_price_fc": 5}]',
  '[{"position": 0, "cost_type": "labour", "amount": 8, "currency_code": "AZN", "rate_to_azn": 1, "is_capitalized": true, "split_method": "by_quantity", "paid_now": true, "cash_account_id": "00000000-0000-0000-02a2-0000000000c1"}]',
  '[{"cost_position": 0, "line_position": 0, "amount_azn": 8}]',
  '00000000-0000-0000-02a2-00000000000a');
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-02a2-00000000000a');
do $$
declare
  v_id uuid := (select id from public.import_shipments where invoice_no = 'INV-IMP2-2');
  v_cash numeric := (select balance from public.accounts where id = '00000000-0000-0000-02a2-0000000000c1');
  v_stock numeric;
  r jsonb;
begin
  perform public.confirm_import_shipment(v_id, null, 'imp2-s2-confirm');
  if (select balance from public.accounts where id = '00000000-0000-0000-02a2-0000000000c1') <> v_cash - 8 then raise exception 'FAIL s2 cash'; end if;
  v_stock := (select stock from public.products where id = '00000000-0000-0000-02a2-000000000101');
  r := public.receive_import_shipment(v_id, jsonb_build_array(jsonb_build_object(
    'shipment_line_id', (select id from public.import_shipment_lines where shipment_id = v_id), 'warehouse_id', '00000000-0000-0000-02a2-0000000000a2', 'qty_stock_unit', 4)), null, null, 'imp2-s2-recv');

  -- One unit used: cancel is refused.
  update public.inventory_batches set remaining_qty = 3 where document_id = (r ->> 'receipt_id')::uuid;
  begin
    perform public.cancel_import_shipment(v_id, 'wrong supplier', 'imp2-s2-cancel-refused');
    raise exception 'FAIL cancelled although stock was used';
  exception when others then if sqlerrm not like '%imports_stock_consumed%' then raise; end if;
  end;
  update public.inventory_batches set remaining_qty = 4 where document_id = (r ->> 'receipt_id')::uuid;

  perform public.cancel_import_shipment(v_id, 'wrong supplier', 'imp2-s2-cancel');
  if (select status from public.import_shipments where id = v_id) <> 'cancelled' then raise exception 'FAIL s2 not cancelled'; end if;
  if (select stock from public.products where id = '00000000-0000-0000-02a2-000000000101') <> v_stock then raise exception 'FAIL s2 stock not taken back'; end if;
  if (select balance from public.accounts where id = '00000000-0000-0000-02a2-0000000000c1') <> v_cash then raise exception 'FAIL s2 cash not restored'; end if;
  if exists (select 1 from public.inventory_batches where document_id = (r ->> 'receipt_id')::uuid) then raise exception 'FAIL s2 batch kept'; end if;
  foreach r in array array[to_jsonb('1360'::text), to_jsonb('2100'::text), to_jsonb('1300'::text), to_jsonb('1100'::text)] loop
    if pg_temp.coa_net(v_id, r #>> '{}') <> 0 then raise exception 'FAIL s2 % not reversed: %', r #>> '{}', pg_temp.coa_net(v_id, r #>> '{}'); end if;
  end loop;
  if exists (select 1 from public.journal_entries where document_id = v_id and reversal_of is null and reversed_by is null) then
    raise exception 'FAIL s2 has an entry that was not reversed';
  end if;
  if exists (select 1 from public.import_payables where shipment_id = v_id and status <> 'cancelled') then raise exception 'FAIL s2 payables open'; end if;
  perform pg_temp.assert_balanced(v_id);
end $$;

-- 9. A closed accounting period refuses the posting.
reset role;
insert into public.accounting_periods (period_year, period_month, status) values (2026, 1, 'closed')
on conflict (period_year, period_month) do update set status = 'closed';
select public.import_shipment_save_draft(
  null,
  '{"supplier_id": "00000000-0000-0000-02a2-0000000000d1", "currency_code": "AZN", "invoice_no": "INV-IMP2-3", "invoice_date": "2026-01-15", "invoice_rate": 1}',
  '[{"position": 0, "product_id": "00000000-0000-0000-02a2-000000000101", "qty_purchase_unit": 1, "qty_stock_unit": 1, "unit_price_fc": 5}]',
  '[]', '[]', '00000000-0000-0000-02a2-00000000000a');
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-02a2-00000000000a');
do $$
declare v_id uuid := (select id from public.import_shipments where invoice_no = 'INV-IMP2-3');
begin
  begin
    perform public.confirm_import_shipment(v_id, null, 'imp2-s3-confirm');
    raise exception 'FAIL posted into a closed period';
  exception when others then if sqlerrm not like '%bağlı maliyyə dövrünə%' then raise; end if;
  end;
  if (select status from public.import_shipments where id = v_id) <> 'draft' then raise exception 'FAIL s3 changed'; end if;
  -- Confirmed in an open month instead.
  perform public.confirm_import_shipment(v_id, '2026-10-03', 'imp2-s3-confirm-open');
end $$;
reset role;
update public.accounting_periods set status = 'open' where period_year = 2026 and period_month = 1;

-- 10. Internal helpers are not callable by users.
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-02a2-00000000000b');
do $$ begin
  begin
    perform public._imports_cash_out('00000000-0000-0000-02a2-0000000000c1', 1, 'x', null, 'x', null);
    raise exception 'FAIL a user called _imports_cash_out';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
select set_config('request.jwt.claims', '', false);

-- 11. Safe to run again.
\ir ../migrations/20261030110000_imports_posting.sql

select 'ALL CHECKS PASSED';
