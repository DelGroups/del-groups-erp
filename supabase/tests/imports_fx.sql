-- Checks supabase/migrations/20261030120000_imports_fx.sql (Imports module, IMP-3: exchange
-- differences and supplier prepayments) on a database built with
-- scripts/db/build-fresh.sh --plain-postgres (CI: .github/workflows/db-baseline.yml).
-- Any failed check raises an exception; the last line prints ALL CHECKS PASSED.
-- Leaves test rows behind: run it on a throwaway database only.

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-03a3-00000000000a', 'imp3-a@example.test', '{"full_name": "Aysel Admin", "role_name": "Admin"}')
on conflict (id) do nothing;
update public.profiles set is_active = true, role_id = (select id from public.roles where name = 'Admin' order by is_system desc limit 1)
where id = '00000000-0000-0000-03a3-00000000000a';

insert into public.suppliers (id, full_name, entity_type) values ('00000000-0000-0000-03a3-0000000000d1', 'IMP3 Kronospan', 'legal')
on conflict (id) do nothing;
insert into public.warehouses (id, code, name, is_default, created_at) values ('00000000-0000-0000-03a3-0000000000a1', 'IMP3-W1', 'IMP3 anbar', false, now())
on conflict (id) do nothing;
insert into public.accounts (id, code, name, type, balance, is_vat_account) values
  ('00000000-0000-0000-03a3-0000000000c1', 'IMP3-K', 'IMP3 Kassa', 'cash', 100000, false),
  ('00000000-0000-0000-03a3-0000000000c2', 'IMP3-B', 'IMP3 Bank', 'bank', 100000, false)
on conflict (id) do nothing;
insert into public.products (id, code, name, stock, is_service, is_composite, inventory_mode, full_sheet_length_m, unit) values
  ('00000000-0000-0000-03a3-000000000101', 'IMP3-P1', 'IMP3 fittings', 0, false, false, 'standard', 4, 'Ədəd')
on conflict (id) do nothing;

create or replace function pg_temp.as_admin() returns void language sql as $$
  select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-03a3-00000000000a","role":"authenticated"}', false);
$$;
create or replace function pg_temp.coa_net(p_shipment uuid, p_code text) returns numeric language sql security definer as $$
  select coalesce(sum(jl.debit - jl.credit), 0)
  from public.journal_entries je join public.journal_entry_lines jl on jl.journal_entry_id = je.id
  join public.chart_of_accounts c on c.id = jl.coa_id
  where je.document_id = p_shipment and c.code = p_code;
$$;
create or replace function pg_temp.assert_balanced(p_shipment uuid) returns void language plpgsql security definer as $$
declare r record;
begin
  for r in
    select je.id, sum(jl.debit) d, sum(jl.credit) c
    from public.journal_entries je join public.journal_entry_lines jl on jl.journal_entry_id = je.id
    where je.document_id = p_shipment group by je.id
  loop
    if abs(r.d - r.c) > 0.001 then raise exception 'FAIL entry % not balanced: % / %', r.id, r.d, r.c; end if;
  end loop;
end $$;

-- Three USD shipments, 10 × 100 USD at 1.70 = 1,700 AZN each, no costs.
select public.import_shipment_save_draft(null,
  format('{"supplier_id": "00000000-0000-0000-03a3-0000000000d1", "currency_code": "USD", "invoice_no": "%s", "invoice_date": "2026-10-01", "invoice_rate": 1.7, "default_warehouse_id": "00000000-0000-0000-03a3-0000000000a1"}', n)::jsonb,
  '[{"position": 0, "product_id": "00000000-0000-0000-03a3-000000000101", "qty_purchase_unit": 10, "qty_stock_unit": 10, "unit_price_fc": 100}]',
  '[]', '[]', '00000000-0000-0000-03a3-00000000000a')
from unnest(array['INV-IMP3-1', 'INV-IMP3-2', 'INV-IMP3-3']) n;

set role authenticated;
select pg_temp.as_admin();

