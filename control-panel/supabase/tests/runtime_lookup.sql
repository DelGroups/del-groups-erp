-- Checks public.erp_tenant_runtime() (the ERP's tenant lookup) on a database built from the
-- migrations, after rls_and_audit.sql. Any failed check raises an exception; the last line
-- prints ALL CHECKS PASSED.

-- Setup as an admin: two tenants, domains, databases and keys in Vault.
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
do $$
declare v_a uuid; v_b uuid;
begin
  insert into public.tenants (name, slug, status) values ('Lookup A', 'lookup-a', 'active') returning id into v_a;
  insert into public.tenants (name, slug, status) values ('Lookup B', 'lookup-b', 'read_only') returning id into v_b;
  insert into public.tenant_domains (tenant_id, domain, is_primary) values (v_a, 'acme.localhost', true), (v_b, 'beta.localhost', true);
  insert into public.tenant_databases (tenant_id, api_url) values (v_a, 'http://127.0.0.1:54321');
  insert into public.tenant_databases (tenant_id, supabase_project_ref) values (v_b, 'abcdefghijklmnop');
  perform public.set_tenant_secret(v_a, 'supabase_anon_key', 'anon-a');
  perform public.set_tenant_secret(v_a, 'supabase_service_role_key', 'service-a');
  perform public.set_tenant_secret(v_b, 'supabase_anon_key', 'anon-b');
  begin
    insert into public.tenant_databases (tenant_id, api_url)
      select id, 'ftp://nope' from public.tenants where slug = 'acme';
    raise exception 'FAIL bad api_url accepted';
  exception when check_violation then null; end;

  -- Admins (signed-in users) may not read decrypted keys through the lookup.
  begin
    perform * from public.erp_tenant_runtime('acme.localhost', null);
    raise exception 'FAIL authenticated can call erp_tenant_runtime';
  exception when insufficient_privilege then null; end;
end $$;
commit;

-- The ERP (service_role): by host and by id.
begin;
set local role service_role;
do $$
declare r record; v_a uuid;
begin
  select * into r from public.erp_tenant_runtime('ACME.localhost', null);
  if r.slug <> 'lookup-a' or r.status <> 'active' or r.api_url <> 'http://127.0.0.1:54321'
     or r.anon_key <> 'anon-a' or r.service_role_key <> 'service-a' then
    raise exception 'FAIL lookup by host: %', row_to_json(r);
  end if;
  v_a := r.tenant_id;
  select * into r from public.erp_tenant_runtime(null, v_a);
  if r.slug <> 'lookup-a' then raise exception 'FAIL lookup by id'; end if;

  select * into r from public.erp_tenant_runtime('beta.localhost', null);
  if r.status <> 'read_only' or r.api_url <> 'https://abcdefghijklmnop.supabase.co'
     or r.anon_key <> 'anon-b' or r.service_role_key is not null then
    raise exception 'FAIL project-ref url / missing service key: %', row_to_json(r);
  end if;

  if exists (select 1 from public.erp_tenant_runtime('unknown.localhost', null)) then
    raise exception 'FAIL unknown host returned a row';
  end if;
  if exists (select 1 from public.erp_tenant_runtime(null, null)) then
    raise exception 'FAIL no arguments returned a row';
  end if;
end $$;
commit;

-- anon: no lookup.
begin;
set local role anon;
do $$ begin
  begin
    perform * from public.erp_tenant_runtime('acme.localhost', null);
    raise exception 'FAIL anon can call erp_tenant_runtime';
  exception when insufficient_privilege then null; end;
end $$;
commit;

select 'ALL CHECKS PASSED' as result;
