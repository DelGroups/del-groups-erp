-- ============================================================================
-- Imports module ("İdxal"), IMP-1: data, exchange rates and landed cost.
--
-- An import shipment is a foreign-currency purchase with its own costs (international freight,
-- insurance, customs duty and fee, customs VAT, broker, local freight, labour, storage). The
-- landed cost of every product line is computed in the app (src/lib/imports/landedCost.ts) and
-- stored in import_cost_allocations. Nothing here posts stock or the general ledger: that is
-- IMP-2. The normal purchase flow (purchases, purchase_items) is not touched.
--
--   currencies               AZN, USD, EUR, TRY, CNY, RUB
--   exchange_rates           one rate per currency, day and source ('cbar' from cbar.az, 'manual')
--   import_shipments         the file: supplier, currency and invoice, customs declaration, status
--   import_shipment_lines    products with quantities (stock unit = metres for sheet products),
--                            price, weight, volume, HS code, duty rate, warehouse
--   import_cost_lines        each cost with its partner, currency, rate, VAT and split method
--   import_cost_allocations  the stored split: cost line × shipment line → AZN
--
-- Access (also checked again by the server actions):
--   imports.view    (flat can_view_imports)    read shipments, lines, costs, rates
--   imports.manage  (flat can_manage_imports)  create and change shipments while open
--   imports.approve (flat can_approve_imports) used by IMP-2 (confirm, receive)
-- Admins have all three. Every amount is money: the tables are read only by users who also see
-- financial figures (dashboard.view_financials, public.can_view_financials()); others get the
-- shipments without amounts through the server actions.
--
-- Shipments carry chatter (notes and attachments): import_shipments joins chatter_models().
-- Each tenant has its own project, so there is no tenant column (as on every other table).
-- Safe to re-run.
-- ============================================================================

-- ─── Permissions ────────────────────────────────────────────────────────────

-- p_action: 'view' | 'manage' | 'approve'. Admin, the flat key, or the role matrix
-- (roles.permissions._matrix.imports.<action>, overridable per user).
create or replace function public.imports_can(p_action text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.user_is_admin(), false) or coalesce((
    select coalesce((r.permissions ->> ('can_' || p_action || '_imports'))::boolean, false)
        or coalesce((p.permission_overrides ->> ('can_' || p_action || '_imports'))::boolean, false)
        or coalesce(
             (p.permission_overrides -> '_matrix' -> 'imports' ->> p_action)::boolean,
             (r.permissions -> '_matrix' -> 'imports' ->> p_action)::boolean,
             false)
      from public.profiles p
      left join public.roles r on r.id = p.role_id
     where p.id = auth.uid() and coalesce(p.is_active, true)
  ), false);
$$;

comment on function public.imports_can(text) is
  'Imports module (IMP-1): may the signed-in user view / manage / approve import shipments? Admins always.';

revoke all on function public.imports_can(text) from public, anon;
grant execute on function public.imports_can(text) to authenticated, service_role;

-- Reading amounts: imports.view and financial figures.
create or replace function public.imports_can_read()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.imports_can('view') and public.can_view_financials();
$$;

revoke all on function public.imports_can_read() from public, anon;
grant execute on function public.imports_can_read() to authenticated, service_role;

-- ─── Currencies and rates ───────────────────────────────────────────────────

create table if not exists public.currencies (
  code text primary key check (code ~ '^[A-Z]{3}$'),
  name text not null,
  symbol text,
  is_active boolean not null default true
);

insert into public.currencies (code, name, symbol) values
  ('AZN', 'Azərbaycan manatı', '₼'),
  ('USD', 'ABŞ dolları', '$'),
  ('EUR', 'Avro', '€'),
  ('TRY', 'Türk lirəsi', '₺'),
  ('CNY', 'Çin yuanı', '¥'),
  ('RUB', 'Rusiya rublu', '₽')
on conflict (code) do nothing;

create table if not exists public.exchange_rates (
  id uuid primary key default gen_random_uuid(),
  currency_code text not null references public.currencies (code),
  rate_date date not null,
  rate_to_azn numeric(18,6) not null check (rate_to_azn > 0),
  source text not null check (source in ('cbar', 'manual')),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (currency_code, rate_date, source)
);

comment on table public.exchange_rates is
  'AZN per one unit of a currency on a day. cbar = the official CBAR bulletin (fetched on demand), manual = typed by a user.';