-- 1. Partial payments at other rates: a loss, then a gain; 2100 ends at zero.
do $$
declare
  v_id uuid := (select id from public.import_shipments where invoice_no = 'INV-IMP3-1');
  v_pay uuid;
  r jsonb;
begin
  perform public.confirm_import_shipment(v_id, null, 'imp3-s1-confirm');
  v_pay := (select id from public.import_payables where shipment_id = v_id and source = 'goods');
  if pg_temp.coa_net(v_id, '2100') <> -1700 then raise exception 'FAIL payable booked at %', pg_temp.coa_net(v_id, '2100'); end if;

  begin
    perform public.pay_import_payable(v_pay, '2026-10-10', null, '[{"account_id": "00000000-0000-0000-03a3-0000000000c1", "amount": 700}]', 'imp3-no-fx');
    raise exception 'FAIL a USD debt paid without amount and rate';
  exception when others then if sqlerrm not like '%imports_fx_required%' then raise; end if;
  end;
  begin
    perform public.pay_import_payable(v_pay, '2026-10-10', null, '[{"account_id": "00000000-0000-0000-03a3-0000000000c1", "amount": 690}]', 'imp3-mismatch', 400, 1.75);
    raise exception 'FAIL splits not matching amount × rate';
  exception when others then if sqlerrm not like '%imports_splits_mismatch%' then raise; end if;
  end;
  begin
    perform public.pay_import_payable(v_pay, '2026-10-10', null, '[{"account_id": "00000000-0000-0000-03a3-0000000000c1", "amount": 1753.5}]', 'imp3-over', 1002, 1.75);
    raise exception 'FAIL paid more USD than owed';
  exception when others then if sqlerrm not like '%imports_overpay%' then raise; end if;
  end;

  -- 400 USD at 1.75 = 700 AZN; booked 400 × 1.70 = 680 → loss 20 (6260).
  r := public.pay_import_payable(v_pay, '2026-10-10', 'first',
    '[{"account_id": "00000000-0000-0000-03a3-0000000000c1", "amount": 500}, {"account_id": "00000000-0000-0000-03a3-0000000000c2", "amount": 200}]',
    'imp3-pay-1', 400, 1.75);
  if (r ->> 'settled_azn')::numeric <> 680 or (r ->> 'fx_difference_azn')::numeric <> 20 then raise exception 'FAIL first payment %', r; end if;
  if (r ->> 'remaining_fc')::numeric <> 600 or (r ->> 'remaining_azn')::numeric <> 1020 then raise exception 'FAIL running balance %', r; end if;
  if pg_temp.coa_net(v_id, '6260') <> 20 then raise exception 'FAIL loss on 6260 %', pg_temp.coa_net(v_id, '6260'); end if;
  if (public.pay_import_payable(v_pay, '2026-10-10', null, '[]', 'imp3-pay-1') ->> 'payment_id') is distinct from r ->> 'payment_id' then
    raise exception 'FAIL payment not idempotent';
  end if;

  -- The remaining 600 USD at 1.65 = 990 AZN; the open 1,020 AZN is relieved → gain 30 (4960).
  r := public.pay_import_payable(v_pay, '2026-10-20', 'rest',
    '[{"account_id": "00000000-0000-0000-03a3-0000000000c2", "amount": 990}]', 'imp3-pay-2', 600, 1.65);
  if (r ->> 'settled_azn')::numeric <> 1020 or (r ->> 'fx_difference_azn')::numeric <> -30 then raise exception 'FAIL second payment %', r; end if;
  if pg_temp.coa_net(v_id, '4960') <> -30 then raise exception 'FAIL gain on 4960 %', pg_temp.coa_net(v_id, '4960'); end if;
  if pg_temp.coa_net(v_id, '2100') <> 0 then raise exception 'FAIL 2100 not cleared: %', pg_temp.coa_net(v_id, '2100'); end if;
  if (select status from public.import_payables where id = v_pay) <> 'paid' or (select paid_fc from public.import_payables where id = v_pay) <> 1000 then
    raise exception 'FAIL payable not paid in full';
  end if;
  if (select count(*) from public.import_payments where payable_id = v_pay and currency_code = 'USD' and payment_rate in (1.75, 1.65)) <> 2 then
    raise exception 'FAIL payments do not keep amount and rate';
  end if;
  perform pg_temp.assert_balanced(v_id);
