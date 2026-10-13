-- Invoices, payments and dunning for subscriptions (prompt 13, plan §4.4 / §4.5). Safe to re-run.
--
-- Nothing here bills anyone by itself. A subscription is billed automatically only when an
-- admin turns on subscriptions.auto_billing (off by default) AND the daily billing job is
-- switched on (repository variable BILLING_ENABLED). Dunning only moves tenants that have
-- auto_billing on, and never a tenant marked billing_exempt (Del Groups is, below).
--
--   billing_settings        one row: seller and bank details on invoices, numbering prefix,
--                           tax, payment terms and the dunning timeline (grace, suspend)
--   invoice_number_counters numbering per calendar year: <prefix>-<year>-00001
--   invoices                + kind, billing_period, seller/buyer snapshots, pdf_path,
--                             amount_paid, charge attempts
--   invoice_lines           what an invoice is for
--   payments                + idempotency on (provider, provider_reference), refunds
--   payment_methods         saved cards of a gateway (only the gateway token, in Vault)
--   billing_emails          every billing email (outbox and record), once per invoice and step
--   plan_change_requests    upgrade / downgrade requests from the tenant's admin in the ERP
--   tenants                 + billing contact, status_source ('admin' | 'billing'),
--                             billing_paused_until
--   subscriptions           + auto_billing, payment_provider
--   Storage bucket "invoices" (private): invoice PDFs, <tenant_id>/<number>.pdf
--
-- Functions (run as the caller: platform admins under RLS, or the service role of the
-- billing job and the payment webhook): issue_invoice, record_payment, set_billing_status,
-- advance_subscription_period, billing_worklist; for the ERP (service role only):
-- erp_billing_overview, erp_request_plan_change, erp_invoice_pdf_path.

