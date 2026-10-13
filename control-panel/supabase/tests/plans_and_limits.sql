-- Checks 20261014100000_plans_and_limits.sql after rls_and_audit.sql: tenant_entitlements()
-- gives the same limits as entitlements() in lib/billing/pricing.ts (same scenario as
-- tests/pricing.test.mjs), and the new tables are admin-only. Prints ALL CHECKS PASSED.

begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
do $$
declare v_plan uuid; v_tenant uuid; v_sub uuid; e record;
begin
  if (select count(*) from public.addons) <> 4 then raise exception 'FAIL addons seed'; end if;

  insert into public.plans (code, name, annual_discount_pct, max_users, included_storage_gb, included_ai_credit_usd)
    values ('business-test', 'Business', 17, 25, 20, 5) returning id into v_plan;
  insert into public.plan_prices (plan_id, module_id, billing_period, amount, per_user) values
    (v_plan, null, 'monthly', 50, false), (v_plan, 'sales', 'monthly', 8, true), (v_plan, 'inventory', 'monthly', 5, true),
    (v_plan, 'accounting', 'monthly', 6, true), (v_plan, 'contracts', 'monthly', 20, false);
  insert into public.plan_addon_prices (plan_id, addon_code, amount) values
    (v_plan, 'extra_users', 15), (v_plan, 'storage_gb', 3.5), (v_plan, 'ai_credit', 12), (v_plan, 'custom_domain', 9.99);
  begin
    insert into public.plan_addon_prices (plan_id, addon_code, amount) values (v_plan, 'extra_users', 1);
    raise exception 'FAIL duplicate add-on price';
  exception when unique_violation then null; end;
  begin
    update public.plans set max_users = 0 where id = v_plan;
    raise exception 'FAIL max_users 0 accepted';
  exception when check_violation then null; end;

  insert into public.tenants (name, slug, status) values ('Limits Co', 'limits-co', 'active') returning id into v_tenant;
  -- No subscription: no limits.
  if exists (select 1 from public.tenant_entitlements(v_tenant)) then raise exception 'FAIL entitlements without subscription'; end if;

  insert into public.subscriptions (tenant_id, plan_id, status, user_count) values (v_tenant, v_plan, 'active', 5) returning id into v_sub;
  insert into public.subscription_items (subscription_id, module_id) values (v_sub, 'sales');
  select * into e from public.tenant_entitlements(v_tenant);
  if e.seat_limit <> 5 or e.storage_limit_bytes <> 20::bigint * 1073741824 or e.ai_limit_usd <> 5 or e.custom_domain then
    raise exception 'FAIL plain entitlements %', row_to_json(e);
  end if;
  if e.modules <> array['accounting', 'contracts', 'core', 'inventory', 'sales'] then
    raise exception 'FAIL modules with dependencies: %', e.modules;
  end if;
  if (select sync_status from public.subscriptions where id = v_sub) <> 'not_synced' then raise exception 'FAIL sync default'; end if;

  insert into public.subscription_addons (subscription_id, addon_code, quantity) values
    (v_sub, 'extra_users', 2), (v_sub, 'storage_gb', 3), (v_sub, 'ai_credit', 2), (v_sub, 'custom_domain', 1);
  select * into e from public.tenant_entitlements(v_tenant);
  if e.seat_limit <> 7 or e.storage_limit_bytes <> 50::bigint * 1073741824 or e.ai_limit_usd <> 25 or not e.custom_domain then
    raise exception 'FAIL entitlements with add-ons %', row_to_json(e);
  end if;

  -- Unlimited storage / AI when the plan says null, add-ons or not.
  update public.plans set included_storage_gb = null, included_ai_credit_usd = null where id = v_plan;
  select * into e from public.tenant_entitlements(v_tenant);
  if e.storage_limit_bytes is not null or e.ai_limit_usd is not null then raise exception 'FAIL unlimited'; end if;

  -- A cancelled subscription grants nothing.
  update public.subscriptions set status = 'cancelled' where id = v_sub;
  if exists (select 1 from public.tenant_entitlements(v_tenant)) then raise exception 'FAIL cancelled still entitled'; end if;
  update public.subscriptions set status = 'active' where id = v_sub;

  if not exists (select 1 from public.platform_audit_log where entity_table = 'subscription_addons') then
    raise exception 'FAIL subscription_addons not audited';
  end if;
end $$;
commit;

