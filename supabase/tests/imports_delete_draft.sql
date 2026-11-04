-- Checks supabase/migrations/20261103100000_imports_delete_draft.sql (UI-5: delete a draft import)
-- on a database built with scripts/db/build-fresh.sh --plain-postgres.
-- Any failed check raises an exception; the last line prints ALL CHECKS PASSED.
-- Leaves test rows behind: run it on a throwaway database only.

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-05d5-00000000000a', 'ui5-a@example.test', '{"full_name": "Aysel Admin", "role_name": "Admin"}'),
  ('00000000-0000-0000-05d5-00000000000b', 'ui5-b@example.test', '{"full_name": "Bəhruz Baxan"}')
on conflict (id) do nothing;
update public.profiles set is_active = true, role_id = (select id from public.roles where name = 'Admin' order by is_system desc limit 1)
where id = '00000000-0000-0000-05d5-00000000000a';
-- No role: may read nothing in imports and manage nothing.
update public.profiles set is_active = true, role_id = null where id = '00000000-0000-0000-05d5-00000000000b';

insert into public.suppliers (id, full_name, entity_type) values ('00000000-0000-0000-05d5-0000000000d1', 'UI5 Kronospan', 'legal')
on conflict (id) do nothing;
insert into public.warehouses (id, code, name, is_default, created_at) values ('00000000-0000-0000-05d5-0000000000a1', 'UI5-W1', 'UI5 anbar', false, now())
on conflict (id) do nothing;
insert into public.accounts (id, code, name, type, balance, is_vat_account) values
  ('00000000-0000-0000-05d5-0000000000c1', 'UI5-K', 'UI5 Kassa', 'cash', 100000, false)
on conflict (id) do nothing;
insert into public.products (id, code, name, stock, is_service, is_composite, inventory_mode, full_sheet_length_m, unit) values
  ('00000000-0000-0000-05d5-000000000101', 'UI5-P1', 'UI5 fittings', 0, false, false, 'standard', 4, 'Ədəd')
on conflict (id) do nothing;

create or replace function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', p), false);
$$;

-- USD drafts with one line and one capitalised cost (lines and costs cascade).
select public.import_shipment_save_draft(null,
  format('{"supplier_id": "00000000-0000-0000-05d5-0000000000d1", "currency_code": "USD", "invoice_no": "%s", "invoice_date": "2026-10-01", "invoice_rate": 1.7, "default_warehouse_id": "00000000-0000-0000-05d5-0000000000a1"}', n)::jsonb,
  '[{"position": 0, "product_id": "00000000-0000-0000-05d5-000000000101", "qty_purchase_unit": 10, "qty_stock_unit": 10, "unit_price_fc": 100}]',
  '[{"position": 0, "cost_type": "freight_international", "amount": 100, "currency_code": "USD", "rate_to_azn": 1.7, "is_capitalized": true, "split_method": "by_value"}]',
  '[]', '00000000-0000-0000-05d5-00000000000a')
from unnest(array['INV-UI5-PLAIN', 'INV-UI5-PREPAID', 'INV-UI5-OTHER']) n;
-- One more without a cost, to be confirmed (a cost needs its saved split before confirming).
select public.import_shipment_save_draft(null,
  '{"supplier_id": "00000000-0000-0000-05d5-0000000000d1", "currency_code": "USD", "invoice_no": "INV-UI5-CONFIRMED", "invoice_date": "2026-10-01", "invoice_rate": 1.7, "default_warehouse_id": "00000000-0000-0000-05d5-0000000000a1"}',
  '[{"position": 0, "product_id": "00000000-0000-0000-05d5-000000000101", "qty_purchase_unit": 10, "qty_stock_unit": 10, "unit_price_fc": 100}]',
  '[]', '[]', '00000000-0000-0000-05d5-00000000000a');

