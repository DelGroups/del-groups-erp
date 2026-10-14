-- Checks supabase/migrations/20261014110000_view_favorites.sql on a database built with
-- scripts/db/build-fresh.sh --plain-postgres (CI: .github/workflows/db-baseline.yml).
-- Any failed check raises an exception; the last line prints ALL CHECKS PASSED.
-- Leaves test rows behind: run it on a throwaway database only.

insert into auth.users (id, email) values
  ('00000000-0000-0000-00fa-000000000001', 'fav-a@example.test'),
  ('00000000-0000-0000-00fa-000000000002', 'fav-b@example.test')
on conflict do nothing;

begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-00fa-000000000001","role":"authenticated"}', true);

do $$
declare
  v_count integer;
begin
  -- A user saves favourites; user_id comes from the session.
  insert into public.view_favorites (view_key, name, state, is_default) values ('crm.deals', 'Won this month', '{"filters":["won"]}', true);
  insert into public.view_favorites (view_key, name, state) values ('crm.deals', 'Mine', '{"filters":["mine"]}');
  select count(*) into v_count from public.view_favorites where user_id = '00000000-0000-0000-00fa-000000000001';
  if v_count <> 2 then raise exception 'FAIL expected 2 own favourites, got %', v_count; end if;

  -- Only one default per screen.
  begin
    update public.view_favorites set is_default = true where name = 'Mine';
    raise exception 'FAIL two defaults on one screen';
  exception when unique_violation then null;
  end;

  -- Same name twice on one screen is refused; bad keys, names and states too.
  begin
    insert into public.view_favorites (view_key, name, state) values ('crm.deals', 'Mine', '{}');
    raise exception 'FAIL duplicate name accepted';
  exception when unique_violation then null;
  end;
  begin
    insert into public.view_favorites (view_key, name, state) values ('CRM deals', 'x', '{}');
    raise exception 'FAIL bad view key accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.view_favorites (view_key, name, state) values ('crm.deals', '   ', '{}');
    raise exception 'FAIL empty name accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.view_favorites (view_key, name, state) values ('crm.deals', 'array', '[]');
    raise exception 'FAIL non-object state accepted';
  exception when check_violation then null;
  end;

  -- Writing a row for someone else is refused by the policy.
  begin
    insert into public.view_favorites (user_id, view_key, name, state) values ('00000000-0000-0000-00fa-000000000002', 'crm.deals', 'planted', '{}');
    raise exception 'FAIL wrote a favourite for another user';
  exception when insufficient_privilege then null;
  end;
end $$;
commit;

begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-00fa-000000000002","role":"authenticated"}', true);

do $$
declare
  v_count integer;
begin
  -- Another user sees, changes and deletes none of them.
  select count(*) into v_count from public.view_favorites;
  if v_count <> 0 then raise exception 'FAIL user B sees % favourites of user A', v_count; end if;
  update public.view_favorites set name = 'hijacked';
  get diagnostics v_count = row_count;
  if v_count <> 0 then raise exception 'FAIL user B updated % rows', v_count; end if;
  delete from public.view_favorites;
  get diagnostics v_count = row_count;
  if v_count <> 0 then raise exception 'FAIL user B deleted % rows', v_count; end if;

  -- B's own default does not clash with A's.
  insert into public.view_favorites (view_key, name, state, is_default) values ('crm.deals', 'Mine', '{}', true);
end $$;
commit;

-- Anonymous visitors have no access at all.
begin;
set local role anon;
do $$
begin
  perform 1 from public.view_favorites;
  raise exception 'FAIL anon can read favourites';
exception when insufficient_privilege then null;
end $$;
commit;

do $$
begin
  if (select count(*) from public.view_favorites where name = 'hijacked') <> 0 then raise exception 'FAIL a row was hijacked'; end if;
  -- Deleting a user removes their favourites.
  delete from auth.users where id = '00000000-0000-0000-00fa-000000000002';
  if exists (select 1 from public.view_favorites where user_id = '00000000-0000-0000-00fa-000000000002') then
    raise exception 'FAIL favourites outlived their user';
  end if;
end $$;

select 'ALL CHECKS PASSED';
