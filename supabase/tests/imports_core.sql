-- Checks supabase/migrations/20261030100000_imports_core.sql (Imports module, IMP-1) on a database
-- built with scripts/db/build-fresh.sh --plain-postgres (CI: .github/workflows/db-baseline.yml).
-- Any failed check raises an exception; the last line prints ALL CHECKS PASSED.
-- Leaves test rows behind: run it on a throwaway database only.

-- Users: A admin; M manages imports (and sees money); V views with money; N views without money;
-- X has the matrix checkbox only (imports.view) plus money; S has nothing.
insert into public.roles (id, name, permissions) values
  ('00000000-0000-0000-01a1-0000000000f1', 'IMP manager', '{"can_view_imports": true, "can_manage_imports": true, "can_view_financials": true}'),
  ('00000000-0000-0000-01a1-0000000000f2', 'IMP viewer', '{"can_view_imports": true, "can_view_financials": true}'),
  ('00000000-0000-0000-01a1-0000000000f3', 'IMP no money', '{"can_view_imports": true}'),
  ('00000000-0000-0000-01a1-0000000000f4', 'IMP matrix', '{"_matrix": {"imports": {"view": true}}, "can_view_financials": true}'),
  ('00000000-0000-0000-01a1-0000000000f5', 'IMP nothing', '{"can_view_sales": true}')
on conflict (id) do nothing;

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-01a1-00000000000a', 'imp-a@example.test', '{"full_name": "Aysel Admin", "role_name": "Admin"}'),
  ('00000000-0000-0000-01a1-00000000000b', 'imp-m@example.test', '{"full_name": "Murad Manager"}'),
  ('00000000-0000-0000-01a1-00000000000c', 'imp-v@example.test', '{"full_name": "Vüsal Viewer"}'),
  ('00000000-0000-0000-01a1-00000000000d', 'imp-n@example.test', '{"full_name": "Nigar NoMoney"}'),
  ('00000000-0000-0000-01a1-00000000000e', 'imp-x@example.test', '{"full_name": "Xəyal Matrix"}'),
  ('00000000-0000-0000-01a1-00000000000f', 'imp-s@example.test', '{"full_name": "Samir Stranger"}')
on conflict (id) do nothing;
update public.profiles set is_active = true, role_id = case id
    when '00000000-0000-0000-01a1-00000000000a' then (select id from public.roles where name = 'Admin' order by is_system desc limit 1)
    when '00000000-0000-0000-01a1-00000000000b' then '00000000-0000-0000-01a1-0000000000f1'::uuid
    when '00000000-0000-0000-01a1-00000000000c' then '00000000-0000-0000-01a1-0000000000f2'::uuid
    when '00000000-0000-0000-01a1-00000000000d' then '00000000-0000-0000-01a1-0000000000f3'::uuid
    when '00000000-0000-0000-01a1-00000000000e' then '00000000-0000-0000-01a1-0000000000f4'::uuid
    else '00000000-0000-0000-01a1-0000000000f5'::uuid end
where id::text like '00000000-0000-0000-01a1-%';

insert into public.suppliers (id, full_name, entity_type) values
  ('00000000-0000-0000-01a1-0000000000d1', 'IMP Kronospan', 'legal'),
  ('00000000-0000-0000-01a1-0000000000d2', 'IMP Gömrük', 'legal')
on conflict (id) do nothing;
insert into public.products (id, code, name, stock, is_service, is_composite, inventory_mode, full_sheet_length_m) values
  ('00000000-0000-0000-01a1-000000000101', 'IMP-PLY', 'IMP plywood', 0, false, false, 'polywood', 4),
  ('00000000-0000-0000-01a1-000000000102', 'IMP-EDGE', 'IMP edge band', 0, false, false, 'standard', 4)
on conflict (id) do nothing;

-- 1. Currencies and the rate key.
do $$
begin
  if (select count(*) from public.currencies where code in ('AZN', 'USD', 'EUR', 'TRY', 'CNY', 'RUB')) <> 6 then
    raise exception 'FAIL currencies not seeded';
  end if;
  insert into public.exchange_rates (currency_code, rate_date, rate_to_azn, source) values ('USD', '2026-10-29', 1.7, 'cbar');
  insert into public.exchange_rates (currency_code, rate_date, rate_to_azn, source) values ('USD', '2026-10-29', 1.71, 'manual');
  begin
    insert into public.exchange_rates (currency_code, rate_date, rate_to_azn, source) values ('USD', '2026-10-29', 1.72, 'cbar');
    raise exception 'FAIL a second cbar rate for the same day';
  exception when unique_violation then null;
  end;
  begin
    insert into public.exchange_rates (currency_code, rate_date, rate_to_azn, source) values ('USD', '2026-10-30', 0, 'cbar');
    raise exception 'FAIL a zero rate was stored';
  exception when check_violation then null;
  end;