end $$;

-- 2. Prepayment before the invoice: the prepaid part at its own rate, no exchange difference.
do $$
declare
  v_id uuid := (select id from public.import_shipments where invoice_no = 'INV-IMP3-2');
  v_pay uuid;
  r jsonb;
begin
  -- 300 USD at 1.60 = 480 AZN while the shipment is a draft: Dr 2100 (a debit balance).
  r := public.prepay_import_supplier(v_id, '2026-09-20', 'advance', 300, 1.6,
    '[{"account_id": "00000000-0000-0000-03a3-0000000000c1", "amount": 480}]', 'imp3-prepay-1');
  if pg_temp.coa_net(v_id, '2100') <> 480 then raise exception 'FAIL prepayment not a debit on 2100: %', pg_temp.coa_net(v_id, '2100'); end if;
  if (public.prepay_import_supplier(v_id, '2026-09-20', null, 300, 1.6, '[]', 'imp3-prepay-1') ->> 'prepayment_id') is distinct from r ->> 'prepayment_id' then
    raise exception 'FAIL prepayment not idempotent';
  end if;

  -- Confirm: 300 USD at 1.60 + 700 USD at 1.70 = 1,670 AZN of goods.
  perform public.confirm_import_shipment(v_id, null, 'imp3-s2-confirm');
  if (select goods_rate_azn from public.import_shipments where id = v_id) <> 1.67 then raise exception 'FAIL effective goods rate'; end if;
  if pg_temp.coa_net(v_id, '1360') <> 1670 then raise exception 'FAIL goods in transit %', pg_temp.coa_net(v_id, '1360'); end if;
  if pg_temp.coa_net(v_id, '2100') <> -1190 then raise exception 'FAIL open payable after the prepayment %', pg_temp.coa_net(v_id, '2100'); end if;
  v_pay := (select id from public.import_payables where shipment_id = v_id and source = 'goods');
  if (select paid_fc from public.import_payables where id = v_pay) <> 300 or (select paid_azn from public.import_payables where id = v_pay) <> 480 then
    raise exception 'FAIL prepayment not applied to the payable';
  end if;
  if (select status from public.import_prepayments where shipment_id = v_id) <> 'applied' then raise exception 'FAIL prepayment not marked applied'; end if;
  if pg_temp.coa_net(v_id, '6260') <> 0 or pg_temp.coa_net(v_id, '4960') <> 0 then raise exception 'FAIL exchange difference on a prepaid part'; end if;

  begin
    perform public.prepay_import_supplier(v_id, '2026-10-05', null, 10, 1.7, '[{"account_id": "00000000-0000-0000-03a3-0000000000c1", "amount": 17}]', 'imp3-prepay-late');
    raise exception 'FAIL a prepayment after confirmation';
  exception when others then if sqlerrm not like '%imports_prepay_draft_only%' then raise; end if;
  end;

  -- The rest at the invoice rate: no difference; 2100 clear.
  r := public.pay_import_payable(v_pay, '2026-10-05', null, '[{"account_id": "00000000-0000-0000-03a3-0000000000c2", "amount": 1190}]', 'imp3-s2-pay', 700, 1.7);
  if (r ->> 'fx_difference_azn')::numeric <> 0 then raise exception 'FAIL difference on the rest %', r; end if;
  if pg_temp.coa_net(v_id, '2100') <> 0 then raise exception 'FAIL 2100 after the rest %', pg_temp.coa_net(v_id, '2100'); end if;

  -- Received at the effective rate: goods in transit closes at zero.
  perform public.receive_import_shipment(v_id, jsonb_build_array(jsonb_build_object(
    'shipment_line_id', (select id from public.import_shipment_lines where shipment_id = v_id), 'warehouse_id', '00000000-0000-0000-03a3-0000000000a1', 'qty_stock_unit', 10)), '2026-10-06', null, 'imp3-s2-recv');
  if pg_temp.coa_net(v_id, '1360') <> 0 then raise exception 'FAIL 1360 after receipt %', pg_temp.coa_net(v_id, '1360'); end if;
  if (select unit_cost from public.inventory_batches where product_id = '00000000-0000-0000-03a3-000000000101' and document_type = 'import' order by created_at desc limit 1) <> 167 then
    raise exception 'FAIL stock not at the effective goods value';
  end if;
  perform public.close_import_shipment(v_id, 'imp3-s2-close');
  perform pg_temp.assert_balanced(v_id);
