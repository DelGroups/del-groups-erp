-- ============================================================================
-- Imports module ("İdxal"), IMP-4: the warehouse of each product line, and one line split over
-- several warehouses (Del, 2026-11-04).
--
-- The products of one import go to different warehouses and the import document says which goes
-- where. A line still has its own warehouse_id (null = the shipment's default warehouse); with a
-- split it has rows here instead: warehouse × quantity, adding up to the line (whole sheets for
-- sheet products). The receive dialog starts from this plan; receive_import_shipment already
-- takes one entry per line and warehouse and is not changed.
--
--   import_shipment_line_warehouses  shipment line × warehouse → qty (purchase and stock unit)
--   import_shipment_save_draft       same signature; also writes the splits from an optional
--                                    "warehouses" array on each line of p_lines, and checks them
--
-- Access exactly like import_shipment_lines: read with imports.view (and financial figures),
-- write with imports.manage while the shipment is a draft; confirmed or received lines keep their
-- splits read-only. Each tenant has its own project, so there is no tenant column.
-- Safe to re-run. Only adds a table and replaces the draft save function: the old form keeps
-- working (its lines simply send no "warehouses").
-- ============================================================================

create table if not exists public.import_shipment_line_warehouses (
  id uuid primary key default gen_random_uuid(),
  shipment_line_id uuid not null references public.import_shipment_lines (id) on delete cascade,
  warehouse_id uuid not null references public.warehouses (id) on delete restrict,
  -- Purchase unit (sheets, pieces) and stock unit (metres for sheet products).
  qty_purchase numeric(14,3) not null check (qty_purchase > 0),
  qty_stock_unit numeric(14,3) not null check (qty_stock_unit > 0),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint import_shipment_line_warehouses_line_wh_key unique (shipment_line_id, warehouse_id)
);

comment on table public.import_shipment_line_warehouses is
  'Imports (IMP-4): a shipment line split over several warehouses. No rows = the whole line goes to the line''s warehouse, else the shipment''s default.';

-- The unique key covers lookups by line; the warehouse foreign key gets its own index.
create index if not exists import_shipment_line_warehouses_wh_idx on public.import_shipment_line_warehouses (warehouse_id);

alter table public.import_shipment_line_warehouses enable row level security;

drop policy if exists import_shipment_line_warehouses_select on public.import_shipment_line_warehouses;
create policy import_shipment_line_warehouses_select on public.import_shipment_line_warehouses for select to authenticated
  using ((select public.imports_can_read()));

drop policy if exists import_shipment_line_warehouses_write on public.import_shipment_line_warehouses;
create policy import_shipment_line_warehouses_write on public.import_shipment_line_warehouses for all to authenticated
  using (
    (select public.imports_can('manage'))
    and exists (select 1 from public.import_shipment_lines l where l.id = shipment_line_id and public.import_shipment_is_draft(l.shipment_id))
  )
  with check (
    (select public.imports_can('manage'))
    and exists (select 1 from public.import_shipment_lines l where l.id = shipment_line_id and public.import_shipment_is_draft(l.shipment_id))
  );

grant select, insert, update, delete on public.import_shipment_line_warehouses to authenticated;
grant all on public.import_shipment_line_warehouses to service_role;

-- ─── Save a draft in one transaction (replaces IMP-1's, same signature) ─────

-- As before: replaces the header, lines, costs and allocations of a draft (allocations refer to
-- lines and costs by their position in the payload). New: each line of p_lines may carry
-- "warehouses": [{warehouse_id, qty_purchase, qty_stock_unit, sort_order}]. An empty or missing
-- array means no split (the line's warehouse_id, else the header default, gets the whole line).
-- A split must add up to the line in both units, use each warehouse once, and be whole sheets
-- for sheet products; otherwise nothing is saved (imports_warehouse_split).
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
  v_bad    record;
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
    -- The splits go with their lines (on delete cascade).
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

  -- IMP-4: the planned split of each line (a repeated warehouse fails the unique key).
  insert into public.import_shipment_line_warehouses (shipment_line_id, warehouse_id, qty_purchase, qty_stock_unit, sort_order)
    select sl.id, (w ->> 'warehouse_id')::uuid, (w ->> 'qty_purchase')::numeric, (w ->> 'qty_stock_unit')::numeric,
           coalesce((w ->> 'sort_order')::int, (wo.ord - 1)::int)
    from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) l
    join public.import_shipment_lines sl on sl.shipment_id = v_id and sl.position = (l ->> 'position')::int
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(l -> 'warehouses') = 'array' then l -> 'warehouses' else '[]'::jsonb end
    ) with ordinality as wo(w, ord);

  -- Every split adds up to its line (purchase and stock unit) and is whole sheets for sheet products.
  select p.name as product_name, sl.qty_purchase_unit, sum(x.qty_purchase) as split_qty,
         sl.qty_stock_unit, sum(x.qty_stock_unit) as split_stock,
         bool_or(p.inventory_mode = 'polywood' and coalesce(p.full_sheet_length_m, 0) > 0
                 and abs(x.qty_purchase - round(x.qty_purchase)) > 0.0005) as part_sheets
    into v_bad
  from public.import_shipment_line_warehouses x
  join public.import_shipment_lines sl on sl.id = x.shipment_line_id
  join public.products p on p.id = sl.product_id
  where sl.shipment_id = v_id
  group by sl.id, p.name, sl.qty_purchase_unit, sl.qty_stock_unit
  having abs(sum(x.qty_purchase) - sl.qty_purchase_unit) > 0.0005
      or abs(sum(x.qty_stock_unit) - sl.qty_stock_unit) > 0.0015
      or bool_or(p.inventory_mode = 'polywood' and coalesce(p.full_sheet_length_m, 0) > 0
                 and abs(x.qty_purchase - round(x.qty_purchase)) > 0.0005)
  limit 1;
  if found then
    raise exception using errcode = '22023',
      message = case when v_bad.part_sheets
        then format('imports_warehouse_split: %s yalnız tam vərəqlə bölünür', v_bad.product_name)
        else format('imports_warehouse_split: %s: anbarlar üzrə %s, sətirdə %s', v_bad.product_name, v_bad.split_qty, v_bad.qty_purchase_unit)
      end;
  end if;

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

notify pgrst, 'reload schema';
