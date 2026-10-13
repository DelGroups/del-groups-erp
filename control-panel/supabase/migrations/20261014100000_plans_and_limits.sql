-- Plans priced by modules and users, add-ons, and the limits a subscription grants (prompt 12,
-- plan §4.2 / §4.4). Prices are monthly; the yearly price is monthly × 12 × (1 − discount)
-- (control-panel/lib/billing/pricing.ts). Safe to re-run.
--
--   plans                 + max_users, included_storage_gb, included_ai_credit_usd,
--                           includes_custom_domain (null storage/AI = unlimited)
--   addons                the four add-ons and what one unit gives (seeded)
--   plan_addon_prices     a plan's monthly price per add-on unit
--   subscription_addons   add-on quantities of a subscription
--   subscriptions         + sync_status / synced_at / sync_error (copy to the tenant database)
--   tenant_entitlements() seats, storage, AI and modules of the tenant's live subscription;
--                         no live subscription = no row = no limits
--   save_plan(), save_subscription()  one-transaction saves for the panel's editors

alter table public.plans add column if not exists max_users integer;
alter table public.plans add column if not exists included_storage_gb numeric(10, 2);
alter table public.plans add column if not exists included_ai_credit_usd numeric(10, 2);
alter table public.plans add column if not exists includes_custom_domain boolean not null default false;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'plans_limits_check' and conrelid = 'public.plans'::regclass) then
    alter table public.plans add constraint plans_limits_check check (
      (max_users is null or max_users between 1 and 10000)
      and (included_storage_gb is null or included_storage_gb >= 0)
      and (included_ai_credit_usd is null or included_ai_credit_usd >= 0)
    );
  end if;
end $$;