end $$;

-- 2. Saving a draft in one call: number, creator, lines, costs, split.
do $$
declare
  v jsonb;
  v_id uuid;
  v_year text := extract(year from current_date)::text;
begin
  v := public.import_shipment_save_draft(
    null,
    '{"supplier_id": "00000000-0000-0000-01a1-0000000000d1", "currency_code": "USD", "invoice_no": "INV-1", "invoice_rate": 1.7}',
    '[{"position": 0, "product_id": "00000000-0000-0000-01a1-000000000101", "qty_purchase_unit": 100, "qty_stock_unit": 400, "unit_price_fc": 25, "weight_kg": 3000, "duty_rate_pct": 5},
      {"position": 1, "product_id": "00000000-0000-0000-01a1-000000000102", "qty_purchase_unit": 20, "qty_stock_unit": 4000, "unit_price_fc": 40, "weight_kg": 100, "duty_rate_pct": 5}]',
    '[{"position": 0, "cost_type": "freight_international", "amount": 600, "currency_code": "USD", "rate_to_azn": 1.7, "is_capitalized": true, "split_method": "by_weight"},
      {"position": 1, "cost_type": "freight_local", "amount": 300, "currency_code": "AZN", "rate_to_azn": 1, "vat_amount_azn": 54, "is_capitalized": true, "split_method": "by_weight", "partner_id": "00000000-0000-0000-01a1-0000000000d2"}]',
    '[{"cost_position": 0, "line_position": 0, "amount_azn": 989.8}, {"cost_position": 0, "line_position": 1, "amount_azn": 30.2},
      {"cost_position": 1, "line_position": 0, "amount_azn": 291.11}, {"cost_position": 1, "line_position": 1, "amount_azn": 8.89}]',
    '00000000-0000-0000-01a1-00000000000b');
  v_id := (v ->> 'id')::uuid;
  if v ->> 'number' !~ ('^IMP-' || v_year || '-\d{4}$') then raise exception 'FAIL number %', v ->> 'number'; end if;
  if (select created_by from public.import_shipments where id = v_id) is distinct from '00000000-0000-0000-01a1-00000000000b' then
    raise exception 'FAIL created_by is not the actor';
  end if;
  if (select status from public.import_shipments where id = v_id) <> 'draft' then raise exception 'FAIL not a draft'; end if;
  if (select count(*) from public.import_shipment_lines where shipment_id = v_id) <> 2 then raise exception 'FAIL lines not saved'; end if;
  if (select count(*) from public.import_cost_allocations a join public.import_cost_lines c on c.id = a.cost_line_id where c.shipment_id = v_id) <> 4 then
    raise exception 'FAIL allocations not saved';
  end if;
  if (select sum(a.amount_azn) from public.import_cost_allocations a join public.import_cost_lines c on c.id = a.cost_line_id where c.shipment_id = v_id and c.position = 0) <> 1020 then
    raise exception 'FAIL freight allocations do not add up';
  end if;

  -- Saving again replaces the children; the number and the creator stay.
  v := public.import_shipment_save_draft(
    v_id,
    '{"supplier_id": "00000000-0000-0000-01a1-0000000000d1", "currency_code": "USD", "invoice_no": "INV-1b", "invoice_rate": 1.7}',
    '[{"position": 0, "product_id": "00000000-0000-0000-01a1-000000000101", "qty_purchase_unit": 10, "qty_stock_unit": 40, "unit_price_fc": 25}]',
    '[]', '[]', '00000000-0000-0000-01a1-00000000000a');
  if (select count(*) from public.import_shipment_lines where shipment_id = v_id) <> 1 then raise exception 'FAIL lines not replaced'; end if;
  if (select count(*) from public.import_cost_lines where shipment_id = v_id) <> 0 then raise exception 'FAIL costs not replaced'; end if;
  if (select invoice_no from public.import_shipments where id = v_id) <> 'INV-1b' then raise exception 'FAIL header not updated'; end if;
  if (select created_by from public.import_shipments where id = v_id) is distinct from '00000000-0000-0000-01a1-00000000000b' then
    raise exception 'FAIL created_by changed on save';
  end if;

  -- The number cannot be changed, and a second shipment gets the next one.
  update public.import_shipments set number = 'HACK' where id = v_id;
  if (select number from public.import_shipments where id = v_id) = 'HACK' then raise exception 'FAIL number was changed'; end if;
  insert into public.import_shipments (supplier_id, currency_code) values ('00000000-0000-0000-01a1-0000000000d1', 'EUR');
  if (select count(distinct number) from public.import_shipments where number like 'IMP-%') < 2 then raise exception 'FAIL numbers not unique'; end if;

  -- A shipment that is no longer a draft is refused.
  update public.import_shipments set status = 'confirmed' where id = v_id;
  begin
    perform public.import_shipment_save_draft(v_id, '{"currency_code": "USD", "invoice_rate": 1}', '[]', '[]', '[]', null);
    raise exception 'FAIL a confirmed shipment was saved as a draft';
  exception when others then
    if sqlerrm not like '%imports_not_draft%' then raise; end if;
  end;
  update public.import_shipments set status = 'draft' where id = v_id;