end $$;

-- 3. A prepayment larger than the goods is refused at confirmation; cancelling returns it.
do $$
declare
  v_id uuid := (select id from public.import_shipments where invoice_no = 'INV-IMP3-3');
  v_cash numeric := (select balance from public.accounts where id = '00000000-0000-0000-03a3-0000000000c1');
begin
  perform public.prepay_import_supplier(v_id, '2026-09-25', null, 1200, 1.7, '[{"account_id": "00000000-0000-0000-03a3-0000000000c1", "amount": 2040}]', 'imp3-s3-prepay');
  if (select balance from public.accounts where id = '00000000-0000-0000-03a3-0000000000c1') <> v_cash - 2040 then raise exception 'FAIL prepayment cash'; end if;
  begin
    perform public.confirm_import_shipment(v_id, null, 'imp3-s3-confirm');
    raise exception 'FAIL confirmed with a prepayment above the goods';
  exception when others then if sqlerrm not like '%imports_prepayment_exceeds%' then raise; end if;
  end;
  perform public.cancel_import_shipment(v_id, 'wrong order', 'imp3-s3-cancel');
  if (select balance from public.accounts where id = '00000000-0000-0000-03a3-0000000000c1') <> v_cash then raise exception 'FAIL prepayment not returned'; end if;
  if (select status from public.import_prepayments where shipment_id = v_id) <> 'cancelled' then raise exception 'FAIL prepayment not cancelled'; end if;
  if pg_temp.coa_net(v_id, '2100') <> 0 then raise exception 'FAIL 2100 after cancel %', pg_temp.coa_net(v_id, '2100'); end if;
end $$;

-- 4. A payment in a closed period is refused.
reset role;
insert into public.accounting_periods (period_year, period_month, status) values (2026, 2, 'closed')
on conflict (period_year, period_month) do update set status = 'closed';
select public.import_shipment_save_draft(null,
  '{"supplier_id": "00000000-0000-0000-03a3-0000000000d1", "currency_code": "USD", "invoice_no": "INV-IMP3-4", "invoice_date": "2026-01-10", "invoice_rate": 1.7}',
  '[{"position": 0, "product_id": "00000000-0000-0000-03a3-000000000101", "qty_purchase_unit": 1, "qty_stock_unit": 1, "unit_price_fc": 10}]',
  '[]', '[]', '00000000-0000-0000-03a3-00000000000a');
set role authenticated;
select pg_temp.as_admin();
do $$
declare v_id uuid := (select id from public.import_shipments where invoice_no = 'INV-IMP3-4');
begin
  perform public.confirm_import_shipment(v_id, null, 'imp3-s4-confirm');
  begin
    perform public.pay_import_payable((select id from public.import_payables where shipment_id = v_id), '2026-02-10', null,
      '[{"account_id": "00000000-0000-0000-03a3-0000000000c1", "amount": 17}]', 'imp3-s4-pay', 10, 1.7);
    raise exception 'FAIL paid in a closed period';
  exception when others then if sqlerrm not like '%bağlı maliyyə dövrünə%' then raise; end if;
  end;
end $$;
reset role;
update public.accounting_periods set status = 'open' where period_year = 2026 and period_month = 2;
select set_config('request.jwt.claims', '', false);

-- 5. Safe to run again.
\ir ../migrations/20261030120000_imports_fx.sql

select 'ALL CHECKS PASSED';
