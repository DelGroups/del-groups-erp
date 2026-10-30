-- Checks the prompt 24c migrations (20261028140000_profile_display_names, 20261028141000_purchases_created_by,
-- 20261028142000_inventory_writeoffs_created_by, 20261028143000_contracts_created_by) on a database built with
-- scripts/db/build-fresh.sh --plain-postgres (CI: .github/workflows/db-baseline.yml).
-- Any failed check raises an exception; the last line prints ALL CHECKS PASSED.
-- Leaves test rows behind: run it on a throwaway database only.

-- A: admin. S: a seller whose role cannot manage users (so RLS hides other profiles from S).
insert into public.roles (id, name, permissions)
values ('00000000-0000-0000-024c-0000000000f1', 'LC seller', '{"can_view_sales": true}')
on conflict (id) do nothing;
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-024c-00000000000a', 'lc-a@example.test', '{"full_name": "Aysel Admin", "role_name": "Admin"}'),
  ('00000000-0000-0000-024c-00000000000b', 'lc-s@example.test', '{"full_name": "Samir Seller"}')
on conflict (id) do nothing;
update public.profiles set full_name = 'Aysel Admin', role_id = (select id from public.roles where name = 'Admin' order by is_system desc limit 1), is_active = true
where id = '00000000-0000-0000-024c-00000000000a';
update public.profiles set full_name = 'Samir Seller', role_id = '00000000-0000-0000-024c-0000000000f1', is_active = true
where id = '00000000-0000-0000-024c-00000000000b';

insert into public.suppliers (id, full_name, entity_type, voen)
values ('00000000-0000-0000-024c-0000000000d1', 'LC supplier', 'legal', '1234567890')
on conflict (id) do nothing;

-- 1. The trigger records the signed-in user, whatever the client sent.
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-024c-00000000000b","role":"authenticated"}', false);
insert into public.purchases (id, invoice_number, supplier_id, total_amount, created_by)
values ('00000000-0000-0000-024c-000000000101', 'LC-P-1', '00000000-0000-0000-024c-0000000000d1', 10, '00000000-0000-0000-024c-00000000000a');
insert into public.inventory_writeoffs (id, document_number, checker_name)
values ('00000000-0000-0000-024c-000000000201', 'LC-W-1', 'Checker');
insert into public.contracts (id, contract_number, party_id, type, title)
values ('00000000-0000-0000-024c-000000000301', 'LC-C-1', '00000000-0000-0000-024c-0000000000d1', 'purchase', 'LC contract');

do $$
declare v uuid;
begin
  select created_by into v from public.purchases where id = '00000000-0000-0000-024c-000000000101';
  if v is distinct from '00000000-0000-0000-024c-00000000000b' then raise exception 'FAIL purchases.created_by = % (expected the signed-in user)', v; end if;
  select created_by into v from public.inventory_writeoffs where id = '00000000-0000-0000-024c-000000000201';
  if v is distinct from '00000000-0000-0000-024c-00000000000b' then raise exception 'FAIL inventory_writeoffs.created_by = %', v; end if;
  select created_by into v from public.contracts where id = '00000000-0000-0000-024c-000000000301';
  if v is distinct from '00000000-0000-0000-024c-00000000000b' then raise exception 'FAIL contracts.created_by = %', v; end if;
end $$;

-- 2. Without a signed-in user (service role, maintenance) the given value is kept.
select set_config('request.jwt.claims', '', false);
insert into public.purchases (id, invoice_number, supplier_id, total_amount, created_by)
values ('00000000-0000-0000-024c-000000000102', 'LC-P-2', '00000000-0000-0000-024c-0000000000d1', 10, '00000000-0000-0000-024c-00000000000a');
insert into public.purchases (id, invoice_number, supplier_id, total_amount)
values ('00000000-0000-0000-024c-000000000103', 'LC-P-3', '00000000-0000-0000-024c-0000000000d1', 10);
do $$
begin
  if (select created_by from public.purchases where id = '00000000-0000-0000-024c-000000000102') is distinct from '00000000-0000-0000-024c-00000000000a' then
    raise exception 'FAIL a maintenance insert lost its created_by';
  end if;
  if (select created_by from public.purchases where id = '00000000-0000-0000-024c-000000000103') is not null then
    raise exception 'FAIL created_by invented without a user';
  end if;
end $$;

-- 3. Backfill: an old row with a logged insert gets its creator when the migration runs again.
insert into public.audit_logs (user_id, action, module, table_name, record_id)
values ('00000000-0000-0000-024c-00000000000a', 'CREATE', 'FINANCE', 'purchases', '00000000-0000-0000-024c-000000000103');
\ir ../migrations/20261028141000_purchases_created_by.sql
do $$
begin
  if (select created_by from public.purchases where id = '00000000-0000-0000-024c-000000000103') is distinct from '00000000-0000-0000-024c-00000000000a' then
    raise exception 'FAIL backfill from audit_logs did not set created_by';
  end if;
  if (select created_by from public.purchases where id = '00000000-0000-0000-024c-000000000101') is distinct from '00000000-0000-0000-024c-00000000000b' then
    raise exception 'FAIL backfill overwrote a known creator';
  end if;
end $$;

-- 4. Names: the seller cannot read the admin's profile, but gets the name (and nothing else).
set role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-024c-00000000000b","role":"authenticated"}', false);
do $$
declare v_name text; v_rows int;
begin
  select count(*) into v_rows from public.profiles where id = '00000000-0000-0000-024c-00000000000a';
  if v_rows <> 0 then raise exception 'FAIL setup: RLS should hide other profiles from the seller'; end if;
  select full_name into v_name from public.profile_display_names(array['00000000-0000-0000-024c-00000000000a'::uuid, '00000000-0000-0000-024c-00000000ffff'::uuid]);
  if v_name is distinct from 'Aysel Admin' then raise exception 'FAIL profile_display_names gave %', v_name; end if;
  select count(*) into v_rows from public.profile_display_names(array['00000000-0000-0000-024c-00000000ffff'::uuid]);
  if v_rows <> 0 then raise exception 'FAIL unknown id returned a row'; end if;
end $$;
reset role;

-- 5. Not for anonymous callers.
set role anon;
do $$
begin
  perform public.profile_display_names(array['00000000-0000-0000-024c-00000000000a'::uuid]);
  raise exception 'FAIL anon could call profile_display_names';
exception when insufficient_privilege then null;
end $$;
reset role;
select set_config('request.jwt.claims', '', false);

select 'ALL CHECKS PASSED';