-- save_plan / save_subscription: one transaction each, replace prices / items / add-ons.
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}', true);
do $$
declare v_plan uuid; v_plan2 uuid; v_tenant uuid; v_sub uuid; v_sub2 uuid; e record;
begin
  v_plan := public.save_plan('{"code":"starter-test","name":"Starter","annual_discount_pct":10,"max_users":5,
    "included_storage_gb":5,"included_ai_credit_usd":2,"currency":"AZN","base_fee":20,
    "modules":[{"module_id":"inventory","amount":3,"per_user":true},{"module_id":"hr","amount":2,"per_user":true}],
    "addons":[{"addon_code":"extra_users","amount":6}]}');
  if (select count(*) from public.plan_prices where plan_id = v_plan) <> 3 then raise exception 'FAIL save_plan prices'; end if;
  -- Saving again replaces, not appends.
  v_plan2 := public.save_plan(jsonb_build_object('id', v_plan, 'code', 'starter-test', 'name', 'Starter 2', 'annual_discount_pct', 15,
    'max_users', 5, 'currency', 'AZN', 'base_fee', 25, 'modules', '[{"module_id":"inventory","amount":4,"per_user":true}]'::jsonb, 'addons', '[]'::jsonb));
  if v_plan2 <> v_plan then raise exception 'FAIL save_plan created a second plan'; end if;
  if (select count(*) from public.plan_prices where plan_id = v_plan) <> 2
     or (select amount from public.plan_prices where plan_id = v_plan and module_id is null) <> 25
     or exists (select 1 from public.plan_addon_prices where plan_id = v_plan)
     or (select name from public.plans where id = v_plan) <> 'Starter 2' then
    raise exception 'FAIL save_plan replace';
  end if;
  -- A bad module id rolls the whole save back.
  begin
    perform public.save_plan(jsonb_build_object('id', v_plan, 'code', 'starter-test', 'name', 'Broken', 'annual_discount_pct', 0,
      'base_fee', 1, 'modules', '[{"module_id":"no-such-module","amount":1}]'::jsonb));
    raise exception 'FAIL bad module accepted';
  exception when foreign_key_violation then null; end;
  if (select name from public.plans where id = v_plan) <> 'Starter 2' then raise exception 'FAIL partial plan save'; end if;

  insert into public.tenants (name, slug, status) values ('Five Seats', 'five-seats', 'active') returning id into v_tenant;
  v_sub := public.save_subscription(jsonb_build_object('tenant_id', v_tenant, 'plan_id', v_plan, 'status', 'active',
    'billing_period', 'monthly', 'user_count', 5, 'current_period_start', '2026-10-01', 'current_period_end', '2026-10-31',
    'modules', '["inventory"]'::jsonb, 'addons', '[{"addon_code":"extra_users","quantity":0}]'::jsonb));
  select * into e from public.tenant_entitlements(v_tenant);
  if e.seat_limit <> 5 or e.modules <> array['core', 'inventory'] then raise exception 'FAIL 5-seat entitlements %', row_to_json(e); end if;
  if (select unit_price from public.subscription_items where subscription_id = v_sub) <> 4 then raise exception 'FAIL unit price copy'; end if;
  if exists (select 1 from public.subscription_addons where subscription_id = v_sub) then raise exception 'FAIL zero add-on stored'; end if;
  update public.subscriptions set sync_status = 'synced' where id = v_sub;
  -- Changing it updates the same live subscription and marks it unsynced.
  v_sub2 := public.save_subscription(jsonb_build_object('tenant_id', v_tenant, 'plan_id', v_plan, 'status', 'active',
    'billing_period', 'yearly', 'user_count', 6, 'modules', '["inventory"]'::jsonb, 'addons', '[]'::jsonb));
  if v_sub2 <> v_sub or (select sync_status from public.subscriptions where id = v_sub) <> 'not_synced'
     or (select user_count from public.subscriptions where id = v_sub) <> 6 then
    raise exception 'FAIL subscription update';
  end if;
  -- Cancelling ends the entitlements.
  perform public.save_subscription(jsonb_build_object('tenant_id', v_tenant, 'plan_id', v_plan, 'status', 'cancelled',
    'billing_period', 'yearly', 'user_count', 6, 'modules', '[]'::jsonb, 'addons', '[]'::jsonb));
  if exists (select 1 from public.tenant_entitlements(v_tenant)) then raise exception 'FAIL cancelled entitlements'; end if;
  if (select cancelled_at from public.subscriptions where id = v_sub) is null then raise exception 'FAIL cancelled_at'; end if;
end $$;
commit;

-- Non-admin: cannot save.
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
do $$ begin
  begin
    perform public.save_plan('{"code":"evil","name":"Evil","annual_discount_pct":0,"base_fee":0}');
    raise exception 'FAIL non-admin saved a plan';
  exception when insufficient_privilege then null; end;
end $$;
commit;

-- Non-admin: no prices, no entitlements.
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}', true);
do $$ begin
  if exists (select 1 from public.plan_addon_prices) then raise exception 'FAIL non-admin reads add-on prices'; end if;
  if exists (select 1 from public.tenant_entitlements((select id from public.tenants where slug = 'limits-co'))) then
    raise exception 'FAIL non-admin reads entitlements';
  end if;
end $$;
commit;

-- The service role (ERP, usage job) reads entitlements. Supabase grants service_role every
-- public table by default; the plain-Postgres shim does not, so do it here.
grant select on all tables in schema public to service_role;
begin;
set local role service_role;
do $$ begin
  if (select seat_limit from public.tenant_entitlements((select id from public.tenants where slug = 'limits-co'))) <> 7 then
    raise exception 'FAIL service role entitlements';
  end if;
end $$;
commit;

begin;
set local role anon;
do $$ begin
  begin
    perform public.tenant_entitlements(gen_random_uuid());
    raise exception 'FAIL anon can call tenant_entitlements';
  exception when insufficient_privilege then null; end;
end $$;
commit;

select 'ALL CHECKS PASSED' as result;
