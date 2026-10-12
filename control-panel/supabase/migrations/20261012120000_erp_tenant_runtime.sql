-- Tenant lookup for the ERP (prompt 8): domain or tenant id -> status, Supabase URL and keys.
--
-- The ERP calls public.erp_tenant_runtime() server-side with this project's service-role
-- key (CONTROL_PLANE_SERVICE_ROLE_KEY) and caches the answer for 60 s. Only service_role
-- may execute it: not anon, not signed-in users (platform admins included), so the
-- decrypted keys never reach a browser session.
--
-- Where the values come from:
--   status, slug          public.tenants
--   api_url               tenant_databases.api_url, else https://<supabase_project_ref>.supabase.co
--   anon_key              Vault secret named in tenant_secrets: 'supabase_anon_key'
--   service_role_key      Vault secret named in tenant_secrets: 'supabase_service_role_key'
-- Platform admins store the two keys with public.set_tenant_secret(tenant_id, name, value).
-- Safe to re-run.

-- A tenant database outside Supabase Cloud (a local stack, later Postgres on Hetzner)
-- needs its API URL spelled out.
alter table public.tenant_databases add column if not exists api_url text;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'tenant_databases_api_url_check' and conrelid = 'public.tenant_databases'::regclass
  ) then
    alter table public.tenant_databases
      add constraint tenant_databases_api_url_check check (api_url is null or api_url ~ '^https?://[^/\s]+');
  end if;
end $$;

create or replace function public.erp_tenant_runtime(p_host text default null, p_tenant_id uuid default null)
returns table (
  tenant_id uuid,
  slug text,
  status text,
  api_url text,
  anon_key text,
  service_role_key text
)
language sql
stable
security definer
set search_path = ''
as $$
  with t as (
    select tn.id, tn.slug, tn.status
      from public.tenants tn
     where (p_tenant_id is not null and tn.id = p_tenant_id)
        or (p_tenant_id is null and p_host is not null and tn.id = (
              select d.tenant_id from public.tenant_domains d where d.domain = lower(btrim(p_host))
           ))
     limit 1
  )
  select
    t.id,
    t.slug,
    t.status,
    coalesce(
      db.api_url,
      case when db.supabase_project_ref is not null then 'https://' || db.supabase_project_ref || '.supabase.co' end
    ),
    (select s.decrypted_secret
       from public.tenant_secrets ts join vault.decrypted_secrets s on s.id = ts.vault_secret_id
      where ts.tenant_id = t.id and ts.name = 'supabase_anon_key'),
    (select s.decrypted_secret
       from public.tenant_secrets ts join vault.decrypted_secrets s on s.id = ts.vault_secret_id
      where ts.tenant_id = t.id and ts.name = 'supabase_service_role_key')
  from t
  left join public.tenant_databases db on db.tenant_id = t.id;
$$;

revoke all on function public.erp_tenant_runtime(text, uuid) from public, anon, authenticated;
grant execute on function public.erp_tenant_runtime(text, uuid) to service_role;
