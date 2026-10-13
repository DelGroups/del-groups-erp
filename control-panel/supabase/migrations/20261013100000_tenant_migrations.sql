-- Tenant database migrations (prompt 10): apply new supabase/migrations files to every tenant.
--
-- scripts/tenants/migrate-all.ts (manual GitHub Actions workflow, service-role key) and the
-- "Migrate this tenant" button (signed-in platform admin, under RLS) share the engine in
-- control-panel/lib/migrations. Per tenant they record here:
--   tenant_databases.is_canary            the one tenant that gets new migrations first
--   tenant_databases.schema_version       newest ERP migration version the database has
--   tenant_databases.last_migration       name of the newest migration file applied
--   tenant_databases.migration_status     idle / running / succeeded / failed (last run)
--   tenant_databases.migration_error      redacted error of the last failed run
--   tenant_databases.migration_locked_until  one run per tenant at a time
--   tenant_migration_log                  append-only log of every run, per tenant
-- Changes to tenant_databases are audited by the existing trigger.
-- Safe to re-run.

alter table public.tenant_databases add column if not exists is_canary boolean not null default false;
alter table public.tenant_databases add column if not exists migration_status text not null default 'idle';
alter table public.tenant_databases add column if not exists migration_error text;
alter table public.tenant_databases add column if not exists migration_locked_until timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'tenant_databases_migration_status_check' and conrelid = 'public.tenant_databases'::regclass
  ) then
    alter table public.tenant_databases
      add constraint tenant_databases_migration_status_check
      check (migration_status in ('idle', 'running', 'succeeded', 'failed'));
  end if;
end $$;

-- At most one canary.
create unique index if not exists tenant_databases_one_canary on public.tenant_databases (is_canary) where is_canary;

create table if not exists public.tenant_migration_log (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  -- Groups the lines of one run (workflow run id, or "panel-<time>" for the button).
  run_id text not null check (run_id ~ '^[A-Za-z0-9_.:-]{1,100}$'),
  -- Migration file the line is about, if any.
  migration text check (migration is null or migration ~ '^[0-9]{14}_[a-z0-9_]+$'),
  level text not null default 'info' check (level in ('info', 'warn', 'error')),
  message text not null check (length(message) <= 2000),
  created_at timestamptz not null default now()
);
create index if not exists tenant_migration_log_tenant on public.tenant_migration_log (tenant_id, id desc);

-- Takes the tenant's migration lock for `p_seconds` and marks it running, unless another
-- run holds it. True when taken. Runs as the caller: platform admins pass RLS, the
-- workflow's service role bypasses it.
create or replace function public.claim_tenant_migration(p_tenant_id uuid, p_seconds integer default 600)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_claimed boolean;
begin
  update public.tenant_databases
     set migration_locked_until = now() + make_interval(secs => greatest(30, least(p_seconds, 3600))),
         migration_status = 'running',
         migration_error = null
   where tenant_id = p_tenant_id
     and (migration_locked_until is null or migration_locked_until < now())
  returning true into v_claimed;
  return coalesce(v_claimed, false);
end;
$$;

revoke all on function public.claim_tenant_migration(uuid, integer) from public, anon;
grant execute on function public.claim_tenant_migration(uuid, integer) to authenticated, service_role;

-- ── Row level security: the log is append-only, platform admins only ───────
alter table public.tenant_migration_log enable row level security;
revoke all on table public.tenant_migration_log from anon, authenticated;
grant select, insert on table public.tenant_migration_log to authenticated;
grant select, insert on table public.tenant_migration_log to service_role;
drop policy if exists tenant_migration_log_select on public.tenant_migration_log;
create policy tenant_migration_log_select on public.tenant_migration_log
  for select to authenticated using (public.is_platform_admin());
drop policy if exists tenant_migration_log_insert on public.tenant_migration_log;
create policy tenant_migration_log_insert on public.tenant_migration_log
  for insert to authenticated with check (public.is_platform_admin());
