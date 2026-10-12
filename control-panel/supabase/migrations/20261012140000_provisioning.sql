-- Provisioning jobs (prompt 9): one-click creation of a tenant's ERP from the control panel.
--
-- A job runs step by step (control-panel/lib/provisioning). Every step is idempotent and
-- resumable: its status, attempts, non-secret output and error are stored here, and every
-- message goes to provisioning_log. Secrets never land in these tables (they go to Vault
-- through set_tenant_secret()). Platform admins drive the job from the tenant page, so all
-- writes run as that admin under RLS and are audited like every other change.
-- Safe to re-run.

create table if not exists public.provisioning_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  status text not null default 'running' check (status in ('running', 'failed', 'succeeded')),
  -- modules, admin_email, admin_name, final_status, region_group, base_domain
  options jsonb not null default '{}'::jsonb,
  current_step text,
  -- Only one browser tab advances a job at a time (claim_provisioning_job()).
  locked_until timestamptz,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  finished_at timestamptz
);
-- One unfinished job per tenant (a failed job is retried, not replaced).
create unique index if not exists provisioning_jobs_one_open
  on public.provisioning_jobs (tenant_id) where status <> 'succeeded';
create index if not exists provisioning_jobs_tenant on public.provisioning_jobs (tenant_id, created_at desc);

create table if not exists public.provisioning_steps (
  job_id uuid not null references public.provisioning_jobs (id) on delete cascade,
  step text not null check (step ~ '^[a-z][a-z_]{0,40}$'),
  position integer not null,
  status text not null default 'pending' check (status in ('pending', 'running', 'succeeded', 'failed')),
  attempts integer not null default 0 check (attempts >= 0),
  -- Non-secret results (project ref, files applied, ...).
  output jsonb not null default '{}'::jsonb,
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (job_id, step),
  unique (job_id, position)
);

create table if not exists public.provisioning_log (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.provisioning_jobs (id) on delete cascade,
  step text,
  level text not null default 'info' check (level in ('info', 'warn', 'error')),
  message text not null check (length(message) <= 2000),
  created_at timestamptz not null default now()
);
create index if not exists provisioning_log_job on public.provisioning_log (job_id, id);

-- Claims a job for `p_seconds`, unless another tab holds it. True when claimed.
create or replace function public.claim_provisioning_job(p_job_id uuid, p_seconds integer default 120)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_claimed boolean;
begin
  update public.provisioning_jobs
     set locked_until = now() + make_interval(secs => greatest(10, least(p_seconds, 600)))
   where id = p_job_id
     and (locked_until is null or locked_until < now())
  returning true into v_claimed;
  return coalesce(v_claimed, false);
end;
$$;

-- ── Audit, updated_at ──────────────────────────────────────────────────────
do $$
declare
  t text;
begin
  foreach t in array array['provisioning_jobs', 'provisioning_steps'] loop
    execute format('drop trigger if exists %I on public.%I', 'trg_audit_' || t, t);
    execute format(
      'create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_platform_change()',
      'trg_audit_' || t, t
    );
    execute format('drop trigger if exists %I on public.%I', 'trg_updated_at_' || t, t);
    execute format(
      'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
      'trg_updated_at_' || t, t
    );
  end loop;
end $$;

-- ── Row level security: platform admins only ───────────────────────────────
alter table public.provisioning_jobs enable row level security;
alter table public.provisioning_steps enable row level security;
alter table public.provisioning_log enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['provisioning_jobs', 'provisioning_steps'] loop
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_platform_admins', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin())',
      t || '_platform_admins', t
    );
  end loop;
end $$;

-- The log is append-only: admins read and add lines, nobody changes or deletes them.
revoke all on table public.provisioning_log from anon, authenticated;
grant select, insert on table public.provisioning_log to authenticated;
drop policy if exists provisioning_log_select on public.provisioning_log;
create policy provisioning_log_select on public.provisioning_log
  for select to authenticated using (public.is_platform_admin());
drop policy if exists provisioning_log_insert on public.provisioning_log;
create policy provisioning_log_insert on public.provisioning_log
  for insert to authenticated with check (public.is_platform_admin());

revoke all on function public.claim_provisioning_job(uuid, integer) from public, anon;
grant execute on function public.claim_provisioning_job(uuid, integer) to authenticated;
