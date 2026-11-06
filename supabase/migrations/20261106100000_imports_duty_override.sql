-- IMP-6: the customs duty typed from the customs declaration.
--
-- A customs_duty cost split per line (per_line_duty) was always computed in the form from the lines'
-- customs value × duty rate, and the draft save stored that computed amount. The real duty is the
-- amount on the customs declaration, so the user may now type it. The typed amount (AZN) goes into
-- the existing columns (amount, currency_code = 'AZN', rate_to_azn = 1) and its split into
-- import_cost_allocations, both computed in src/lib/imports/landedCost.ts as before: in proportion
-- to each line's computed duty, or by customs value when every rate is 0.
--
-- The only thing the existing columns cannot say is whether the amount was typed or computed. Without
-- that, reopening a draft would either recompute and overwrite the typed duty, or freeze a computed
-- one that should follow the rates. So one boolean column:
--   import_cost_lines.amount_typed (default false = computed, today's behaviour).
-- Confirm, receive and the late-cost true-up read amount and import_cost_allocations as stored, so
-- they use the typed duty without any change.
--
-- Replaced (same signatures, only amount_typed added to the insert):
--   import_shipment_save_draft (from 20261105100000_imports_stages_pay.sql),
--   _imports_cost_from_json (from 20261030110000_imports_posting.sql; add_import_cost and
--   finalize_import_cost use it).
-- Run after 20261105100000_imports_stages_pay.sql. Safe to run twice.

ALTER TABLE public.import_cost_lines
  ADD COLUMN IF NOT EXISTS amount_typed BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.import_cost_lines.amount_typed IS
  'IMP-6: customs duty split per line whose amount (AZN) was typed from the customs declaration; false = computed from the lines'' duty rates.';

ALTER TABLE public.import_cost_lines DROP CONSTRAINT IF EXISTS import_cost_lines_amount_typed_duty;
ALTER TABLE public.import_cost_lines
  ADD CONSTRAINT import_cost_lines_amount_typed_duty CHECK (NOT amount_typed OR split_method = 'per_line_duty');

-- ─── Draft save ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.import_shipment_save_draft(
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
  v_id      uuid := p_id;
  v_status  text;
  v_number  text;
  v_bad     record;
  v_old_ids uuid[] := '{}';
  v_locked  record;
  v_new     jsonb;
begin
  if p_id is not null then
    select status into v_status from public.import_shipments where id = p_id for update;
    if not found then raise exception 'imports_not_found' using errcode = 'P0002'; end if;
    if v_status <> 'draft' then raise exception 'imports_not_draft' using errcode = '22023'; end if;

    select coalesce(array_agg(id), '{}') into v_old_ids from public.import_cost_lines where shipment_id = p_id;

    -- Paid costs (IMP-5): still there, with the same amount, currency, rate, VAT, flag, partner.
    for v_locked in
      select c.* from public.import_cost_lines c
      where c.shipment_id = p_id
        and exists (select 1 from public.import_prepayments pp where pp.cost_line_id = c.id and pp.status <> 'cancelled')
    loop
      v_new := null;
      select e.value into v_new from jsonb_array_elements(coalesce(p_costs, '[]'::jsonb)) as e(value)
      where e.value ->> 'id' = v_locked.id::text limit 1;
      if v_new is null then
        raise exception using errcode = '22023',
          message = format('imports_cost_paid_locked: «%s» ödənilib, silinə bilməz', coalesce(nullif(v_locked.description, ''), v_locked.cost_type));
      end if;
      if (v_new ->> 'partner_id')::uuid is distinct from v_locked.partner_id
         or (v_new ->> 'currency_code') is distinct from v_locked.currency_code
         or round((v_new ->> 'amount')::numeric, 2) is distinct from round(v_locked.amount, 2)
         or (v_locked.currency_code <> 'AZN' and round((v_new ->> 'rate_to_azn')::numeric, 6) is distinct from round(v_locked.rate_to_azn, 6))
         or round(coalesce((v_new ->> 'vat_amount_azn')::numeric, 0), 2) is distinct from round(v_locked.vat_amount_azn, 2)
         or (v_new ->> 'is_capitalized')::boolean is distinct from v_locked.is_capitalized then
        raise exception using errcode = '22023',
          message = format('imports_cost_paid_locked: «%s» ödənilib: məbləğ, valyuta, məzənnə, ƏDV, maya dəyərinə daxil olması və tərəf dəyişdirilə bilməz',
            coalesce(nullif(v_locked.description, ''), v_locked.cost_type));
      end if;
    end loop;

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

  -- A stored cost keeps its id (only an id this shipment had; anything else gets a new one).
  insert into public.import_cost_lines (
      id, shipment_id, position, cost_type, partner_id, description, amount, currency_code, rate_to_azn,
      vat_amount_azn, is_capitalized, split_method, is_estimate, added_at_status, paid_now, cash_account_id, created_by, amount_typed)
    select case when (c ->> 'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                     and (c ->> 'id')::uuid = any (v_old_ids)
                then (c ->> 'id')::uuid else gen_random_uuid() end,
           v_id, (c ->> 'position')::int, c ->> 'cost_type', (c ->> 'partner_id')::uuid, c ->> 'description',
           (c ->> 'amount')::numeric, c ->> 'currency_code', (c ->> 'rate_to_azn')::numeric,
           coalesce((c ->> 'vat_amount_azn')::numeric, 0), (c ->> 'is_capitalized')::boolean, c ->> 'split_method',
           coalesce((c ->> 'is_estimate')::boolean, false), 'draft', coalesce((c ->> 'paid_now')::boolean, false),
           (c ->> 'cash_account_id')::uuid, p_actor,
           -- IMP-6: the duty typed from the customs declaration (only for a duty split per line).
           coalesce((c ->> 'amount_typed')::boolean, false) and c ->> 'split_method' = 'per_line_duty'
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

-- ─── Late and finalized costs ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._imports_cost_from_json(p_shipment_id UUID, p_cost JSONB, p_status TEXT)
RETURNS public.import_cost_lines
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.import_cost_lines;
BEGIN
  INSERT INTO public.import_cost_lines (
    shipment_id, position, cost_type, partner_id, description, amount, currency_code, rate_to_azn,
    vat_amount_azn, is_capitalized, split_method, is_estimate, added_at_status, paid_now, created_by, amount_typed)
  VALUES (
    p_shipment_id,
    COALESCE((SELECT MAX(position) + 1 FROM public.import_cost_lines WHERE shipment_id = p_shipment_id), 0),
    p_cost->>'cost_type',
    NULLIF(p_cost->>'partner_id', '')::uuid,
    NULLIF(btrim(p_cost->>'description'), ''),
    round(COALESCE((p_cost->>'amount')::numeric, 0), 2),
    COALESCE(NULLIF(p_cost->>'currency_code', ''), 'AZN'),
    CASE WHEN COALESCE(NULLIF(p_cost->>'currency_code', ''), 'AZN') = 'AZN' THEN 1 ELSE COALESCE((p_cost->>'rate_to_azn')::numeric, 0) END,
    round(COALESCE((p_cost->>'vat_amount_azn')::numeric, 0), 2),
    CASE WHEN p_cost->>'cost_type' = 'customs_vat' THEN false ELSE COALESCE((p_cost->>'is_capitalized')::boolean, true) END,
    COALESCE(NULLIF(p_cost->>'split_method', ''), 'by_value'),
    COALESCE((p_cost->>'is_estimate')::boolean, false),
    p_status,
    false,
    auth.uid(),
    -- IMP-6: a late or finalized duty typed from the declaration keeps that mark.
    COALESCE((p_cost->>'amount_typed')::boolean, false) AND COALESCE(NULLIF(p_cost->>'split_method', ''), 'by_value') = 'per_line_duty'
  ) RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public._imports_cost_from_json(UUID, JSONB, TEXT) FROM PUBLIC, anon, authenticated;