-- ── Settings ───────────────────────────────────────────────────────────────
create table if not exists public.billing_settings (
  id boolean primary key default true check (id),
  seller_name text not null default '',
  seller_tax_id text,
  seller_address text,
  seller_email text,
  seller_phone text,
  bank_name text,
  bank_code text,
  bank_tax_id text,
  bank_swift text,
  bank_correspondent_account text,
  bank_account text,
  invoice_prefix text not null default 'INV' check (invoice_prefix ~ '^[A-Z0-9]{1,10}$'),
  tax_label text not null default 'ƏDV' check (length(tax_label) between 1 and 20),
  tax_rate_pct numeric(5, 2) not null default 0 check (tax_rate_pct between 0 and 100),
  -- Days between issuing an invoice and its due date. Renewal invoices are issued this many
  -- days before the renewal date, so they are due on the renewal date.
  payment_terms_days integer not null default 7 check (payment_terms_days between 0 and 60),
  -- Dunning: overdue for up to grace_days = past_due (full access), then read_only for
  -- suspend_after_days, then suspended.
  grace_days integer not null default 7 check (grace_days between 0 and 90),
  suspend_after_days integer not null default 30 check (suspend_after_days between 1 and 365),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into public.billing_settings (id) values (true) on conflict (id) do nothing;

-- ── Tenants and subscriptions ──────────────────────────────────────────────
alter table public.tenants add column if not exists billing_email text;
alter table public.tenants add column if not exists billing_tax_id text;
alter table public.tenants add column if not exists billing_address text;
-- Who set the current status: an admin (never lifted automatically) or the billing job.
alter table public.tenants add column if not exists status_source text not null default 'admin';
alter table public.tenants add column if not exists status_changed_at timestamptz;
-- Dunning leaves the tenant alone until this date (an admin gave more time).
alter table public.tenants add column if not exists billing_paused_until date;
-- Never billed or dunned by the panel, whatever its subscription says. Del Groups' own ERP
-- (tenant #1, slug del-groups) is exempt; set once here, an owner can change it later.
alter table public.tenants add column if not exists billing_exempt boolean not null default false;
update public.tenants set billing_exempt = true where slug = 'del-groups' and not billing_exempt;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tenants_status_source_check' and conrelid = 'public.tenants'::regclass) then
    alter table public.tenants add constraint tenants_status_source_check check (status_source in ('admin', 'billing'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'tenants_billing_email_check' and conrelid = 'public.tenants'::regclass) then
    alter table public.tenants add constraint tenants_billing_email_check
      check (billing_email is null or billing_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');
  end if;
end $$;

-- Status changes record their source. The billing functions set billing.status_source.
create or replace function public.tenant_status_source()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status is distinct from old.status then
    new.status_source := case when current_setting('billing.status_source', true) = 'billing' then 'billing' else 'admin' end;
    new.status_changed_at := now();
  end if;
  return new;
end;
$$;
drop trigger if exists trg_tenant_status_source on public.tenants;
create trigger trg_tenant_status_source before update of status on public.tenants
  for each row execute function public.tenant_status_source();

alter table public.subscriptions add column if not exists auto_billing boolean not null default false;
alter table public.subscriptions add column if not exists payment_provider text not null default 'manual_bank_transfer';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'subscriptions_payment_provider_check' and conrelid = 'public.subscriptions'::regclass) then
    alter table public.subscriptions add constraint subscriptions_payment_provider_check
      check (payment_provider ~ '^[a-z][a-z0-9_]{0,39}$');
  end if;
end $$;

-- ── Invoices ───────────────────────────────────────────────────────────────
create table if not exists public.invoice_number_counters (
  year integer primary key check (year between 2000 and 2999),
  last_number integer not null default 0 check (last_number >= 0)
);

alter table public.invoices add column if not exists kind text not null default 'manual';
alter table public.invoices add column if not exists billing_period text;
alter table public.invoices add column if not exists language text not null default 'az';
alter table public.invoices add column if not exists seller jsonb not null default '{}'::jsonb;
alter table public.invoices add column if not exists buyer jsonb not null default '{}'::jsonb;
alter table public.invoices add column if not exists amount_paid numeric(12, 2) not null default 0;
alter table public.invoices add column if not exists pdf_path text;
alter table public.invoices add column if not exists charge_attempts integer not null default 0;
alter table public.invoices add column if not exists last_charge_attempt_at timestamptz;
alter table public.invoices add column if not exists voided_at timestamptz;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'invoices_kind_check' and conrelid = 'public.invoices'::regclass) then
    alter table public.invoices add constraint invoices_kind_check check (kind in ('renewal', 'change', 'manual'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'invoices_billing_period_check' and conrelid = 'public.invoices'::regclass) then
    alter table public.invoices add constraint invoices_billing_period_check
      check (billing_period is null or billing_period in ('monthly', 'yearly'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'invoices_language_check' and conrelid = 'public.invoices'::regclass) then
    alter table public.invoices add constraint invoices_language_check check (language in ('az', 'en', 'ru'));
  end if;
end $$;
-- One renewal invoice per subscription and period (the billing job may run twice a day).
create unique index if not exists invoices_one_renewal
  on public.invoices (subscription_id, period_start) where kind = 'renewal' and status <> 'void';
create index if not exists invoices_open on public.invoices (tenant_id, due_date) where status in ('issued', 'overdue');

create table if not exists public.invoice_lines (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices (id) on delete cascade,
  position integer not null default 0,
  kind text not null check (kind in ('base', 'module', 'addon', 'discount', 'proration', 'credit', 'other')),
  item_id text,
  description text not null check (length(description) between 1 and 500),
  quantity numeric(12, 2) not null default 1,
  unit_price numeric(12, 2) not null,
  -- Negative for discounts and credits.
  amount numeric(12, 2) not null,
  created_at timestamptz not null default now()
);
create index if not exists invoice_lines_invoice on public.invoice_lines (invoice_id, position);

-- ── Payments ───────────────────────────────────────────────────────────────
alter table public.payments add column if not exists refunded_amount numeric(12, 2) not null default 0;
alter table public.payments add column if not exists failure_reason text;
alter table public.payments add column if not exists recorded_by uuid default auth.uid();
-- A gateway reports the same payment more than once; the second report changes nothing.
create unique index if not exists payments_provider_reference
  on public.payments (provider, provider_reference) where provider_reference is not null;

create table if not exists public.payment_methods (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  provider text not null check (provider ~ '^[a-z][a-z0-9_]{0,39}$'),
  brand text,
  last4 text check (last4 is null or last4 ~ '^[0-9]{4}$'),
  exp_month integer check (exp_month is null or exp_month between 1 and 12),
  exp_year integer check (exp_year is null or exp_year between 2000 and 2999),
  -- The gateway's card token, in Vault. Never the card number.
  vault_secret_id uuid not null,
  is_default boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists payment_methods_one_default on public.payment_methods (tenant_id, provider) where is_default;

-- ── Emails ─────────────────────────────────────────────────────────────────
create table if not exists public.billing_emails (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  invoice_id uuid references public.invoices (id) on delete cascade,
  kind text not null check (kind in ('invoice_issued', 'payment_received', 'payment_failed', 'past_due', 'read_only', 'suspended', 'reactivated')),
  recipient text,
  subject text not null default '',
  -- skipped: no recipient or no email provider configured (the email is still on record).
  status text not null default 'pending' check (status in ('pending', 'sent', 'skipped', 'failed')),
  error text,
  provider_message_id text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
-- Each step's email goes out once per invoice.
create unique index if not exists billing_emails_once on public.billing_emails (invoice_id, kind) where invoice_id is not null;
create index if not exists billing_emails_tenant on public.billing_emails (tenant_id, created_at desc);

-- ── Plan change requests ───────────────────────────────────────────────────
create table if not exists public.plan_change_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete cascade,
  current_plan_id uuid references public.plans (id) on delete set null,
  plan_id uuid not null references public.plans (id),
  billing_period text not null check (billing_period in ('monthly', 'yearly')),
  user_count integer not null check (user_count between 1 and 10000),
  modules text[] not null default '{}',
  note text check (note is null or length(note) <= 2000),
  requested_by_email text,
  requested_by_name text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  handled_by uuid references auth.users (id) on delete set null,
  handled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists plan_change_requests_one_pending on public.plan_change_requests (tenant_id) where status = 'pending';

-- ── Storage: invoice PDFs ──────────────────────────────────────────────────
insert into storage.buckets (id, name, public) values ('invoices', 'invoices', false) on conflict (id) do nothing;
drop policy if exists invoices_platform_admins on storage.objects;
create policy invoices_platform_admins on storage.objects for all to authenticated
  using (bucket_id = 'invoices' and public.is_platform_admin())
  with check (bucket_id = 'invoices' and public.is_platform_admin());

-- ── Functions ──────────────────────────────────────────────────────────────

-- Next number of the invoice's year: INV-2026-00001. Called by issue_invoice only.
create or replace function public.next_invoice_number(p_date date)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_year integer := extract(year from p_date)::integer;
  v_n integer;
  v_prefix text := coalesce((select invoice_prefix from public.billing_settings where id), 'INV');
begin
  insert into public.invoice_number_counters as c (year, last_number) values (v_year, 1)
  on conflict (year) do update set last_number = c.last_number + 1
  returning last_number into v_n;
  return v_prefix || '-' || v_year || '-' || lpad(v_n::text, 5, '0');
end;
$$;

-- p: {tenant_id, subscription_id?, kind, billing_period?, period_start?, period_end?,
--     issue_date, due_date, currency, notes?, lines: [{kind, item_id?, description,
--     quantity, unit_price, amount}]}
-- Issues an invoice with the next number of its year, the seller and buyer as they are
-- today, and tax from billing_settings. For a renewal that already has its invoice, returns
-- the existing one (created = false). Returns {id, number, created}.
create or replace function public.issue_invoice(p jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_tenant public.tenants;
  v_settings public.billing_settings;
  v_kind text := coalesce(p ->> 'kind', 'manual');
  v_issue date := coalesce(nullif(p ->> 'issue_date', '')::date, current_date);
  v_sub uuid := nullif(p ->> 'subscription_id', '')::uuid;
  v_period_start date := nullif(p ->> 'period_start', '')::date;
  v_existing public.invoices;
  v_subtotal numeric(12, 2);
  v_tax numeric(12, 2);
  v_id uuid;
  v_number text;
begin
  select * into v_tenant from public.tenants where id = (p ->> 'tenant_id')::uuid;
  if v_tenant.id is null then
    raise exception 'tenant not found' using errcode = 'P0002';
  end if;
  if jsonb_array_length(coalesce(p -> 'lines', '[]')) = 0 then
    raise exception 'an invoice needs at least one line' using errcode = '22023';
  end if;

  if v_kind = 'renewal' then
    select * into v_existing from public.invoices
     where subscription_id = v_sub and period_start = v_period_start and kind = 'renewal' and status <> 'void';
    if v_existing.id is not null then
      return jsonb_build_object('id', v_existing.id, 'number', v_existing.number, 'created', false);
    end if;
  end if;

  select * into v_settings from public.billing_settings where id;
  select coalesce(sum((l ->> 'amount')::numeric), 0) into v_subtotal from jsonb_array_elements(p -> 'lines') l;
  if v_subtotal < 0 then
    raise exception 'invoice total is negative' using errcode = '22023';
  end if;
  v_tax := round(v_subtotal * coalesce(v_settings.tax_rate_pct, 0) / 100, 2);
  v_number := public.next_invoice_number(v_issue);

  insert into public.invoices (
    tenant_id, subscription_id, number, status, kind, billing_period, currency, subtotal, tax, total,
    period_start, period_end, issued_at, due_date, notes, language, seller, buyer
  ) values (
    v_tenant.id, v_sub, v_number, 'issued', v_kind, nullif(p ->> 'billing_period', ''),
    coalesce(nullif(p ->> 'currency', ''), v_tenant.currency), v_subtotal, v_tax, v_subtotal + v_tax,
    v_period_start, nullif(p ->> 'period_end', '')::date, v_issue::timestamptz,
    coalesce(nullif(p ->> 'due_date', '')::date, v_issue + coalesce(v_settings.payment_terms_days, 7)),
    nullif(p ->> 'notes', ''), v_tenant.language,
    jsonb_build_object(
      'name', v_settings.seller_name, 'tax_id', v_settings.seller_tax_id, 'address', v_settings.seller_address,
      'email', v_settings.seller_email, 'phone', v_settings.seller_phone, 'bank_name', v_settings.bank_name,
      'bank_code', v_settings.bank_code, 'bank_tax_id', v_settings.bank_tax_id, 'bank_swift', v_settings.bank_swift,
      'bank_correspondent_account', v_settings.bank_correspondent_account, 'bank_account', v_settings.bank_account,
      'tax_label', v_settings.tax_label, 'tax_rate_pct', v_settings.tax_rate_pct
    ),
    jsonb_build_object(
      'name', v_tenant.name, 'slug', v_tenant.slug, 'tax_id', v_tenant.billing_tax_id,
      'address', v_tenant.billing_address, 'email', v_tenant.billing_email
    )
  )
  returning id into v_id;

  insert into public.invoice_lines (invoice_id, position, kind, item_id, description, quantity, unit_price, amount)
  select v_id, l.ordinality::integer, l.value ->> 'kind', nullif(l.value ->> 'item_id', ''), l.value ->> 'description',
         coalesce((l.value ->> 'quantity')::numeric, 1), (l.value ->> 'unit_price')::numeric, (l.value ->> 'amount')::numeric
    from jsonb_array_elements(p -> 'lines') with ordinality l;

  return jsonb_build_object('id', v_id, 'number', v_number, 'created', true);
end;
$$;

-- p: {invoice_id, amount, method, provider?, provider_reference?, paid_at?, status?}
-- Records a payment (status succeeded unless given). A provider_reference already on record
-- changes nothing (webhooks repeat). The invoice is paid once its succeeded payments cover
-- the total. Returns {payment_id, duplicate, invoice_status, tenant_id}.
create or replace function public.record_payment(p jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_invoice public.invoices;
  v_existing uuid;
  v_id uuid;
  v_status text := coalesce(nullif(p ->> 'status', ''), 'succeeded');
  v_paid_at timestamptz := coalesce(nullif(p ->> 'paid_at', '')::timestamptz, now());
  v_sum numeric(12, 2);
begin
  select * into v_invoice from public.invoices where id = (p ->> 'invoice_id')::uuid for update;
  if v_invoice.id is null then
    raise exception 'invoice not found' using errcode = 'P0002';
  end if;
  if v_status not in ('succeeded', 'failed') then
    raise exception 'invalid payment status' using errcode = '22023';
  end if;

  if nullif(p ->> 'provider_reference', '') is not null then
    select id into v_existing from public.payments
     where provider = p ->> 'provider' and provider_reference = p ->> 'provider_reference';
    if v_existing is not null then
      return jsonb_build_object('payment_id', v_existing, 'duplicate', true, 'invoice_status', v_invoice.status,
                                'tenant_id', v_invoice.tenant_id);
    end if;
  end if;
  if v_status = 'succeeded' and v_invoice.status not in ('issued', 'overdue') then
    raise exception 'invoice is not open (status %)', v_invoice.status using errcode = '22023';
  end if;

  insert into public.payments (tenant_id, invoice_id, amount, currency, method, provider, provider_reference, status,
                               paid_at, failure_reason)
  values (v_invoice.tenant_id, v_invoice.id, (p ->> 'amount')::numeric, v_invoice.currency, p ->> 'method',
          nullif(p ->> 'provider', ''), nullif(p ->> 'provider_reference', ''), v_status,
          case when v_status = 'succeeded' then v_paid_at end, nullif(p ->> 'failure_reason', ''))
  returning id into v_id;

  select coalesce(sum(amount - refunded_amount), 0) into v_sum
    from public.payments where invoice_id = v_invoice.id and status = 'succeeded';
  update public.invoices
     set amount_paid = v_sum,
         status = case when v_sum >= total then 'paid' else status end,
         paid_at = case when v_sum >= total then v_paid_at else paid_at end
   where id = v_invoice.id
   returning status into v_invoice.status;

  return jsonb_build_object('payment_id', v_id, 'duplicate', false, 'invoice_status', v_invoice.status,
                            'tenant_id', v_invoice.tenant_id);
end;
$$;

-- Moves a tenant to a status decided by the billing job (lib/billing/dunning.ts), records
-- it as a billing change, and keeps the live subscription in step: past_due while the tenant
-- is past_due / read_only / suspended, active again once it is active. Only from and to the
-- statuses billing manages; returns false when nothing changed.
create or replace function public.set_billing_status(p_tenant_id uuid, p_status text)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_updated boolean;
begin
  if p_status not in ('active', 'past_due', 'read_only', 'suspended') then
    raise exception 'not a billing status: %', p_status using errcode = '22023';
  end if;
  perform set_config('billing.status_source', 'billing', true);
  update public.tenants set status = p_status
   where id = p_tenant_id and status <> p_status and not billing_exempt
     and status in ('trial', 'active', 'past_due', 'read_only', 'suspended');
  v_updated := found;
  perform set_config('billing.status_source', '', true);

  if v_updated then
    update public.subscriptions
       set status = case when p_status = 'active' then 'active' else 'past_due' end
     where tenant_id = p_tenant_id and status in ('trial', 'active', 'past_due')
       and status <> case when p_status = 'active' then 'active' else 'past_due' end;
  end if;
  return v_updated;
end;
$$;

-- Issued invoices whose due date has passed become overdue. Returns how many changed.
create or replace function public.mark_overdue_invoices(p_today date)
returns integer
language sql
set search_path = ''
as $$
  with u as (
    update public.invoices set status = 'overdue'
     where status = 'issued' and due_date is not null and due_date < p_today
    returning 1
  )
  select count(*)::integer from u;
$$;

-- Moves a subscription to its next period once the renewal date has passed. Guarded by the
-- old end date, so two runs cannot advance it twice.
create or replace function public.advance_subscription_period(p_subscription_id uuid, p_from_end date, p_new_end date)
returns boolean
language sql
set search_path = ''
as $$
  with u as (
    update public.subscriptions
       set current_period_start = p_from_end, current_period_end = p_new_end
     where id = p_subscription_id and current_period_end = p_from_end and p_new_end > p_from_end
    returning 1
  )
  select exists (select 1 from u);
$$;

-- Everything the billing job needs about one tenant: its billing fields, the live
-- subscription with its plan prices, and the open invoices. Null for an unknown tenant.
create or replace function public.billing_work_item(p_tenant_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'tenant_id', t.id, 'slug', t.slug, 'name', t.name, 'status', t.status, 'status_source', t.status_source,
    'language', t.language, 'billing_email', t.billing_email, 'billing_paused_until', t.billing_paused_until,
    'billing_exempt', t.billing_exempt,
    'subscription', (
      select jsonb_build_object(
        'id', s.id, 'status', s.status, 'billing_period', s.billing_period, 'currency', s.currency,
        'user_count', s.user_count, 'current_period_start', s.current_period_start,
        'current_period_end', s.current_period_end, 'auto_billing', s.auto_billing,
        'payment_provider', s.payment_provider,
        'modules', coalesce((select jsonb_agg(si.module_id order by si.module_id) from public.subscription_items si where si.subscription_id = s.id), '[]'::jsonb),
        'addons', coalesce((select jsonb_object_agg(sa.addon_code, sa.quantity) from public.subscription_addons sa where sa.subscription_id = s.id), '{}'::jsonb),
        'plan', jsonb_build_object(
          'id', p.id, 'code', p.code, 'name', p.name, 'annual_discount_pct', p.annual_discount_pct,
          'max_users', p.max_users, 'included_storage_gb', p.included_storage_gb,
          'included_ai_credit_usd', p.included_ai_credit_usd, 'includes_custom_domain', p.includes_custom_domain,
          'prices', coalesce((select jsonb_agg(jsonb_build_object('module_id', pp.module_id, 'amount', pp.amount, 'per_user', pp.per_user))
                                from public.plan_prices pp where pp.plan_id = p.id and pp.billing_period = 'monthly' and pp.currency = s.currency), '[]'::jsonb),
          'addon_prices', coalesce((select jsonb_agg(jsonb_build_object('addon_code', ap.addon_code, 'amount', ap.amount))
                                      from public.plan_addon_prices ap where ap.plan_id = p.id and ap.currency = s.currency), '[]'::jsonb)
        )
      )
      from public.subscriptions s join public.plans p on p.id = s.plan_id
      where s.tenant_id = t.id and s.status in ('trial', 'active', 'past_due')
      limit 1
    ),
    'open_invoices', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'number', i.number, 'kind', i.kind, 'status', i.status, 'total', i.total,
        'amount_paid', i.amount_paid, 'currency', i.currency, 'due_date', i.due_date, 'pdf_path', i.pdf_path,
        'charge_attempts', i.charge_attempts, 'last_charge_attempt_at', i.last_charge_attempt_at
      ) order by i.due_date, i.number)
      from public.invoices i where i.tenant_id = t.id and i.status in ('issued', 'overdue')
    ), '[]'::jsonb),
    'last_paid_invoice_id', (
      select i.id from public.invoices i where i.tenant_id = t.id and i.status = 'paid'
      order by i.paid_at desc nulls last limit 1
    )
  )
  from public.tenants t
  where t.id = p_tenant_id;
$$;

-- The tenants the daily billing job works on: a live subscription with auto_billing on, or
-- a status billing imposed (so a payment can lift it). Never a billing_exempt tenant.
create or replace function public.billing_worklist()
returns jsonb
language sql
stable
set search_path = ''
as $$
  select coalesce(jsonb_agg(public.billing_work_item(t.id) order by t.slug), '[]'::jsonb)
    from public.tenants t
   where not t.billing_exempt
     and (exists (
            select 1 from public.subscriptions s
             where s.tenant_id = t.id and s.status in ('trial', 'active', 'past_due') and s.auto_billing
          )
          or (t.status_source = 'billing' and t.status in ('past_due', 'read_only', 'suspended')));
$$;

-- ── Functions for the ERP (service role only) ──────────────────────────────

-- The billing page of a tenant's admin: plan, subscription, invoices, the pending request,
-- the plans they may ask for and the bank details for a transfer. Never another tenant's data.
create or replace function public.erp_billing_overview(p_tenant_id uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'tenant', jsonb_build_object('status', t.status, 'currency', t.currency, 'billing_email', t.billing_email),
    'subscription', (
      select jsonb_build_object(
        'plan_id', p.id, 'plan_code', p.code, 'plan_name', p.name, 'status', s.status,
        'billing_period', s.billing_period, 'currency', s.currency, 'user_count', s.user_count,
        'current_period_start', s.current_period_start, 'current_period_end', s.current_period_end,
        'trial_ends_at', s.trial_ends_at, 'auto_billing', s.auto_billing, 'payment_provider', s.payment_provider,
        'modules', coalesce((select jsonb_agg(si.module_id order by si.module_id) from public.subscription_items si where si.subscription_id = s.id), '[]'::jsonb)
      )
      from public.subscriptions s join public.plans p on p.id = s.plan_id
      where s.tenant_id = t.id and s.status in ('trial', 'active', 'past_due')
      limit 1
    ),
    'entitlements', (select to_jsonb(e) from public.tenant_entitlements(t.id) e limit 1),
    'invoices', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'number', i.number, 'status', i.status, 'kind', i.kind, 'currency', i.currency,
        'total', i.total, 'amount_paid', i.amount_paid, 'issued_at', i.issued_at, 'due_date', i.due_date,
        'paid_at', i.paid_at, 'period_start', i.period_start, 'period_end', i.period_end,
        'has_pdf', i.pdf_path is not null
      ) order by i.issued_at desc nulls last, i.number desc)
      from (select * from public.invoices where tenant_id = t.id and status <> 'draft'
            order by issued_at desc nulls last limit 36) i
    ), '[]'::jsonb),
    'pending_request', (
      select jsonb_build_object('id', r.id, 'plan_id', r.plan_id, 'billing_period', r.billing_period,
                                'user_count', r.user_count, 'note', r.note, 'created_at', r.created_at)
      from public.plan_change_requests r where r.tenant_id = t.id and r.status = 'pending'
    ),
    'plans', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'code', p.code, 'name', p.name, 'max_users', p.max_users) order by p.sort_order, p.name)
      from public.plans p where p.is_active
    ), '[]'::jsonb),
    'bank', (
      select jsonb_build_object('seller_name', b.seller_name, 'seller_tax_id', b.seller_tax_id, 'bank_name', b.bank_name,
                                'bank_code', b.bank_code, 'bank_tax_id', b.bank_tax_id, 'bank_swift', b.bank_swift,
                                'bank_correspondent_account', b.bank_correspondent_account, 'bank_account', b.bank_account)
      from public.billing_settings b where b.id
    )
  )
  from public.tenants t
  where t.id = p_tenant_id;