end $$;

-- 3. Rules on cost lines.
do $$
declare v_id uuid := (select id from public.import_shipments where invoice_no = 'INV-1b');
begin
  begin
    insert into public.import_cost_lines (shipment_id, position, cost_type, amount, is_capitalized) values (v_id, 10, 'customs_vat', 100, true);
    raise exception 'FAIL customs VAT capitalized';
  exception when check_violation then null;
  end;
  begin
    insert into public.import_cost_lines (shipment_id, position, cost_type, amount, split_method) values (v_id, 11, 'labour', 100, 'per_line_duty');
    raise exception 'FAIL per_line_duty on labour';
  exception when check_violation then null;
  end;
  begin
    insert into public.import_cost_lines (shipment_id, position, cost_type, amount, paid_now) values (v_id, 12, 'broker', 100, true);
    raise exception 'FAIL paid now without an account';
  exception when check_violation then null;
  end;
  insert into public.import_cost_lines (shipment_id, position, cost_type, amount, is_capitalized) values (v_id, 13, 'customs_vat', 931.77, false);
  begin
    insert into public.import_cost_lines (shipment_id, position, cost_type, amount) values (v_id, 13, 'other', 1);
    raise exception 'FAIL two cost lines at the same position';
  exception when unique_violation then null;
  end;
end $$;

-- 4. Row level security.
create or replace function pg_temp.as_user(p_user uuid) returns void language sql as $$
  select set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, false);
$$;

-- What the posting functions do to the status, done as the owner for the checks below.
create or replace function pg_temp.set_status(p_id uuid, p_status text) returns void language sql security definer as $$
  update public.import_shipments set status = p_status where id = p_id;
$$;

set role authenticated;

select pg_temp.as_user('00000000-0000-0000-01a1-00000000000a');
do $$ begin
  if (select count(*) from public.import_shipments) < 2 then raise exception 'FAIL admin cannot read shipments'; end if;
  if not public.imports_can('approve') then raise exception 'FAIL admin lacks approve'; end if;
end $$;

select pg_temp.as_user('00000000-0000-0000-01a1-00000000000c');
do $$ begin
  if (select count(*) from public.import_shipments) < 2 then raise exception 'FAIL viewer cannot read shipments'; end if;
  if (select count(*) from public.import_shipment_lines) < 1 then raise exception 'FAIL viewer cannot read lines'; end if;
  if (select count(*) from public.exchange_rates) < 1 then raise exception 'FAIL viewer cannot read rates'; end if;
  if public.imports_can('manage') then raise exception 'FAIL viewer can manage'; end if;
  begin
    insert into public.import_shipments (supplier_id, currency_code) values ('00000000-0000-0000-01a1-0000000000d1', 'USD');
    raise exception 'FAIL viewer created a shipment';
  exception when insufficient_privilege then null;
  end;
  if not public.chatter_record_visible('import_shipments', (select id from public.import_shipments where invoice_no = 'INV-1b')) then
    raise exception 'FAIL chatter not visible to a viewer';
  end if;
end $$;

