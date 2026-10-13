-- Checks the tenant migration bookkeeping (20261013100000_tenant_migrations.sql) on a database
-- built from the migrations, after rls_and_audit.sql. Any failed check raises an exception;
-- the last line prints ALL CHECKS PASSED.

-- Admin: canary flag, lock, status, append-only log.
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
do $$
declare v_a uuid; v_b uuid;
begin
  insert into public.tenants (name, slug, status) values ('Migr A', 'migr-a', 'active') returning id into v_a;
  insert into public.tenants (name, slug, status) values ('Migr B', 'migr-b', 'active') returning id into v_b;
  insert into public.tenant_databases (tenant_id, supabase_project_ref, is_canary) values (v_a, 'migrrefaaaaaaaaa', true);
  insert into public.tenant_databases (tenant_id, supabase_project_ref) values (v_b, 'migrrefbbbbbbbbb');

  if (select migration_status from public.tenant_databases where tenant_id = v_b) <> 'idle' then raise exception 'FAIL default status'; end if;

  -- One canary at most.
  begin
    update public.tenant_databases set is_canary = true where tenant_id = v_b;
    raise exception 'FAIL two canaries allowed';
  exception when unique_violation then null; end;

  -- The lock: taken once, refused while held, marks the tenant running.
  if not public.claim_tenant_migration(v_a, 600) then raise exception 'FAIL first claim'; end if;
  if public.claim_tenant_migration(v_a, 600) then raise exception 'FAIL second claim while locked'; end if;
  if (select migration_status from public.tenant_databases where tenant_id = v_a) <> 'running' then raise exception 'FAIL running status'; end if;
  if public.claim_tenant_migration(gen_random_uuid(), 600) then raise exception 'FAIL claim of unknown tenant'; end if;

  -- An expired lock can be taken again.
  update public.tenant_databases set migration_locked_until = now() - interval '1 minute' where tenant_id = v_a;
  if not public.claim_tenant_migration(v_a, 600) then raise exception 'FAIL claim after expiry'; end if;

  update public.tenant_databases
     set schema_version = '20261011150000', last_migration = '20261011150000_enable_rls_on_remaining_tables',
         migration_status = 'succeeded', migration_locked_until = null
   where tenant_id = v_a;
  begin
    update public.tenant_databases set migration_status = 'nope' where tenant_id = v_a;
    raise exception 'FAIL bad migration status accepted';
  exception when check_violation then null; end;

  -- Version changes are audited like every other tenant_databases change.
  if not exists (
    select 1 from public.platform_audit_log
     where entity_table = 'tenant_databases' and details -> 'changes' ? 'schema_version'
  ) then raise exception 'FAIL version change not audited'; end if;

  insert into public.tenant_migration_log (tenant_id, run_id, migration, level, message)
    values (v_a, 'gh-123-1', '20261011150000_enable_rls_on_remaining_tables', 'info', 'applied');
  begin
    insert into public.tenant_migration_log (tenant_id, run_id, message) values (v_a, 'bad run id!', 'x');
    raise exception 'FAIL bad run id accepted';
  exception when check_violation then null; end;
  begin
    update public.tenant_migration_log set message = 'edited';
    raise exception 'FAIL log update allowed';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.tenant_migration_log;
    raise exception 'FAIL log delete allowed';
  exception when insufficient_privilege then null; end;
end $$;
commit;

-- Non-admin: sees no log line, cannot take a lock.
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
do $$ begin
  if (select count(*) from public.tenant_migration_log) <> 0 then raise exception 'FAIL non-admin reads the migration log'; end if;
  if public.claim_tenant_migration((select tenant_id from public.tenant_databases where supabase_project_ref = 'migrrefbbbbbbbbb'), 600)
    then raise exception 'FAIL non-admin took a lock'; end if;
  begin
    insert into public.tenant_migration_log (tenant_id, run_id, message)
      values ('00000000-0000-0000-0000-000000000000', 'x', 'forged');
    raise exception 'FAIL non-admin wrote the migration log';
  exception when insufficient_privilege then null; end;
end $$;
commit;

-- anon: nothing.
begin;
set local role anon;
do $$ begin
  begin
    perform public.claim_tenant_migration(gen_random_uuid(), 60);
    raise exception 'FAIL anon can claim';
  exception when insufficient_privilege then null; end;
end $$;
commit;

select 'ALL CHECKS PASSED' as result;
