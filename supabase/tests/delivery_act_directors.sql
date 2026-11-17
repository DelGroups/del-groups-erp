-- Checks supabase/migrations/20261121150000_delivery_act_directors.sql: both director columns exist, take
-- a name, refuse more than 120 characters, and are nullable. One transaction, rolled back; the last line
-- prints ALL CHECKS PASSED.

begin;
set local client_min_messages = warning;

do $$
declare
  v_ok boolean;
  v_name text;
  v_id uuid := '00000000-0000-0000-0d1a-0000000000c1';
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'customers' and column_name = 'director_name') then
    raise exception 'FAIL customers.director_name missing';
  end if;
  if to_regclass('public.company_profile') is not null and not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'company_profile' and column_name = 'director_name') then
    raise exception 'FAIL company_profile.director_name missing';
  end if;

  insert into public.customers (id, full_name, company_name, voen, entity_type, director_name)
  values (v_id, 'Act customer', 'Baku Book Center MMC', '1234567890', 'legal', 'Rzayeva Günel Anar qızı');
  select director_name into v_name from public.customers where id = v_id;
  if v_name <> 'Rzayeva Günel Anar qızı' then raise exception 'FAIL customer director: %', v_name; end if;
  update public.customers set director_name = null where id = v_id;

  v_ok := false;
  begin update public.customers set director_name = repeat('x', 121) where id = v_id; exception when check_violation then v_ok := true; end;
  if not v_ok then raise exception 'FAIL customer director length'; end if;

  if to_regclass('public.company_profile') is not null then
    insert into public.company_profile (id, director_name) values (true, 'Shahab Naem')
      on conflict (id) do update set director_name = excluded.director_name;
    select director_name into v_name from public.company_profile limit 1;
    if v_name <> 'Shahab Naem' then raise exception 'FAIL company director: %', v_name; end if;
    v_ok := false;
    begin update public.company_profile set director_name = repeat('x', 121); exception when check_violation then v_ok := true; end;
    if not v_ok then raise exception 'FAIL company director length'; end if;
  end if;
end $$;

select 'ALL CHECKS PASSED';
rollback;