select pg_temp.as_user('00000000-0000-0000-01a1-00000000000d');
do $$ begin
  if (select count(*) from public.import_shipments) <> 0 then raise exception 'FAIL a viewer without financial figures read amounts'; end if;
  if (select count(*) from public.import_cost_lines) <> 0 then raise exception 'FAIL a viewer without financial figures read costs'; end if;
  if not public.imports_can('view') then raise exception 'FAIL imports.view not recognised'; end if;
end $$;

select pg_temp.as_user('00000000-0000-0000-01a1-00000000000e');
do $$ begin
  if (select count(*) from public.import_shipments) < 2 then raise exception 'FAIL the matrix checkbox does not grant imports.view'; end if;
end $$;

select pg_temp.as_user('00000000-0000-0000-01a1-00000000000f');
do $$ begin
  if (select count(*) from public.import_shipments) <> 0 then raise exception 'FAIL a stranger read shipments'; end if;
  if (select count(*) from public.exchange_rates) <> 0 then raise exception 'FAIL a stranger read rates'; end if;
  if (select count(*) from public.currencies) <> 6 then raise exception 'FAIL currencies hidden from a signed-in user'; end if;
end $$;

select pg_temp.as_user('00000000-0000-0000-01a1-00000000000b');
do $$
declare v_id uuid;
begin
  insert into public.import_shipments (supplier_id, currency_code) values ('00000000-0000-0000-01a1-0000000000d1', 'TRY') returning id into v_id;
  if (select created_by from public.import_shipments where id = v_id) is distinct from '00000000-0000-0000-01a1-00000000000b' then
    raise exception 'FAIL created_by not the signed-in manager';
  end if;
  insert into public.import_shipment_lines (shipment_id, position, product_id, qty_purchase_unit, qty_stock_unit, unit_price_fc)
  values (v_id, 0, '00000000-0000-0000-01a1-000000000102', 1, 1, 1);
  begin
    insert into public.import_shipments (supplier_id, currency_code, status) values ('00000000-0000-0000-01a1-0000000000d1', 'TRY', 'received');
    raise exception 'FAIL a shipment was created past draft';
  exception when insufficient_privilege then null;
  end;
  insert into public.exchange_rates (currency_code, rate_date, rate_to_azn, source) values ('EUR', '2026-10-29', 1.9, 'manual');
  begin
    insert into public.exchange_rates (currency_code, rate_date, rate_to_azn, source) values ('EUR', '2026-10-29', 1.9, 'cbar');
    raise exception 'FAIL a user stored a cbar rate';
  exception when insufficient_privilege then null;
  end;
  -- The status is not changed directly (IMP-2: only the posting functions move it).
  begin
    update public.import_shipments set status = 'closed' where id = v_id;
    raise exception 'FAIL the status was changed directly';
  exception when insufficient_privilege then null;
  end;
  -- A shipment that is no longer a draft cannot get new lines.
  perform pg_temp.set_status(v_id, 'closed');
  begin
    insert into public.import_shipment_lines (shipment_id, position, product_id, qty_purchase_unit, qty_stock_unit, unit_price_fc)
    values (v_id, 1, '00000000-0000-0000-01a1-000000000102', 1, 1, 1);
    raise exception 'FAIL a line was added to a closed shipment';
  exception when insufficient_privilege then null;
  end;
  -- The draft save is for the server only.
  begin
    perform public.import_shipment_save_draft(null, '{}', '[]', '[]', '[]', null);
    raise exception 'FAIL a signed-in user called import_shipment_save_draft';
  exception when insufficient_privilege then null;
  end;
end $$;

reset role;

set role anon;
do $$ begin
  begin
    perform public.imports_can('view');
    raise exception 'FAIL anon called imports_can';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
select set_config('request.jwt.claims', '', false);

-- 5. Chatter.
do $$ begin
  if not ('import_shipments' = any (public.chatter_models())) then raise exception 'FAIL import_shipments not in chatter_models()'; end if;
end $$;

-- 6. Safe to run again. Later migrations tighten its write rules (IMP-2: direct writes only
-- while a draft), so they are applied again after it, in order, as a re-run must be.
\ir ../migrations/20261030100000_imports_core.sql
\ir ../migrations/20261030110000_imports_posting.sql
\ir ../migrations/20261030120000_imports_fx.sql

select 'ALL CHECKS PASSED';
