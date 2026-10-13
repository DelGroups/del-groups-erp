-- Plan limits inside the tenant database (prompt 12, plan §4.4).
--
-- public.tenant_limits holds at most one row, written by the control panel (service role)
-- when a subscription changes and by the daily usage job. NO ROW, or a null column, means
-- NO LIMIT: that is the state of every database until a subscription with limits is synced,
-- so applying this migration changes nothing for anyone.
--
--   max_users             seats; a profile cannot become active beyond it (trigger below,
--                         the second layer after the /api/users check)
--   storage_limit_bytes   uploads by signed-in users stop at 100 % (restrictive storage
--                         policy); server-side uploads check public.tenant_limit_status()
--   ai_monthly_limit_usd  AI questions stop at 100 % of this month's ai_usage_log cost
--
-- Usage is measured live here (profiles, storage.objects, ai_usage_log), so a limit takes
-- effect at once, not after the next daily snapshot. Safe to re-run.

create table if not exists public.tenant_limits (
  id boolean primary key default true check (id),
  max_users integer check (max_users is null or max_users > 0),
  storage_limit_bytes bigint check (storage_limit_bytes is null or storage_limit_bytes >= 0),
  ai_monthly_limit_usd numeric(12, 2) check (ai_monthly_limit_usd is null or ai_monthly_limit_usd >= 0),
  synced_at timestamptz,
  updated_at timestamptz not null default now()
);

comment on table public.tenant_limits is
  'Plan limits of this tenant (one row, written by the control panel). No row = no limits.';

alter table public.tenant_limits enable row level security;
drop policy if exists tenant_limits_select on public.tenant_limits;
create policy tenant_limits_select on public.tenant_limits
  for select to authenticated
  using (true);
-- No insert/update/delete policies: only the service role (bypasses RLS) writes.
revoke all on table public.tenant_limits from public, anon, authenticated;
grant select on table public.tenant_limits to authenticated;
grant all on table public.tenant_limits to service_role;

-- ── Usage and status ───────────────────────────────────────────────────────

create or replace function public.tenant_storage_used_bytes()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum((o.metadata ->> 'size')::bigint), 0)::bigint from storage.objects o;
$$;

create or replace function public.tenant_ai_used_usd()
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(l.cost_usd), 0)
    from public.ai_usage_log l
   where l.created_at >= date_trunc('month', now());
$$;

-- {users|storage|ai: {used, limit}}; limit null = unlimited. Counts only, no names.
create or replace function public.tenant_limit_status()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'users', jsonb_build_object(
      'used', (select count(*) from public.profiles p where p.is_active),
      'limit', l.max_users),
    'storage', jsonb_build_object(
      'used', case when l.storage_limit_bytes is null then null else public.tenant_storage_used_bytes() end,
      'limit', l.storage_limit_bytes),
    'ai', jsonb_build_object(
      'used', case when l.ai_monthly_limit_usd is null then null else public.tenant_ai_used_usd() end,
      'limit', l.ai_monthly_limit_usd)
  )
  from (select 1) one
  left join public.tenant_limits l on l.id;
$$;

-- ── Seats: second layer ────────────────────────────────────────────────────

create or replace function public.enforce_seat_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_used integer;
begin
  if not coalesce(new.is_active, false) then
    return new;
  end if;
  if tg_op = 'UPDATE' and coalesce(old.is_active, false) then
    return new; -- already counted
  end if;
  select l.max_users into v_limit from public.tenant_limits l where l.id;
  if v_limit is null then
    return new; -- no limit
  end if;
  -- Two invitations at the same moment must not both take the last seat.
  perform pg_advisory_xact_lock(hashtext('public.enforce_seat_limit'));
  select count(*) into v_used from public.profiles p where p.is_active and p.id <> new.id;
  if v_used >= v_limit then
    raise exception 'seat_limit_reached'
      using errcode = 'P0001',
            detail = format('%s of %s seats are in use', v_used, v_limit),
            hint = 'Add seats to the subscription or deactivate a user.';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_seat_limit on public.profiles;
create trigger trg_profiles_seat_limit
  before insert or update of is_active on public.profiles
  for each row execute function public.enforce_seat_limit();

-- ── Storage: uploads by signed-in users ────────────────────────────────────

create or replace function public.storage_upload_allowed()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1 from public.tenant_limits l
     where l.id and l.storage_limit_bytes is not null
       and public.tenant_storage_used_bytes() >= l.storage_limit_bytes
  );
$$;

-- Restrictive: an extra condition on top of the bucket policies, never a new permission.
drop policy if exists storage_quota_insert on storage.objects;
create policy storage_quota_insert on storage.objects
  as restrictive
  for insert to authenticated
  with check (public.storage_upload_allowed());

revoke all on function public.tenant_storage_used_bytes() from public, anon;
revoke all on function public.tenant_ai_used_usd() from public, anon;
revoke all on function public.tenant_limit_status() from public, anon;
revoke all on function public.enforce_seat_limit() from public, anon, authenticated;
revoke all on function public.storage_upload_allowed() from public, anon;
grant execute on function public.tenant_storage_used_bytes() to authenticated, service_role;
grant execute on function public.tenant_ai_used_usd() to authenticated, service_role;
grant execute on function public.tenant_limit_status() to authenticated, service_role;
grant execute on function public.storage_upload_allowed() to authenticated, service_role;
