-- Checks supabase/migrations/20261014100000_tenant_limits.sql on a database built with
-- scripts/db/build-fresh.sh --plain-postgres (CI: .github/workflows/db-baseline.yml).
-- Any failed check raises an exception; the last line prints ALL CHECKS PASSED.
-- Leaves test rows behind: run it on a throwaway database only.

do $$
declare
  i integer;
  v_status jsonb;
begin
  -- No row: no limits. Six users become active as usual.
  if exists (select 1 from public.tenant_limits) then raise exception 'FAIL a fresh database has limits'; end if;
  for i in 1..6 loop
    insert into auth.users (id, email) values (('00000000-0000-0000-00aa-' || lpad(i::text, 12, '0'))::uuid, 'seat' || i || '@example.test');
  end loop;
  if (select count(*) from public.profiles where is_active and email like 'seat%@example.test') <> 6 then
    raise exception 'FAIL profiles were not created active';
  end if;
  v_status := public.tenant_limit_status();
  if v_status -> 'users' ->> 'limit' is not null or v_status -> 'storage' ->> 'limit' is not null or v_status -> 'ai' ->> 'limit' is not null then
    raise exception 'FAIL status without limits: %', v_status;
  end if;
  if not public.storage_upload_allowed() then raise exception 'FAIL uploads blocked without a limit'; end if;
end $$;

-- A 5-seat plan.
insert into public.tenant_limits (max_users) values (5);
update public.profiles set is_active = false where email like 'seat%@example.test';

do $$
declare
  i integer;
  v_active integer;
begin
  -- Count every active profile, not only the test ones.
  for i in 1..6 loop
    begin
      update public.profiles set is_active = true where email = 'seat' || i || '@example.test';
    exception when raise_exception then
      if sqlerrm <> 'seat_limit_reached' then raise; end if;
    end;
  end loop;
  select count(*) into v_active from public.profiles where is_active;
  if v_active <> 5 then raise exception 'FAIL expected 5 active users, got %', v_active; end if;

  -- The 6th: activating, or a brand-new user (auth trigger inserts an active profile).
  begin
    update public.profiles set is_active = true where email = 'seat6@example.test' and not is_active;
    if found then raise exception 'FAIL a 6th user was activated'; end if;
  exception when raise_exception then
    if sqlerrm <> 'seat_limit_reached' then raise; end if;
  end;
  begin
    insert into auth.users (id, email) values ('00000000-0000-0000-00aa-000000000099', 'seat99@example.test');
    raise exception 'FAIL a 6th user was created';
  exception when raise_exception then
    if sqlerrm <> 'seat_limit_reached' then raise; end if;
  end;

  -- Other changes to active users are not blocked; deactivating frees a seat.
  update public.profiles set full_name = 'Renamed' where email = 'seat1@example.test';
  update public.profiles set is_active = false where email = 'seat1@example.test';
  update public.profiles set is_active = true where email = 'seat6@example.test';
  if (select count(*) from public.profiles where is_active) <> 5 then raise exception 'FAIL seat not reused'; end if;
  if (public.tenant_limit_status() -> 'users') <> '{"used": 5, "limit": 5}'::jsonb then
    raise exception 'FAIL users status %', public.tenant_limit_status() -> 'users';
  end if;
end $$;

-- Storage: 100 bytes allowed, 150 used.
update public.tenant_limits set storage_limit_bytes = 100;
do $$ begin
  if not public.storage_upload_allowed() then raise exception 'FAIL blocked below the limit'; end if;
  insert into storage.objects (bucket_id, name, metadata)
    values ((select id from storage.buckets limit 1), 'limits-test/a.bin', '{"size": 150}');
  if public.storage_upload_allowed() then raise exception 'FAIL uploads allowed above the limit'; end if;
  if (public.tenant_limit_status() -> 'storage') <> '{"used": 150, "limit": 100}'::jsonb then
    raise exception 'FAIL storage status %', public.tenant_limit_status() -> 'storage';
  end if;
  if not exists (
    select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
       and policyname = 'storage_quota_insert' and permissive = 'RESTRICTIVE' and cmd = 'INSERT'
  ) then raise exception 'FAIL storage quota policy missing or not restrictive'; end if;
end $$;

-- AI: this month's cost counts, last month's does not.
update public.tenant_limits set ai_monthly_limit_usd = 10;
insert into public.ai_usage_log (id, user_id, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, cost_usd, tool_calls, status, created_at)
select gen_random_uuid(), (select id from public.profiles where is_active limit 1), 1, 1, 0, 0, c, 0, 'ok', t
  from (values (4.5, now()), (3.25, now()), (99, date_trunc('month', now()) - interval '1 day')) v(c, t);
do $$ begin
  if (public.tenant_limit_status() -> 'ai') <> '{"used": 7.75, "limit": 10}'::jsonb then
    raise exception 'FAIL ai status %', public.tenant_limit_status() -> 'ai';
  end if;
end $$;

-- Signed-in users may read the limits but not change them.
begin;
set local role authenticated;
do $$ begin
  if (select max_users from public.tenant_limits) <> 5 then raise exception 'FAIL users cannot read limits'; end if;
  begin
    update public.tenant_limits set max_users = 500;
    if found then raise exception 'FAIL a user raised the seat limit'; end if;
  exception when insufficient_privilege then null; end;
end $$;
commit;

-- Removing the row lifts every limit again.
delete from public.tenant_limits;
do $$ begin
  if not public.storage_upload_allowed() then raise exception 'FAIL limit kept after removal'; end if;
  update public.profiles set is_active = true where email like 'seat%@example.test';
end $$;

select 'ALL CHECKS PASSED' as result;
