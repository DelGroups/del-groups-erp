-- Tenant #1 cutover (prompt 11), step 4: registers the existing Del Groups ERP database as
-- tenant "del-groups" in the CONTROL PANEL's Supabase project. No ERP data moves.
--
-- Run it in the SQL Editor of the control panel's project (never the ERP's), after filling
-- in the four <...> values in the `values` block below. It creates or updates:
--   tenants           slug del-groups, "Del Groups MMC", status active, az / AZ / AZN
--   tenant_databases  the ERP's Supabase project ref; not the canary
--   tenant_domains    erp.del-groups.com, custom domain, primary, SSL active (Caddy has it)
-- For the rehearsal on a copy (runbook step 3) change slug, name and domain in the same block
-- (e.g. del-groups-rehearsal, "Del Groups (rehearsal)", localhost).
--   Vault             the ERP's anon key and service-role key (set_tenant_secret)
-- Every change is audited under your admin account. Safe to re-run (it updates in place).
--
-- The keys: Supabase dashboard of the ERP project -> Project Settings -> API. Paste them here,
-- run, then clear them from the editor and do not save the snippet: the SQL Editor keeps
-- history. Nothing else stores them outside Vault.
--
-- Until the ERP container is switched to multi-tenant mode (runbook step 7) this record is
-- not used by erp.del-groups.com at all.

begin;

create temporary table tenant1_input on commit drop as
select * from (values (
  '<YOUR PLATFORM ADMIN EMAIL>',   -- admin_email: your row in platform_admins (role owner/admin)
  '<ERP PROJECT REF>',             -- project_ref: from https://<ref>.supabase.co, 20 letters
  '<ERP ANON OR PUBLISHABLE KEY>', -- anon_key: the one NEXT_PUBLIC_SUPABASE_ANON_KEY holds today
  '<ERP SERVICE ROLE OR SECRET KEY>', -- service_role_key: the one SUPABASE_SERVICE_ROLE_KEY holds today
  'del-groups',                    -- slug
  'Del Groups MMC',                -- name
  'erp.del-groups.com'             -- domain
)) as v(admin_email, project_ref, anon_key, service_role_key, slug, name, domain);

do $$
declare
  v_in record;
  v_admin uuid;
  v_tenant uuid;
  v_other uuid;
begin
  select * into v_in from tenant1_input;
  if v_in.admin_email like '<%' or v_in.project_ref like '<%' or v_in.anon_key like '<%' or v_in.service_role_key like '<%' then
    raise exception 'fill in the four values in the values block first';
  end if;
  if v_in.slug !~ '^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$' or v_in.domain !~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$' then
    raise exception 'slug or domain is not valid';
  end if;
  if v_in.project_ref !~ '^[a-z0-9]{20}$' then
    raise exception 'project_ref must be the 20-character project ref (the part before .supabase.co)';
  end if;

  -- Act as that platform admin for this transaction: set_tenant_secret() and the audit log
  -- need a signed-in admin, and the SQL Editor has none.
  select user_id into v_admin from public.platform_admins where lower(email) = lower(v_in.admin_email) and is_active;
  if v_admin is null then
    raise exception 'no active platform admin with email %', v_in.admin_email;
  end if;
  perform set_config('request.jwt.claim.sub', v_admin::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  insert into public.tenants (name, slug, status, country, language, currency, notes)
  values (v_in.name, v_in.slug, 'active', 'AZ', 'az', 'AZN',
          'Tenant #1: the original Del Groups ERP database, registered in place (prompt 11).')
  on conflict (slug) do update
    set name = excluded.name, status = 'active', country = excluded.country,
        language = excluded.language, currency = excluded.currency
  returning id into v_tenant;

  -- The project must not already belong to another tenant.
  select tenant_id into v_other from public.tenant_databases
   where supabase_project_ref = v_in.project_ref and tenant_id <> v_tenant;
  if v_other is not null then
    raise exception 'project % is already registered for another tenant (%)', v_in.project_ref, v_other;
  end if;
  insert into public.tenant_databases (tenant_id, supabase_project_ref, region, schema_version, is_canary)
  values (v_tenant, v_in.project_ref, null, '20261006100000', false)
  on conflict (tenant_id) do update
    set supabase_project_ref = excluded.supabase_project_ref, is_canary = false;

  select tenant_id into v_other from public.tenant_domains where domain = v_in.domain and tenant_id <> v_tenant;
  if v_other is not null then
    raise exception '% is already mapped to another tenant (%)', v_in.domain, v_other;
  end if;
  update public.tenant_domains set is_primary = false where tenant_id = v_tenant and domain <> v_in.domain and is_primary;
  insert into public.tenant_domains (tenant_id, domain, kind, is_primary, ssl_status)
  values (v_tenant, v_in.domain, 'custom', true, 'active')
  on conflict (domain) do update set kind = 'custom', is_primary = true, ssl_status = 'active';

  perform public.set_tenant_secret(v_tenant, 'supabase_anon_key', v_in.anon_key);
  perform public.set_tenant_secret(v_tenant, 'supabase_service_role_key', v_in.service_role_key);

  perform public.log_platform_action('register_tenant_1', 'tenants', v_tenant::text,
    jsonb_build_object('domain', v_in.domain, 'project_ref', v_in.project_ref));
end $$;

commit;

-- What the ERP will see for the domain (keys shown only as present / missing).
select t.slug, t.status, d.domain, d.is_primary, db.supabase_project_ref, db.is_canary,
       (select count(*) from public.tenant_secrets s where s.tenant_id = t.id
         and s.name in ('supabase_anon_key', 'supabase_service_role_key')) as keys_in_vault
  from public.tenants t
  join public.tenant_domains d on d.tenant_id = t.id
  left join public.tenant_databases db on db.tenant_id = t.id
 where d.is_primary
   and t.id in (select tenant_id from public.tenant_secrets where name = 'supabase_service_role_key')
 order by t.created_at;