$$;

-- p: {plan_id, billing_period, user_count, note?, requested_by_email?, requested_by_name?}
-- One pending request per tenant: a new one replaces the pending one.
create or replace function public.erp_request_plan_change(p_tenant_id uuid, p jsonb)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
  v_current uuid;
begin
  if not exists (select 1 from public.plans where id = (p ->> 'plan_id')::uuid and is_active) then
    raise exception 'plan not available' using errcode = '22023';
  end if;
  select plan_id into v_current from public.subscriptions
   where tenant_id = p_tenant_id and status in ('trial', 'active', 'past_due') limit 1;
  update public.plan_change_requests set status = 'cancelled', handled_at = now()
   where tenant_id = p_tenant_id and status = 'pending';
  insert into public.plan_change_requests (tenant_id, current_plan_id, plan_id, billing_period, user_count, note,
                                           requested_by_email, requested_by_name)
  values (p_tenant_id, v_current, (p ->> 'plan_id')::uuid, p ->> 'billing_period', (p ->> 'user_count')::integer,
          nullif(left(btrim(coalesce(p ->> 'note', '')), 2000), ''), nullif(p ->> 'requested_by_email', ''),
          nullif(p ->> 'requested_by_name', ''))
  returning id into v_id;
  return v_id;
end;
$$;

