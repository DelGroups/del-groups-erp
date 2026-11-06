-- Checks supabase/migrations/20261106100000_imports_duty_override.sql (IMP-6) on a database built with
-- scripts/db/build-fresh.sh --plain-postgres: a customs duty typed from the declaration is stored
-- with amount_typed, survives a second save, is what confirm posts and receive values, and a late
-- typed duty keeps the mark. Any failed check raises an exception; the last line prints
-- ALL CHECKS PASSED. Leaves test rows behind: run it on a throwaway database only.
--
-- Three lines, invoice rate 1: 1,000 / 2,000 / 3,000 AZN at 5 % / 5 % / 10 % duty. Computed duty
-- 50 + 100 + 300 = 450; the declaration says 500 → 55.56 / 111.11 / 333.33 (the form's split).
-- Landed 6,000 + 500 = 6,500 on 1360 at confirm.

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0e06-00000000000a', 'imp6-a@example.test', '{"full_name": "Aysel Admin", "role_name": "Admin"}')
on conflict (id) do nothing;
update public.profiles set is_active = true, role_id = (select id from public.roles where name = 'Admin' order by is_system desc limit 1)
where id = '00000000-0000-0000-0e06-00000000000a';

insert into public.suppliers (id, full_name, entity_type) values
  ('00000000-0000-0000-0e06-0000000000d1', 'IMP6 Supplier', 'legal'),
  ('00000000-0000-0000-0e06-0000000000d3', 'IMP6 Gömrük', 'legal')
on conflict (id) do nothing;
insert into public.warehouses (id, code, name, is_default, created_at) values
  ('00000000-0000-0000-0e06-0000000000a1', 'IMP6-W1', 'IMP6 Bakı', false, now())
on conflict (id) do nothing;
insert into public.products (id, code, name, stock, is_service, is_composite, unit) values
  ('00000000-0000-0000-0e06-000000000101', 'IMP6-A', 'IMP6 A', 0, false, false, 'ədəd'),
  ('00000000-0000-0000-0e06-000000000102', 'IMP6-B', 'IMP6 B', 0, false, false, 'ədəd'),
  ('00000000-0000-0000-0e06-000000000103', 'IMP6-C', 'IMP6 C', 0, false, false, 'ədəd')
on conflict (id) do nothing;

create or replace function pg_temp.as_user(p uuid) returns void language sql as $$
  select set_config('request.jwt.claims', format('{"sub":"%s","role":"authenticated"}', p), false);
$$;
create or replace function pg_temp.coa_net(p_shipment uuid, p_code text) returns numeric language sql security definer as $$
  select coalesce(sum(jl.debit - jl.credit), 0)
  from public.journal_entries je join public.journal_entry_lines jl on jl.journal_entry_id = je.id
  join public.chart_of_accounts c on c.id = jl.coa_id
  where je.document_id = p_shipment and c.code = p_code;
$$;

create temp table imp6_payload as select
  '{"supplier_id": "00000000-0000-0000-0e06-0000000000d1", "currency_code": "AZN", "invoice_no": "INV-IMP6-1", "invoice_date": "2026-11-05", "invoice_rate": 1, "default_warehouse_id": "00000000-0000-0000-0e06-0000000000a1"}'::jsonb as header,
  '[{"position": 0, "product_id": "00000000-0000-0000-0e06-000000000101", "qty_purchase_unit": 1, "qty_stock_unit": 1, "unit_price_fc": 1000, "duty_rate_pct": 5},
    {"position": 1, "product_id": "00000000-0000-0000-0e06-000000000102", "qty_purchase_unit": 1, "qty_stock_unit": 1, "unit_price_fc": 2000, "duty_rate_pct": 5},
    {"position": 2, "product_id": "00000000-0000-0000-0e06-000000000103", "qty_purchase_unit": 1, "qty_stock_unit": 1, "unit_price_fc": 3000, "duty_rate_pct": 10}]'::jsonb as lines,
  '[{"position": 0, "cost_type": "customs_duty", "partner_id": "00000000-0000-0000-0e06-0000000000d3", "amount": 500, "amount_typed": true, "currency_code": "AZN", "rate_to_azn": 1, "is_capitalized": true, "split_method": "per_line_duty"}]'::jsonb as costs,
  '[{"cost_position": 0, "line_position": 0, "amount_azn": 55.56}, {"cost_position": 0, "line_position": 1, "amount_azn": 111.11}, {"cost_position": 0, "line_position": 2, "amount_azn": 333.33}]'::jsonb as allocations;

create temp table ids (k text primary key, id uuid);
grant all on ids to authenticated;

-- 1. The draft, saved as the form does (service role, like the server action), then saved again.
do $$
declare
  p record;
  v_ship uuid;
  v_cost public.import_cost_lines;