-- ─── Shipments ──────────────────────────────────────────────────────────────

create table if not exists public.import_shipments (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  supplier_id uuid references public.suppliers (id) on delete restrict,
  currency_code text not null default 'USD' references public.currencies (code),
  invoice_no text check (invoice_no is null or length(invoice_no) <= 100),
  invoice_date date,
  invoice_rate numeric(18,6) not null default 1 check (invoice_rate > 0),
  incoterm text check (incoterm is null or incoterm in ('EXW', 'FCA', 'FAS', 'FOB', 'CFR', 'CIF', 'CPT', 'CIP', 'DAP', 'DPU', 'DDP')),
  customs_declaration_no text check (customs_declaration_no is null or length(customs_declaration_no) <= 100),
  customs_declaration_date date,
  customs_rate numeric(18,6) check (customs_rate is null or customs_rate > 0),
  default_warehouse_id uuid references public.warehouses (id) on delete set null,
  status text not null default 'draft'
    check (status in ('draft', 'confirmed', 'cleared', 'partially_received', 'received', 'closed', 'cancelled')),
  notes text check (notes is null or length(notes) <= 10000),
  custom_fields jsonb not null default '{}'::jsonb,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists import_shipments_status_idx on public.import_shipments (status, created_at desc);
create index if not exists import_shipments_supplier_idx on public.import_shipments (supplier_id);

create table if not exists public.import_shipment_lines (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.import_shipments (id) on delete cascade,
  position integer not null default 0,
  product_id uuid not null references public.products (id) on delete restrict,
  qty_purchase_unit numeric(14,3) not null check (qty_purchase_unit > 0),
  purchase_unit text,
  -- Metres for sheet products (sheets × full_sheet_length_m), else the purchase quantity.
  qty_stock_unit numeric(14,3) not null check (qty_stock_unit > 0),
  unit_price_fc numeric(18,4) not null default 0 check (unit_price_fc >= 0),
  -- Totals of the line.
  weight_kg numeric(14,3) check (weight_kg is null or weight_kg >= 0),
  volume_m3 numeric(14,4) check (volume_m3 is null or volume_m3 >= 0),
  hs_code text check (hs_code is null or length(hs_code) <= 20),
  duty_rate_pct numeric(6,3) not null default 0 check (duty_rate_pct between 0 and 100),
  -- null = the shipment's default warehouse.
  warehouse_id uuid references public.warehouses (id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists import_shipment_lines_shipment_idx on public.import_shipment_lines (shipment_id, position);
create index if not exists import_shipment_lines_product_idx on public.import_shipment_lines (product_id);

create table if not exists public.import_cost_lines (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.import_shipments (id) on delete cascade,
  position integer not null default 0,
  cost_type text not null check (cost_type in (
    'freight_international', 'insurance', 'customs_duty', 'customs_fee', 'customs_vat',
    'broker', 'freight_local', 'labour', 'storage', 'other')),
  -- Carrier, customs office, broker...: a counterparty in suppliers.
  partner_id uuid references public.suppliers (id) on delete set null,
  description text check (description is null or length(description) <= 500),
  amount numeric(18,2) not null default 0 check (amount >= 0),
  currency_code text not null default 'AZN' references public.currencies (code),
  rate_to_azn numeric(18,6) not null default 1 check (rate_to_azn > 0),
  vat_amount_azn numeric(18,2) not null default 0 check (vat_amount_azn >= 0),
  is_capitalized boolean not null default true,
  split_method text not null default 'by_value' check (split_method in (
    'by_value', 'by_quantity', 'by_weight', 'by_volume', 'chargeable_weight', 'equal', 'per_line_duty', 'manual')),
  is_estimate boolean not null default false,
  -- Shipment status when the cost was added (a late cost after receipt is split differently in IMP-2).
  added_at_status text not null default 'draft',
  paid_now boolean not null default false,
  cash_account_id uuid references public.accounts (id) on delete set null,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  check (split_method <> 'per_line_duty' or cost_type = 'customs_duty'),
  -- Customs VAT is recoverable (1410), never part of the product cost.
  check (cost_type <> 'customs_vat' or not is_capitalized),
  check (not paid_now or cash_account_id is not null)
);

create unique index if not exists import_cost_lines_shipment_idx on public.import_cost_lines (shipment_id, position);

create table if not exists public.import_cost_allocations (
  cost_line_id uuid not null references public.import_cost_lines (id) on delete cascade,
  shipment_line_id uuid not null references public.import_shipment_lines (id) on delete cascade,
  amount_azn numeric(18,2) not null,
  primary key (cost_line_id, shipment_line_id)
);

create index if not exists import_cost_allocations_line_idx on public.import_cost_allocations (shipment_line_id);

-- ─── Number, creator, updated_at ────────────────────────────────────────────

-- IMP-YYYY-NNNN, one counter per year (document_number_counters, as the other documents).
create or replace function public.next_import_shipment_no(p_date date default current_date)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year int := extract(year from coalesce(p_date, current_date))::int;
  v_no   int;
begin
  insert into public.document_number_counters (doc_type, year, last_no)
  values ('import_shipment', v_year, 1)
  on conflict (doc_type, year)
  do update set last_no = public.document_number_counters.last_no + 1
  returning last_no into v_no;

  return 'IMP-' || v_year::text || '-' || lpad(v_no::text, 4, '0');
end;
$$;

revoke all on function public.next_import_shipment_no(date) from public, anon;
-- Called by the insert trigger (security definer); not for direct use.
revoke all on function public.next_import_shipment_no(date) from authenticated;
grant execute on function public.next_import_shipment_no(date) to service_role;

create or replace function public.import_shipments_before_write()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.number is null or btrim(new.number) = '' then
      new.number := public.next_import_shipment_no(coalesce(new.invoice_date, current_date));
    end if;
  else
    new.number := old.number;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

-- The column default fills number on a direct insert; the trigger keeps it unique and fixed.
alter table public.import_shipments alter column number set default '';

drop trigger if exists import_shipments_before_write on public.import_shipments;
create trigger import_shipments_before_write before insert or update on public.import_shipments
  for each row execute function public.import_shipments_before_write();

drop trigger if exists trg_import_shipments_set_created_by on public.import_shipments;
create trigger trg_import_shipments_set_created_by before insert on public.import_shipments
  for each row execute function public.set_created_by_from_auth();

drop trigger if exists trg_import_cost_lines_set_created_by on public.import_cost_lines;
create trigger trg_import_cost_lines_set_created_by before insert on public.import_cost_lines
  for each row execute function public.set_created_by_from_auth();

-- Lines, costs and allocations of a closed or cancelled shipment cannot change.
create or replace function public.import_shipment_is_open(p_shipment uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.import_shipments s where s.id = p_shipment and s.status not in ('closed', 'cancelled'));
$$;

revoke all on function public.import_shipment_is_open(uuid) from public, anon;
grant execute on function public.import_shipment_is_open(uuid) to authenticated, service_role;

-- ─── Save a draft in one transaction ────────────────────────────────────────

-- Called by the server action (service role) after it checked the permission and computed the
-- split with src/lib/imports/landedCost.ts. Replaces the lines, costs and allocations of a draft;
-- allocations refer to lines and costs by their position in the payload. p_actor is the user
-- (the service role has no auth.uid()).
create or replace function public.import_shipment_save_draft(
  p_id          uuid,
  p_header      jsonb,
  p_lines       jsonb,
  p_costs       jsonb,
  p_allocations jsonb,
  p_actor       uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id     uuid := p_id;
  v_status text;
  v_number text;
begin
  if p_id is not null then
    select status into v_status from public.import_shipments where id = p_id for update;
    if not found then raise exception 'imports_not_found' using errcode = 'P0002'; end if;
    if v_status <> 'draft' then raise exception 'imports_not_draft' using errcode = '22023'; end if;

    update public.import_shipments set
      supplier_id = (p_header ->> 'supplier_id')::uuid,
      currency_code = p_header ->> 'currency_code',
      invoice_no = p_header ->> 'invoice_no',
      invoice_date = (p_header ->> 'invoice_date')::date,
      invoice_rate = (p_header ->> 'invoice_rate')::numeric,
      incoterm = p_header ->> 'incoterm',
      customs_declaration_no = p_header ->> 'customs_declaration_no',
      customs_declaration_date = (p_header ->> 'customs_declaration_date')::date,
      customs_rate = (p_header ->> 'customs_rate')::numeric,
      default_warehouse_id = (p_header ->> 'default_warehouse_id')::uuid,
      notes = p_header ->> 'notes'
    where id = p_id;

    delete from public.import_cost_lines where shipment_id = p_id;
    delete from public.import_shipment_lines where shipment_id = p_id;
  else
    insert into public.import_shipments (
      supplier_id, currency_code, invoice_no, invoice_date, invoice_rate, incoterm,
      customs_declaration_no, customs_declaration_date, customs_rate, default_warehouse_id, notes,
      status, created_by)
    values (
      (p_header ->> 'supplier_id')::uuid, p_header ->> 'currency_code', p_header ->> 'invoice_no',
      (p_header ->> 'invoice_date')::date, (p_header ->> 'invoice_rate')::numeric, p_header ->> 'incoterm',
      p_header ->> 'customs_declaration_no', (p_header ->> 'customs_declaration_date')::date,
      (p_header ->> 'customs_rate')::numeric, (p_header ->> 'default_warehouse_id')::uuid, p_header ->> 'notes',
      'draft', p_actor)
    returning id into v_id;
  end if;

  insert into public.import_shipment_lines (
      shipment_id, position, product_id, qty_purchase_unit, purchase_unit, qty_stock_unit, unit_price_fc,
      weight_kg, volume_m3, hs_code, duty_rate_pct, warehouse_id)
    select v_id, (l ->> 'position')::int, (l ->> 'product_id')::uuid, (l ->> 'qty_purchase_unit')::numeric,
           l ->> 'purchase_unit', (l ->> 'qty_stock_unit')::numeric, (l ->> 'unit_price_fc')::numeric,
           (l ->> 'weight_kg')::numeric, (l ->> 'volume_m3')::numeric, l ->> 'hs_code',
           coalesce((l ->> 'duty_rate_pct')::numeric, 0), (l ->> 'warehouse_id')::uuid
    from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) l;

  insert into public.import_cost_lines (
      shipment_id, position, cost_type, partner_id, description, amount, currency_code, rate_to_azn,
      vat_amount_azn, is_capitalized, split_method, is_estimate, added_at_status, paid_now, cash_account_id, created_by)
    select v_id, (c ->> 'position')::int, c ->> 'cost_type', (c ->> 'partner_id')::uuid, c ->> 'description',
           (c ->> 'amount')::numeric, c ->> 'currency_code', (c ->> 'rate_to_azn')::numeric,
           coalesce((c ->> 'vat_amount_azn')::numeric, 0), (c ->> 'is_capitalized')::boolean, c ->> 'split_method',
           coalesce((c ->> 'is_estimate')::boolean, false), 'draft', coalesce((c ->> 'paid_now')::boolean, false),
           (c ->> 'cash_account_id')::uuid, p_actor
    from jsonb_array_elements(coalesce(p_costs, '[]'::jsonb)) c;

  insert into public.import_cost_allocations (cost_line_id, shipment_line_id, amount_azn)
  select c.id, l.id, (a ->> 'amount_azn')::numeric
  from jsonb_array_elements(coalesce(p_allocations, '[]'::jsonb)) a
  join public.import_cost_lines c on c.shipment_id = v_id and c.position = (a ->> 'cost_position')::int
  join public.import_shipment_lines l on l.shipment_id = v_id and l.position = (a ->> 'line_position')::int;

  select number into v_number from public.import_shipments where id = v_id;
  return jsonb_build_object('id', v_id, 'number', v_number);
end;
$$;

revoke all on function public.import_shipment_save_draft(uuid, jsonb, jsonb, jsonb, jsonb, uuid) from public, anon, authenticated;
grant execute on function public.import_shipment_save_draft(uuid, jsonb, jsonb, jsonb, jsonb, uuid) to service_role;

-- ─── Chatter (notes and attachments) on shipments ───────────────────────────

create or replace function public.chatter_models()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'accounts', 'contracts', 'customers', 'deals', 'employee_advances', 'employee_leaves', 'employees',
    'expenses', 'import_shipments', 'inventory_counts', 'inventory_initial_balances', 'inventory_writeoffs', 'payments',
    'payrolls', 'production_orders', 'products', 'purchases', 'sales', 'sales_commissions', 'suppliers',
    'todo_tasks', 'transactions', 'warehouse_slips'
  ]::text[];
$$;

-- ─── Row level security ─────────────────────────────────────────────────────

alter table public.currencies enable row level security;
drop policy if exists currencies_select on public.currencies;
create policy currencies_select on public.currencies for select to authenticated using (public.is_active_user());
drop policy if exists currencies_write on public.currencies;
create policy currencies_write on public.currencies for all to authenticated
  using ((select public.user_is_admin())) with check ((select public.user_is_admin()));

alter table public.exchange_rates enable row level security;
drop policy if exists exchange_rates_select on public.exchange_rates;
create policy exchange_rates_select on public.exchange_rates for select to authenticated
  using ((select public.imports_can('view')));
drop policy if exists exchange_rates_insert on public.exchange_rates;
create policy exchange_rates_insert on public.exchange_rates for insert to authenticated
  with check ((select public.imports_can('manage')) and source = 'manual');
drop policy if exists exchange_rates_update on public.exchange_rates;
create policy exchange_rates_update on public.exchange_rates for update to authenticated
  using ((select public.imports_can('manage')) and source = 'manual')
  with check ((select public.imports_can('manage')) and source = 'manual');

alter table public.import_shipments enable row level security;
drop policy if exists import_shipments_select on public.import_shipments;
create policy import_shipments_select on public.import_shipments for select to authenticated
  using ((select public.imports_can_read()));
drop policy if exists import_shipments_insert on public.import_shipments;
create policy import_shipments_insert on public.import_shipments for insert to authenticated
  with check ((select public.imports_can('manage')) and status = 'draft');
drop policy if exists import_shipments_update on public.import_shipments;
create policy import_shipments_update on public.import_shipments for update to authenticated
  using ((select public.imports_can('manage')) and status not in ('closed', 'cancelled'))
  with check ((select public.imports_can('manage')));
drop policy if exists import_shipments_delete on public.import_shipments;
create policy import_shipments_delete on public.import_shipments for delete to authenticated
  using ((select public.imports_can('manage')) and status = 'draft');

alter table public.import_shipment_lines enable row level security;
drop policy if exists import_shipment_lines_select on public.import_shipment_lines;
create policy import_shipment_lines_select on public.import_shipment_lines for select to authenticated
  using ((select public.imports_can_read()));
drop policy if exists import_shipment_lines_write on public.import_shipment_lines;
create policy import_shipment_lines_write on public.import_shipment_lines for all to authenticated
  using ((select public.imports_can('manage')) and public.import_shipment_is_open(shipment_id))
  with check ((select public.imports_can('manage')) and public.import_shipment_is_open(shipment_id));

alter table public.import_cost_lines enable row level security;
drop policy if exists import_cost_lines_select on public.import_cost_lines;
create policy import_cost_lines_select on public.import_cost_lines for select to authenticated
  using ((select public.imports_can_read()));
drop policy if exists import_cost_lines_write on public.import_cost_lines;
create policy import_cost_lines_write on public.import_cost_lines for all to authenticated
  using ((select public.imports_can('manage')) and public.import_shipment_is_open(shipment_id))
  with check ((select public.imports_can('manage')) and public.import_shipment_is_open(shipment_id));

alter table public.import_cost_allocations enable row level security;
drop policy if exists import_cost_allocations_select on public.import_cost_allocations;
create policy import_cost_allocations_select on public.import_cost_allocations for select to authenticated
  using ((select public.imports_can_read()));
drop policy if exists import_cost_allocations_write on public.import_cost_allocations;
create policy import_cost_allocations_write on public.import_cost_allocations for all to authenticated
  using (
    (select public.imports_can('manage'))
    and exists (select 1 from public.import_cost_lines c where c.id = cost_line_id and public.import_shipment_is_open(c.shipment_id))
  )
  with check (
    (select public.imports_can('manage'))
    and exists (select 1 from public.import_cost_lines c where c.id = cost_line_id and public.import_shipment_is_open(c.shipment_id))
  );

grant select on public.currencies to authenticated;
grant select, insert, update on public.exchange_rates to authenticated;
grant select, insert, update, delete on public.import_shipments, public.import_shipment_lines,
  public.import_cost_lines, public.import_cost_allocations to authenticated;
grant all on public.currencies, public.exchange_rates, public.import_shipments, public.import_shipment_lines,
  public.import_cost_lines, public.import_cost_allocations to service_role;

notify pgrst, 'reload schema';
