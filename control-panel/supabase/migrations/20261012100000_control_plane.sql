-- Control plane schema (docs/SaaS-Commercialization-Plan.md §4.1).
--
-- Runs on the control panel's own Supabase project, never on a tenant (ERP) database.
-- Only platform admins (rows in platform_admins, is_active) can read or write anything:
-- every table has RLS with policies that call is_platform_admin(). anon gets nothing.
-- Every insert, update and delete is written to platform_audit_log by a trigger, and
-- other actions (sign-in, sign-out) through log_platform_action(). The log is append-only.
-- Tenant secrets are stored in Supabase Vault; tenant_secrets only keeps the Vault id.
-- Safe to re-run.

-- ── Vault ──────────────────────────────────────────────────────────────────
-- Supabase projects ship with supabase_vault; create it if it is available but off.
do $$
begin
  if not exists (select 1 from pg_extension where extname = 'supabase_vault')
     and exists (select 1 from pg_available_extensions where name = 'supabase_vault') then
    create extension supabase_vault with schema vault;
  end if;
end $$;

-- ── Helpers ────────────────────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ── Platform admins ────────────────────────────────────────────────────────
create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  role text not null default 'admin' check (role in ('owner', 'admin', 'support')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.is_platform_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.platform_admins
    where user_id = auth.uid() and is_active
  );
$$;

create or replace function public.is_platform_owner()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.platform_admins
    where user_id = auth.uid() and is_active and role = 'owner'
  );
$$;

