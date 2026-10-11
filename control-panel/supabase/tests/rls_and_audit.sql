-- Checks RLS, the audit log and Vault secrets on a database built from the migrations.
-- Run after scripts/db/supabase-shim.sql, vault-shim.sql and the migrations (see .github/workflows/control-panel.yml).
-- Any failed check raises an exception; the last line prints ALL CHECKS PASSED.

-- Users: one admin (owner), one signed-in non-admin.
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'owner@example.test'),
  ('22222222-2222-2222-2222-222222222222', 'someone@example.test')
on conflict do nothing;
-- Bootstrap (as the database owner, like the SQL editor): make the first owner.
insert into public.platform_admins (user_id, email, role) values
  ('11111111-1111-1111-1111-111111111111', 'owner@example.test', 'owner') on conflict do nothing;

-- Non-admin: sees nothing, cannot write.
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
do $$ begin
  if (select count(*) from public.modules) <> 0 then raise exception 'FAIL non-admin can read modules'; end if;
  if (select count(*) from public.platform_admins) <> 0 then raise exception 'FAIL non-admin can read admins'; end if;
  begin
    insert into public.tenants (name, slug) values ('X', 'x');
    raise exception 'FAIL non-admin inserted a tenant';
  exception when insufficient_privilege then null; end;
  begin
    perform public.log_platform_action('login');
    raise exception 'FAIL non-admin wrote the audit log';
  exception when insufficient_privilege then null; end;
end $$;
commit;

-- Admin: full read/write, audit rows, Vault secret.
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
do $$
declare v_id uuid; n int;
begin
  if (select count(*) from public.modules) <> 18 then raise exception 'FAIL modules seed: %', (select count(*) from public.modules); end if;
  insert into public.tenants (name, slug) values ('Acme MMC', 'acme') returning id into v_id;
  if (select created_by from public.tenants where id = v_id) <> '11111111-1111-1111-1111-111111111111' then raise exception 'FAIL created_by'; end if;
  update public.tenants set status = 'trial', name = 'Acme' where id = v_id;
  update public.tenants set name = 'Acme' where id = v_id;  -- no change: no audit row
  select count(*) into n from public.platform_audit_log where entity_table = 'tenants' and entity_id = v_id::text;
  if n <> 2 then raise exception 'FAIL expected 2 tenant audit rows, got %', n; end if;
  if (select actor_email from public.platform_audit_log where entity_table = 'tenants' and action = 'update' limit 1) <> 'owner@example.test'
    then raise exception 'FAIL audit actor'; end if;
  if (select details -> 'changes' -> 'status' ->> 'new' from public.platform_audit_log where entity_table = 'tenants' and action = 'update' limit 1) <> 'trial'
    then raise exception 'FAIL audit diff'; end if;
  perform public.log_platform_action('login');
  if not exists (select 1 from public.platform_audit_log where action = 'login') then raise exception 'FAIL login log'; end if;
  begin
    insert into public.tenants (name, slug) values ('Bad', 'Bad Slug');
    raise exception 'FAIL bad slug accepted';
  exception when check_violation then null; end;
  begin
    update public.tenants set status = 'nope' where id = v_id;
    raise exception 'FAIL bad status accepted';
  exception when check_violation then null; end;
  -- Secrets go to Vault; the table holds only the id.
  perform public.set_tenant_secret(v_id, 'service_role_key', 'first');
  perform public.set_tenant_secret(v_id, 'service_role_key', 'second');
  if (select count(*) from public.tenant_secrets where tenant_id = v_id) <> 1 then raise exception 'FAIL secret rows'; end if;
  begin
    insert into public.tenant_secrets (tenant_id, name, vault_secret_id) values (v_id, 'x', gen_random_uuid());
    raise exception 'FAIL direct secret insert allowed';
  exception when insufficient_privilege then null; end;
  begin
    perform 1 from vault.secrets;
    raise exception 'FAIL authenticated can read vault';
  exception when insufficient_privilege then null; end;
  begin
    insert into public.platform_audit_log (action) values ('forged');
    raise exception 'FAIL audit log insert allowed';
  exception when insufficient_privilege then null; end;
  begin
    delete from public.platform_audit_log;
    raise exception 'FAIL audit log delete allowed';
  exception when insufficient_privilege then null; end;
  insert into public.plans (code, name, annual_discount_pct) values ('starter', 'Starter', 17);
  insert into public.plan_prices (plan_id, module_id, billing_period, amount, per_user)
    select id, null, 'monthly', 20, false from public.plans where code = 'starter';
  begin
    insert into public.plan_prices (plan_id, module_id, billing_period, amount, per_user)
      select id, null, 'monthly', 25, false from public.plans where code = 'starter';
    raise exception 'FAIL duplicate base price allowed';
  exception when unique_violation then null; end;
  insert into public.subscriptions (tenant_id, plan_id, status) select v_id, id, 'trial' from public.plans where code = 'starter';
  begin
    insert into public.subscriptions (tenant_id, plan_id, status) select v_id, id, 'active' from public.plans where code = 'starter';
    raise exception 'FAIL two live subscriptions allowed';
  exception when unique_violation then null; end;
  insert into public.tenant_domains (tenant_id, domain, is_primary) values (v_id, 'acme.example.az', true);
  insert into public.usage_snapshots (tenant_id, snapshot_date, active_users) values (v_id, current_date, 7);
end $$;
commit;

-- Vault really holds the latest value (checked as the owner).
do $$ begin
  if (select s.secret from vault.secrets s join public.tenant_secrets t on t.vault_secret_id = s.id) <> 'second'
    then raise exception 'FAIL vault value'; end if;
end $$;

-- anon: no access at all.
begin;
set local role anon;
do $$ begin
  begin
    perform 1 from public.tenants;
    raise exception 'FAIL anon can read tenants';
  exception when insufficient_privilege then null; end;
  begin
    perform public.is_platform_admin();
    raise exception 'FAIL anon can call is_platform_admin';
  exception when insufficient_privilege then null; end;
end $$;
commit;

select 'ALL CHECKS PASSED' as result;
