-- Which ERP modules this tenant has (src/modules). One row per module.
-- A disabled module disappears from the menu, its pages show "not in your
-- plan" and its server actions, API routes and AI tools refuse to run.
-- Disabling never deletes data. Enabling a module also enables the modules it
-- depends on (resolved in the app, src/modules/enabled.ts).
--
-- Readable by every signed-in user; written only by the service role (the
-- control panel, later). Seeded with every module enabled. Safe to re-run.

create table if not exists public.tenant_modules (
  module_id text primary key check (module_id ~ '^[a-z][a-z0-9-]*$'),
  enabled boolean not null default true,
  installed_at timestamptz not null default now(),
  version text not null default '1.0.0' check (version ~ '^\d+\.\d+\.\d+$'),
  updated_at timestamptz not null default now()
);

comment on table public.tenant_modules is
  'Modules enabled for this tenant (see src/modules). Written by the service role only.';

alter table public.tenant_modules enable row level security;

drop policy if exists tenant_modules_select on public.tenant_modules;
create policy tenant_modules_select on public.tenant_modules
  for select to authenticated
  using (true);
-- No insert/update/delete policies: only the service role (bypasses RLS) writes.

revoke all on table public.tenant_modules from public, anon, authenticated;
grant select on table public.tenant_modules to authenticated;
grant all on table public.tenant_modules to service_role;

insert into public.tenant_modules (module_id, enabled, version) values
  ('core', true, '1.0.0'),
  ('sales', true, '1.0.0'),
  ('purchases', true, '1.0.0'),
  ('inventory', true, '1.0.0'),
  ('polywood', true, '1.0.0'),
  ('production', true, '1.0.0'),
  ('accounting', true, '1.0.0'),
  ('expenses', true, '1.0.0'),
  ('hr', true, '1.0.0'),
  ('payroll', true, '1.0.0'),
  ('crm', true, '1.0.0'),
  ('contracts', true, '1.0.0'),
  ('consignment', true, '1.0.0'),
  ('commissions', true, '1.0.0'),
  ('tax-az', true, '1.0.0'),
  ('barcode', true, '1.0.0'),
  ('ai', true, '1.0.0'),
  ('studio', true, '1.0.0')
on conflict (module_id) do nothing;