-- ── Tenants ────────────────────────────────────────────────────────────────
create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 200),
  slug text not null unique check (slug ~ '^[a-z0-9]([a-z0-9-]{0,38}[a-z0-9])?$'),
  status text not null default 'provisioning'
    check (status in ('provisioning', 'trial', 'active', 'past_due', 'read_only', 'suspended', 'cancelled')),
  country text not null default 'AZ' check (country ~ '^[A-Z]{2}$'),
  language text not null default 'az' check (language in ('az', 'en', 'ru')),
  currency text not null default 'AZN' check (currency ~ '^[A-Z]{3}$'),
  notes text,
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tenant_databases (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null unique references public.tenants (id) on delete cascade,
  supabase_project_ref text unique,
  region text,
  schema_version text,
  last_migration text,
  last_migrated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.tenant_domains (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  domain text not null unique check (domain = lower(domain) and domain ~ '^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$'),
  kind text not null default 'subdomain' check (kind in ('subdomain', 'custom')),
  is_primary boolean not null default false,
  ssl_status text not null default 'pending' check (ssl_status in ('pending', 'active', 'failed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists tenant_domains_one_primary on public.tenant_domains (tenant_id) where is_primary;
create index if not exists tenant_domains_tenant on public.tenant_domains (tenant_id);

-- Secret values live in Supabase Vault (vault.secrets); this table only names them.
create table if not exists public.tenant_secrets (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  name text not null check (name ~ '^[a-z][a-z0-9_]{0,62}$'),
  vault_secret_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, name)
);

-- ── Modules and plans ──────────────────────────────────────────────────────
create table if not exists public.modules (
  id text primary key check (id ~ '^[a-z][a-z0-9-]{0,39}$'),
  name text not null,
  depends text[] not null default '{}',
  is_core boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[a-z][a-z0-9-]{0,39}$'),
  name text not null,
  description text,
  annual_discount_pct numeric(5, 2) not null default 0 check (annual_discount_pct between 0 and 100),
  is_active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- module_id null = the plan's platform base fee; otherwise the price of that module.
create table if not exists public.plan_prices (
  id uuid primary key default gen_random_uuid(),
  plan_id uuid not null references public.plans (id) on delete cascade,
  module_id text references public.modules (id),
  billing_period text not null check (billing_period in ('monthly', 'yearly')),
  currency text not null default 'AZN' check (currency ~ '^[A-Z]{3}$'),
  amount numeric(12, 2) not null check (amount >= 0),
  per_user boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique nulls not distinct (plan_id, module_id, billing_period, currency)
);

-- ── Subscriptions and billing ──────────────────────────────────────────────
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  plan_id uuid not null references public.plans (id),
  status text not null default 'trial' check (status in ('trial', 'active', 'past_due', 'cancelled', 'expired')),
  billing_period text not null default 'monthly' check (billing_period in ('monthly', 'yearly')),
  currency text not null default 'AZN' check (currency ~ '^[A-Z]{3}$'),
  user_count integer not null default 1 check (user_count > 0),
  current_period_start date,
  current_period_end date,
  trial_ends_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (current_period_end is null or current_period_start is null or current_period_end >= current_period_start)
);
-- At most one live subscription per tenant.
create unique index if not exists subscriptions_one_live
  on public.subscriptions (tenant_id) where status in ('trial', 'active', 'past_due');

create table if not exists public.subscription_items (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.subscriptions (id) on delete cascade,
  module_id text not null references public.modules (id),
  quantity integer not null default 1 check (quantity > 0),
  unit_price numeric(12, 2) check (unit_price is null or unit_price >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (subscription_id, module_id)
);

create table if not exists public.invoices (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  subscription_id uuid references public.subscriptions (id) on delete set null,
  number text not null unique,
  status text not null default 'draft' check (status in ('draft', 'issued', 'paid', 'overdue', 'void')),
  currency text not null default 'AZN' check (currency ~ '^[A-Z]{3}$'),
  subtotal numeric(12, 2) not null default 0 check (subtotal >= 0),
  tax numeric(12, 2) not null default 0 check (tax >= 0),
  total numeric(12, 2) not null default 0 check (total >= 0),
  period_start date,
  period_end date,
  issued_at timestamptz,
  due_date date,
  paid_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  invoice_id uuid references public.invoices (id) on delete set null,
  amount numeric(12, 2) not null check (amount > 0),
  currency text not null default 'AZN' check (currency ~ '^[A-Z]{3}$'),
  method text not null check (method in ('bank_transfer', 'card', 'cash', 'other')),
  provider text,
  provider_reference text,
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed', 'refunded')),
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.usage_snapshots (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  snapshot_date date not null,
  active_users integer not null default 0 check (active_users >= 0),
  storage_bytes bigint not null default 0 check (storage_bytes >= 0),
  ai_requests integer not null default 0 check (ai_requests >= 0),
  ai_cost numeric(12, 4) not null default 0 check (ai_cost >= 0),
  created_at timestamptz not null default now(),
  unique (tenant_id, snapshot_date)
);

create index if not exists subscriptions_tenant on public.subscriptions (tenant_id);
create index if not exists subscription_items_subscription on public.subscription_items (subscription_id);
create index if not exists invoices_tenant on public.invoices (tenant_id);
create index if not exists payments_tenant on public.payments (tenant_id);
create index if not exists payments_invoice on public.payments (invoice_id);
create index if not exists plan_prices_plan on public.plan_prices (plan_id);

-- ── Audit log (append-only) ────────────────────────────────────────────────
create table if not exists public.platform_audit_log (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  actor_id uuid,
  actor_email text,
  action text not null,
  entity_table text,
  entity_id text,
  details jsonb not null default '{}'::jsonb
);
create index if not exists platform_audit_log_created on public.platform_audit_log (created_at desc);
create index if not exists platform_audit_log_entity on public.platform_audit_log (entity_table, entity_id);

create or replace function public.audit_platform_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row jsonb := to_jsonb(coalesce(new, old));
  v_details jsonb;
begin
  if tg_op = 'UPDATE' then
    -- Only the columns that changed.
    select coalesce(jsonb_object_agg(n.key, jsonb_build_object('old', o.value, 'new', n.value)), '{}'::jsonb)
      into v_details
      from jsonb_each(to_jsonb(new)) n
      join jsonb_each(to_jsonb(old)) o using (key)
     where n.value is distinct from o.value and n.key <> 'updated_at';
    if v_details = '{}'::jsonb then
      return new;
    end if;
    v_details := jsonb_build_object('changes', v_details);
  elsif tg_op = 'INSERT' then
    v_details := jsonb_build_object('new', to_jsonb(new));
  else
    v_details := jsonb_build_object('old', to_jsonb(old));
  end if;

  insert into public.platform_audit_log (actor_id, actor_email, action, entity_table, entity_id, details)
  values (
    auth.uid(),
    (select email from public.platform_admins where user_id = auth.uid()),
    lower(tg_op),
    tg_table_name,
    coalesce(v_row ->> 'id', v_row ->> 'user_id'),
    v_details
  );
  return coalesce(new, old);
end;
$$;

-- For actions that change no row (sign-in, sign-out, a future "provision" button).
create or replace function public.log_platform_action(
  p_action text,
  p_entity_table text default null,
  p_entity_id text default null,
  p_details jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'not a platform admin' using errcode = '42501';
  end if;
  if p_action is null or p_action !~ '^[a-z][a-z0-9_.]{0,62}$' then
    raise exception 'invalid action' using errcode = '22023';
  end if;
  insert into public.platform_audit_log (actor_id, actor_email, action, entity_table, entity_id, details)
  values (
    auth.uid(),
    (select email from public.platform_admins where user_id = auth.uid()),
    p_action,
    p_entity_table,
    p_entity_id,
    coalesce(p_details, '{}'::jsonb)
  );
end;
$$;

-- Stores or replaces a tenant secret in Vault. There is deliberately no function that
-- returns a secret value: provisioning reads them server-side with the service role.
create or replace function public.set_tenant_secret(p_tenant_id uuid, p_name text, p_value text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing uuid;
  v_vault_name text := 'tenant:' || p_tenant_id::text || ':' || p_name;
begin
  if not public.is_platform_admin() then
    raise exception 'not a platform admin' using errcode = '42501';
  end if;
  if p_value is null or length(p_value) = 0 then
    raise exception 'empty secret' using errcode = '22023';
  end if;

  select vault_secret_id into v_existing
    from public.tenant_secrets where tenant_id = p_tenant_id and name = p_name;

  if v_existing is null then
    v_existing := vault.create_secret(p_value, v_vault_name, 'Control plane tenant secret');
    insert into public.tenant_secrets (tenant_id, name, vault_secret_id)
    values (p_tenant_id, p_name, v_existing);
  else
    perform vault.update_secret(v_existing, p_value, v_vault_name, 'Control plane tenant secret');
    update public.tenant_secrets set updated_at = now()
     where tenant_id = p_tenant_id and name = p_name;
  end if;
  return v_existing;
end;
$$;

-- ── Triggers ───────────────────────────────────────────────────────────────
do $$
declare
  t text;
begin
  foreach t in array array[
    'platform_admins', 'tenants', 'tenant_databases', 'tenant_domains', 'tenant_secrets',
    'modules', 'plans', 'plan_prices', 'subscriptions', 'subscription_items',
    'invoices', 'payments', 'usage_snapshots'
  ] loop
    execute format('drop trigger if exists %I on public.%I', 'trg_audit_' || t, t);
    execute format(
      'create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_platform_change()',
      'trg_audit_' || t, t
    );
    if t <> 'usage_snapshots' then
      execute format('drop trigger if exists %I on public.%I', 'trg_updated_at_' || t, t);
      execute format(
        'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
        'trg_updated_at_' || t, t
      );
    end if;
  end loop;
end $$;

-- ── Row level security ─────────────────────────────────────────────────────
do $$
declare
  t text;
begin
  -- Tables platform admins read and write directly.
  foreach t in array array[
    'tenants', 'tenant_databases', 'tenant_domains', 'modules', 'plans', 'plan_prices',
    'subscriptions', 'subscription_items', 'invoices', 'payments', 'usage_snapshots'
  ] loop
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

-- platform_admins: every admin can see the team; only owners change it.
alter table public.platform_admins enable row level security;
revoke all on table public.platform_admins from anon, authenticated;
grant select, insert, update, delete on table public.platform_admins to authenticated;
drop policy if exists platform_admins_select on public.platform_admins;
create policy platform_admins_select on public.platform_admins
  for select to authenticated using (public.is_platform_admin());
drop policy if exists platform_admins_owner_write on public.platform_admins;
create policy platform_admins_owner_write on public.platform_admins
  for all to authenticated using (public.is_platform_owner()) with check (public.is_platform_owner());

-- tenant_secrets: admins see which secrets exist; values only change through set_tenant_secret().
alter table public.tenant_secrets enable row level security;
revoke all on table public.tenant_secrets from anon, authenticated;
grant select, delete on table public.tenant_secrets to authenticated;
drop policy if exists tenant_secrets_select on public.tenant_secrets;
create policy tenant_secrets_select on public.tenant_secrets
  for select to authenticated using (public.is_platform_admin());
drop policy if exists tenant_secrets_delete on public.tenant_secrets;
create policy tenant_secrets_delete on public.tenant_secrets
  for delete to authenticated using (public.is_platform_owner());

-- platform_audit_log: readable by admins, written only by the functions above.
alter table public.platform_audit_log enable row level security;
revoke all on table public.platform_audit_log from anon, authenticated;
grant select on table public.platform_audit_log to authenticated;
drop policy if exists platform_audit_log_select on public.platform_audit_log;
create policy platform_audit_log_select on public.platform_audit_log
  for select to authenticated using (public.is_platform_admin());

-- Functions: only signed-in users may call them (each checks is_platform_admin itself).
revoke all on function public.is_platform_admin() from public, anon;
revoke all on function public.is_platform_owner() from public, anon;
revoke all on function public.log_platform_action(text, text, text, jsonb) from public, anon;
revoke all on function public.set_tenant_secret(uuid, text, text) from public, anon;
revoke all on function public.audit_platform_change() from public, anon, authenticated;
grant execute on function public.is_platform_admin() to authenticated;
grant execute on function public.is_platform_owner() to authenticated;
grant execute on function public.log_platform_action(text, text, text, jsonb) to authenticated;
grant execute on function public.set_tenant_secret(uuid, text, text) to authenticated;

-- ── Seed: the ERP modules (src/modules/*/manifest.ts) ───────────────────────
-- Prices are not seeded: Del sets them per plan in plan_prices.
insert into public.modules (id, name, depends, is_core) values
  ('core', 'Core', '{}', true),
  ('accounting', 'Accounting', '{core}', false),
  ('inventory', 'Inventory', '{core}', false),
  ('contracts', 'Contracts', '{core}', false),
  ('sales', 'Sales', '{core,inventory,accounting,contracts}', false),
  ('purchases', 'Purchases', '{core,inventory,accounting,contracts}', false),
  ('polywood', 'Polywood', '{core,inventory,sales}', false),
  ('production', 'Production', '{core,inventory}', false),
  ('expenses', 'Expenses', '{core,accounting}', false),
  ('hr', 'Human resources', '{core}', false),
  ('tax-az', 'Azerbaijan tax', '{core,accounting}', false),
  ('payroll', 'Payroll', '{core,hr,accounting,tax-az}', false),
  ('crm', 'CRM', '{core,sales}', false),
  ('consignment', 'Consignment', '{core,inventory,sales}', false),
  ('commissions', 'Commissions', '{core,hr,sales}', false),
  ('barcode', 'Barcode', '{core,inventory}', false),
  ('ai', 'AI assistant', '{core}', false),
  ('studio', 'Studio', '{core}', false)
on conflict (id) do update set name = excluded.name, depends = excluded.depends, is_core = excluded.is_core;