-- Storage path of an invoice PDF, only for an invoice of this tenant.
create or replace function public.erp_invoice_pdf_path(p_tenant_id uuid, p_invoice_id uuid)
returns text
language sql
stable
set search_path = ''
as $$
  select pdf_path from public.invoices where id = p_invoice_id and tenant_id = p_tenant_id and status <> 'draft';
$$;

-- Saves a gateway card token in Vault for the payment webhook (service role only).
create or replace function public.save_payment_method(
  p_tenant_id uuid, p_provider text, p_token text, p_brand text, p_last4 text, p_exp_month integer, p_exp_year integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_secret uuid;
  v_id uuid;
begin
  if p_token is null or length(p_token) = 0 then
    raise exception 'empty token' using errcode = '22023';
  end if;
  v_secret := vault.create_secret(p_token, 'card:' || p_tenant_id::text || ':' || gen_random_uuid()::text, 'Gateway card token');
  update public.payment_methods set is_default = false where tenant_id = p_tenant_id and provider = p_provider;
  insert into public.payment_methods (tenant_id, provider, brand, last4, exp_month, exp_year, vault_secret_id)
  values (p_tenant_id, p_provider, p_brand, p_last4, p_exp_month, p_exp_year, v_secret)
  returning id into v_id;
  return v_id;
end;
$$;

-- The card token of a payment method, for chargeSavedCard (service role only).
create or replace function public.payment_method_token(p_payment_method_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select s.decrypted_secret from public.payment_methods pm
    join vault.decrypted_secrets s on s.id = pm.vault_secret_id
   where pm.id = p_payment_method_id;
$$;

-- ── Audit, updated_at, row level security, grants ──────────────────────────
do $$
declare
  t text;
begin
  foreach t in array array[
    'billing_settings', 'invoice_number_counters', 'invoice_lines', 'payment_methods', 'billing_emails', 'plan_change_requests'
  ] loop
    execute format('drop trigger if exists %I on public.%I', 'trg_audit_' || t, t);
    execute format(
      'create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_platform_change()',
      'trg_audit_' || t, t
    );
    if t in ('billing_settings', 'payment_methods', 'plan_change_requests') then
      execute format('drop trigger if exists %I on public.%I', 'trg_updated_at_' || t, t);
      execute format(
        'create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
        'trg_updated_at_' || t, t
      );
    end if;
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

-- payment_methods: admins see and remove saved cards; tokens are added only by the webhook.
revoke insert, update on table public.payment_methods from authenticated;

revoke all on function public.tenant_status_source() from public, anon, authenticated;
revoke all on function public.next_invoice_number(date) from public, anon;
do $$
declare
  f text;
begin
  -- Platform admins (under RLS) and the billing job.
  foreach f in array array[
    'public.issue_invoice(jsonb)', 'public.record_payment(jsonb)', 'public.set_billing_status(uuid, text)',
    'public.advance_subscription_period(uuid, date, date)', 'public.billing_worklist()', 'public.billing_work_item(uuid)',
    'public.mark_overdue_invoices(date)'
  ] loop
    execute format('revoke all on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated, service_role', f);
  end loop;
  -- The ERP and the payment webhook only.
  foreach f in array array[
    'public.erp_billing_overview(uuid)', 'public.erp_request_plan_change(uuid, jsonb)',
    'public.erp_invoice_pdf_path(uuid, uuid)',
    'public.save_payment_method(uuid, text, text, text, text, integer, integer)',
    'public.payment_method_token(uuid)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;
-- issue_invoice numbers through next_invoice_number as the caller.
grant execute on function public.next_invoice_number(date) to authenticated, service_role;