create table if not exists public.addons (
  code text primary key check (code in ('extra_users', 'storage_gb', 'ai_credit', 'custom_domain')),
  name text not null,
  -- What one unit gives: seats, GB, USD of AI usage per month, or one domain.
  unit_size numeric(10, 2) not null check (unit_size > 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into public.addons (code, name, unit_size, sort_order) values
  ('extra_users', 'Extra user', 1, 1),
  ('storage_gb', 'Storage, 10 GB', 10, 2),
  ('ai_credit', 'AI credit, 10 USD per month', 10, 3),
  ('custom_domain', 'Custom domain', 1, 4)
on conflict (code) do nothing;

create table if not exists public.plan_addon_prices (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans (id) on delete cascade,
  addon_code text not null references public.addons (code),
  currency text not null default 'AZN' check (currency ~ '^[A-Z]{3}$'),
  -- Monthly price of one unit.
  amount numeric(12, 2) not null check (amount >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_id, addon_code, currency)
);
create index if not exists plan_addon_prices_plan on public.plan_addon_prices (plan_id);

create table if not exists public.subscription_addons (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions (id) on delete cascade,
  addon_code text not null references public.addons (code),
  quantity integer not null check (quantity between 0 and 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (subscription_id, addon_code)
);
create index if not exists subscription_addons_subscription on public.subscription_addons (subscription_id);

-- Whether the tenant database has the subscription's modules and limits (lib/billing/sync.ts).
alter table public.subscriptions add column if not exists sync_status text not null default 'not_synced';
alter table public.subscriptions add column if not exists synced_at timestamptz;
alter table public.subscriptions add column if not exists sync_error text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'subscriptions_sync_status_check' and conrelid = 'public.subscriptions'::regclass) then
    alter table public.subscriptions add constraint subscriptions_sync_status_check
      check (sync_status in ('not_synced', 'synced', 'failed'));
  end if;
end $$;

-- ── Entitlements ───────────────────────────────────────────────────────────
-- Runs as the caller: platform admins (RLS) in the panel, the service role for the ERP
-- (POST /rest/v1/rpc/tenant_entitlements) and the usage job. Same rules as
-- entitlements() in lib/billing/pricing.ts.
create or replace function public.tenant_entitlements(p_tenant_id uuid)
returns table (
  subscription_id uuid,
  status text,
  seat_limit integer,
  storage_limit_bytes bigint,
  ai_limit_usd numeric,
  custom_domain boolean,
  modules text[]
)
language sql
stable
set search_path = ''
as $$
  with recursive s as (
    select sub.*, p.included_storage_gb, p.included_ai_credit_usd, p.includes_custom_domain
      from public.subscriptions sub
      join public.plans p on p.id = sub.plan_id
     where sub.tenant_id = p_tenant_id and sub.status in ('trial', 'active', 'past_due')
     limit 1
  ),
  q as (
    select a.code, sa.quantity * a.unit_size as units, sa.quantity
      from s join public.subscription_addons sa on sa.subscription_id = s.id
      join public.addons a on a.code = sa.addon_code
  ),
  chosen(id) as (
    select m.id from public.modules m where m.is_core
    union
    select si.module_id from s join public.subscription_items si on si.subscription_id = s.id
    union
    select dep from chosen c join public.modules m on m.id = c.id cross join unnest(m.depends) as dep
  )
  select
    s.id,
    s.status,
    (s.user_count + coalesce((select units from q where code = 'extra_users'), 0))::integer,
    case when s.included_storage_gb is null then null
         else round((s.included_storage_gb + coalesce((select units from q where code = 'storage_gb'), 0)) * 1073741824)::bigint end,
    case when s.included_ai_credit_usd is null then null
         else s.included_ai_credit_usd + coalesce((select units from q where code = 'ai_credit'), 0) end,
    s.includes_custom_domain or coalesce((select quantity from q where code = 'custom_domain'), 0) > 0,
    (select array_agg(c.id order by c.id) from chosen c)
  from s;
$$;

revoke all on function public.tenant_entitlements(uuid) from public, anon;
grant execute on function public.tenant_entitlements(uuid) to authenticated, service_role;

-- ── Saving a plan or a subscription in one transaction ─────────────────────
-- Both run as the caller (platform admins under RLS; every row change is audited).

-- p: {id?, code, name, description, annual_discount_pct, is_active, sort_order, max_users,
--     included_storage_gb, included_ai_credit_usd, includes_custom_domain, currency, base_fee,
--     modules: [{module_id, amount, per_user}], addons: [{addon_code, amount}]}
-- Replaces the plan's monthly prices and add-on prices with the given ones.
create or replace function public.save_plan(p jsonb)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_currency text := coalesce(nullif(p ->> 'currency', ''), 'AZN');
begin
  if v_id is null then
    insert into public.plans (code, name, description, annual_discount_pct, is_active, sort_order, max_users,
                              included_storage_gb, included_ai_credit_usd, includes_custom_domain)
    values (p ->> 'code', p ->> 'name', nullif(p ->> 'description', ''), (p ->> 'annual_discount_pct')::numeric,
            coalesce((p ->> 'is_active')::boolean, true), coalesce((p ->> 'sort_order')::integer, 0),
            (p ->> 'max_users')::integer, (p ->> 'included_storage_gb')::numeric, (p ->> 'included_ai_credit_usd')::numeric,
            coalesce((p ->> 'includes_custom_domain')::boolean, false))
    returning id into v_id;
  else
    update public.plans set
      code = p ->> 'code', name = p ->> 'name', description = nullif(p ->> 'description', ''),
      annual_discount_pct = (p ->> 'annual_discount_pct')::numeric, is_active = coalesce((p ->> 'is_active')::boolean, true),
      sort_order = coalesce((p ->> 'sort_order')::integer, 0), max_users = (p ->> 'max_users')::integer,
      included_storage_gb = (p ->> 'included_storage_gb')::numeric, included_ai_credit_usd = (p ->> 'included_ai_credit_usd')::numeric,
      includes_custom_domain = coalesce((p ->> 'includes_custom_domain')::boolean, false)
    where id = v_id;
    if not found then
      raise exception 'plan not found' using errcode = 'P0002';
    end if;
  end if;

  delete from public.plan_prices where plan_id = v_id and billing_period = 'monthly';
  insert into public.plan_prices (plan_id, module_id, billing_period, currency, amount, per_user)
  values (v_id, null, 'monthly', v_currency, coalesce((p ->> 'base_fee')::numeric, 0), false);
  insert into public.plan_prices (plan_id, module_id, billing_period, currency, amount, per_user)
  select v_id, m ->> 'module_id', 'monthly', v_currency, (m ->> 'amount')::numeric, coalesce((m ->> 'per_user')::boolean, true)
    from jsonb_array_elements(coalesce(p -> 'modules', '[]')) m;

  delete from public.plan_addon_prices where plan_id = v_id;
  insert into public.plan_addon_prices (plan_id, addon_code, currency, amount)
  select v_id, a ->> 'addon_code', v_currency, (a ->> 'amount')::numeric
    from jsonb_array_elements(coalesce(p -> 'addons', '[]')) a;
  return v_id;
end;
$$;

-- p: {tenant_id, plan_id, status, billing_period, user_count, current_period_start,
--     current_period_end, trial_ends_at, modules: [module_id], addons: [{addon_code, quantity}]}
-- Updates the tenant's live subscription (or creates one) and replaces its modules and
-- add-ons. Module prices are copied from the plan (subscription_items.unit_price) so the
-- price at the time of the change stays on record. Marks it not yet synced.
create or replace function public.save_subscription(p jsonb)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_tenant uuid := (p ->> 'tenant_id')::uuid;
  v_plan uuid := (p ->> 'plan_id')::uuid;
  v_id uuid;
  v_currency text;
begin
  select pp.currency into v_currency from public.plan_prices pp
   where pp.plan_id = v_plan and pp.module_id is null and pp.billing_period = 'monthly' limit 1;
  v_currency := coalesce(v_currency, 'AZN');

  select s.id into v_id from public.subscriptions s
   where s.tenant_id = v_tenant and s.status in ('trial', 'active', 'past_due')
   for update;
  if v_id is null then
    insert into public.subscriptions (tenant_id, plan_id, status, billing_period, currency, user_count,
                                      current_period_start, current_period_end, trial_ends_at)
    values (v_tenant, v_plan, p ->> 'status', p ->> 'billing_period', v_currency, (p ->> 'user_count')::integer,
            nullif(p ->> 'current_period_start', '')::date, nullif(p ->> 'current_period_end', '')::date,
            nullif(p ->> 'trial_ends_at', '')::timestamptz)
    returning id into v_id;
  else
    update public.subscriptions set
      plan_id = v_plan, status = p ->> 'status', billing_period = p ->> 'billing_period', currency = v_currency,
      user_count = (p ->> 'user_count')::integer,
      current_period_start = nullif(p ->> 'current_period_start', '')::date,
      current_period_end = nullif(p ->> 'current_period_end', '')::date,
      trial_ends_at = nullif(p ->> 'trial_ends_at', '')::timestamptz,
      cancelled_at = case when p ->> 'status' = 'cancelled' then now() else null end,
      sync_status = 'not_synced', sync_error = null
    where id = v_id;
  end if;

  delete from public.subscription_items where subscription_id = v_id;
  insert into public.subscription_items (subscription_id, module_id, quantity, unit_price)
  select v_id, m.module_id, 1, pp.amount
    from jsonb_array_elements_text(coalesce(p -> 'modules', '[]')) as m(module_id)
    left join public.plan_prices pp
      on pp.plan_id = v_plan and pp.module_id = m.module_id and pp.billing_period = 'monthly' and pp.currency = v_currency;

  delete from public.subscription_addons where subscription_id = v_id;
  insert into public.subscription_addons (subscription_id, addon_code, quantity)
  select v_id, a ->> 'addon_code', (a ->> 'quantity')::integer
    from jsonb_array_elements(coalesce(p -> 'addons', '[]')) a
   where (a ->> 'quantity')::integer > 0;
  return v_id;
end;
$$;

revoke all on function public.save_plan(jsonb) from public, anon;
revoke all on function public.save_subscription(jsonb) from public, anon;
grant execute on function public.save_plan(jsonb) to authenticated;
grant execute on function public.save_subscription(jsonb) to authenticated;

-- ── Audit, updated_at, row level security ──────────────────────────────────
do $$
declare
  t text;
begin
  foreach t in array array['addons', 'plan_addon_prices', 'subscription_addons'] loop
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

do $$
declare
  t text;
begin
  foreach t in array array['addons', 'plan_addon_prices', 'subscription_addons'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon, authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_platform_admins', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.is_platform_admin()) with check (public.is_platform_admin())',
      t || '_platform_admins', t
    );
  end loop;
end $$;