set role authenticated;
-- The admin for every block (each block's DECLARE reads under RLS before its body runs).
select pg_temp.as_user('00000000-0000-0000-05d5-00000000000a');

-- 1. A plain draft is deleted with its lines and costs; a second call says "not found".
do $$
declare
  v_id uuid := (select id from public.import_shipments where invoice_no = 'INV-UI5-PLAIN');
  r jsonb;
begin
  perform pg_temp.as_user('00000000-0000-0000-05d5-00000000000a');
  if (select count(*) from public.import_shipment_lines where shipment_id = v_id) <> 1 then raise exception 'FAIL setup: no line'; end if;
  if (select count(*) from public.import_cost_lines where shipment_id = v_id) <> 1 then raise exception 'FAIL setup: no cost'; end if;
  r := public.delete_import_draft(v_id);
  if (r ->> 'success')::boolean is not true or r ->> 'number' is null then raise exception 'FAIL delete answer %', r; end if;
  if exists (select 1 from public.import_shipments where id = v_id) then raise exception 'FAIL draft still there'; end if;
  if exists (select 1 from public.import_shipment_lines where shipment_id = v_id) then raise exception 'FAIL lines left behind'; end if;
  if exists (select 1 from public.import_cost_lines where shipment_id = v_id) then raise exception 'FAIL costs left behind'; end if;
  begin
    perform public.delete_import_draft(v_id);
    raise exception 'FAIL deleted twice';
  exception when others then if sqlerrm not like '%imports_not_found%' then raise; end if;
  end;
end $$;

-- 2. A draft with a supplier prepayment (cash, payment and journal posted) is never deleted:
--    not through the function, not by a direct delete; cancelling it still works and reverses it.
do $$
declare
  v_id uuid := (select id from public.import_shipments where invoice_no = 'INV-UI5-PREPAID');
  v_n int;
begin
  perform pg_temp.as_user('00000000-0000-0000-05d5-00000000000a');
  perform public.prepay_import_supplier(v_id, '2026-10-02', 'avans', 100, 1.7,
    '[{"account_id": "00000000-0000-0000-05d5-0000000000c1", "amount": 170}]', 'ui5-prepay-1');
  if not public.import_shipment_has_postings(v_id) then raise exception 'FAIL prepayment not seen as a posting'; end if;
  begin
    perform public.delete_import_draft(v_id);
    raise exception 'FAIL a prepaid draft was deleted';
  exception when others then if sqlerrm not like '%imports_delete_has_postings%' then raise; end if;
  end;
  delete from public.import_shipments where id = v_id;
  get diagnostics v_n = row_count;
  if v_n <> 0 then raise exception 'FAIL the delete policy let a prepaid draft go'; end if;
  if not exists (select 1 from public.import_prepayments where shipment_id = v_id) then raise exception 'FAIL prepayment lost'; end if;
  perform public.cancel_import_shipment(v_id, 'wrong supplier', 'ui5-cancel-prepaid');
  if (select status from public.import_shipments where id = v_id) <> 'cancelled' then raise exception 'FAIL not cancelled'; end if;
  if exists (select 1 from public.import_prepayments where shipment_id = v_id and status <> 'cancelled') then raise exception 'FAIL prepayment not reversed'; end if;
end $$;

-- 3. A confirmed import is cancelled, never deleted.
do $$
declare
  v_id uuid := (select id from public.import_shipments where invoice_no = 'INV-UI5-CONFIRMED');
  v_n int;
begin
  perform pg_temp.as_user('00000000-0000-0000-05d5-00000000000a');
  perform public.confirm_import_shipment(v_id, null, 'ui5-confirm');
  begin
    perform public.delete_import_draft(v_id);
    raise exception 'FAIL a confirmed import was deleted';
  exception when others then if sqlerrm not like '%imports_delete_draft_only%' then raise; end if;
  end;
  delete from public.import_shipments where id = v_id;
  get diagnostics v_n = row_count;
  if v_n <> 0 then raise exception 'FAIL the delete policy let a confirmed import go'; end if;
end $$;

-- 4. Without the imports manage right nothing is deleted.
do $$
declare
  v_id uuid := (select id from public.import_shipments where invoice_no = 'INV-UI5-OTHER');
begin
  perform pg_temp.as_user('00000000-0000-0000-05d5-00000000000b');
  begin
    perform public.delete_import_draft(v_id);
    raise exception 'FAIL deleted without the right';
  exception when others then if sqlerrm like 'FAIL%' then raise; end if;
  end;
  perform pg_temp.as_user('00000000-0000-0000-05d5-00000000000a');
  if not exists (select 1 from public.import_shipments where id = v_id) then raise exception 'FAIL draft gone'; end if;
end $$;

select 'ALL CHECKS PASSED';