begin
  select * into p from imp6_payload;
  v_ship := (public.import_shipment_save_draft(null, p.header, p.lines, p.costs, p.allocations, '00000000-0000-0000-0e06-00000000000a') ->> 'id')::uuid;
  insert into ids values ('ship', v_ship);
  select * into v_cost from public.import_cost_lines where shipment_id = v_ship;
  if v_cost.amount <> 500 or not v_cost.amount_typed then raise exception 'FAIL typed duty not stored: %', row_to_json(v_cost); end if;
  if (select sum(amount_azn) from public.import_cost_allocations where cost_line_id = v_cost.id) <> 500 then raise exception 'FAIL allocations do not add up to 500'; end if;

  -- A second save keeps the typed duty (nothing recomputes it in the database).
  perform public.import_shipment_save_draft(v_ship, p.header, p.lines, jsonb_set(p.costs, '{0,id}', to_jsonb(v_cost.id::text)), p.allocations, '00000000-0000-0000-0e06-00000000000a');
  select * into v_cost from public.import_cost_lines where shipment_id = v_ship;
  if v_cost.amount <> 500 or not v_cost.amount_typed then raise exception 'FAIL second save lost the typed duty'; end if;

  -- Computed (no amount_typed in the payload, like an older client): stored as computed.
  perform public.import_shipment_save_draft(v_ship, p.header, p.lines,
    jsonb_set(p.costs #- '{0,amount_typed}', '{0,amount}', '450'),
    '[{"cost_position": 0, "line_position": 0, "amount_azn": 50}, {"cost_position": 0, "line_position": 1, "amount_azn": 100}, {"cost_position": 0, "line_position": 2, "amount_azn": 300}]',
    '00000000-0000-0000-0e06-00000000000a');
  if (select amount_typed from public.import_cost_lines where shipment_id = v_ship) then raise exception 'FAIL computed duty stored as typed'; end if;

  -- The mark only counts on a duty split per line.
  perform public.import_shipment_save_draft(v_ship, p.header, p.lines,
    jsonb_set(p.costs, '{0,split_method}', '"by_value"'), p.allocations, '00000000-0000-0000-0e06-00000000000a');
  if (select amount_typed from public.import_cost_lines where shipment_id = v_ship) then raise exception 'FAIL amount_typed kept on by_value'; end if;
  begin
    update public.import_cost_lines set amount_typed = true where shipment_id = v_ship;
    raise exception 'FAIL check constraint missing';
  exception when check_violation then null;
  end;

  -- Back to the typed duty for the posting checks.
  perform public.import_shipment_save_draft(v_ship, p.header, p.lines, p.costs, p.allocations, '00000000-0000-0000-0e06-00000000000a');
  if not (select amount_typed from public.import_cost_lines where shipment_id = v_ship) then raise exception 'FAIL typed duty not restored'; end if;
end $$;

-- 2. Confirm posts the typed duty (500, not the computed 450); receiving values the lines with it.
set role authenticated;
select pg_temp.as_user('00000000-0000-0000-0e06-00000000000a');
do $$
declare
  v_ship uuid := (select id from ids where k = 'ship');
  r jsonb;
begin
  perform public.confirm_import_shipment(v_ship, '2026-11-05', 'imp6-confirm');
  if pg_temp.coa_net(v_ship, '1360') <> 6500 then raise exception 'FAIL 1360 after confirm: % (want 6,500)', pg_temp.coa_net(v_ship, '1360'); end if;
  if (select amount_azn from public.import_payables where shipment_id = v_ship and source <> 'goods' and status <> 'cancelled') <> 500 then
    raise exception 'FAIL duty payable is not 500';
  end if;
  r := public.receive_import_shipment(v_ship, (
      select jsonb_agg(jsonb_build_object('shipment_line_id', l.id, 'warehouse_id', '00000000-0000-0000-0e06-0000000000a1', 'qty_stock_unit', 1) order by l.position)
      from public.import_shipment_lines l where l.shipment_id = v_ship),
    '2026-11-05', null, 'imp6-recv');
  if (r ->> 'value_azn')::numeric <> 6500 then raise exception 'FAIL receipt value % (want 6,500)', r ->> 'value_azn'; end if;
  if pg_temp.coa_net(v_ship, '1360') <> 0 then raise exception 'FAIL 1360 after receipt: %', pg_temp.coa_net(v_ship, '1360'); end if;

  -- 3. A late typed duty (add_import_cost → _imports_cost_from_json) keeps the mark; the stock is trued up.
  perform public.add_import_cost(v_ship, jsonb_build_object('cost_type', 'customs_duty', 'partner_id', '00000000-0000-0000-0e06-0000000000d3',
    'description', 'Əlavə rüsum', 'amount', 30, 'amount_typed', true, 'currency_code', 'AZN', 'is_capitalized', true, 'split_method', 'per_line_duty',
    'allocations', (select jsonb_agg(jsonb_build_object('shipment_line_id', l.id, 'amount_azn', case l.position when 0 then 3.33 when 1 then 6.67 else 20 end))
                    from public.import_shipment_lines l where l.shipment_id = v_ship)), null, '2026-11-06', 'imp6-late');
end $$;
reset role;
do $$
declare v_ship uuid := (select id from ids where k = 'ship');
begin
  if not (select amount_typed from public.import_cost_lines where shipment_id = v_ship and description = 'Əlavə rüsum') then
    raise exception 'FAIL late typed duty lost the mark';
  end if;
  if (select sum(a.amount_azn) from public.import_cost_allocations a join public.import_cost_lines c on c.id = a.cost_line_id
      where c.shipment_id = v_ship and c.description = 'Əlavə rüsum') <> 30 then raise exception 'FAIL late duty allocations'; end if;
  -- Received in full before the late duty: all 30 goes to stock (1300), nothing stays on 1360.
  if pg_temp.coa_net(v_ship, '1360') <> 0 then raise exception 'FAIL 1360 after the late duty: %', pg_temp.coa_net(v_ship, '1360'); end if;
  if pg_temp.coa_net(v_ship, '1300') <> 6530 then raise exception 'FAIL 1300 after the late duty: % (want 6,530)', pg_temp.coa_net(v_ship, '1300'); end if;
end $$;

select set_config('request.jwt.claims', '', false);
select 'ALL CHECKS PASSED';
