-- Company profile: one row describing the company that uses this ERP (name,
-- VÖEN, address, bank, logo, seal, default currency/VAT). Replaces the values
-- that were hard-coded in the app and the overlapping `settings` /
-- `company_settings` tables, which stay in place (read-only fallback) for now.
--
-- On an existing install the row is filled with exactly what the screens show
-- today, so nothing changes visually. On a fresh database it stays empty.
-- Safe to re-run.

create table if not exists public.company_profile (
  id boolean primary key default true check (id),
  display_name text not null default '',
  legal_name text not null default '',
  voen text not null default '',
  address text not null default '',
  phone text not null default '',
  email text not null default '',
  bank_name text not null default '',
  iban text not null default '',
  logo_url text not null default '',
  seal_url text not null default '',
  default_currency text not null default 'AZN' check (default_currency ~ '^[A-Z]{3}$'),
  default_vat_rate numeric(5,2) not null default 18 check (default_vat_rate between 0 and 100),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

comment on table public.company_profile is
  'Single row: the company using this ERP. Edited under Settings → Company.';

alter table public.company_profile enable row level security;

drop policy if exists company_profile_select on public.company_profile;
create policy company_profile_select on public.company_profile
  for select to authenticated
  using (public.is_active_user());

drop policy if exists company_profile_insert on public.company_profile;
create policy company_profile_insert on public.company_profile
  for insert to authenticated
  with check (public.require_permission('can_manage_settings'));

drop policy if exists company_profile_update on public.company_profile;
create policy company_profile_update on public.company_profile
  for update to authenticated
  using (public.require_permission('can_manage_settings'))
  with check (public.require_permission('can_manage_settings'));

revoke all on table public.company_profile from public, anon, authenticated;
grant select, insert, update on table public.company_profile to authenticated;
grant all on table public.company_profile to service_role;

-- Branding (header name, logo, seal) is admin-only. The service role
-- (auth.uid() is null) is not restricted.
create or replace function public.company_profile_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and not public.user_is_admin() and (
    new.display_name is distinct from old.display_name
    or new.logo_url is distinct from old.logo_url
    or new.seal_url is distinct from old.seal_url
  ) then
    raise exception 'forbidden: only an admin can change the company name, logo or seal';
  end if;
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$$;

revoke all on function public.company_profile_guard() from public, anon;

drop trigger if exists company_profile_guard on public.company_profile;
create trigger company_profile_guard
  before update on public.company_profile
  for each row execute function public.company_profile_guard();

insert into public.company_profile (id) values (true) on conflict (id) do nothing;

-- Existing install: copy today's values with the precedence the app used.
-- The literals are Del Groups' former hard-coded fallbacks.
do $$
begin
  if not exists (select 1 from public.settings) and not exists (select 1 from public.company_settings) then
    return; -- fresh database: keep the profile empty
  end if;
  if exists (select 1 from public.company_profile where legal_name <> '' or display_name <> '') then
    return; -- already filled (re-run)
  end if;

  update public.company_profile p set
    display_name     = coalesce(nullif(trim(s.company_name), ''), 'DEL GROUPS MMC'),
    legal_name       = coalesce(nullif(trim(c.company_name), ''), nullif(trim(s.company_name), ''), 'DEL GROUPS MMC'),
    voen             = coalesce(nullif(trim(c.voen), ''), nullif(trim(s.voen), ''), ''),
    address          = coalesce(nullif(trim(c.address), ''), nullif(trim(s.address), ''), ''),
    phone            = coalesce(nullif(trim(c.phone), ''), nullif(trim(s.phone), ''), ''),
    email            = coalesce(nullif(trim(c.email), ''), ''),
    bank_name        = coalesce(nullif(trim(c.bank_name), ''), ''),
    iban             = coalesce(nullif(trim(c.iban), ''), ''),
    logo_url         = coalesce(nullif(trim(s.logo_url), ''), ''),
    seal_url         = coalesce(nullif(trim(crm.value ->> 'company_seal_signature_url'), ''), ''),
    default_currency = coalesce(nullif(upper(trim(c.currency)), ''), 'AZN'),
    default_vat_rate = coalesce(c.vat_rate, 18)
  from (select 1) as one
  left join lateral (select * from public.settings limit 1) s on true
  left join lateral (select * from public.company_settings limit 1) c on true
  left join lateral (select value from public.system_settings where key = 'crm_config') crm on true
  where p.id;

  -- The thermal label header used to default to this name in code.
  insert into public.system_settings (key, value, updated_at)
  values ('barcode_label_config', jsonb_build_object('header_title', 'DEL GROUPS MMC'), now())
  on conflict (key) do update
    set value = public.system_settings.value || jsonb_build_object('header_title', 'DEL GROUPS MMC'),
        updated_at = now()
    where coalesce(trim(public.system_settings.value ->> 'header_title'), '') = '';

  -- ai.del-groups.com now belongs to another product; its old webhooks are dead.
  update public.system_settings
    set value = value || jsonb_build_object('webhook_url', ''), updated_at = now()
    where key = 'n8n_ai_config'
      and value ->> 'webhook_url' like 'https://ai.del-groups.com/webhook/%';
end;
$$;

-- New databases should not start with Del Groups' name in the legacy tables.
alter table public.settings alter column company_name drop default;
alter table public.company_settings alter column company_name drop default;
