-- ============================================================================
-- LOT-2: inbound documents create named lots (plan docs/lot-tracking/LOT-plan.md, 2, 5, 7).
--
-- On LOT-1's engine (20261115100000_lot_core.sql): each inbound document tells the lot triggers
-- which lot a stock change goes to (lot_ctx_begin / lot_ctx_end around the change):
--   * Imports (first and most careful): planned lot fields per shipment line (draft save); a
--     receipt entry may be split into lots (one import_receipt_lines row and FIFO layer per lot);
--     a second receipt of the same line adds to the SAME lot unless another number is given;
--     cancel takes stock out of exactly the receipt's lots.
--   * Purchases: optional lot fields per line; one lot per product per purchase (posting merges
--     a product's lines; two lines of one product with different lots are refused); reversal
--     takes the purchase's lots back out.
--   * Initial balance / stock receipt (posted from the app server): lot_post_inbound_line /
--     lot_insert_inbound_pieces do the stock change and its lot in one transaction; unpost
--     reverses.
--   * Production: finished goods get a 'production' lot (the order number when free) listing the
--     material lots the order consumed (custom_fields.material_lots: filled once LOT-3 gives the
--     material issues their context, doc_type 'production_order').
--   * Counts: a surplus is a new 'count_surplus' lot, a shortage leaves FEFO; unpost reverses.
-- products.lot_policy = 'manual_required' needs a supplier batch number (and, with
-- shelf_life_days, an expiry date: default mfg_date + shelf_life_days).
--
-- Each function is replaced with the same signature and its latest body; only the lot parts
-- change. Module functions only where the module is installed. Needs 20261115100000. Safe to re-run.
-- ============================================================================

DO $$
BEGIN
  IF to_regprocedure('public._lot_create(uuid, jsonb)') IS NULL THEN
    RAISE EXCEPTION 'Run 20261115100000_lot_core.sql (LOT-1) before 20261115110000_lot_inbound.sql';
  END IF;
END
$$;

-- ─── 1. Columns ─────────────────────────────────────────────────────────────

ALTER TABLE public.import_shipment_lines ADD COLUMN IF NOT EXISTS lot_no_planned TEXT;
ALTER TABLE public.import_shipment_lines ADD COLUMN IF NOT EXISTS supplier_batch_no TEXT;
ALTER TABLE public.import_shipment_lines ADD COLUMN IF NOT EXISTS mfg_date DATE;
ALTER TABLE public.import_shipment_lines ADD COLUMN IF NOT EXISTS exp_date DATE;
ALTER TABLE public.import_receipt_lines ADD COLUMN IF NOT EXISTS lot_id UUID REFERENCES public.stock_lots(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS import_receipt_lines_lot_idx ON public.import_receipt_lines (lot_id) WHERE lot_id IS NOT NULL;

DO $$
BEGIN
  IF to_regclass('public.purchase_items') IS NOT NULL THEN
    ALTER TABLE public.purchase_items ADD COLUMN IF NOT EXISTS lot_no TEXT;
    ALTER TABLE public.purchase_items ADD COLUMN IF NOT EXISTS supplier_batch_no TEXT;
    ALTER TABLE public.purchase_items ADD COLUMN IF NOT EXISTS mfg_date DATE;
    ALTER TABLE public.purchase_items ADD COLUMN IF NOT EXISTS exp_date DATE;
  END IF;
  IF to_regclass('public.inventory_initial_balance_items') IS NOT NULL THEN
    ALTER TABLE public.inventory_initial_balance_items ADD COLUMN IF NOT EXISTS lot_no TEXT;
    ALTER TABLE public.inventory_initial_balance_items ADD COLUMN IF NOT EXISTS supplier_batch_no TEXT;
    ALTER TABLE public.inventory_initial_balance_items ADD COLUMN IF NOT EXISTS mfg_date DATE;
    ALTER TABLE public.inventory_initial_balance_items ADD COLUMN IF NOT EXISTS exp_date DATE;
  END IF;
END
$$;

-- ─── 2. Helpers ─────────────────────────────────────────────────────────────

-- The lot fields of an inbound line, checked: {lot_no, supplier_batch_no, mfg_date, exp_date}.
-- manual_required: a supplier batch number, and with shelf_life_days an expiry date (default
-- mfg_date + shelf_life_days). Errors start with a code (lot_batch_required, lot_exp_required,
-- lot_dates_invalid) for the UI.
CREATE OR REPLACE FUNCTION public._lot_inbound_fields(p_product UUID, p JSONB)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_policy TEXT;
  v_life   INTEGER;
  v_name   TEXT;
  v_no     TEXT := NULLIF(btrim(COALESCE(p ->> 'lot_no', '')), '');
  v_batch  TEXT := NULLIF(btrim(COALESCE(p ->> 'supplier_batch_no', '')), '');
  v_mfg    DATE := public._lot_date(p ->> 'mfg_date');
  v_exp    DATE := public._lot_date(p ->> 'exp_date');
BEGIN
  SELECT lot_policy, shelf_life_days, name INTO v_policy, v_life, v_name FROM public.products WHERE id = p_product;
  IF v_exp IS NULL AND v_life IS NOT NULL AND v_mfg IS NOT NULL THEN
    v_exp := v_mfg + v_life;
  END IF;
  IF v_policy = 'manual_required' THEN
    IF v_batch IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = format('lot_batch_required: %s: istehsalçının partiya nömrəsini yazın', v_name);
    END IF;
    IF v_life IS NOT NULL AND v_exp IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = format('lot_exp_required: %s: son istifadə tarixini (və ya istehsal tarixini) yazın', v_name);
    END IF;
  END IF;
  IF v_mfg IS NOT NULL AND v_exp IS NOT NULL AND v_exp < v_mfg THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = format('lot_dates_invalid: %s: son istifadə tarixi istehsal tarixindən əvvəldir', v_name);
  END IF;
  RETURN jsonb_strip_nulls(jsonb_build_object('lot_no', v_no, 'supplier_batch_no', v_batch, 'mfg_date', v_mfg, 'exp_date', v_exp));
END;
$$;

-- The existing lot with this number for the product (NULL: none yet). A number of another
-- product's lot is refused.
CREATE OR REPLACE FUNCTION public._lot_resolve_named(p_product UUID, p_lot_no TEXT)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lot RECORD;
BEGIN
  IF NULLIF(btrim(COALESCE(p_lot_no, '')), '') IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT id, product_id, origin_type INTO v_lot FROM public.stock_lots WHERE lot_no = btrim(p_lot_no);
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  IF v_lot.product_id <> p_product OR v_lot.origin_type = 'unassigned' THEN
    RAISE EXCEPTION USING ERRCODE = '23505',
      MESSAGE = format('lot_no_taken: %s lot nömrəsi başqa məhsulun lotudur', btrim(p_lot_no));
  END IF;
  RETURN v_lot.id;
END;
$$;

-- The lot context of one product of a purchase: an existing lot named on its lines, else a new
-- lot with the lines' fields. Two lines of the product with different lots are refused (posting
-- moves a product once).
CREATE OR REPLACE FUNCTION public._lot_purchase_ctx(p_purchase_id UUID, p_product UUID, p_qty NUMERIC)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pu    RECORD;
  v_li    RECORD;
  v_kinds INTEGER;
  v_f     JSONB;
  v_lot   UUID;
  v_ctx   JSONB;
BEGIN
  SELECT p.supplier_id, p.invoice_number INTO v_pu FROM public.purchases p WHERE p.id = p_purchase_id;
  SELECT count(DISTINCT (COALESCE(pi.lot_no, ''), COALESCE(pi.supplier_batch_no, ''), pi.mfg_date, pi.exp_date))
  INTO v_kinds
  FROM public.purchase_items pi
  WHERE pi.purchase_id = p_purchase_id AND pi.product_id = p_product
    AND (pi.lot_no IS NOT NULL OR pi.supplier_batch_no IS NOT NULL OR pi.mfg_date IS NOT NULL OR pi.exp_date IS NOT NULL);
  IF v_kinds > 1 THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = format('lot_conflict: %s: bir alışda eyni məhsulun sətirləri fərqli lotlardadır; sətirləri birləşdirin',
                       (SELECT name FROM public.products WHERE id = p_product));
  END IF;
  SELECT pi.id, pi.lot_no, pi.supplier_batch_no, pi.mfg_date, pi.exp_date INTO v_li
  FROM public.purchase_items pi
  WHERE pi.purchase_id = p_purchase_id AND pi.product_id = p_product
  ORDER BY (pi.lot_no IS NULL AND pi.supplier_batch_no IS NULL AND pi.mfg_date IS NULL AND pi.exp_date IS NULL), pi.id
  LIMIT 1;
  v_f := public._lot_inbound_fields(p_product, jsonb_build_object(
    'lot_no', v_li.lot_no, 'supplier_batch_no', v_li.supplier_batch_no, 'mfg_date', v_li.mfg_date, 'exp_date', v_li.exp_date));
  v_lot := public._lot_resolve_named(p_product, v_f ->> 'lot_no');
  v_ctx := jsonb_build_object('doc_type', 'purchase', 'doc_id', p_purchase_id, 'doc_line_id', v_li.id, 'doc_no', v_pu.invoice_number,
                              'product_id', p_product, 'counterparty_type', 'supplier', 'counterparty_id', v_pu.supplier_id);
  IF v_lot IS NOT NULL THEN
    UPDATE public.stock_lots SET qty_received = qty_received + p_qty, updated_at = NOW() WHERE id = v_lot;
    RETURN v_ctx || jsonb_build_object('lots', jsonb_build_array(jsonb_build_object('lot_id', v_lot, 'qty', p_qty)));
  END IF;
  RETURN v_ctx || jsonb_build_object('new_lot', v_f || jsonb_build_object('origin_type', 'purchase', 'supplier_id', v_pu.supplier_id));
END;
$$;

-- Link a document's FIFO layer and its lot (the lot its latest in movement for the product went to).
CREATE OR REPLACE FUNCTION public._lot_link_batch(p_doc_type TEXT, p_doc_id UUID, p_product UUID, p_batch UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lot UUID;
BEGIN
  IF p_batch IS NULL THEN
    RETURN;
  END IF;
  SELECT m.lot_id INTO v_lot
  FROM public.stock_lot_movements m
  JOIN public.stock_lots l ON l.id = m.lot_id AND l.origin_type <> 'unassigned'
  WHERE m.doc_type = p_doc_type AND m.doc_id = p_doc_id AND m.product_id = p_product AND m.qty_delta > 0
  ORDER BY m.recorded_at DESC
  LIMIT 1;
  IF v_lot IS NOT NULL THEN
    UPDATE public.inventory_batches SET lot_id = v_lot WHERE id = p_batch;
    UPDATE public.stock_lots SET inventory_batch_id = COALESCE(inventory_batch_id, p_batch) WHERE id = v_lot;
  END IF;
END;
$$;

-- The lot of an inbound line posted from the app server: an existing lot by number, else a new
-- one with the line's fields. p_doc: {doc_type, doc_id, doc_line_id, doc_no, counterparty_type,
-- counterparty_id, origin_type}.
CREATE OR REPLACE FUNCTION public._lot_for_inbound_line(p_doc JSONB, p_product UUID, p_qty NUMERIC, p_fields JSONB)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_f   JSONB := public._lot_inbound_fields(p_product, COALESCE(p_fields, '{}'::jsonb));
  v_lot UUID := public._lot_resolve_named(p_product, v_f ->> 'lot_no');
BEGIN
  IF v_lot IS NOT NULL THEN
    UPDATE public.stock_lots SET qty_received = qty_received + p_qty, updated_at = NOW() WHERE id = v_lot;
    RETURN v_lot;
  END IF;
  RETURN public._lot_create(p_product, v_f || jsonb_build_object(
    'origin_type', COALESCE(NULLIF(p_doc ->> 'origin_type', ''), public._lot_origin_for(p_doc ->> 'doc_type')),
    'origin_doc_type', p_doc ->> 'doc_type', 'origin_doc_id', p_doc ->> 'doc_id', 'origin_line_id', p_doc ->> 'doc_line_id',
    'origin_doc_no', p_doc ->> 'doc_no',
    'supplier_id', CASE WHEN p_doc ->> 'counterparty_type' = 'supplier' THEN p_doc ->> 'counterparty_id' END,
    'received_date', (COALESCE(public.document_timestamp(), NOW()) AT TIME ZONE 'Asia/Baku')::date,
    'qty_received', p_qty));
END;
$$;

-- Server (service role): a stock increase of a document line and its lot in one transaction
-- (the initial balance is posted from the app server, request by request).
CREATE OR REPLACE FUNCTION public.lot_post_inbound_line(p_doc JSONB, p_product UUID, p_warehouse UUID, p_qty NUMERIC, p_fields JSONB DEFAULT '{}'::jsonb)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lot   UUID;
  v_stock NUMERIC;
BEGIN
  IF COALESCE(p_qty, 0) <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Miqdar sıfırdan böyük olmalıdır';
  END IF;
  v_lot := public._lot_for_inbound_line(p_doc, p_product, p_qty, p_fields);
  PERFORM public.lot_ctx_begin((p_doc - 'origin_type') || jsonb_build_object(
    'product_id', p_product, 'lots', jsonb_build_array(jsonb_build_object('lot_id', v_lot, 'qty', p_qty))));
  v_stock := public.adjust_warehouse_stock(p_product, p_warehouse, p_qty);
  PERFORM public.lot_ctx_end();
  RETURN jsonb_build_object('lot_id', v_lot, 'stock', v_stock);
END;
$$;

-- Server (service role): Polywood pieces of a document line on its lot. p_rows: the
-- polywood_pieces rows (product_id, warehouse_id, length_m, piece_type, status, notes,
-- source_document_id, barcode, qr_code). Returns the metres added.
CREATE OR REPLACE FUNCTION public.lot_insert_inbound_pieces(p_doc JSONB, p_fields JSONB, p_rows JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product UUID := public._lot_uuid(p_rows -> 0 ->> 'product_id');
  v_metres  NUMERIC;
  v_lot     UUID;
BEGIN
  IF v_product IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Hissə sətirləri boşdur';
  END IF;
  SELECT COALESCE(SUM((x ->> 'length_m')::numeric), 0) INTO v_metres FROM jsonb_array_elements(p_rows) x;
  v_lot := public._lot_for_inbound_line(p_doc, v_product, v_metres, p_fields);
  PERFORM public.lot_ctx_begin((p_doc - 'origin_type') || jsonb_build_object('product_id', v_product));
  INSERT INTO public.polywood_pieces (product_id, warehouse_id, length_m, piece_type, status, notes, source_document_id, barcode, qr_code, updated_at, lot_id)
  SELECT x.product_id, x.warehouse_id, x.length_m, x.piece_type, COALESCE(x.status, 'available'), x.notes, x.source_document_id,
         x.barcode, x.qr_code, NOW(), v_lot
  FROM jsonb_to_recordset(p_rows) AS x(product_id UUID, warehouse_id UUID, length_m NUMERIC, piece_type TEXT, status TEXT,
                                       notes TEXT, source_document_id UUID, barcode TEXT, qr_code TEXT);
  PERFORM public.lot_ctx_end();
  RETURN jsonb_build_object('lot_id', v_lot, 'metres', v_metres);
END;
$$;

-- ─── 3. Imports ─────────────────────────────────────────────────────────────

-- Draft save: the planned lot fields of each line.
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
  v_lot_bad record;
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

  -- LOT-2: optional planned lot fields per line (lot_no_planned, supplier_batch_no, mfg_date, exp_date).
  insert into public.import_shipment_lines (
      shipment_id, position, product_id, qty_purchase_unit, purchase_unit, qty_stock_unit, unit_price_fc,
      weight_kg, volume_m3, hs_code, duty_rate_pct, warehouse_id,
      lot_no_planned, supplier_batch_no, mfg_date, exp_date)
    select v_id, (l ->> 'position')::int, (l ->> 'product_id')::uuid, (l ->> 'qty_purchase_unit')::numeric,
           l ->> 'purchase_unit', (l ->> 'qty_stock_unit')::numeric, (l ->> 'unit_price_fc')::numeric,
           (l ->> 'weight_kg')::numeric, (l ->> 'volume_m3')::numeric, l ->> 'hs_code',
           coalesce((l ->> 'duty_rate_pct')::numeric, 0), (l ->> 'warehouse_id')::uuid,
           nullif(btrim(l ->> 'lot_no_planned'), ''), nullif(btrim(l ->> 'supplier_batch_no'), ''),
           public._lot_date(l ->> 'mfg_date'), public._lot_date(l ->> 'exp_date')
    from jsonb_array_elements(coalesce(p_lines, '[]'::jsonb)) l;

  -- LOT-2: a planned lot number is unique in the shipment and not taken by an existing lot.
  select sl.lot_no_planned, p.name as product_name,
         count(*) over (partition by sl.lot_no_planned) as uses,
         exists (select 1 from public.stock_lots x where x.lot_no = sl.lot_no_planned) as taken
    into v_lot_bad
  from public.import_shipment_lines sl
  join public.products p on p.id = sl.product_id
  where sl.shipment_id = v_id and sl.lot_no_planned is not null
  order by 3 desc, 4 desc
  limit 1;
  if found and (v_lot_bad.uses > 1 or v_lot_bad.taken) then
    raise exception using errcode = '23505',
      message = case when v_lot_bad.uses > 1
        then format('lot_no_duplicate: %s lot nömrəsi bu idxalda bir neçə sətirdədir', v_lot_bad.lot_no_planned)
        else format('lot_no_taken: %s lot nömrəsi artıq var (%s)', v_lot_bad.lot_no_planned, v_lot_bad.product_name)
      end;
  end if;
  select sl.mfg_date, sl.exp_date, p.name as product_name into v_lot_bad
  from public.import_shipment_lines sl join public.products p on p.id = sl.product_id
  where sl.shipment_id = v_id and sl.mfg_date is not null and sl.exp_date is not null and sl.exp_date < sl.mfg_date
  limit 1;
  if found then
    raise exception using errcode = '22023',
      message = format('lot_dates_invalid: %s: son istifadə tarixi istehsal tarixindən əvvəldir', v_lot_bad.product_name);
  end if;

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

-- Receipt: every entry (or each of its lots) on a named lot.
CREATE OR REPLACE FUNCTION public.receive_import_shipment(p_id UUID, p_lines JSONB, p_date DATE DEFAULT NULL, p_note TEXT DEFAULT NULL, p_idempotency_key TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- LOT-2
  v_lots     JSONB;
  v_lotj     JSONB;
  v_lot_sum  NUMERIC;
  v_last_k   INT;
  v_k        INT;
  v_lqty     NUMERIC;
  v_lvalue   NUMERIC;
  v_lunit    NUMERIC;
  v_vleft    NUMERIC;
  v_f        JSONB;
  v_lot      UUID;
  v_lot_new  BOOLEAN;
  v_expected NUMERIC;
  v_lsheets  NUMERIC;
  v_done    JSONB := public._imports_op_get(p_idempotency_key);
  v_s       public.import_shipments;
  v_entry   JSONB;
  v_line    RECORD;
  v_qty     NUMERIC;
  v_wh      UUID;
  v_landed  NUMERIC;
  v_rec     RECORD;
  v_value   NUMERIC;
  v_unit    NUMERIC;
  v_sheets  NUMERIC;
  v_receipt UUID;
  v_number  TEXT;
  v_year    INT;
  v_no      INT;
  v_total   NUMERIC := 0;
  v_rl      UUID;
  v_batch   UUID;
  v_journal UUID;
  v_date    DATE;
  v_status  TEXT;
  i         INT;
BEGIN
  IF v_done IS NOT NULL THEN RETURN v_done; END IF;
  PERFORM public._imports_require('approve');

  SELECT * INTO v_s FROM public.import_shipments WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'imports_not_found: İdxal sənədi tapılmadı';
  END IF;
  IF v_s.status NOT IN ('confirmed', 'cleared', 'partially_received') THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'imports_cannot_receive: Yalnız təsdiqlənmiş idxal anbara qəbul edilə bilər';
  END IF;
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'imports_receipt_empty: Qəbul ediləcək sətir yoxdur';
  END IF;

  v_date := COALESCE(p_date, public.document_today());
  IF v_date < COALESCE(v_s.confirm_date, v_date) THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'imports_date_before_confirm: Qəbul tarixi təsdiq tarixindən əvvəl ola bilməz';
  END IF;
  PERFORM public.use_document_date(v_date);

  v_year := EXTRACT(YEAR FROM v_date)::int;
  INSERT INTO public.document_number_counters (doc_type, year, last_no) VALUES ('import_receipt', v_year, 1)
  ON CONFLICT (doc_type, year) DO UPDATE SET last_no = public.document_number_counters.last_no + 1
  RETURNING last_no INTO v_no;
  v_number := 'IMR-' || v_year::text || '-' || lpad(v_no::text, 4, '0');

  INSERT INTO public.import_receipts (shipment_id, number, receipt_date, note)
  VALUES (p_id, v_number, v_date, NULLIF(btrim(p_note), '')) RETURNING id INTO v_receipt;

  FOR i IN 0 .. jsonb_array_length(p_lines) - 1 LOOP
    v_entry := p_lines -> i;
    v_qty := round(COALESCE((v_entry->>'qty_stock_unit')::numeric, 0), 3);
    IF v_qty <= 0 THEN
      CONTINUE;
    END IF;

    SELECT l.*, p.inventory_mode, p.full_sheet_length_m, p.name AS product_name, p.unit AS product_unit
    INTO v_line
    FROM public.import_shipment_lines l JOIN public.products p ON p.id = l.product_id
    WHERE l.id = (v_entry->>'shipment_line_id')::uuid AND l.shipment_id = p_id
    FOR UPDATE OF l;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'imports_line_not_found: Sətir bu idxala aid deyil';
    END IF;

    SELECT * INTO v_rec FROM public._imports_line_received(v_line.id);
    IF v_rec.qty + v_qty > v_line.qty_stock_unit + 0.0005 THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = format('imports_over_receipt: %s: qəbul (%s) gözləniləndən (%s) çoxdur',
          v_line.product_name, v_rec.qty + v_qty, v_line.qty_stock_unit);
    END IF;

    v_wh := COALESCE(NULLIF(v_entry->>'warehouse_id', '')::uuid, v_line.warehouse_id, v_s.default_warehouse_id, public.stock_default_warehouse());
    IF v_wh IS NULL OR NOT EXISTS (SELECT 1 FROM public.warehouses WHERE id = v_wh) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'imports_warehouse_required: Anbar seçilməyib';
    END IF;

    -- The latest allocation; the last receipt of a line takes exactly what is left.
    v_landed := public._imports_line_landed(v_line.id);
    IF v_rec.qty + v_qty >= v_line.qty_stock_unit - 0.0005 THEN
      v_value := round(v_landed, 2) - v_rec.value;
    ELSE
      v_value := round(v_landed * v_qty / v_line.qty_stock_unit, 2);
    END IF;
    v_value := GREATEST(v_value, 0);
    v_unit := round(v_value / v_qty, 4);

    IF v_line.inventory_mode = 'polywood' THEN
      v_sheets := v_qty / NULLIF(v_line.full_sheet_length_m, 0);
      IF v_sheets IS NULL OR abs(v_sheets - round(v_sheets)) > 0.001 THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
          MESSAGE = format('imports_whole_sheets: %s yalnız tam vərəqlə qəbul edilir (%s m)', v_line.product_name, v_line.full_sheet_length_m);
      END IF;
    END IF;

    -- LOT-2: the entry's lots [{qty_stock_unit, lot_no?, supplier_batch_no?, mfg_date?, exp_date?}]
    -- summing to the entry; without them one lot with the line's planned values. One receipt line
    -- per lot, each with its share of the value and its own FIFO layer.
    v_lots := CASE WHEN jsonb_typeof(v_entry -> 'lots') = 'array' AND jsonb_array_length(v_entry -> 'lots') > 0
                   THEN v_entry -> 'lots' ELSE jsonb_build_array(jsonb_build_object('qty_stock_unit', v_qty)) END;
    SELECT COALESCE(SUM(round(COALESCE(NULLIF(x ->> 'qty_stock_unit', '')::numeric, 0), 3)), 0),
           MAX(o) FILTER (WHERE round(COALESCE(NULLIF(x ->> 'qty_stock_unit', '')::numeric, 0), 3) > 0)
    INTO v_lot_sum, v_last_k
    FROM jsonb_array_elements(v_lots) WITH ORDINALITY AS e(x, o);
    IF abs(v_lot_sum - v_qty) > 0.0005 THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = format('lot_split_sum: %s: lotların cəmi (%s) qəbul miqdarına (%s) bərabər deyil', v_line.product_name, v_lot_sum, v_qty);
    END IF;
    v_vleft := v_value;
    v_expected := NULLIF(v_entry->>'expected_qty_stock_unit', '')::numeric;

    FOR v_lotj, v_k IN SELECT x, o::int FROM jsonb_array_elements(v_lots) WITH ORDINALITY AS e(x, o) LOOP
      v_lqty := round(COALESCE(NULLIF(v_lotj ->> 'qty_stock_unit', '')::numeric, 0), 3);
      CONTINUE WHEN v_lqty <= 0;
      v_lvalue := CASE WHEN v_k = v_last_k THEN v_vleft ELSE round(v_value * v_lqty / v_qty, 2) END;
      v_vleft := v_vleft - v_lvalue;
      v_lunit := round(v_lvalue / v_lqty, 4);

      -- Its fields: what the receipt gives, else the line's plan (the planned number goes to the first lot).
      v_f := public._lot_inbound_fields(v_line.product_id, jsonb_build_object(
        'lot_no', COALESCE(NULLIF(btrim(v_lotj ->> 'lot_no'), ''), CASE WHEN v_k = 1 THEN v_line.lot_no_planned END),
        'supplier_batch_no', COALESCE(NULLIF(btrim(v_lotj ->> 'supplier_batch_no'), ''), v_line.supplier_batch_no),
        'mfg_date', COALESCE(NULLIF(v_lotj ->> 'mfg_date', ''), v_line.mfg_date::text),
        'exp_date', COALESCE(NULLIF(v_lotj ->> 'exp_date', ''), v_line.exp_date::text)));

      -- The lot: a given number (an existing lot of this product, or a new one with that number);
      -- an unsplit entry without a number adds to the lot this shipment line already received into.
      v_lot := NULL;
      v_lot_new := false;
      IF v_f ->> 'lot_no' IS NOT NULL THEN
        v_lot := public._lot_resolve_named(v_line.product_id, v_f ->> 'lot_no');
      ELSIF jsonb_array_length(v_lots) = 1 THEN
        SELECT rl.lot_id INTO v_lot
        FROM public.import_receipt_lines rl
        JOIN public.import_receipts rc ON rc.id = rl.receipt_id
        WHERE rl.shipment_line_id = v_line.id AND rl.lot_id IS NOT NULL
        ORDER BY rc.created_at DESC, rl.id DESC
        LIMIT 1;
      END IF;
      IF v_lot IS NULL THEN
        v_lot := public._lot_create(v_line.product_id, v_f || jsonb_build_object(
          'origin_type', 'import', 'origin_doc_type', 'import_receipt', 'origin_doc_id', v_receipt,
          'origin_doc_no', v_number, 'supplier_id', v_s.supplier_id, 'import_shipment_id', p_id,
          'customs_declaration_no', v_s.customs_declaration_no, 'received_date', v_date, 'qty_received', 0));
        v_lot_new := true;
      END IF;
      UPDATE public.stock_lots SET qty_received = qty_received + v_lqty, updated_at = NOW() WHERE id = v_lot;

      INSERT INTO public.import_receipt_lines (receipt_id, shipment_line_id, warehouse_id, qty_stock_unit, expected_qty_stock_unit, unit_cost_azn, value_azn, lot_id)
      VALUES (v_receipt, v_line.id, v_wh, v_lqty,
              CASE WHEN v_k = 1 AND v_expected IS NOT NULL THEN v_lqty + (v_expected - v_qty) END,
              v_lunit, v_lvalue, v_lot)
      RETURNING id INTO v_rl;
      IF v_lot_new THEN
        UPDATE public.stock_lots SET origin_line_id = v_rl WHERE id = v_lot;
      END IF;

      PERFORM public.lot_ctx_begin(jsonb_build_object(
        'doc_type', 'import_receipt', 'doc_id', v_receipt, 'doc_line_id', v_rl, 'doc_no', v_number,
        'product_id', v_line.product_id, 'counterparty_type', 'supplier', 'counterparty_id', v_s.supplier_id,
        'lots', jsonb_build_array(jsonb_build_object('lot_id', v_lot, 'qty', v_lqty))));
      IF v_line.inventory_mode = 'polywood' THEN
        v_lsheets := v_lqty / NULLIF(v_line.full_sheet_length_m, 0);
        IF v_lsheets IS NULL OR abs(v_lsheets - round(v_lsheets)) > 0.001 THEN
          RAISE EXCEPTION USING ERRCODE = '22023',
            MESSAGE = format('imports_whole_sheets: %s yalnız tam vərəqlə qəbul edilir (%s m)', v_line.product_name, v_line.full_sheet_length_m);
        END IF;
        INSERT INTO public.polywood_pieces (product_id, warehouse_id, length_m, piece_type, status, notes, source_document_id, updated_at, lot_id)
        SELECT v_line.product_id, v_wh, v_line.full_sheet_length_m, 'full', 'available', 'İdxal — ' || v_number, v_receipt, NOW(), v_lot
        FROM generate_series(1, round(v_lsheets)::int);
        PERFORM public.stock_sync_use_warehouse(v_wh);
        UPDATE public.products SET stock = COALESCE(stock, 0) + v_lqty WHERE id = v_line.product_id;
      ELSE
        PERFORM public.stock_move(v_line.product_id, v_wh, v_lqty, false);
      END IF;
      PERFORM public.lot_ctx_end();

      INSERT INTO public.stock_movements (product_id, warehouse_id, movement_type, quantity, unit, reference_type, reference_id, source_line_id, description, created_by)
      VALUES (v_line.product_id, v_wh, 'in', v_lqty, CASE WHEN v_line.inventory_mode = 'polywood' THEN 'm' ELSE v_line.product_unit END,
              'import', v_receipt, v_rl, 'İdxal qəbulu — ' || v_number || ' (' || v_s.number || ')', auth.uid());

      v_batch := public.create_inventory_batch(v_line.product_id, v_receipt, 'import', v_lunit, v_lqty);
      UPDATE public.import_receipt_lines SET batch_id = v_batch WHERE id = v_rl;
      UPDATE public.inventory_batches SET lot_id = v_lot WHERE id = v_batch;
      UPDATE public.stock_lots SET inventory_batch_id = COALESCE(inventory_batch_id, v_batch) WHERE id = v_lot;
    END LOOP;
    v_total := v_total + v_value;
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM public.import_receipt_lines WHERE receipt_id = v_receipt) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'imports_receipt_empty: Qəbul ediləcək sətir yoxdur';
  END IF;

  IF v_total > 0 THEN
    v_journal := public.create_journal_entry(jsonb_build_object(
      'document_type', 'import_receipt',
      'document_id', p_id,
      'idempotency_key', 'import_receipt:' || v_receipt::text,
      'entry_date', v_date,
      'description', format('İdxal %s: anbara qəbul %s', v_s.number, v_number),
      'lines', jsonb_build_array(
        public._imports_line('1300', v_total, 'Anbara qəbul — ' || v_number),
        public._imports_line('1360', -v_total, 'Yolda olan mallar — ' || v_s.number)
      )
    ));
    UPDATE public.import_receipts SET journal_entry_id = v_journal WHERE id = v_receipt;
  END IF;

  v_status := CASE WHEN EXISTS (
      SELECT 1 FROM public.import_shipment_lines l
      WHERE l.shipment_id = p_id
        AND l.qty_stock_unit - COALESCE((SELECT SUM(rl.qty_stock_unit) FROM public.import_receipt_lines rl WHERE rl.shipment_line_id = l.id), 0) > 0.0005
    ) THEN 'partially_received' ELSE 'received' END;
  UPDATE public.import_shipments SET status = v_status WHERE id = p_id;
  PERFORM public.stock_sync_use_warehouse(NULL);
  PERFORM public.use_document_date(NULL);

  RETURN public._imports_op_put(p_idempotency_key, 'receive', p_id, jsonb_build_object(
    'success', true, 'shipment_id', p_id, 'receipt_id', v_receipt, 'receipt_number', v_number,
    'status', v_status, 'value_azn', v_total, 'journal_entry_id', v_journal));
END;
$$;

-- Cancel: stock leaves the receipt lots (reverse context).
CREATE OR REPLACE FUNCTION public.cancel_import_shipment(p_id UUID, p_reason TEXT, p_idempotency_key TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_done   JSONB := public._imports_op_get(p_idempotency_key);
  v_s      public.import_shipments;
  v_reason TEXT := NULLIF(btrim(p_reason), '');
  r        RECORD;
  v_count  INT := 0;
BEGIN
  IF v_done IS NOT NULL THEN RETURN v_done; END IF;
  PERFORM public._imports_require('approve');
  IF v_reason IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'imports_reason_required: Ləğv səbəbini yazın';
  END IF;
  SELECT * INTO v_s FROM public.import_shipments WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'imports_not_found: İdxal sənədi tapılmadı';
  END IF;
  IF v_s.status IN ('closed', 'cancelled') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'imports_cannot_cancel: Bağlı və ya ləğv edilmiş idxal ləğv edilə bilməz';
  END IF;

  -- Received stock must still be all there.
  IF EXISTS (
    SELECT 1 FROM public.import_receipt_lines rl
    JOIN public.import_receipts rc ON rc.id = rl.receipt_id
    JOIN public.inventory_batches b ON b.id = rl.batch_id
    WHERE rc.shipment_id = p_id AND b.remaining_qty < b.initial_qty - 0.0005
  ) OR EXISTS (
    SELECT 1 FROM public.polywood_pieces pp JOIN public.import_receipts rc ON rc.id = pp.source_document_id
    WHERE rc.shipment_id = p_id AND pp.status <> 'available'
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'imports_stock_consumed: Qəbul edilmiş malın bir hissəsi artıq satılıb və ya istifadə olunub; idxal ləğv edilə bilməz';
  END IF;

  -- Stock back out of each warehouse.
  FOR r IN
    SELECT rl.*, rc.number AS receipt_number, p.inventory_mode, p.unit AS product_unit, l.product_id
    FROM public.import_receipt_lines rl
    JOIN public.import_receipts rc ON rc.id = rl.receipt_id
    JOIN public.import_shipment_lines l ON l.id = rl.shipment_line_id
    JOIN public.products p ON p.id = l.product_id
    WHERE rc.shipment_id = p_id
  LOOP
    -- LOT-2: out of exactly the lots this receipt line put in.
    PERFORM public.lot_ctx_begin(jsonb_build_object(
      'doc_type', 'import_receipt', 'doc_id', r.receipt_id, 'doc_line_id', r.id, 'doc_no', r.receipt_number,
      'product_id', r.product_id, 'counterparty_type', 'supplier', 'counterparty_id', v_s.supplier_id, 'mode', 'reverse',
      'reverse_of', jsonb_build_object('doc_type', 'import_receipt', 'doc_id', r.receipt_id, 'doc_line_id', r.id)));
    IF r.inventory_mode = 'polywood' THEN
      DELETE FROM public.polywood_pieces WHERE source_document_id = r.receipt_id AND product_id = r.product_id AND warehouse_id = r.warehouse_id AND status = 'available'
        AND (r.lot_id IS NULL OR lot_id = r.lot_id);
      PERFORM public.stock_sync_use_warehouse(r.warehouse_id);
      UPDATE public.products SET stock = GREATEST(COALESCE(stock, 0) - r.qty_stock_unit, 0) WHERE id = r.product_id;
    ELSE
      PERFORM public.stock_move(r.product_id, r.warehouse_id, -r.qty_stock_unit, true);
    END IF;
    PERFORM public.lot_ctx_end();
    INSERT INTO public.stock_movements (product_id, warehouse_id, movement_type, quantity, unit, reference_type, reference_id, source_line_id, description, created_by)
    VALUES (r.product_id, r.warehouse_id, 'out', r.qty_stock_unit, CASE WHEN r.inventory_mode = 'polywood' THEN 'm' ELSE r.product_unit END,
            'import', r.receipt_id, r.id, 'İdxal ləğvi — ' || r.receipt_number || ' (' || v_s.number || ')', auth.uid());
    UPDATE public.import_receipt_lines SET batch_id = NULL WHERE id = r.id;
    DELETE FROM public.inventory_batches WHERE id = r.batch_id;
  END LOOP;
  PERFORM public.stock_sync_use_warehouse(NULL);

  -- Cash back (each transaction's entry is reversed with it), then every other entry.
  PERFORM public.reverse_document_cash_transactions('import_shipment', p_id, v_s.number, 'İdxal ləğvi: ' || v_reason);
  FOR r IN
    SELECT id FROM public.journal_entries
    WHERE document_id = p_id AND document_type LIKE 'import_%' AND reversal_of IS NULL AND reversed_by IS NULL
    ORDER BY posted_at
  LOOP
    PERFORM public.reverse_journal_entry(r.id, 'İdxal ləğvi: ' || v_reason);
    v_count := v_count + 1;
  END LOOP;

  UPDATE public.import_payables SET status = 'cancelled' WHERE shipment_id = p_id;
  UPDATE public.import_shipments SET status = 'cancelled', cancelled_at = NOW(), cancel_reason = v_reason WHERE id = p_id;
  PERFORM public.refresh_supplier_ap_balance(v_s.supplier_id);

  RETURN public._imports_op_put(p_idempotency_key, 'cancel', p_id, jsonb_build_object('success', true, 'shipment_id', p_id, 'status', 'cancelled', 'reversed_entries', v_count));
END;
$$;


-- ─── 4. Purchases (module purchases) ────────────────────────────────────────

-- Purchase draft save: the lot fields of each line.
DO $do$
BEGIN
  IF to_regclass('public.purchases') IS NOT NULL AND to_regclass('public.purchase_items') IS NOT NULL THEN
    EXECUTE $fn$
CREATE OR REPLACE FUNCTION public.save_purchase_invoice_draft(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_header JSONB;
  v_items JSONB;
  v_payments JSONB;
  v_add_exp JSONB;
  v_purchase_id UUID;
  v_invoice_number TEXT;
  v_supplier_id UUID;
  v_item JSONB;
  v_status TEXT;
BEGIN
  IF p_payload IS NULL THEN
    RAISE EXCEPTION 'invalid_payload'
      USING ERRCODE = '22023',
            MESSAGE = 'Alış draft payload göndərilməyib';
  END IF;

  IF NOT (
    public.require_permission('can_edit_purchases')
    OR public.require_permission('can_create_purchase')
    OR public.require_permission('can_manage_finance')
  ) THEN
    RAISE EXCEPTION 'forbidden'
      USING ERRCODE = '42501',
            MESSAGE = 'Alış yaratmaq üçün icazəniz yoxdur';
  END IF;

  v_header := COALESCE(p_payload->'header', '{}'::jsonb);
  v_items := COALESCE(p_payload->'items', '[]'::jsonb);
  v_payments := COALESCE(p_payload->'payments', '[]'::jsonb);
  v_add_exp := COALESCE(p_payload->'additional_expenses', '[]'::jsonb);
  v_purchase_id := NULLIF(p_payload->>'purchase_id', '')::uuid;
  IF v_purchase_id IS NULL THEN
    v_purchase_id := NULLIF(v_header->>'id', '')::uuid;
  END IF;

  IF jsonb_typeof(v_items) <> 'array' OR jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'items_required'
      USING ERRCODE = '22023',
            MESSAGE = 'Ən azı bir məhsul tələb olunur';
  END IF;

  v_supplier_id := NULLIF(v_header->>'supplier_id', '')::uuid;
  IF v_supplier_id IS NULL THEN
    RAISE EXCEPTION 'supplier_required'
      USING ERRCODE = '22023',
            MESSAGE = 'Təchizatçı seçilməlidir';
  END IF;

  PERFORM id FROM suppliers WHERE id = v_supplier_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'supplier_not_found'
      USING ERRCODE = 'P0002',
            MESSAGE = 'Təchizatçı tapılmadı';
  END IF;

  IF v_purchase_id IS NOT NULL THEN
    SELECT status, invoice_number INTO v_status, v_invoice_number
    FROM purchases
    WHERE id = v_purchase_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'purchase_not_found'
        USING ERRCODE = 'P0002',
              MESSAGE = 'Alış sənədi tapılmadı';
    END IF;

    IF v_status = 'posted' THEN
      RAISE EXCEPTION 'already_posted'
        USING ERRCODE = '22023',
              MESSAGE = 'Təsdiqlənmiş sənəd redaktə edilə bilməz';
    END IF;

    IF v_status IN ('cancelled', 'void', 'voided') THEN
      RAISE EXCEPTION 'cancelled_document'
        USING ERRCODE = '22023',
              MESSAGE = 'Ləğv edilmiş sənəd redaktə edilə bilməz';
    END IF;
  ELSE
    v_invoice_number := NULLIF(trim(v_header->>'invoice_number'), '');
    IF v_invoice_number IS NULL OR v_invoice_number ~ '\.{3,}$' THEN
      v_invoice_number := public.next_purchase_doc_no('AS');
    END IF;
  END IF;

  IF v_purchase_id IS NULL THEN
    INSERT INTO purchases (
      invoice_number, supplier_id, warehouse_id, doc_date, responsible_id, responsible_name,
      total_amount, paid_amount, debt_amount, status, notes, due_date,
      additional_expenses, additional_expenses_total, payments,
      is_official, contract_id, vat_mode, subtotal_amount, vat_rate, vat_amount, grand_total
    )
    VALUES (
      v_invoice_number,
      v_supplier_id,
      NULLIF(v_header->>'warehouse_id', '')::uuid,
      COALESCE(NULLIF(v_header->>'doc_date', '')::date, CURRENT_DATE),
      NULLIF(v_header->>'responsible_id', '')::uuid,
      NULLIF(trim(v_header->>'responsible_name'), ''),
      COALESCE(NULLIF(v_header->>'total_amount', '')::numeric, 0),
      COALESCE(NULLIF(v_header->>'paid_amount', '')::numeric, 0),
      GREATEST(COALESCE(NULLIF(v_header->>'debt_amount', '')::numeric, 0), 0),
      'draft',
      NULLIF(trim(v_header->>'notes'), ''),
      NULLIF(v_header->>'due_date', '')::date,
      v_add_exp,
      COALESCE(NULLIF(v_header->>'additional_expenses_total', '')::numeric, 0),
      v_payments,
      COALESCE((v_header->>'is_official')::boolean, false),
      NULLIF(v_header->>'contract_id', '')::uuid,
      COALESCE(NULLIF(trim(v_header->>'vat_mode'), ''), 'none'),
      NULLIF(v_header->>'subtotal_amount', '')::numeric,
      COALESCE(NULLIF(v_header->>'vat_rate', '')::numeric, 18),
      COALESCE(NULLIF(v_header->>'vat_amount', '')::numeric, 0),
      NULLIF(v_header->>'grand_total', '')::numeric
    )
    RETURNING id INTO v_purchase_id;
  ELSE
    UPDATE purchases SET
      supplier_id = v_supplier_id,
      warehouse_id = NULLIF(v_header->>'warehouse_id', '')::uuid,
      doc_date = COALESCE(NULLIF(v_header->>'doc_date', '')::date, doc_date),
      responsible_id = NULLIF(v_header->>'responsible_id', '')::uuid,
      responsible_name = NULLIF(trim(v_header->>'responsible_name'), ''),
      total_amount = COALESCE(NULLIF(v_header->>'total_amount', '')::numeric, 0),
      paid_amount = COALESCE(NULLIF(v_header->>'paid_amount', '')::numeric, 0),
      debt_amount = GREATEST(COALESCE(NULLIF(v_header->>'debt_amount', '')::numeric, 0), 0),
      status = 'draft',
      notes = NULLIF(trim(v_header->>'notes'), ''),
      due_date = NULLIF(v_header->>'due_date', '')::date,
      additional_expenses = v_add_exp,
      additional_expenses_total = COALESCE(NULLIF(v_header->>'additional_expenses_total', '')::numeric, 0),
      payments = v_payments,
      is_official = COALESCE((v_header->>'is_official')::boolean, is_official),
      contract_id = NULLIF(v_header->>'contract_id', '')::uuid,
      vat_mode = COALESCE(NULLIF(trim(v_header->>'vat_mode'), ''), vat_mode, 'none'),
      subtotal_amount = NULLIF(v_header->>'subtotal_amount', '')::numeric,
      vat_rate = COALESCE(NULLIF(v_header->>'vat_rate', '')::numeric, vat_rate, 18),
      vat_amount = COALESCE(NULLIF(v_header->>'vat_amount', '')::numeric, 0),
      grand_total = NULLIF(v_header->>'grand_total', '')::numeric
    WHERE id = v_purchase_id;

    DELETE FROM purchase_items WHERE purchase_id = v_purchase_id;
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_items)
  LOOP
    -- LOT-2: optional lot fields per line (lot_no, supplier_batch_no, mfg_date, exp_date).
    INSERT INTO purchase_items (
      purchase_id, product_id, product_code, product_name, quantity, unit, unit_price, total_price,
      lot_no, supplier_batch_no, mfg_date, exp_date
    )
    VALUES (
      v_purchase_id,
      NULLIF(v_item->>'product_id', '')::uuid,
      NULLIF(trim(v_item->>'product_code'), ''),
      NULLIF(trim(v_item->>'product_name'), ''),
      COALESCE(NULLIF(v_item->>'quantity', '')::numeric, 0),
      COALESCE(NULLIF(trim(v_item->>'unit'), ''), 'Ədəd'),
      COALESCE(NULLIF(v_item->>'unit_price', '')::numeric, 0),
      COALESCE(
        NULLIF(v_item->>'total_price', '')::numeric,
        NULLIF(v_item->>'total', '')::numeric,
        0
      ),
      NULLIF(btrim(v_item->>'lot_no'), ''), NULLIF(btrim(v_item->>'supplier_batch_no'), ''),
      public._lot_date(v_item->>'mfg_date'), public._lot_date(v_item->>'exp_date')
    );
  END LOOP;

  SELECT invoice_number INTO v_invoice_number FROM purchases WHERE id = v_purchase_id;

  RETURN jsonb_build_object(
    'success', true,
    'event_type', 'purchase_invoice_draft',
    'purchase_id', v_purchase_id,
    'invoice_number', v_invoice_number,
    'status', 'draft'
  );
END;
$function$
    $fn$;
  END IF;
END
$do$;

-- Purchase posting: each product on its lot.
DO $do$
BEGIN
  IF to_regclass('public.purchases') IS NOT NULL AND to_regclass('public.purchase_items') IS NOT NULL THEN
    EXECUTE $fn$
CREATE OR REPLACE FUNCTION public.post_purchase_invoice_draft(p_purchase_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_lot_ctx JSONB;
  v_batch_id UUID;
  v_purchase RECORD;
  v_item RECORD;
  v_pay JSONB;
  v_product_id UUID;
  v_qty NUMERIC;
  v_unit_price NUMERIC;
  v_stock NUMERIC;
  v_account_id UUID;
  v_pay_amount NUMERIC;
  v_account_name TEXT;
  v_pay_note TEXT;
  v_stock_demand JSONB := '{}'::jsonb;
  v_price_map JSONB := '{}'::jsonb;
  v_key TEXT;
  v_journal_id UUID;
  v_add_exp_total NUMERIC;
  v_idempotency TEXT;
  v_result JSONB;
  v_event_id UUID;
  v_pay_date DATE;
BEGIN
  IF p_purchase_id IS NULL THEN
    RAISE EXCEPTION 'invalid_payload'
      USING ERRCODE = '22023',
            MESSAGE = 'Alış ID göndərilməyib';
  END IF;

  IF NOT (
    public.require_permission('can_edit_purchases')
    OR public.require_permission('can_create_purchase')
    OR public.require_permission('can_manage_finance')
  ) THEN
    RAISE EXCEPTION 'forbidden'
      USING ERRCODE = '42501',
            MESSAGE = 'Alış təsdiqləmək üçün icazəniz yoxdur';
  END IF;

  SELECT * INTO v_purchase FROM purchases WHERE id = p_purchase_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'purchase_not_found'
      USING ERRCODE = 'P0002',
            MESSAGE = 'Alış sənədi tapılmadı';
  END IF;

  -- Every record of this posting carries the invoice date (fix F1).
  PERFORM public.use_document_date(v_purchase.doc_date);

  IF v_purchase.status = 'posted' THEN
    RAISE EXCEPTION 'already_posted'
      USING ERRCODE = '22023',
            MESSAGE = 'Sənəd artıq təsdiqlənib';
  END IF;

  IF v_purchase.status IN ('cancelled', 'void', 'voided') THEN
    RAISE EXCEPTION 'cancelled_document'
      USING ERRCODE = '22023',
            MESSAGE = 'Ləğv edilmiş sənəd təsdiqlənə bilməz';
  END IF;

  IF COALESCE(v_purchase.total_amount, 0) <= 0 THEN
    RAISE EXCEPTION 'invalid_total_amount'
      USING ERRCODE = '22023',
            MESSAGE = 'Alış məbləği sıfırdan böyük olmalıdır';
  END IF;

  IF COALESCE(v_purchase.paid_amount, 0) > COALESCE(v_purchase.total_amount, 0) + 0.0001 THEN
    RAISE EXCEPTION 'overpaid'
      USING ERRCODE = '22023',
            MESSAGE = 'Ödənilən məbləğ ümumi məbləğdən böyük ola bilməz';
  END IF;

  FOR v_item IN
    SELECT product_id, quantity, unit_price
    FROM purchase_items
    WHERE purchase_id = p_purchase_id
  LOOP
    v_product_id := v_item.product_id;
    v_qty := COALESCE(v_item.quantity, 0);
    v_unit_price := COALESCE(v_item.unit_price, 0);

    IF v_product_id IS NULL OR v_qty <= 0 OR v_unit_price <= 0 THEN
      RAISE EXCEPTION 'invalid_item'
        USING ERRCODE = '22023',
              MESSAGE = 'Hər sətirdə məhsul, miqdar və qiymət tələb olunur';
    END IF;

    v_key := v_product_id::text;
    v_stock_demand := jsonb_set(
      v_stock_demand,
      ARRAY[v_key],
      to_jsonb(COALESCE((v_stock_demand->>v_key)::numeric, 0) + v_qty),
      true
    );
    v_price_map := jsonb_set(v_price_map, ARRAY[v_key], to_jsonb(v_unit_price), true);
  END LOOP;

  IF NOT EXISTS (SELECT 1 FROM jsonb_object_keys(v_stock_demand)) THEN
    RAISE EXCEPTION 'items_required'
      USING ERRCODE = '22023',
            MESSAGE = 'Ən azı bir məhsul tələb olunur';
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(v_stock_demand)
  LOOP
    PERFORM id FROM products WHERE id = v_key::uuid;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'product_not_found'
        USING ERRCODE = 'P0002',
              MESSAGE = 'Məhsul tapılmadı: ' || v_key;
    END IF;
  END LOOP;

  IF jsonb_typeof(v_purchase.payments) = 'array' THEN
    FOR v_pay IN SELECT value FROM jsonb_array_elements(v_purchase.payments)
    LOOP
      v_pay_amount := COALESCE(NULLIF(v_pay->>'amount', '')::numeric, 0);
      IF v_pay_amount <= 0 THEN
        CONTINUE;
      END IF;

      v_account_id := NULLIF(v_pay->>'account_id', '')::uuid;
      IF v_account_id IS NULL THEN
        RAISE EXCEPTION 'account_required'
          USING ERRCODE = '22023',
                MESSAGE = 'Ödəniş üçün kassa/bank hesabı seçilməlidir';
      END IF;

      PERFORM id FROM accounts WHERE id = v_account_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'account_not_found'
          USING ERRCODE = 'P0002',
                MESSAGE = 'Seçilmiş kassa/bank hesabı tapılmadı';
      END IF;
    END LOOP;
  END IF;

  FOR v_key IN SELECT jsonb_object_keys(v_stock_demand)
  LOOP
    v_product_id := v_key::uuid;
    v_qty := COALESCE((v_stock_demand->>v_key)::numeric, 0);
    v_unit_price := COALESCE((v_price_map->>v_key)::numeric, 0);

    SELECT stock INTO v_stock
    FROM products
    WHERE id = v_product_id
    FOR UPDATE;

    -- LOT-2: the product's lot (one per product: posting merges its lines).
    v_lot_ctx := public._lot_purchase_ctx(p_purchase_id, v_product_id, v_qty);
    PERFORM public.lot_ctx_begin(v_lot_ctx);
    -- Into the purchase warehouse (fix F3); the buy price as before.
    PERFORM public._stock_move_doc(v_product_id, v_purchase.warehouse_id, v_qty, false);
    PERFORM public.lot_ctx_end();
    UPDATE products SET buy_price = v_unit_price WHERE id = v_product_id;

    v_batch_id := public.create_inventory_batch(
      v_product_id,
      p_purchase_id,
      'purchase',
      v_unit_price,
      v_qty
    );
    PERFORM public._lot_link_batch('purchase', p_purchase_id, v_product_id, v_batch_id);
  END LOOP;

  IF jsonb_typeof(v_purchase.payments) = 'array' THEN
    FOR v_pay IN SELECT value FROM jsonb_array_elements(v_purchase.payments)
    LOOP
      v_pay_amount := COALESCE(NULLIF(v_pay->>'amount', '')::numeric, 0);
      IF v_pay_amount <= 0 THEN
        CONTINUE;
      END IF;

      -- An admin amendment keeps the payments already booked (fix F1).
      IF public.invoice_amend_in_progress() THEN
        CONTINUE;
      END IF;

      v_account_id := NULLIF(v_pay->>'account_id', '')::uuid;
      v_pay_date := public.invoice_payment_date(v_pay, v_purchase.doc_date);
      PERFORM public.use_document_date(v_pay_date);

      SELECT name INTO v_account_name
      FROM accounts
      WHERE id = v_account_id;

      v_pay_note := COALESCE(
        NULLIF(trim(v_pay->>'note'), ''),
        format('Alış fakturası %s', v_purchase.invoice_number)
      );
      IF NULLIF(trim(v_pay->>'payment_date'), '') IS NOT NULL THEN
        v_pay_note := trim(v_pay->>'payment_date') || ' — ' || v_pay_note;
      END IF;
      IF v_account_name IS NOT NULL THEN
        v_pay_note := v_pay_note || ' — ' || v_account_name;
      END IF;

      PERFORM public.post_cash_transaction(
        v_account_id,
        'Məxaric',
        v_pay_amount,
        'Alış Ödənişi',
        v_pay_note,
        NULL,
        'purchase',
        p_purchase_id
      );
      PERFORM public.use_document_date(v_purchase.doc_date);
    END LOOP;
  END IF;

  v_add_exp_total := public.apply_document_additional_expenses(
    COALESCE(v_purchase.additional_expenses, '[]'::jsonb),
    'purchase',
    p_purchase_id,
    v_purchase.invoice_number
  );

  v_idempotency := 'purchase_receipt:' || p_purchase_id::text || public.invoice_revision_suffix(v_purchase.amend_revision);

  v_journal_id := public.post_purchase_bill_gl_journal(
    p_purchase_id,
    v_purchase.invoice_number,
    v_purchase.total_amount,
    v_purchase.supplier_id,
    v_idempotency
  );

  PERFORM public.refresh_supplier_ap_balance(v_purchase.supplier_id);

  UPDATE purchases
  SET status = 'posted',
      posted_at = NOW(),
      additional_expenses_total = v_add_exp_total
  WHERE id = p_purchase_id;

  PERFORM public.use_document_date(NULL);

  v_result := jsonb_build_object(
    'success', true,
    'event_type', 'purchase_invoice_post',
    'purchase_id', p_purchase_id,
    'invoice_number', v_purchase.invoice_number,
    'status', 'posted',
    'journal_entry_id', v_journal_id,
    'total_amount', v_purchase.total_amount,
    'paid_amount', v_purchase.paid_amount,
    'debt_amount', v_purchase.debt_amount
  );

  v_event_id := public.log_erp_event(
    'purchase_receipt',
    'purchases',
    p_purchase_id,
    jsonb_build_object('purchase_id', p_purchase_id, 'posted_from', 'draft'),
    v_journal_id,
    v_idempotency,
    v_result
  );

  RETURN v_result || jsonb_build_object('event_id', v_event_id);
END;
$function$
    $fn$;
  END IF;
END
$do$;

-- Purchase receipt event: each product on its lot.
DO $do$
BEGIN
  IF to_regclass('public.purchases') IS NOT NULL AND to_regclass('public.purchase_items') IS NOT NULL THEN
    EXECUTE $fn$
CREATE OR REPLACE FUNCTION public.process_purchase_receipt_event(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_lot_ctx JSONB;
  v_batch_id UUID;
  v_doc_date DATE;
  v_pay_date DATE;
  v_idempotency TEXT;
  v_cached JSONB;
  v_header JSONB;
  v_items JSONB;
  v_payments JSONB;
  v_supplier_id UUID;
  v_purchase_id UUID;
  v_invoice_number TEXT;
  v_total_amount NUMERIC;
  v_paid_amount NUMERIC;
  v_debt_amount NUMERIC;
  v_item JSONB;
  v_pay JSONB;
  v_product_id UUID;
  v_qty NUMERIC;
  v_unit_price NUMERIC;
  v_stock NUMERIC;
  v_account_id UUID;
  v_pay_amount NUMERIC;
  v_account_name TEXT;
  v_pay_note TEXT;
  v_stock_demand JSONB := '{}'::jsonb;
  v_price_map JSONB := '{}'::jsonb;
  v_key TEXT;
  v_journal_id UUID;
  v_event_id UUID;
  v_result JSONB;
  v_add_exp_total NUMERIC;
BEGIN
  IF p_payload IS NULL THEN
    RAISE EXCEPTION 'invalid_payload'
      USING ERRCODE = '22023',
            MESSAGE = 'Alış event payload göndərilməyib';
  END IF;

  v_idempotency := NULLIF(trim(p_payload->>'idempotency_key'), '');
  IF v_idempotency IS NOT NULL THEN
    v_cached := public.find_erp_event_by_idempotency(v_idempotency);
    IF v_cached IS NOT NULL THEN
      RETURN v_cached->'result';
    END IF;
  END IF;

  IF NOT (
    public.require_permission('can_edit_purchases')
    OR public.require_permission('can_create_purchase')
    OR public.require_permission('can_manage_finance')
  ) THEN
    RAISE EXCEPTION 'forbidden'
      USING ERRCODE = '42501',
            MESSAGE = 'Alış yaratmaq üçün icazəniz yoxdur';
  END IF;

  v_header := COALESCE(p_payload->'header', '{}'::jsonb);
  v_items := COALESCE(p_payload->'items', '[]'::jsonb);
  v_payments := COALESCE(p_payload->'payments', '[]'::jsonb);

  IF jsonb_typeof(v_items) <> 'array' OR jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'items_required'
      USING ERRCODE = '22023',
            MESSAGE = 'Æn azı bir məhsul tələb olunur';
  END IF;

  v_supplier_id := NULLIF(v_header->>'supplier_id', '')::uuid;
  IF v_supplier_id IS NULL THEN
    RAISE EXCEPTION 'supplier_required'
      USING ERRCODE = '22023',
            MESSAGE = 'Təchizatçı seçilməlidir';
  END IF;

  PERFORM id FROM suppliers WHERE id = v_supplier_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'supplier_not_found'
      USING ERRCODE = 'P0002',
            MESSAGE = 'Təchizatçı tapılmadı';
  END IF;

  v_total_amount := COALESCE(NULLIF(v_header->>'total_amount', '')::numeric, 0);
  v_paid_amount := COALESCE(NULLIF(v_header->>'paid_amount', '')::numeric, 0);
  v_debt_amount := COALESCE(
    NULLIF(v_header->>'debt_amount', '')::numeric,
    GREATEST(v_total_amount - v_paid_amount, 0)
  );

  IF v_total_amount <= 0 THEN
    RAISE EXCEPTION 'invalid_total_amount'
      USING ERRCODE = '22023',
            MESSAGE = 'Alış məbləği sıfırdan böyük olmalıdır';
  END IF;

  IF v_paid_amount > v_total_amount + 0.0001 THEN
    RAISE EXCEPTION 'overpaid'
      USING ERRCODE = '22023',
            MESSAGE = 'Ödənilən məbləğ ümumi məbləğdən böyük ola bilməz';
  END IF;

  IF abs((v_paid_amount + v_debt_amount) - v_total_amount) > 0.01 THEN
    RAISE EXCEPTION 'amount_mismatch'
      USING ERRCODE = '22023',
            MESSAGE = 'Ödənilən və borc məbləğlərinin cəmi ümumi məbləğə bərabər olmalıdır';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_items)
  LOOP
    v_product_id := NULLIF(v_item->>'product_id', '')::uuid;
    v_qty := COALESCE(NULLIF(v_item->>'quantity', '')::numeric, 0);
    v_unit_price := COALESCE(NULLIF(v_item->>'unit_price', '')::numeric, 0);

    IF v_product_id IS NULL OR v_qty <= 0 OR v_unit_price <= 0 THEN
      RAISE EXCEPTION 'invalid_item'
        USING ERRCODE = '22023',
              MESSAGE = 'Hər sətirdə məhsul, miqdar və qiymət tələb olunur';
    END IF;

    v_key := v_product_id::text;
    v_stock_demand := jsonb_set(
      v_stock_demand,
      ARRAY[v_key],
      to_jsonb(COALESCE((v_stock_demand->>v_key)::numeric, 0) + v_qty),
      true
    );
    v_price_map := jsonb_set(v_price_map, ARRAY[v_key], to_jsonb(v_unit_price), true);
  END LOOP;

  FOR v_key IN SELECT jsonb_object_keys(v_stock_demand)
  LOOP
    PERFORM id FROM products WHERE id = v_key::uuid;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'product_not_found'
        USING ERRCODE = 'P0002',
              MESSAGE = 'Məhsul tapılmadı: ' || v_key;
    END IF;
  END LOOP;

  IF jsonb_typeof(v_payments) = 'array' THEN
    FOR v_pay IN SELECT value FROM jsonb_array_elements(v_payments)
    LOOP
      v_pay_amount := COALESCE(NULLIF(v_pay->>'amount', '')::numeric, 0);
      IF v_pay_amount <= 0 THEN
        CONTINUE;
      END IF;

      v_account_id := NULLIF(v_pay->>'account_id', '')::uuid;
      IF v_account_id IS NULL THEN
        RAISE EXCEPTION 'account_required'
          USING ERRCODE = '22023',
                MESSAGE = 'Ödəniş üçün kassa/bank hesabı seçilməlidir';
      END IF;

      PERFORM id FROM accounts WHERE id = v_account_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'account_not_found'
          USING ERRCODE = 'P0002',
                MESSAGE = 'Seçilmiş kassa/bank hesabı tapılmadı';
      END IF;
    END LOOP;
  END IF;

  v_invoice_number := COALESCE(
    NULLIF(trim(v_header->>'invoice_number'), ''),
    NULLIF(trim(p_payload->>'invoice_number'), ''),
    'PUR-' || to_char(CURRENT_DATE, 'YYYY') || '-' || floor(10000 + random() * 90000)::int
  );

  INSERT INTO purchases (
    invoice_number, supplier_id, warehouse_id, doc_date, responsible_id, responsible_name,
    total_amount, paid_amount, debt_amount, status, notes
  )
  VALUES (
    v_invoice_number,
    v_supplier_id,
    NULLIF(v_header->>'warehouse_id', '')::uuid,
    COALESCE(NULLIF(v_header->>'doc_date', '')::date, CURRENT_DATE),
    NULLIF(v_header->>'responsible_id', '')::uuid,
    NULLIF(trim(v_header->>'responsible_name'), ''),
    v_total_amount,
    v_paid_amount,
    v_debt_amount,
    'posted',
    NULLIF(trim(v_header->>'notes'), '')
  )
  RETURNING id INTO v_purchase_id;

  -- Every record of this posting carries the invoice date (fix F1).
  v_doc_date := COALESCE(NULLIF(v_header->>'doc_date', '')::date, CURRENT_DATE);
  PERFORM public.use_document_date(v_doc_date);

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_items)
  LOOP
    INSERT INTO purchase_items (
      purchase_id, product_id, product_code, product_name, quantity, unit, unit_price, total_price,
      lot_no, supplier_batch_no, mfg_date, exp_date
    )
    VALUES (
      v_purchase_id,
      NULLIF(v_item->>'product_id', '')::uuid,
      NULLIF(trim(v_item->>'product_code'), ''),
      NULLIF(trim(v_item->>'product_name'), ''),
      COALESCE(NULLIF(v_item->>'quantity', '')::numeric, 0),
      COALESCE(NULLIF(trim(v_item->>'unit'), ''), 'Ædəd'),
      COALESCE(NULLIF(v_item->>'unit_price', '')::numeric, 0),
      COALESCE(
        NULLIF(v_item->>'total_price', '')::numeric,
        NULLIF(v_item->>'total', '')::numeric,
        0
      ),
      NULLIF(btrim(v_item->>'lot_no'), ''), NULLIF(btrim(v_item->>'supplier_batch_no'), ''),
      public._lot_date(v_item->>'mfg_date'), public._lot_date(v_item->>'exp_date')
    );
  END LOOP;

  FOR v_key IN SELECT jsonb_object_keys(v_stock_demand)
  LOOP
    v_product_id := v_key::uuid;
    v_qty := COALESCE((v_stock_demand->>v_key)::numeric, 0);
    v_unit_price := COALESCE((v_price_map->>v_key)::numeric, 0);

    SELECT stock INTO v_stock
    FROM products
    WHERE id = v_product_id
    FOR UPDATE;

    -- LOT-2: the product's lot (one per product: posting merges its lines).
    v_lot_ctx := public._lot_purchase_ctx(v_purchase_id, v_product_id, v_qty);
    PERFORM public.lot_ctx_begin(v_lot_ctx);
    -- Into the purchase warehouse (fix F3); the buy price as before.
    PERFORM public._stock_move_doc(v_product_id, NULLIF(v_header->>'warehouse_id', '')::uuid, v_qty, false);
    PERFORM public.lot_ctx_end();
    UPDATE products SET buy_price = v_unit_price WHERE id = v_product_id;

    v_batch_id := public.create_inventory_batch(
      v_product_id,
      v_purchase_id,
      'purchase',
      v_unit_price,
      v_qty
    );
    PERFORM public._lot_link_batch('purchase', v_purchase_id, v_product_id, v_batch_id);
  END LOOP;

  IF jsonb_typeof(v_payments) = 'array' THEN
    FOR v_pay IN SELECT value FROM jsonb_array_elements(v_payments)
    LOOP
      v_pay_amount := COALESCE(NULLIF(v_pay->>'amount', '')::numeric, 0);
      IF v_pay_amount <= 0 THEN
        CONTINUE;
      END IF;

      v_account_id := NULLIF(v_pay->>'account_id', '')::uuid;
      v_pay_date := public.invoice_payment_date(v_pay, v_doc_date);
      PERFORM public.use_document_date(v_pay_date);

      SELECT name INTO v_account_name
      FROM accounts
      WHERE id = v_account_id;

      v_pay_note := COALESCE(
        NULLIF(trim(v_pay->>'note'), ''),
        format('Alış fakturası %s', v_invoice_number)
      );
      IF NULLIF(trim(v_pay->>'payment_date'), '') IS NOT NULL THEN
        v_pay_note := trim(v_pay->>'payment_date') || ' — ' || v_pay_note;
      END IF;
      IF v_account_name IS NOT NULL THEN
        v_pay_note := v_pay_note || ' — ' || v_account_name;
      END IF;

      PERFORM public.post_cash_transaction(
        v_account_id,
        'Məxaric',
        v_pay_amount,
        'Alış Ödənişi',
        v_pay_note,
        NULL,
        'purchase',
        v_purchase_id
      );
      PERFORM public.use_document_date(v_doc_date);
    END LOOP;
  END IF;

  v_add_exp_total := public.apply_document_additional_expenses(
    COALESCE(p_payload->'additional_expenses', '[]'::jsonb),
    'purchase',
    v_purchase_id,
    v_invoice_number
  );

  UPDATE purchases
  SET additional_expenses = COALESCE(p_payload->'additional_expenses', '[]'::jsonb),
      additional_expenses_total = v_add_exp_total
  WHERE id = v_purchase_id;

  v_journal_id := public.post_purchase_bill_gl_journal(
    v_purchase_id,
    v_invoice_number,
    v_total_amount,
    v_supplier_id,
    v_idempotency
  );

  PERFORM public.refresh_supplier_ap_balance(v_supplier_id);

  PERFORM public.use_document_date(NULL);

  v_result := jsonb_build_object(
    'success', true,
    'event_type', 'purchase_receipt',
    'purchase_id', v_purchase_id,
    'invoice_number', v_invoice_number,
    'journal_entry_id', v_journal_id,
    'total_amount', v_total_amount,
    'paid_amount', v_paid_amount,
    'debt_amount', v_debt_amount
  );

  v_event_id := public.log_erp_event(
    'purchase_receipt',
    'purchases',
    v_purchase_id,
    p_payload,
    v_journal_id,
    v_idempotency,
    v_result
  );

  RETURN v_result || jsonb_build_object('event_id', v_event_id);
END;
$function$
    $fn$;
  END IF;
END
$do$;

-- Purchase reversal (void / amend): out of the purchase's lots.
DO $do$
BEGIN
  IF to_regclass('public.purchases') IS NOT NULL AND to_regclass('public.purchase_items') IS NOT NULL THEN
    EXECUTE $fn$
CREATE OR REPLACE FUNCTION public._reverse_purchase_invoice_posting(
  p_purchase_id uuid, p_label text, p_reason text, p_keep_cash boolean DEFAULT false
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_label    TEXT := p_label;
  v_reason   TEXT := p_reason;
  v_line     RECORD;
  v_stock    NUMERIC;
  v_cash     INTEGER := 0;
  v_journals INTEGER := 0;
BEGIN
  -- Goods from this purchase that were already sold or used cannot be unbought.
  IF EXISTS (
    SELECT 1 FROM public.inventory_batches
    WHERE document_id = p_purchase_id
      AND remaining_qty + 0.0001 < initial_qty
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = format('%s: bu alışın malının bir hissəsi artıq satılıb və ya istifadə olunub — ləğv etmək olmaz. Qaytarma sənədi ilə düzəldin.', v_label);
  END IF;

  -- 1. Stock out, per product.
  FOR v_line IN
    SELECT pi.product_id, SUM(pi.quantity) AS qty, MAX(p.name) AS product_name
    FROM public.purchase_items pi
    JOIN public.products p ON p.id = pi.product_id
    WHERE pi.purchase_id = p_purchase_id AND COALESCE(pi.quantity, 0) > 0
    GROUP BY pi.product_id
  LOOP
    SELECT stock INTO v_stock FROM public.products WHERE id = v_line.product_id FOR UPDATE;
    IF COALESCE(v_stock, 0) + 0.0001 < v_line.qty THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = format('%s: %s üçün stok kifayət etmir (lazım: %s, mövcud: %s)',
                         v_label, v_line.product_name,
                         trim(to_char(v_line.qty, 'FM999999990.00')),
                         trim(to_char(COALESCE(v_stock, 0), 'FM999999990.00')));
    END IF;
    -- Back out of the purchase warehouse; refused when that warehouse no longer has it (fix F3).
    -- LOT-2: out of the lots the purchase put in.
    PERFORM public.lot_ctx_begin(jsonb_build_object(
      'doc_type', 'purchase', 'doc_id', p_purchase_id, 'product_id', v_line.product_id, 'mode', 'reverse',
      'counterparty_type', 'supplier', 'counterparty_id', (SELECT supplier_id FROM public.purchases WHERE id = p_purchase_id),
      'reverse_of', jsonb_build_object('doc_type', 'purchase', 'doc_id', p_purchase_id)));
    PERFORM public._stock_move_doc(v_line.product_id,
      (SELECT warehouse_id FROM public.purchases WHERE id = p_purchase_id), -v_line.qty, true);
    PERFORM public.lot_ctx_end();
  END LOOP;

  -- 2. Its FIFO layers (all unconsumed, checked above).
  DELETE FROM public.inventory_batches WHERE document_id = p_purchase_id;

  -- 3. Cash paid to the supplier (and paid additional expenses) comes back.
  IF NOT p_keep_cash THEN
    v_cash := public.reverse_document_cash_transactions('purchase', p_purchase_id, v_label, v_reason);
  END IF;

  DELETE FROM public.warehouse_slips
  WHERE source_type = 'purchase' AND source_document_id = p_purchase_id;

  -- 4. Bill journal.
  v_journals := public.reverse_document_journals(p_purchase_id, v_reason);

  RETURN jsonb_build_object('cash_reversed', v_cash, 'journals_reversed', v_journals);
END;
$function$
    $fn$;
  END IF;
END
$do$;


-- ─── 5. Initial balance, counts, production (module tables guarded) ─────────

-- Initial balance unpost: out of the document's lots.
DO $do$
BEGIN
  IF to_regclass('public.inventory_initial_balances') IS NOT NULL AND to_regclass('public.inventory_initial_balance_items') IS NOT NULL THEN
    EXECUTE $fn$
CREATE OR REPLACE FUNCTION public.unpost_inventory_initial_balance(p_document_id uuid, p_reason text DEFAULT NULL::text, p_actor uuid DEFAULT NULL::uuid)
     RETURNS jsonb
     LANGUAGE plpgsql
     SECURITY DEFINER
     SET search_path TO 'public'
    AS $body$
    DECLARE
      -- Server actions call through the service role (no auth.uid()) and pass the
      -- already-authorised user in p_actor; a signed-in caller is always itself.
      v_actor      UUID := COALESCE(auth.uid(), p_actor);
      v_doc        RECORD;
      v_ref        TEXT;
      v_label      TEXT;
      r            RECORD;
      v_is_metric  BOOLEAN;
      v_value      NUMERIC;
      v_old_stock  NUMERIC;
      v_old_buy    NUMERIC;
      v_new_stock  NUMERIC;
      v_new_buy    NUMERIC;
      v_row_id     UUID;
      v_moves      INTEGER := 0;
      v_journals   INTEGER := 0;
    BEGIN
      IF auth.uid() IS NOT NULL
         AND NOT (public.user_is_admin() OR public.has_permission('can_unpost_inventory')) THEN
        RAISE EXCEPTION '%', 'forbidden' USING ERRCODE = '42501';
      END IF;

      IF p_document_id IS NULL THEN
        RAISE EXCEPTION '%', 'Sənəd ID-si göstərilməyib' USING ERRCODE = '22023';
      END IF;

      SELECT * INTO v_doc
      FROM public.inventory_initial_balances
      WHERE id = p_document_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION '%', 'Sənəd tapılmadı' USING ERRCODE = 'P0002';
      END IF;

      IF v_doc.status <> 'posted' THEN
        RAISE EXCEPTION '%', 'Yalnız təsdiqlənmiş sənəd qaralamaya qaytarıla bilər' USING ERRCODE = '22023';
      END IF;

      IF public.is_accounting_period_closed(v_doc.doc_date) THEN
        RAISE EXCEPTION '%', format(
          'Sənəd tarixi bağlı maliyyə dövrünə düşür (%s). Əvvəlcə dövrü açın.',
          to_char(v_doc.doc_date, 'YYYY-MM')
        ) USING ERRCODE = '22023';
      END IF;

      v_ref := CASE WHEN v_doc.entry_type = 'receipt' THEN 'stock_receipt' ELSE 'initial_balance' END;
      v_label := v_doc.document_number;

      -- ─── Guards: nothing from this document may have left the warehouse ──────

      IF EXISTS (
        SELECT 1 FROM public.inventory_batches
        WHERE document_id = p_document_id
          AND document_type = v_ref
          AND remaining_qty < initial_qty
      ) THEN
        RAISE EXCEPTION '%',
          'Bu sənədlə daxil olan stokun bir hissəsi artıq satılıb və ya istifadə olunub. Qaralamaya qaytarmaq mümkün deyil — silinmə və ya düzəliş sənədi ilə düzəldin.'
          USING ERRCODE = '22023';
      END IF;

      IF EXISTS (
        SELECT 1 FROM public.polywood_pieces
        WHERE source_document_id = p_document_id
          AND status <> 'available'
      ) THEN
        RAISE EXCEPTION '%',
          'Bu sənədlə daxil olan hissələrin bəziləri artıq satılıb və ya kəsilib. Qaralamaya qaytarmaq mümkün deyil.'
          USING ERRCODE = '22023';
      END IF;

      -- Metric lines posted before pieces were linked to their document cannot be
      -- told apart from other pieces of the same product, so refuse rather than guess.
      IF EXISTS (
        SELECT 1 FROM public.inventory_initial_balance_items i
        WHERE i.document_id = p_document_id
          AND i.is_metric
          AND NOT EXISTS (
            SELECT 1 FROM public.polywood_pieces pp
            WHERE pp.source_document_id = p_document_id
              AND pp.product_id = i.product_id
          )
      ) THEN
        RAISE EXCEPTION '%',
          'Bu sənəddəki metrik hissələr köhnə qaydada təsdiqlənib və sənədə bağlı deyil. Avtomatik geri qaytarmaq mümkün deyil — administratorla əlaqə saxlayın.'
          USING ERRCODE = '22023';
      END IF;

      -- ─── Reverse stock, per product and warehouse ────────────────────────────
      -- Net the document's own movements so earlier post/unpost cycles cancel out.

      FOR r IN
        SELECT
          m.product_id,
          m.warehouse_id,
          MIN(m.unit) AS unit,
          SUM(CASE WHEN m.movement_type = 'in' THEN m.quantity ELSE -m.quantity END) AS net_qty
        FROM public.stock_movements m
        WHERE m.reference_id = p_document_id
          AND m.reference_type = v_ref
        GROUP BY m.product_id, m.warehouse_id
        HAVING SUM(CASE WHEN m.movement_type = 'in' THEN m.quantity ELSE -m.quantity END) > 0.0005
      LOOP
        SELECT EXISTS (
          SELECT 1 FROM public.inventory_initial_balance_items i
          WHERE i.document_id = p_document_id AND i.product_id = r.product_id AND i.is_metric
        ) INTO v_is_metric;

        SELECT COALESCE(SUM(
          (CASE WHEN i.is_metric THEN COALESCE(i.metric_total_meters, i.quantity) ELSE i.quantity END) * i.unit_cost
        ), 0)
        INTO v_value
        FROM public.inventory_initial_balance_items i
        WHERE i.document_id = p_document_id AND i.product_id = r.product_id;

        SELECT COALESCE(stock, 0), COALESCE(buy_price, 0)
        INTO v_old_stock, v_old_buy
        FROM public.products
        WHERE id = r.product_id
        FOR UPDATE;

        IF v_is_metric THEN
          DELETE FROM public.polywood_pieces
          WHERE source_document_id = p_document_id
            AND product_id = r.product_id;

          -- Polywood stock = available metres in every warehouse.
          SELECT ROUND(COALESCE(SUM(length_m), 0), 3)
          INTO v_new_stock
          FROM public.polywood_pieces
          WHERE product_id = r.product_id
            AND status = 'available';
        ELSE
          IF v_old_stock + 0.0005 < r.net_qty THEN
            RAISE EXCEPTION '%', format(
              'Məhsulun cari qalığı (%s) bu sənədin daxil etdiyi miqdardan (%s) azdır — stok artıq çıxarılıb. Qaralamaya qaytarmaq mümkün deyil.',
              v_old_stock, r.net_qty
            ) USING ERRCODE = '22023';
          END IF;
          v_new_stock := v_old_stock - r.net_qty;
        END IF;

        -- Undo the weighted-average cost the posting applied.
        v_new_buy := v_old_buy;
        IF v_new_stock > 0 THEN
          v_new_buy := ROUND((v_old_stock * v_old_buy - v_value) / v_new_stock, 2);
          IF v_new_buy < 0 THEN
            v_new_buy := v_old_buy;
          END IF;
        END IF;

        PERFORM public.stock_sync_skip(true);
        UPDATE public.products
        SET stock = v_new_stock, buy_price = v_new_buy
        WHERE id = r.product_id;
        PERFORM public.stock_sync_skip(false);

        IF v_is_metric THEN
          PERFORM public._stock_sync_polywood_rows(r.product_id);
        ELSE
          -- LOT-2: out of the lots the document put in.
          PERFORM public.lot_ctx_begin(jsonb_build_object(
            'doc_type', 'inventory_initial_balance', 'doc_id', p_document_id, 'doc_no', v_label,
            'product_id', r.product_id, 'mode', 'reverse',
            'reverse_of', jsonb_build_object('doc_type', 'inventory_initial_balance', 'doc_id', p_document_id)));
          v_row_id := public._stock_row_for(r.product_id, r.warehouse_id);
          UPDATE public.warehouse_stocks
          SET current_stock = GREATEST(current_stock - r.net_qty, 0), updated_at = NOW()
          WHERE id = v_row_id;
          PERFORM public.lot_ctx_end();
        END IF;

        INSERT INTO public.stock_movements (
          product_id, warehouse_id, movement_type, quantity, unit,
          reference_type, reference_id, description, created_by
        )
        VALUES (
          r.product_id, r.warehouse_id, 'out', r.net_qty, r.unit,
          v_ref, p_document_id, 'STORNO: ' || v_label, v_actor
        );

        v_moves := v_moves + 1;
      END LOOP;

      IF v_moves = 0 AND EXISTS (
        SELECT 1 FROM public.inventory_initial_balance_items WHERE document_id = p_document_id
      ) THEN
        RAISE EXCEPTION '%',
          'Bu sənəd üçün anbar hərəkəti tapılmadı. Avtomatik geri qaytarmaq mümkün deyil — administratorla əlaqə saxlayın.'
          USING ERRCODE = '22023';
      END IF;

      -- FIFO layers were verified untouched above; re-posting creates fresh ones.
      DELETE FROM public.inventory_batches
      WHERE document_id = p_document_id
        AND document_type = v_ref;

      -- Ledger is immutable: offset any postings with storno entries.
      v_journals := public.reverse_document_journals(
        p_document_id,
        'Qaralamaya qaytarıldı: ' || v_label || COALESCE(' — ' || NULLIF(trim(p_reason), ''), '')
      );

      UPDATE public.inventory_initial_balances
      SET status = 'draft',
          posted_at = NULL,
          posted_by = NULL,
          unposted_at = NOW(),
          unposted_by = v_actor,
          unpost_reason = NULLIF(trim(p_reason), ''),
          updated_at = NOW()
      WHERE id = p_document_id;

      RETURN jsonb_build_object(
        'document_number', v_label,
        'movements_reversed', v_moves,
        'journals_reversed', v_journals
      );
    END;
    $body$
    $fn$;
  END IF;
END
$do$;

-- Count posting: surplus lots, shortage FEFO.
DO $do$
BEGIN
  IF to_regclass('public.inventory_counts') IS NOT NULL AND to_regclass('public.inventory_count_items') IS NOT NULL THEN
    EXECUTE $fn$
CREATE OR REPLACE FUNCTION public.inventory_count_post(p_count_id uuid, p_actor uuid DEFAULT NULL::uuid)
  RETURNS jsonb
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
  AS $body$
  DECLARE
    v_actor     UUID := COALESCE(auth.uid(), p_actor);
    v_doc       public.inventory_counts;
    v_line      public.inventory_count_items;
    v_ref       CONSTANT TEXT := 'inventory_adjustment';
    v_polywood  BOOLEAN;
    v_book      NUMERIC;
    v_delta     NUMERIC;
    v_new_qty   NUMERIC;
    v_value     NUMERIC;
    v_surplus   NUMERIC := 0;
    v_shortage  NUMERIC := 0;
    v_moves     INTEGER := 0;
    v_journal   UUID;
    v_lines     JSONB;
    v_key       TEXT;
    -- polywood piece reconciliation
    v_targets   NUMERIC[];
    v_target    NUMERIC;
    v_matched   UUID[];
    v_scanned   UUID[];
    v_piece_id  UUID;
    v_piece     RECORD;
    v_need      NUMERIC;
    v_lengths   JSONB;
  BEGIN
    PERFORM public._inventory_count_authorize('can_post_inventory_count');
    v_doc := public._inventory_count_lock(p_count_id, ARRAY['review']);

    IF public.is_accounting_period_closed(v_doc.count_date) THEN
      RAISE EXCEPTION '%', format(
        'Sənəd tarixi bağlı maliyyə dövrünə düşür (%s). Əvvəlcə dövrü açın.',
        to_char(v_doc.count_date, 'YYYY-MM')
      ) USING ERRCODE = '22023';
    END IF;

    FOR v_line IN
      SELECT * FROM public.inventory_count_items
      WHERE count_id = v_doc.id AND actual_qty IS NOT NULL
      ORDER BY line_no
      FOR UPDATE
    LOOP
      -- LOT-2: a surplus is a new 'count_surplus' lot, a shortage leaves FEFO; Polywood offcuts keep
      -- their piece's lot.
      PERFORM public.lot_ctx_begin(jsonb_build_object(
        'doc_type', 'inventory_count', 'doc_id', v_doc.id, 'doc_line_id', v_line.id, 'doc_no', v_doc.document_number,
        'product_id', v_line.product_id,
        'new_lot', jsonb_build_object('origin_type', 'count_surplus')));
      SELECT inventory_mode = 'polywood' INTO v_polywood
      FROM public.products WHERE id = v_line.product_id FOR UPDATE;
      v_book := public.inventory_count_book_qty(v_line.product_id, v_doc.warehouse_id);

      IF v_line.is_metric THEN
        -- Pieces are physical identities: make the available set equal the
        -- counted set, keeping existing pieces (and their barcodes) wherever a
        -- counted length matches, scanned pieces first.
        SELECT COALESCE(array_agg(value::uuid), '{}') INTO v_scanned
        FROM jsonb_array_elements_text(v_line.scanned_piece_ids);

        SELECT COALESCE(array_agg(len ORDER BY len DESC), '{}') INTO v_targets
        FROM (
          SELECT v_line.full_sheet_length_m AS len
          FROM generate_series(1, COALESCE(v_line.actual_full_sheets, 0))
          UNION ALL
          SELECT value::numeric FROM jsonb_array_elements_text(COALESCE(v_line.actual_cut_pieces, '[]'::jsonb))
        ) t;

        v_matched := '{}';
        FOREACH v_target IN ARRAY v_targets LOOP
          SELECT pp.id INTO v_piece_id
          FROM public.polywood_pieces pp
          WHERE pp.product_id = v_line.product_id
            AND pp.warehouse_id = v_doc.warehouse_id
            AND pp.status = 'available'
            AND abs(pp.length_m - v_target) < 0.0005
            AND NOT (pp.id = ANY (v_matched))
          ORDER BY (pp.id = ANY (v_scanned)) DESC, pp.created_at
          LIMIT 1;

          IF v_piece_id IS NOT NULL THEN
            v_matched := v_matched || v_piece_id;
          ELSE
            INSERT INTO public.polywood_pieces (
              product_id, warehouse_id, length_m, piece_type, status, notes, source_document_id, updated_at
            ) VALUES (
              v_line.product_id, v_doc.warehouse_id, v_target,
              CASE WHEN abs(v_target - v_line.full_sheet_length_m) < 0.0005 THEN 'full' ELSE 'cut' END,
              'available', 'İnventarizasiya artığı — ' || v_doc.document_number, v_doc.id, NOW()
            )
            RETURNING id INTO v_piece_id;
            v_matched := v_matched || v_piece_id;
          END IF;
        END LOOP;

        UPDATE public.polywood_pieces
        SET status = 'consumed',
            consumed_by_document_id = v_doc.id,
            notes = 'İnventarizasiya çatışmazlığı — ' || v_doc.document_number,
            updated_at = NOW()
        WHERE product_id = v_line.product_id
          AND warehouse_id = v_doc.warehouse_id
          AND status = 'available'
          AND NOT (id = ANY (v_matched));

        SELECT ROUND(COALESCE(SUM(length_m), 0), 3),
               COALESCE(jsonb_agg(length_m ORDER BY length_m DESC), '[]'::jsonb)
        INTO v_new_qty, v_lengths
        FROM public.polywood_pieces
        WHERE product_id = v_line.product_id AND warehouse_id = v_doc.warehouse_id AND status = 'available';

        v_delta := ROUND(v_new_qty - v_book, 3);
        PERFORM public._inventory_count_set_stock(v_line.product_id, v_doc.warehouse_id, v_new_qty, v_delta, v_lengths);
        v_value := ROUND(v_delta * v_line.unit_cost, 2);

      ELSIF v_polywood THEN
        -- Backdated polywood line counted in metres: a surplus becomes one cut
        -- piece; a shortage consumes available pieces shortest first and splits
        -- the last one.
        v_delta := ROUND(v_line.actual_qty - v_line.expected_qty, 3);
        IF v_delta > 0.0005 THEN
          INSERT INTO public.polywood_pieces (
            product_id, warehouse_id, length_m, piece_type, status, notes, source_document_id, updated_at
          ) VALUES (
            v_line.product_id, v_doc.warehouse_id, v_delta, 'cut', 'available',
            'İnventarizasiya artığı — ' || v_doc.document_number, v_doc.id, NOW()
          );
        ELSIF v_delta < -0.0005 THEN
          v_need := -v_delta;
          FOR v_piece IN
            SELECT id, length_m FROM public.polywood_pieces
            WHERE product_id = v_line.product_id AND warehouse_id = v_doc.warehouse_id AND status = 'available'
            ORDER BY length_m ASC, created_at ASC
            FOR UPDATE
          LOOP
            EXIT WHEN v_need <= 0.0005;
            UPDATE public.polywood_pieces
            SET status = 'consumed',
                consumed_by_document_id = v_doc.id,
                notes = 'İnventarizasiya çatışmazlığı — ' || v_doc.document_number,
                updated_at = NOW()
            WHERE id = v_piece.id;
            IF v_piece.length_m > v_need + 0.0005 THEN
              INSERT INTO public.polywood_pieces (
                product_id, warehouse_id, length_m, piece_type, status, notes, source_document_id, updated_at
              ) VALUES (
                v_line.product_id, v_doc.warehouse_id, ROUND(v_piece.length_m - v_need, 3), 'cut', 'available',
                'İnventarizasiya qalığı — ' || v_doc.document_number, v_doc.id, NOW()
              );
              v_need := 0;
            ELSE
              v_need := v_need - v_piece.length_m;
            END IF;
          END LOOP;
        END IF;

        SELECT ROUND(COALESCE(SUM(length_m), 0), 3),
               COALESCE(jsonb_agg(length_m ORDER BY length_m DESC), '[]'::jsonb)
        INTO v_new_qty, v_lengths
        FROM public.polywood_pieces
        WHERE product_id = v_line.product_id AND warehouse_id = v_doc.warehouse_id AND status = 'available';

        v_delta := ROUND(v_new_qty - v_book, 3);
        PERFORM public._inventory_count_set_stock(v_line.product_id, v_doc.warehouse_id, v_new_qty, v_delta, v_lengths);
        v_value := ROUND(v_delta * v_line.unit_cost, 2);

      ELSE
        -- Apply the counted difference to today's stock (sales made after the
        -- shelf was counted stay booked).
        v_delta := ROUND(v_line.actual_qty - v_line.expected_qty, 4);
        v_new_qty := GREATEST(v_book + v_delta, 0);
        v_delta := v_new_qty - v_book;

        IF abs(v_delta) > 0.00005 THEN
          PERFORM public._inventory_count_set_stock(v_line.product_id, v_doc.warehouse_id, v_new_qty, v_delta);
        END IF;

        IF v_delta > 0 THEN
          PERFORM public.create_inventory_batch(v_line.product_id, v_doc.id, v_ref, v_line.unit_cost, v_delta);
          v_value := ROUND(v_delta * v_line.unit_cost, 2);
        ELSIF v_delta < 0 THEN
          v_value := -public._fifo_consume_for_document(
            v_line.product_id, -v_delta, v_ref, v_doc.id, v_line.unit_cost
          );
        ELSE
          v_value := 0;
        END IF;
      END IF;

      IF abs(v_delta) > 0.00005 THEN
        INSERT INTO public.stock_movements (
          product_id, warehouse_id, movement_type, quantity, unit,
          reference_type, reference_id, source_line_id, description, created_by
        ) VALUES (
          v_line.product_id, v_doc.warehouse_id,
          CASE WHEN v_delta > 0 THEN 'in' ELSE 'out' END,
          abs(v_delta), v_line.unit, v_ref, v_doc.id, v_line.id,
          'İnventarizasiya — ' || v_doc.document_number, v_actor
        );
        v_moves := v_moves + 1;
      END IF;

      IF v_value > 0 THEN
        v_surplus := v_surplus + v_value;
      ELSE
        v_shortage := v_shortage - v_value;
      END IF;

      UPDATE public.inventory_count_items
      SET applied_qty = v_delta, applied_value = v_value
      WHERE id = v_line.id;
    END LOOP;
    PERFORM public.lot_ctx_end();

    v_lines := '[]'::jsonb;
    IF v_surplus > 0 THEN
      v_lines := v_lines
        || jsonb_build_object('account_code', '1300', 'debit', v_surplus, 'credit', 0, 'line_memo', 'İnventarizasiya artığı — anbar')
        || jsonb_build_object('account_code', '4950', 'debit', 0, 'credit', v_surplus, 'line_memo', 'İnventarizasiya artığı');
    END IF;
    IF v_shortage > 0 THEN
      v_lines := v_lines
        || jsonb_build_object('account_code', '6250', 'debit', v_shortage, 'credit', 0, 'line_memo', 'İnventarizasiya çatışmazlığı')
        || jsonb_build_object('account_code', '1300', 'debit', 0, 'credit', v_shortage, 'line_memo', 'İnventarizasiya çatışmazlığı — anbar');
    END IF;

    -- A re-post after an unpost gets its own key, or the old (reversed) entry would come back.
    v_key := 'inventory_count:' || v_doc.id::text
      || CASE WHEN v_doc.post_revision > 0 THEN ':' || v_doc.post_revision::text ELSE '' END;

    IF jsonb_array_length(v_lines) > 0 THEN
      v_journal := public.create_journal_entry(jsonb_build_object(
        'document_type', 'inventory_count',
        'document_id', v_doc.id,
        'source_type', 'inventory_count',
        'source_id', v_doc.id,
        'idempotency_key', v_key,
        'entry_date', v_doc.count_date,
        'description', format('İnventarizasiya — %s (%s)', v_doc.document_number, COALESCE(v_doc.warehouse_name, '')),
        'lines', v_lines
      ));
    END IF;

    UPDATE public.inventory_counts
    SET status = 'posted',
        posted_at = NOW(),
        posted_by = v_actor,
        journal_entry_id = v_journal,
        updated_at = NOW()
    WHERE id = v_doc.id;

    PERFORM public.inventory_count_refresh_totals(v_doc.id);

    IF v_doc.post_revision > 0 THEN
      PERFORM public._inventory_count_log(
        v_doc.id, 'INVENTORY_COUNT_REPOST',
        format('Yenidən təsdiqləndi (versiya %s)', v_doc.post_revision),
        v_actor, jsonb_build_object('revision', v_doc.post_revision, 'journal_entry_id', v_journal)
      );
    END IF;

    RETURN jsonb_build_object(
      'document_number', v_doc.document_number,
      'movements', v_moves,
      'surplus_value', v_surplus,
      'shortage_value', v_shortage,
      'journal_entry_id', v_journal
    );
  END;
  $body$
    $fn$;
  END IF;
END
$do$;

-- Count unpost: reverse context per line.
DO $do$
BEGIN
  IF to_regclass('public.inventory_counts') IS NOT NULL AND to_regclass('public.inventory_count_items') IS NOT NULL THEN
    EXECUTE $fn$
CREATE OR REPLACE FUNCTION public.inventory_count_unpost(
    p_count_id UUID,
    p_reason   TEXT,
    p_actor    UUID DEFAULT NULL
  )
  RETURNS JSONB
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
  AS $body$
  DECLARE
    v_actor    UUID := COALESCE(auth.uid(), p_actor);
    v_doc      public.inventory_counts;
    v_ref      CONSTANT TEXT := 'inventory_adjustment';
    v_reason   TEXT := NULLIF(trim(p_reason), '');
    v_blocked  TEXT;
    v_line     RECORD;
    r          RECORD;
    v_book     NUMERIC;
    v_new_qty  NUMERIC;
    v_lengths  JSONB;
    v_moves    INTEGER := 0;
    v_journals INTEGER := 0;
  BEGIN
    IF NOT public._inventory_count_actor_is_admin(p_actor) THEN
      RAISE EXCEPTION '%', 'forbidden' USING ERRCODE = '42501';
    END IF;
    IF v_reason IS NULL THEN
      RAISE EXCEPTION '%', 'Geri alma səbəbi göstərilməlidir' USING ERRCODE = '22023';
    END IF;

    v_doc := public._inventory_count_lock(p_count_id, ARRAY['posted']);

    IF public.is_accounting_period_closed(v_doc.count_date) THEN
      RAISE EXCEPTION '%', format(
        'Sənəd tarixi bağlı maliyyə dövrünə düşür (%s). Əvvəlcə dövrü açın.',
        to_char(v_doc.count_date, 'YYYY-MM')
      ) USING ERRCODE = '22023';
    END IF;

    -- What the count added must still be on the shelf.
    SELECT string_agg(DISTINCT COALESCE(p.code || ' ', '') || p.name, ', ') INTO v_blocked
    FROM (
      SELECT b.product_id FROM public.inventory_batches b
      WHERE b.document_id = v_doc.id AND b.document_type = v_ref AND b.remaining_qty < b.initial_qty - 0.00005
      UNION
      SELECT pp.product_id FROM public.polywood_pieces pp
      WHERE pp.source_document_id = v_doc.id AND pp.status <> 'available'
      UNION
      SELECT i.product_id FROM public.inventory_count_items i
      JOIN public.products pr ON pr.id = i.product_id
      WHERE i.count_id = v_doc.id AND COALESCE(i.applied_qty, 0) > 0.00005
        AND pr.inventory_mode IS DISTINCT FROM 'polywood'
        AND public.inventory_count_book_qty(i.product_id, v_doc.warehouse_id) + 0.00005 < i.applied_qty
    ) x
    JOIN public.products p ON p.id = x.product_id;

    IF v_blocked IS NOT NULL THEN
      RAISE EXCEPTION '%', format(
        'Bu sayımın artığı artıq satılıb və ya kəsilib, geri almaq mümkün deyil: %s. Düzəliş üçün yeni inventarizasiya aparın.',
        v_blocked
      ) USING ERRCODE = '22023';
    END IF;

    -- Polywood: put back what the count consumed, remove what it created.
    UPDATE public.polywood_pieces
    SET status = 'available', consumed_by_document_id = NULL,
        notes = 'Geri alındı — ' || v_doc.document_number, updated_at = NOW()
    WHERE consumed_by_document_id = v_doc.id AND status = 'consumed';
    DELETE FROM public.polywood_pieces WHERE source_document_id = v_doc.id;

    -- FIFO: shortage consumptions back into their layers; surplus layers removed.
    FOR r IN
      SELECT id, batch_id, quantity FROM public.inventory_batch_consumptions
      WHERE source_type = v_ref AND source_id = v_doc.id
    LOOP
      IF r.batch_id IS NOT NULL THEN
        UPDATE public.inventory_batches SET remaining_qty = remaining_qty + r.quantity WHERE id = r.batch_id;
      END IF;
      DELETE FROM public.inventory_batch_consumptions WHERE id = r.id;
    END LOOP;
    DELETE FROM public.inventory_batches WHERE document_id = v_doc.id AND document_type = v_ref;

    -- Stock: each line moves back by what posting applied.
    FOR v_line IN
      SELECT i.*, p.inventory_mode = 'polywood' AS polywood
      FROM public.inventory_count_items i
      JOIN public.products p ON p.id = i.product_id
      WHERE i.count_id = v_doc.id AND abs(COALESCE(i.applied_qty, 0)) > 0.00005
      ORDER BY i.line_no
    LOOP
      PERFORM 1 FROM public.products WHERE id = v_line.product_id FOR UPDATE;
      -- LOT-2: back exactly as the posting moved it (the surplus lot out, a shortage back to its lots).
      PERFORM public.lot_ctx_begin(jsonb_build_object(
        'doc_type', 'inventory_count', 'doc_id', v_doc.id, 'doc_line_id', v_line.id, 'doc_no', v_doc.document_number,
        'product_id', v_line.product_id, 'mode', 'reverse',
        'reverse_of', jsonb_build_object('doc_type', 'inventory_count', 'doc_id', v_doc.id, 'doc_line_id', v_line.id)));
      IF v_line.polywood THEN
        SELECT ROUND(COALESCE(SUM(length_m), 0), 3),
               COALESCE(jsonb_agg(length_m ORDER BY length_m DESC), '[]'::jsonb)
        INTO v_new_qty, v_lengths
        FROM public.polywood_pieces
        WHERE product_id = v_line.product_id AND warehouse_id = v_doc.warehouse_id AND status = 'available';
      ELSE
        v_book := public.inventory_count_book_qty(v_line.product_id, v_doc.warehouse_id);
        v_new_qty := v_book - v_line.applied_qty;
        v_lengths := NULL;
      END IF;
      PERFORM public._inventory_count_set_stock(v_line.product_id, v_doc.warehouse_id, v_new_qty, -v_line.applied_qty, v_lengths);
    END LOOP;
    PERFORM public.lot_ctx_end();

    -- Movements: offset the net of this count's postings (earlier cycles cancel out).
    FOR r IN
      SELECT m.product_id, m.warehouse_id, MIN(m.unit) AS unit, MIN(m.source_line_id::text)::uuid AS line_id,
             SUM(CASE WHEN m.movement_type = 'in' THEN m.quantity ELSE -m.quantity END) AS net_in
      FROM public.stock_movements m
      WHERE m.reference_id = v_doc.id
        AND m.reference_type IN (v_ref, 'inventory_adjustment_reversal')
      GROUP BY m.product_id, m.warehouse_id
      HAVING abs(SUM(CASE WHEN m.movement_type = 'in' THEN m.quantity ELSE -m.quantity END)) > 0.00005
    LOOP
      INSERT INTO public.stock_movements (
        product_id, warehouse_id, movement_type, quantity, unit,
        reference_type, reference_id, source_line_id, description, created_by
      ) VALUES (
        r.product_id, r.warehouse_id,
        CASE WHEN r.net_in > 0 THEN 'out' ELSE 'in' END,
        abs(r.net_in), r.unit, 'inventory_adjustment_reversal', v_doc.id, r.line_id,
        'STORNO: İnventarizasiya — ' || v_doc.document_number, v_actor
      );
      v_moves := v_moves + 1;
    END LOOP;

    v_journals := public.reverse_document_journals(
      v_doc.id,
      'İnventarizasiya geri alındı: ' || v_doc.document_number || ' — ' || v_reason
    );

    UPDATE public.inventory_count_items
    SET applied_qty = NULL, applied_value = NULL
    WHERE count_id = v_doc.id;

    UPDATE public.inventory_counts
    SET status = 'review',
        posted_at = NULL,
        posted_by = NULL,
        journal_entry_id = NULL,
        unposted_at = NOW(),
        unposted_by = v_actor,
        unpost_reason = v_reason,
        post_revision = post_revision + 1,
        updated_at = NOW()
    WHERE id = v_doc.id;

    PERFORM public.inventory_count_refresh_totals(v_doc.id);

    PERFORM public._inventory_count_log(
      v_doc.id, 'INVENTORY_COUNT_UNPOST',
      'Təsdiq geri alındı: ' || v_reason,
      v_actor,
      jsonb_build_object('reason', v_reason, 'movements_reversed', v_moves, 'journals_reversed', v_journals)
    );

    RETURN jsonb_build_object(
      'document_number', v_doc.document_number,
      'movements_reversed', v_moves,
      'journals_reversed', v_journals
    );
  END;
  $body$
    $fn$;
  END IF;
END
$do$;

-- Production: finished goods on a 'production' lot.
DO $do$
BEGIN
  IF to_regclass('public.production_orders') IS NOT NULL THEN
    EXECUTE $fn$
CREATE OR REPLACE FUNCTION public.process_production_ready_event(p_order_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_lot UUID;
  v_lot_no TEXT;
  v_idempotency TEXT;
  v_cached JSONB;
  v_order production_orders%ROWTYPE;
  v_qty NUMERIC;
  v_wip_cost NUMERIC;
  v_journal_id UUID;
  v_event_id UUID;
  v_result JSONB;
  v_stock NUMERIC;
BEGIN
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'order_required'
      USING ERRCODE = '22023',
            MESSAGE = 'İstehsal sifarişi identifikatoru tələb olunur';
  END IF;

  v_idempotency := 'production_ready:' || p_order_id::text;
  v_cached := public.find_erp_event_by_idempotency(v_idempotency);
  IF v_cached IS NOT NULL THEN
    RETURN v_cached->'result';
  END IF;

  IF NOT public.user_has_permission('can_manage_production') THEN
    RAISE EXCEPTION 'forbidden'
      USING ERRCODE = '42501',
            MESSAGE = 'İcazəniz yoxdur';
  END IF;

  SELECT * INTO v_order
  FROM production_orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'production_order_not_found'
      USING ERRCODE = 'P0002',
            MESSAGE = 'İstehsal sifarişi tapılmadı';
  END IF;

  IF v_order.type IS DISTINCT FROM 'Series' THEN
    RAISE EXCEPTION 'invalid_order_type'
      USING ERRCODE = '22023',
            MESSAGE = 'Hazır statusu yalnız seriya sifarişləri üçün aktivdir';
  END IF;

  IF COALESCE(v_order.finished_goods_posted, false) THEN
    RETURN jsonb_build_object(
      'success', true,
      'event_type', 'production_ready',
      'order_id', p_order_id,
      'already_completed', true,
      'finished_goods_posted', true
    );
  END IF;

  IF v_order.status IS DISTINCT FROM 'In-Progress' AND v_order.status IS DISTINCT FROM 'Ready' THEN
    RAISE EXCEPTION 'invalid_status'
      USING ERRCODE = '22023',
            MESSAGE = 'Hazır statusu yalnız «İstehsalda» statusundan aktivdir';
  END IF;

  IF v_order.finished_product_id IS NULL THEN
    RAISE EXCEPTION 'finished_product_required'
      USING ERRCODE = '22023',
            MESSAGE = 'Hazır məhsul təyin edilməyib';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM production_materials
    WHERE production_order_id = p_order_id
      AND COALESCE(issued, false) = false
  ) THEN
    RAISE EXCEPTION 'materials_pending'
      USING ERRCODE = '22023',
            MESSAGE = 'Bütün BOM materialları verilməlidir';
  END IF;

  v_qty := GREATEST(COALESCE(v_order.quantity, 1), 1);

  SELECT stock INTO v_stock
  FROM products
  WHERE id = v_order.finished_product_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'finished_product_not_found'
      USING ERRCODE = 'P0002',
            MESSAGE = 'Hazır məhsul tapılmadı';
  END IF;

  -- LOT-2: the finished goods get a 'production' lot, numbered after the order when that number is
  -- free; the material lots the order consumed are listed in custom_fields.material_lots.
  v_lot_no := NULLIF(btrim(COALESCE(v_order.order_no, '')), '');
  IF v_lot_no IS NOT NULL AND EXISTS (SELECT 1 FROM public.stock_lots WHERE lot_no = v_lot_no) THEN
    v_lot_no := NULL;
  END IF;
  v_lot := public._lot_create(v_order.finished_product_id, jsonb_build_object(
    'lot_no', v_lot_no, 'origin_type', 'production', 'origin_doc_type', 'production_order', 'origin_doc_id', p_order_id,
    'origin_doc_no', v_order.order_no, 'qty_received', v_qty,
    'received_date', (COALESCE(public.document_timestamp(), NOW()) AT TIME ZONE 'Asia/Baku')::date));
  UPDATE public.stock_lots
  SET custom_fields = custom_fields || jsonb_build_object('material_lots', COALESCE((
        SELECT jsonb_agg(jsonb_build_object('lot_id', x.lot_id, 'lot_no', x.lot_no, 'product_id', x.product_id, 'qty', x.qty) ORDER BY x.lot_no)
        FROM (SELECT m.lot_id, l.lot_no, m.product_id, -SUM(m.qty_delta) AS qty
              FROM public.stock_lot_movements m JOIN public.stock_lots l ON l.id = m.lot_id
              WHERE m.doc_type = 'production_order' AND m.doc_id = p_order_id
              GROUP BY m.lot_id, l.lot_no, m.product_id
              HAVING SUM(m.qty_delta) < 0) x), '[]'::jsonb))
  WHERE id = v_lot;
  PERFORM public.lot_ctx_begin(jsonb_build_object(
    'doc_type', 'production_order', 'doc_id', p_order_id, 'doc_no', v_order.order_no,
    'product_id', v_order.finished_product_id,
    'lots', jsonb_build_array(jsonb_build_object('lot_id', v_lot, 'qty', v_qty))));
  -- Into the furniture warehouse, else the order warehouse, else the default (fix F3).
  PERFORM public.stock_move(v_order.finished_product_id,
    COALESCE(v_order.furniture_warehouse_id, v_order.warehouse_id), v_qty, false);
  PERFORM public.lot_ctx_end();
  INSERT INTO stock_movements (
    product_id, warehouse_id, movement_type, quantity, unit,
    reference_type, reference_id, description, created_by
  ) VALUES (
    v_order.finished_product_id,
    COALESCE(v_order.furniture_warehouse_id, v_order.warehouse_id, public.stock_default_warehouse()),
    'in', v_qty, COALESCE((SELECT unit FROM products WHERE id = v_order.finished_product_id), 'Ədəd'),
    'production', p_order_id, 'Hazır məhsul — ' || COALESCE(v_order.order_no, ''), auth.uid()
  );

  v_wip_cost := public.compute_production_wip_cost(p_order_id);

  IF v_wip_cost > 0.0001 THEN
    v_journal_id := public.post_journal_entry(
      jsonb_build_object(
        'source_type', 'production_ready',
        'source_id', p_order_id,
        'idempotency_key', v_idempotency,
        'memo', format('Hazır məhsul anbara — %s', v_order.order_no),
        'lines', jsonb_build_array(
          jsonb_build_object(
            'coa_code', '1300',
            'debit', v_wip_cost,
            'credit', 0,
            'line_memo', 'Hazır məhsul — ' || v_order.order_no
          ),
          jsonb_build_object(
            'coa_code', '1350',
            'debit', 0,
            'credit', v_wip_cost,
            'line_memo', 'WIP bağlanması — ' || v_order.order_no
          )
        )
      )
    );
  END IF;

  UPDATE production_orders
  SET finished_goods_posted = true,
      status = 'Ready',
      updated_at = NOW()
  WHERE id = p_order_id;

  v_result := jsonb_build_object(
    'success', true,
    'event_type', 'production_ready',
    'order_id', p_order_id,
    'finished_product_id', v_order.finished_product_id,
    'quantity', v_qty,
    'wip_cost', v_wip_cost,
    'journal_entry_id', v_journal_id,
    'finished_goods_posted', true,
    'status', 'Ready'
  );

  v_event_id := public.log_erp_event(
    'production_ready',
    'production_orders',
    p_order_id,
    jsonb_build_object('order_id', p_order_id),
    v_journal_id,
    v_idempotency,
    v_result
  );

  RETURN v_result || jsonb_build_object('event_id', v_event_id);
END;
$function$
    $fn$;
  END IF;
END
$do$;


-- ─── 6. Grants ──────────────────────────────────────────────────────────────
-- The replaced functions keep their grants (CREATE OR REPLACE). New ones: internal, or the server.

REVOKE ALL ON FUNCTION public._lot_inbound_fields(UUID, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._lot_resolve_named(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._lot_purchase_ctx(UUID, UUID, NUMERIC) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._lot_link_batch(TEXT, UUID, UUID, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._lot_for_inbound_line(JSONB, UUID, NUMERIC, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lot_post_inbound_line(JSONB, UUID, UUID, NUMERIC, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.lot_insert_inbound_pieces(JSONB, JSONB, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.lot_post_inbound_line(JSONB, UUID, UUID, NUMERIC, JSONB) TO service_role;
GRANT EXECUTE ON FUNCTION public.lot_insert_inbound_pieces(JSONB, JSONB, JSONB) TO service_role;

NOTIFY pgrst, 'reload schema';
