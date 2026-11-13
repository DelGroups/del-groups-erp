-- ============================================================================
-- LOT-3: outbound and moving stock documents record their lots (plan docs/lot-tracking/LOT-plan.md,
-- sections 4, 6, 7).
--
-- On LOT-1's engine (20261115100000_lot_core.sql) and after LOT-2 (20261115110000_lot_inbound.sql):
--   * Every outbound line runs in a lot context (lot_ctx_begin / lot_ctx_end): its document, line,
--     number, product and counterparty (customer for sales, partner for consignment). The lots
--     are the ones the user chose (line key "lots": [{lot_id, qty}]), else FEFO then FIFO.
--   * Chosen lots are checked BEFORE any stock moves (_lot_check_choice): same product, enough
--     in the line's warehouse, not quarantined or closed, adding up to the line quantity. An
--     expired lot only with lots.manage. FEFO never picks a quarantined lot (LOT-1).
--   * Kits: the component lines pick automatically.
--   * Cancel / void / reverse / unpost / material return / consignment return give back exactly
--     the lots taken (mode reverse with reverse_of = the original document and line).
--   * post_stock_transfer(p_payload): a stock transfer in one transaction, out of the source
--     (chosen lots or FEFO) and into the target on the same lots (mode mirror). Polywood offcuts
--     move their pieces (their lot goes along).
--
-- Each function is replaced with the same signature and its latest body; only the lot parts
-- change. Module functions only where the module is installed. Needs 20261115100000 and
-- 20261115110000. Safe to re-run.
-- ============================================================================

DO $$
BEGIN
  IF to_regprocedure('public._lot_apply(uuid, uuid, numeric, uuid, text, text)') IS NULL THEN
    RAISE EXCEPTION 'Run 20261115100000_lot_core.sql (LOT-1) before 20261115120000_lot_outbound.sql';
  END IF;
  IF to_regprocedure('public._lot_for_inbound_line(jsonb, uuid, numeric, jsonb)') IS NULL THEN
    RAISE EXCEPTION 'Run 20261115110000_lot_inbound.sql (LOT-2) before 20261115120000_lot_outbound.sql';
  END IF;
END
$$;

-- ─── 1. Columns ─────────────────────────────────────────────────────────────
-- The lots chosen for a line ([{lot_id, qty}], stock unit); NULL = automatic (FEFO).

ALTER TABLE public.sale_items ADD COLUMN IF NOT EXISTS lots JSONB;

DO $do$
BEGIN
  IF to_regclass('public.production_materials') IS NOT NULL THEN
    ALTER TABLE public.production_materials ADD COLUMN IF NOT EXISTS lots JSONB;
  END IF;
END
$do$;

-- The invoice print shows lot numbers under each line (default off; settings page).
INSERT INTO public.system_settings (key, value, updated_at)
VALUES ('lot_tracking', jsonb_build_object('print_on_invoice', false), NOW())
ON CONFLICT (key) DO UPDATE
SET value = COALESCE(public.system_settings.value, '{}'::jsonb)
            || jsonb_build_object('print_on_invoice', COALESCE((public.system_settings.value ->> 'print_on_invoice')::boolean, false));

-- ─── 2. Helpers ─────────────────────────────────────────────────────────────

-- lots.<action> for a given user (the app server posts with the service role: no auth.uid()).
CREATE OR REPLACE FUNCTION public._lots_can_user(p_user UUID, p_action TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT lower(COALESCE(r.name, '')) = 'admin'
        OR COALESCE((r.permissions ->> ('can_' || p_action || '_lots'))::boolean, false)
        OR COALESCE((p.permission_overrides ->> ('can_' || p_action || '_lots'))::boolean, false)
        OR COALESCE(
             (p.permission_overrides -> '_matrix' -> 'inventory' ->> (p_action || '_lots'))::boolean,
             (r.permissions -> '_matrix' -> 'inventory' ->> (p_action || '_lots'))::boolean,
             false)
      FROM public.profiles p
      LEFT JOIN public.roles r ON r.id = p.role_id
     WHERE p.id = p_user AND COALESCE(p.is_active, true)
  ), false);
$$;

-- Checks the lots chosen for one line BEFORE any stock moves and returns them normalized as
-- [{lot_id, qty}] (a lot_no is resolved). Raises a clear message naming product, lot and
-- warehouse; the message starts with a code the app translates:
--   lot_choice_invalid  the lot is not found or belongs to another product
--   lot_choice_blocked  the lot is quarantined or closed
--   lot_choice_expired  the lot is expired (allowed with lots.manage)
--   lot_choice_short    the lot has less than chosen in the line's warehouse
--   lot_choice_sum      the chosen quantities do not add up to the line quantity
-- p_user: whose lots.manage allows an expired lot (NULL = the signed-in user).
CREATE OR REPLACE FUNCTION public._lot_check_choice(p_product UUID, p_wh UUID, p_qty NUMERIC, p_lots JSONB, p_user UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  eps      CONSTANT NUMERIC := 0.0005;
  v_wh     UUID := public._lot_wh(p_wh);
  v_pname  TEXT;
  v_wname  TEXT;
  v_out    JSONB := '[]'::jsonb;
  v_sum    NUMERIC := 0;
  v_qty    NUMERIC;
  v_lot    public.stock_lots%ROWTYPE;
  v_bal    NUMERIC;
  v_manage BOOLEAN;
  x        JSONB;
  r        RECORD;
BEGIN
  IF jsonb_typeof(p_lots) <> 'array' OR jsonb_array_length(p_lots) = 0 THEN
    RETURN NULL;
  END IF;
  SELECT name INTO v_pname FROM public.products WHERE id = p_product;
  SELECT name INTO v_wname FROM public.warehouses WHERE id = v_wh;
  v_pname := COALESCE(v_pname, p_product::text);
  v_wname := COALESCE(v_wname, '—');

  FOR x IN SELECT value FROM jsonb_array_elements(p_lots) LOOP
    v_lot := NULL;
    SELECT * INTO v_lot FROM public.stock_lots l
    WHERE l.id = public._lot_uuid(x ->> 'lot_id')
       OR (public._lot_uuid(x ->> 'lot_id') IS NULL AND l.lot_no = NULLIF(btrim(x ->> 'lot_no'), '') AND l.product_id = p_product)
    LIMIT 1;
    IF v_lot.id IS NULL OR v_lot.product_id IS DISTINCT FROM p_product OR v_lot.origin_type = 'unassigned' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = format(
        'lot_choice_invalid: "%s" lotu "%s" məhsuluna aid deyil (anbar "%s")',
        COALESCE(v_lot.lot_no, x ->> 'lot_no', x ->> 'lot_id', '?'), v_pname, v_wname);
    END IF;
    IF v_lot.status <> 'active' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = format(
        'lot_choice_blocked: "%s" lotu %s ("%s", anbar "%s"); seçmək olmaz',
        v_lot.lot_no, CASE v_lot.status WHEN 'quarantine' THEN 'karantindədir' ELSE 'bağlıdır' END, v_pname, v_wname);
    END IF;
    IF v_lot.exp_date IS NOT NULL AND v_lot.exp_date < public.document_today() THEN
      v_manage := CASE WHEN p_user IS NOT NULL THEN public._lots_can_user(p_user, 'manage') ELSE public.lots_can('manage') END;
      IF NOT COALESCE(v_manage, false) THEN
        RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = format(
          'lot_choice_expired: "%s" lotunun istifadə müddəti %s bitib ("%s", anbar "%s"); yalnız lotları idarə etmə icazəsi ilə seçilə bilər',
          v_lot.lot_no, to_char(v_lot.exp_date, 'DD.MM.YYYY'), v_pname, v_wname);
      END IF;
    END IF;
    v_qty := COALESCE(NULLIF(x ->> 'qty', '')::numeric, CASE WHEN jsonb_array_length(p_lots) = 1 THEN p_qty END, 0);
    IF v_qty <= 0 THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = format(
        'lot_choice_sum: "%s" lotu üçün miqdar göstərilməyib ("%s")', v_lot.lot_no, v_pname);
    END IF;
    v_out := v_out || jsonb_build_object('lot_id', v_lot.id, 'qty', v_qty);
    v_sum := v_sum + v_qty;
  END LOOP;

  -- Per lot (one lot may be named twice): enough in the line's warehouse.
  FOR r IN
    SELECT (e ->> 'lot_id')::uuid AS lot_id, SUM((e ->> 'qty')::numeric) AS qty
    FROM jsonb_array_elements(v_out) e GROUP BY 1
  LOOP
    SELECT COALESCE(b.qty, 0) INTO v_bal FROM public.stock_lot_balances b WHERE b.lot_id = r.lot_id AND b.warehouse_id = v_wh;
    IF COALESCE(v_bal, 0) + eps < r.qty THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = format(
        'lot_choice_short: "%s" lotunda "%s" anbarında %s var, %s seçilib ("%s")',
        (SELECT lot_no FROM public.stock_lots WHERE id = r.lot_id), v_wname,
        trim_scale(COALESCE(v_bal, 0)), trim_scale(r.qty), v_pname);
    END IF;
  END LOOP;

  IF abs(v_sum - COALESCE(p_qty, 0)) > eps THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = format(
      'lot_choice_sum: seçilmiş lotların cəmi %s, sətirin miqdarı %s ("%s", anbar "%s")',
      trim_scale(v_sum), trim_scale(COALESCE(p_qty, 0)), v_pname, v_wname);
  END IF;
  RETURN v_out;
END;
$$;

-- The lots of a product still out at a consignment partner (dispatched minus returned), latest
-- dispatch first, as chosen lots for a return of p_qty: [{lot_id, qty}].
CREATE OR REPLACE FUNCTION public._lot_partner_return_lots(p_partner UUID, p_product UUID, p_qty NUMERIC)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_left NUMERIC := COALESCE(p_qty, 0);
  v_out  JSONB := '[]'::jsonb;
  v_take NUMERIC;
  r      RECORD;
BEGIN
  IF p_partner IS NULL OR p_product IS NULL OR v_left <= 0 THEN
    RETURN v_out;
  END IF;
  FOR r IN
    SELECT m.lot_id,
           SUM(CASE WHEN m.doc_type = 'consignment_dispatch' THEN -m.qty_delta ELSE 0 END)
             - SUM(CASE WHEN m.doc_type = 'consignment_settlement' THEN m.qty_delta ELSE 0 END) AS open_qty,
           MAX(m.recorded_at) FILTER (WHERE m.doc_type = 'consignment_dispatch') AS last_out
    FROM public.stock_lot_movements m
    JOIN public.stock_lots l ON l.id = m.lot_id AND l.origin_type <> 'unassigned'
    WHERE m.product_id = p_product AND m.counterparty_type = 'partner' AND m.counterparty_id = p_partner
      AND m.doc_type IN ('consignment_dispatch', 'consignment_settlement')
    GROUP BY m.lot_id
    ORDER BY last_out DESC NULLS LAST
  LOOP
    EXIT WHEN v_left <= 0;
    CONTINUE WHEN r.open_qty <= 0;
    v_take := LEAST(v_left, r.open_qty);
    v_out := v_out || jsonb_build_object('lot_id', r.lot_id, 'qty', v_take);
    v_left := v_left - v_take;
  END LOOP;
  RETURN v_out;
END;
$$;

-- ─── 3. Sales ───────────────────────────────────────────────────────────────

-- Sales draft save: the chosen lots of each line.
CREATE OR REPLACE FUNCTION public.save_sales_invoice_draft(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_header JSONB;
  v_items JSONB;
  v_payments JSONB;
  v_sale_id UUID;
  v_doc_no TEXT;
  v_customer_id UUID;
  v_customer_name TEXT;
  v_prefix TEXT;
  v_item JSONB;
  v_status TEXT;
  v_item_ids JSONB := '[]'::jsonb;
  v_item_id UUID;
  v_idx INT := 0;
  v_add_exp JSONB;
BEGIN
  IF p_payload IS NULL THEN
    RAISE EXCEPTION 'invalid_payload'
      USING ERRCODE = '22023',
            MESSAGE = 'Satış draft payload göndərilməyib';
  END IF;

  IF NOT (
    public.require_permission('can_edit_sales')
    OR public.require_permission('can_create_invoice')
    OR public.require_permission('can_manage_finance')
  ) THEN
    RAISE EXCEPTION 'forbidden'
      USING ERRCODE = '42501',
            MESSAGE = 'Satış yaratmaq üçün icazəniz yoxdur';
  END IF;

  v_header := COALESCE(p_payload->'header', '{}'::jsonb);
  v_items := COALESCE(p_payload->'items', '[]'::jsonb);
  v_payments := COALESCE(p_payload->'payments', '[]'::jsonb);
  v_add_exp := COALESCE(p_payload->'additional_expenses', '[]'::jsonb);
  v_sale_id := NULLIF(p_payload->>'sale_id', '')::uuid;
  IF v_sale_id IS NULL THEN
    v_sale_id := NULLIF(v_header->>'id', '')::uuid;
  END IF;

  IF jsonb_typeof(v_items) <> 'array' OR jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'items_required'
      USING ERRCODE = '22023',
            MESSAGE = 'Ən azı bir satış sətri tələb olunur';
  END IF;

  v_customer_id := NULLIF(v_header->>'customer_id', '')::uuid;
  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'customer_required'
      USING ERRCODE = '22023',
            MESSAGE = 'Müştəri seçilməlidir';
  END IF;

  SELECT COALESCE(NULLIF(trim(full_name), ''), NULLIF(trim(name), ''), NULLIF(trim(company_name), ''), '')
  INTO v_customer_name
  FROM customers
  WHERE id = v_customer_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'customer_not_found'
      USING ERRCODE = 'P0002',
            MESSAGE = 'Müştəri tapılmadı';
  END IF;

  IF v_sale_id IS NOT NULL THEN
    SELECT status, doc_no INTO v_status, v_doc_no
    FROM sales
    WHERE id = v_sale_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'sale_not_found'
        USING ERRCODE = 'P0002',
              MESSAGE = 'Satış sənədi tapılmadı';
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
    v_doc_no := NULLIF(trim(v_header->>'doc_no'), '');
    v_prefix := CASE
      WHEN COALESCE(v_header->>'invoice_mode', '') = 'polywood' THEN 'SPW'
      ELSE 'SS'
    END;
    IF v_doc_no IS NULL OR v_doc_no ~ '\.{3,}$' THEN
      v_doc_no := public.next_sales_doc_no(v_prefix);
    END IF;
  END IF;

  IF v_sale_id IS NULL THEN
    INSERT INTO sales (
      doc_no, invoice_number, doc_date, customer_id, customer_name,
      seller_id, seller_name, warehouse_name, subtotal, discount_total, vat_total,
      total_amount, paid_amount, remaining_balance, delivery_address, delivery_type,
      delivery_fee, note, notes, payments, created_at, status, payment_type,
      due_date, currency, exchange_rate, currency_breakdown, additional_expenses,
      additional_expenses_total
    )
    VALUES (
      v_doc_no,
      COALESCE(NULLIF(trim(v_header->>'invoice_number'), ''), v_doc_no),
      COALESCE(NULLIF(v_header->>'doc_date', '')::date, CURRENT_DATE),
      v_customer_id,
      COALESCE(NULLIF(trim(v_header->>'customer_name'), ''), v_customer_name),
      NULLIF(v_header->>'seller_id', '')::uuid,
      NULLIF(trim(v_header->>'seller_name'), ''),
      NULLIF(trim(v_header->>'warehouse_name'), ''),
      COALESCE(NULLIF(v_header->>'subtotal', '')::numeric, 0),
      COALESCE(NULLIF(v_header->>'discount_total', '')::numeric, 0),
      COALESCE(NULLIF(v_header->>'vat_total', '')::numeric, 0),
      COALESCE(NULLIF(v_header->>'total_amount', '')::numeric, 0),
      COALESCE(NULLIF(v_header->>'paid_amount', '')::numeric, 0),
      GREATEST(COALESCE(NULLIF(v_header->>'remaining_balance', '')::numeric, 0), 0),
      NULLIF(trim(v_header->>'delivery_address'), ''),
      COALESCE(NULLIF(trim(v_header->>'delivery_type'), ''), 'free'),
      COALESCE(NULLIF(v_header->>'delivery_fee', '')::numeric, 0),
      NULLIF(trim(v_header->>'note'), ''),
      NULLIF(trim(v_header->>'notes'), ''),
      COALESCE(v_header->'payments', v_payments, '[]'::jsonb),
      COALESCE(NULLIF(v_header->>'created_at', '')::timestamptz, NOW()),
      'draft',
      COALESCE(NULLIF(trim(v_header->>'payment_type'), ''), 'cash'),
      NULLIF(v_header->>'due_date', '')::date,
      COALESCE(NULLIF(trim(v_header->>'currency'), ''), 'AZN'),
      COALESCE(NULLIF(v_header->>'exchange_rate', '')::numeric, 1),
      COALESCE(v_header->'currency_breakdown', '{}'::jsonb),
      v_add_exp,
      COALESCE(NULLIF(v_header->>'additional_expenses_total', '')::numeric, 0)
    )
    RETURNING id INTO v_sale_id;
  ELSE
    UPDATE sales SET
      doc_date = COALESCE(NULLIF(v_header->>'doc_date', '')::date, doc_date),
      customer_id = v_customer_id,
      customer_name = COALESCE(NULLIF(trim(v_header->>'customer_name'), ''), v_customer_name),
      seller_id = NULLIF(v_header->>'seller_id', '')::uuid,
      seller_name = NULLIF(trim(v_header->>'seller_name'), ''),
      warehouse_name = NULLIF(trim(v_header->>'warehouse_name'), ''),
      subtotal = COALESCE(NULLIF(v_header->>'subtotal', '')::numeric, 0),
      discount_total = COALESCE(NULLIF(v_header->>'discount_total', '')::numeric, 0),
      vat_total = COALESCE(NULLIF(v_header->>'vat_total', '')::numeric, 0),
      total_amount = COALESCE(NULLIF(v_header->>'total_amount', '')::numeric, 0),
      paid_amount = COALESCE(NULLIF(v_header->>'paid_amount', '')::numeric, 0),
      remaining_balance = GREATEST(COALESCE(NULLIF(v_header->>'remaining_balance', '')::numeric, 0), 0),
      delivery_address = NULLIF(trim(v_header->>'delivery_address'), ''),
      delivery_type = COALESCE(NULLIF(trim(v_header->>'delivery_type'), ''), 'free'),
      delivery_fee = COALESCE(NULLIF(v_header->>'delivery_fee', '')::numeric, 0),
      note = NULLIF(trim(v_header->>'note'), ''),
      notes = NULLIF(trim(v_header->>'notes'), ''),
      payments = COALESCE(v_header->'payments', v_payments, '[]'::jsonb),
      status = 'draft',
      payment_type = COALESCE(NULLIF(trim(v_header->>'payment_type'), ''), payment_type, 'cash'),
      due_date = NULLIF(v_header->>'due_date', '')::date,
      currency = COALESCE(NULLIF(trim(v_header->>'currency'), ''), currency, 'AZN'),
      exchange_rate = COALESCE(NULLIF(v_header->>'exchange_rate', '')::numeric, exchange_rate, 1),
      currency_breakdown = COALESCE(v_header->'currency_breakdown', currency_breakdown, '{}'::jsonb),
      additional_expenses = v_add_exp,
      additional_expenses_total = COALESCE(NULLIF(v_header->>'additional_expenses_total', '')::numeric, 0)
    WHERE id = v_sale_id;

    DELETE FROM sale_items WHERE sale_id = v_sale_id;
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_items)
  LOOP
    INSERT INTO sale_items (
      sale_id, product_id, product_code, product_name, warehouse_id, warehouse_name,
      quantity, unit, unit_price, discount_percent, discount_type, vat_rate, line_total, extra_info,
      polywood_sale_mode, polywood_length_m, price_tier, currency, exchange_rate, lots
    )
    VALUES (
      v_sale_id,
      NULLIF(v_item->>'product_id', '')::uuid,
      NULLIF(trim(v_item->>'product_code'), ''),
      NULLIF(trim(v_item->>'product_name'), ''),
      NULLIF(v_item->>'warehouse_id', '')::uuid,
      NULLIF(trim(v_item->>'warehouse_name'), ''),
      COALESCE(NULLIF(v_item->>'quantity', '')::numeric, 0),
      COALESCE(NULLIF(trim(v_item->>'unit'), ''), 'Ədəd'),
      COALESCE(NULLIF(v_item->>'unit_price', '')::numeric, 0),
      COALESCE(NULLIF(v_item->>'discount_percent', '')::numeric, 0),
      CASE
        WHEN COALESCE(NULLIF(trim(v_item->>'discount_type'), ''), 'percentage') = 'fixed' THEN 'fixed'
        ELSE 'percentage'
      END,
      COALESCE(NULLIF(v_item->>'vat_rate', '')::numeric, 0),
      COALESCE(NULLIF(v_item->>'line_total', '')::numeric, NULLIF(v_item->>'total', '')::numeric, 0),
      NULLIF(trim(v_item->>'extra_info'), ''),
      NULLIF(trim(v_item->>'polywood_sale_mode'), ''),
      NULLIF(trim(v_item->>'polywood_length_m'), '')::numeric,
      COALESCE(NULLIF(trim(v_item->>'price_tier'), ''), 'retail'),
      COALESCE(NULLIF(trim(v_item->>'currency'), ''), 'AZN'),
      COALESCE(NULLIF(v_item->>'exchange_rate', '')::numeric, 1),
      -- LOT-3: the lots chosen for the line ([{lot_id, qty}]); none = automatic (FEFO).
      CASE WHEN jsonb_typeof(v_item->'lots') = 'array' AND jsonb_array_length(v_item->'lots') > 0 THEN v_item->'lots' END
    )
    RETURNING id INTO v_item_id;

    v_item_ids := v_item_ids || jsonb_build_array(
      jsonb_build_object(
        'index', v_idx,
        'id', v_item_id,
        'product_id', NULLIF(v_item->>'product_id', '')::uuid,
        'polywood_sale_mode', NULLIF(trim(v_item->>'polywood_sale_mode'), '')
      )
    );
    v_idx := v_idx + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'event_type', 'sales_invoice_draft',
    'sale_id', v_sale_id,
    'doc_no', v_doc_no,
    'status', 'draft',
    'items', v_item_ids
  );
END;
$function$;

-- Direct sale: the chosen lots of each line.
CREATE OR REPLACE FUNCTION public.create_sale_atomic(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_header JSONB;
  v_items JSONB;
  v_payments JSONB;
  v_decrement_stock BOOLEAN := true;
  v_customer_id UUID;
  v_customer_name TEXT;
  v_sale_id UUID;
  v_doc_no TEXT;
  v_total_amount NUMERIC;
  v_paid_amount NUMERIC;
  v_remaining NUMERIC;
  v_item JSONB;
  v_pay JSONB;
  v_product_id UUID;
  v_qty NUMERIC;
  v_stock NUMERIC;
  v_account_id UUID;
  v_pay_amount NUMERIC;
  v_pay_method TEXT;
  v_skip_stock BOOLEAN;
  v_polywood_mode TEXT;
  v_item_ids JSONB := '[]'::jsonb;
  v_item_id UUID;
  v_idx INT := 0;
  v_stock_demand JSONB := '{}'::jsonb;
  v_key TEXT;
BEGIN
  IF NOT public.require_permission('can_edit_sales') THEN
    RAISE EXCEPTION 'forbidden'
      USING ERRCODE = '42501',
            MESSAGE = 'Satış yaratmaq üçün icazəniz yoxdur';
  END IF;

  IF p_payload IS NULL THEN
    RAISE EXCEPTION 'invalid_payload'
      USING ERRCODE = '22023',
            MESSAGE = 'Satış məlumatları göndərilməyib';
  END IF;

  v_header := COALESCE(p_payload->'header', '{}'::jsonb);
  v_items := COALESCE(p_payload->'items', '[]'::jsonb);
  v_payments := COALESCE(p_payload->'payments', '[]'::jsonb);

  IF jsonb_typeof(v_items) <> 'array' OR jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'items_required'
      USING ERRCODE = '22023',
            MESSAGE = 'Ən azı bir satış sətri tələb olunur';
  END IF;

  IF (p_payload ? 'decrement_stock') THEN
    v_decrement_stock := COALESCE((p_payload->>'decrement_stock')::boolean, true);
  END IF;

  v_customer_id := NULLIF(v_header->>'customer_id', '')::uuid;
  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'customer_required'
      USING ERRCODE = '22023',
            MESSAGE = 'Müştəri seçilməlidir';
  END IF;

  SELECT COALESCE(NULLIF(trim(full_name), ''), NULLIF(trim(name), ''), NULLIF(trim(company_name), ''), '')
  INTO v_customer_name
  FROM customers
  WHERE id = v_customer_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'customer_not_found'
      USING ERRCODE = 'P0002',
            MESSAGE = 'Müştəri tapılmadı';
  END IF;

  v_total_amount := COALESCE(NULLIF(v_header->>'total_amount', '')::numeric, 0);
  v_paid_amount := COALESCE(NULLIF(v_header->>'paid_amount', '')::numeric, 0);
  v_remaining := GREATEST(
    COALESCE(
      NULLIF(v_header->>'remaining_balance', '')::numeric,
      v_total_amount - v_paid_amount
    ),
    0
  );

  IF v_paid_amount > v_total_amount + 0.0001 THEN
    RAISE EXCEPTION 'overpaid'
      USING ERRCODE = '22023',
            MESSAGE = 'Ödənilən məbləğ ümumi məbləğdən böyük ola bilməz';
  END IF;

  -- Stock demand per product and warehouse, checked against that warehouse (fix F3).
  IF v_decrement_stock THEN
    v_stock_demand := public.build_and_validate_sale_stock_demand(v_items);
  END IF;

  -- Validate payment accounts before writing
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

  v_doc_no := NULLIF(trim(v_header->>'doc_no'), '');
  IF v_doc_no IS NULL THEN
    v_doc_no := 'SF-' || to_char(CURRENT_DATE, 'YYYY') || '-' || floor(10000 + random() * 90000)::int;
  END IF;

  INSERT INTO sales (
    doc_no,
    invoice_number,
    doc_date,
    customer_id,
    customer_name,
    seller_id,
    seller_name,
    warehouse_name,
    subtotal,
    discount_total,
    vat_total,
    total_amount,
    paid_amount,
    remaining_balance,
    delivery_address,
    delivery_type,
    delivery_fee,
    note,
    notes,
    payments,
    created_at
  )
  VALUES (
    v_doc_no,
    COALESCE(NULLIF(trim(v_header->>'invoice_number'), ''), v_doc_no),
    COALESCE(NULLIF(v_header->>'doc_date', '')::date, CURRENT_DATE),
    v_customer_id,
    COALESCE(NULLIF(trim(v_header->>'customer_name'), ''), v_customer_name),
    NULLIF(v_header->>'seller_id', '')::uuid,
    NULLIF(trim(v_header->>'seller_name'), ''),
    NULLIF(trim(v_header->>'warehouse_name'), ''),
    COALESCE(NULLIF(v_header->>'subtotal', '')::numeric, 0),
    COALESCE(NULLIF(v_header->>'discount_total', '')::numeric, 0),
    COALESCE(NULLIF(v_header->>'vat_total', '')::numeric, 0),
    v_total_amount,
    v_paid_amount,
    v_remaining,
    NULLIF(trim(v_header->>'delivery_address'), ''),
    COALESCE(NULLIF(trim(v_header->>'delivery_type'), ''), 'free'),
    COALESCE(NULLIF(v_header->>'delivery_fee', '')::numeric, 0),
    NULLIF(trim(v_header->>'note'), ''),
    NULLIF(trim(v_header->>'notes'), ''),
    COALESCE(v_header->'payments', v_payments, '[]'::jsonb),
    COALESCE(NULLIF(v_header->>'created_at', '')::timestamptz, NOW())
  )
  RETURNING id INTO v_sale_id;

  -- Insert line items
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_items)
  LOOP
    INSERT INTO sale_items (
      sale_id,
      product_id,
      product_code,
      product_name,
      warehouse_id,
      warehouse_name,
      quantity,
      unit,
      unit_price,
      discount_percent,
      vat_rate,
      line_total,
      extra_info,
      polywood_sale_mode,
      polywood_length_m,
      lots
    )
    VALUES (
      v_sale_id,
      NULLIF(v_item->>'product_id', '')::uuid,
      NULLIF(trim(v_item->>'product_code'), ''),
      NULLIF(trim(v_item->>'product_name'), ''),
      NULLIF(v_item->>'warehouse_id', '')::uuid,
      NULLIF(trim(v_item->>'warehouse_name'), ''),
      COALESCE(NULLIF(v_item->>'quantity', '')::numeric, 0),
      COALESCE(NULLIF(trim(v_item->>'unit'), ''), 'Ədəd'),
      COALESCE(NULLIF(v_item->>'unit_price', '')::numeric, 0),
      COALESCE(NULLIF(v_item->>'discount_percent', '')::numeric, 0),
      COALESCE(NULLIF(v_item->>'vat_rate', '')::numeric, 0),
      COALESCE(
        NULLIF(v_item->>'line_total', '')::numeric,
        NULLIF(v_item->>'total', '')::numeric,
        0
      ),
      NULLIF(trim(v_item->>'extra_info'), ''),
      NULLIF(trim(v_item->>'polywood_sale_mode'), ''),
      NULLIF(v_item->>'polywood_length_m', '')::numeric,
      CASE WHEN jsonb_typeof(v_item->'lots') = 'array' AND jsonb_array_length(v_item->'lots') > 0 THEN v_item->'lots' END
    )
    RETURNING id INTO v_item_id;

    v_item_ids := v_item_ids || jsonb_build_array(
      jsonb_build_object(
        'index', v_idx,
        'id', v_item_id,
        'product_id', NULLIF(v_item->>'product_id', '')::uuid,
        'polywood_sale_mode', NULLIF(trim(v_item->>'polywood_sale_mode'), '')
      )
    );
    v_idx := v_idx + 1;
  END LOOP;

  -- Deduct the stock of each line's warehouse
  IF v_decrement_stock THEN
    PERFORM public.apply_sale_stock_decrement(v_stock_demand);
  END IF;

  -- Cash payments: transactions + account balance
  IF jsonb_typeof(v_payments) = 'array' THEN
    FOR v_pay IN SELECT value FROM jsonb_array_elements(v_payments)
    LOOP
      v_pay_amount := COALESCE(NULLIF(v_pay->>'amount', '')::numeric, 0);
      IF v_pay_amount <= 0 THEN
        CONTINUE;
      END IF;

      v_account_id := NULLIF(v_pay->>'account_id', '')::uuid;
      v_pay_method := COALESCE(NULLIF(trim(v_pay->>'method'), ''), 'Ödəniş');

      SELECT balance INTO v_stock
      FROM accounts
      WHERE id = v_account_id
      FOR UPDATE;

      INSERT INTO transactions (account_id, type, amount, category, notes)
      VALUES (
        v_account_id,
        'Mədaxil',
        v_pay_amount,
        'Satış Ödənişi',
        format('Satış fakturası %s — %s', v_doc_no, v_pay_method)
      );

      UPDATE accounts
      SET balance = COALESCE(v_stock, 0) + v_pay_amount
      WHERE id = v_account_id;
    END LOOP;
  END IF;

  -- Accounts receivable on customer master
  IF v_remaining > 0.0001 THEN
    SELECT balance INTO v_stock
    FROM customers
    WHERE id = v_customer_id
    FOR UPDATE;

    UPDATE customers
    SET balance = COALESCE(v_stock, 0) + v_remaining
    WHERE id = v_customer_id;
  END IF;

  RETURN jsonb_build_object(
    'sale_id', v_sale_id,
    'doc_no', v_doc_no,
    'items', v_item_ids
  );
END;
$function$;

-- Sales invoice event: the chosen lots of each line.
CREATE OR REPLACE FUNCTION public.process_sales_invoice_event(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_doc_date DATE;
  v_pay_date DATE;
  v_idempotency TEXT;
  v_cached JSONB;
  v_header JSONB;
  v_items JSONB;
  v_payments JSONB;
  v_decrement_stock BOOLEAN := true;
  v_customer_id UUID;
  v_customer_name TEXT;
  v_sale_id UUID;
  v_doc_no TEXT;
  v_total_amount NUMERIC;
  v_paid_amount NUMERIC;
  v_remaining NUMERIC;
  v_item JSONB;
  v_pay JSONB;
  v_product_id UUID;
  v_qty NUMERIC;
  v_stock NUMERIC;
  v_account_id UUID;
  v_pay_amount NUMERIC;
  v_pay_method TEXT;
  v_skip_stock BOOLEAN;
  v_polywood_mode TEXT;
  v_polywood_sale_mode TEXT;
  v_polywood_length_m NUMERIC;
  v_item_ids JSONB := '[]'::jsonb;
  v_item_id UUID;
  v_idx INT := 0;
  v_stock_demand JSONB := '{}'::jsonb;
  v_key TEXT;
  v_journal_id UUID;
  v_cogs_result JSONB;
  v_total_cogs NUMERIC := 0;
  v_cogs_journal_id UUID;
  v_event_id UUID;
  v_result JSONB;
  v_add_exp_total NUMERIC;
BEGIN
  IF p_payload IS NULL THEN
    RAISE EXCEPTION 'invalid_payload'
      USING ERRCODE = '22023',
            MESSAGE = 'Satış event payload göndərilməyib';
  END IF;

  v_idempotency := NULLIF(trim(p_payload->>'idempotency_key'), '');
  IF v_idempotency IS NOT NULL THEN
    v_cached := public.find_erp_event_by_idempotency(v_idempotency);
    IF v_cached IS NOT NULL THEN
      RETURN v_cached->'result';
    END IF;
  END IF;

  IF NOT (
    public.require_permission('can_edit_sales')
    OR public.require_permission('can_create_invoice')
    OR public.require_permission('can_manage_finance')
  ) THEN
    RAISE EXCEPTION 'forbidden'
      USING ERRCODE = '42501',
            MESSAGE = 'Satış yaratmaq üçün icazəniz yoxdur';
  END IF;

  v_header := COALESCE(p_payload->'header', '{}'::jsonb);
  v_items := COALESCE(p_payload->'items', '[]'::jsonb);
  v_payments := COALESCE(p_payload->'payments', '[]'::jsonb);

  IF jsonb_typeof(v_items) <> 'array' OR jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'items_required'
      USING ERRCODE = '22023',
            MESSAGE = 'Æn azı bir satış sətri tələb olunur';
  END IF;

  IF (p_payload ? 'decrement_stock') THEN
    v_decrement_stock := COALESCE((p_payload->>'decrement_stock')::boolean, true);
  END IF;

  v_customer_id := NULLIF(v_header->>'customer_id', '')::uuid;
  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'customer_required'
      USING ERRCODE = '22023',
            MESSAGE = 'Müştəri seçilməlidir';
  END IF;

  SELECT COALESCE(NULLIF(trim(full_name), ''), NULLIF(trim(name), ''), NULLIF(trim(company_name), ''), '')
  INTO v_customer_name
  FROM customers
  WHERE id = v_customer_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'customer_not_found'
      USING ERRCODE = 'P0002',
            MESSAGE = 'Müştəri tapılmadı';
  END IF;

  v_total_amount := COALESCE(NULLIF(v_header->>'total_amount', '')::numeric, 0);
  v_paid_amount := COALESCE(NULLIF(v_header->>'paid_amount', '')::numeric, 0);
  v_remaining := GREATEST(
    COALESCE(NULLIF(v_header->>'remaining_balance', '')::numeric, v_total_amount - v_paid_amount),
    0
  );

  IF v_total_amount <= 0 THEN
    RAISE EXCEPTION 'invalid_total_amount'
      USING ERRCODE = '22023',
            MESSAGE = 'Satış məbləği sıfırdan böyük olmalıdır';
  END IF;

  IF v_paid_amount > v_total_amount + 0.0001 THEN
    RAISE EXCEPTION 'overpaid'
      USING ERRCODE = '22023',
            MESSAGE = 'Ödənilən məbləğ ümumi məbləğdən böyük ola bilməz';
  END IF;

  IF v_decrement_stock THEN
    v_stock_demand := public.build_and_validate_sale_stock_demand(v_items);
  END IF;

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

  v_doc_no := NULLIF(trim(v_header->>'doc_no'), '');
  IF v_doc_no IS NULL THEN
    v_doc_no := 'SF-' || to_char(CURRENT_DATE, 'YYYY') || '-' || floor(10000 + random() * 90000)::int;
  END IF;

  INSERT INTO sales (
    doc_no, invoice_number, doc_date, customer_id, customer_name,
    seller_id, seller_name, warehouse_name, subtotal, discount_total, vat_total,
    total_amount, paid_amount, remaining_balance, delivery_address, delivery_type,
    delivery_fee, note, notes, payments, created_at
  )
  VALUES (
    v_doc_no,
    COALESCE(NULLIF(trim(v_header->>'invoice_number'), ''), v_doc_no),
    COALESCE(NULLIF(v_header->>'doc_date', '')::date, CURRENT_DATE),
    v_customer_id,
    COALESCE(NULLIF(trim(v_header->>'customer_name'), ''), v_customer_name),
    NULLIF(v_header->>'seller_id', '')::uuid,
    NULLIF(trim(v_header->>'seller_name'), ''),
    NULLIF(trim(v_header->>'warehouse_name'), ''),
    COALESCE(NULLIF(v_header->>'subtotal', '')::numeric, 0),
    COALESCE(NULLIF(v_header->>'discount_total', '')::numeric, 0),
    COALESCE(NULLIF(v_header->>'vat_total', '')::numeric, 0),
    v_total_amount,
    v_paid_amount,
    v_remaining,
    NULLIF(trim(v_header->>'delivery_address'), ''),
    COALESCE(NULLIF(trim(v_header->>'delivery_type'), ''), 'free'),
    COALESCE(NULLIF(v_header->>'delivery_fee', '')::numeric, 0),
    NULLIF(trim(v_header->>'note'), ''),
    NULLIF(trim(v_header->>'notes'), ''),
    COALESCE(v_header->'payments', v_payments, '[]'::jsonb),
    COALESCE(NULLIF(v_header->>'created_at', '')::timestamptz, NOW())
  )
  RETURNING id INTO v_sale_id;

  -- Every record of this posting carries the invoice date (fix F1).
  v_doc_date := COALESCE(NULLIF(v_header->>'doc_date', '')::date, CURRENT_DATE);
  PERFORM public.use_document_date(v_doc_date);

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_items)
  LOOP
    v_polywood_sale_mode := CASE
      WHEN v_item ? 'polywood_sale_mode'
      THEN NULLIF(trim(v_item->>'polywood_sale_mode'), '')
      ELSE NULL
    END;

    v_polywood_length_m := NULL;
    IF v_item ? 'polywood_length_m' THEN
      BEGIN
        v_polywood_length_m := NULLIF(trim(v_item->>'polywood_length_m'), '')::numeric;
      EXCEPTION
        WHEN OTHERS THEN
          v_polywood_length_m := NULL;
      END;
    END IF;

    INSERT INTO sale_items (
      sale_id, product_id, product_code, product_name, warehouse_id, warehouse_name,
      quantity, unit, unit_price, discount_percent, vat_rate, line_total, extra_info,
      polywood_sale_mode, polywood_length_m, lots
    )
    VALUES (
      v_sale_id,
      NULLIF(v_item->>'product_id', '')::uuid,
      NULLIF(trim(v_item->>'product_code'), ''),
      NULLIF(trim(v_item->>'product_name'), ''),
      NULLIF(v_item->>'warehouse_id', '')::uuid,
      NULLIF(trim(v_item->>'warehouse_name'), ''),
      COALESCE(NULLIF(v_item->>'quantity', '')::numeric, 0),
      COALESCE(NULLIF(trim(v_item->>'unit'), ''), 'Ædəd'),
      COALESCE(NULLIF(v_item->>'unit_price', '')::numeric, 0),
      COALESCE(NULLIF(v_item->>'discount_percent', '')::numeric, 0),
      COALESCE(NULLIF(v_item->>'vat_rate', '')::numeric, 0),
      COALESCE(NULLIF(v_item->>'line_total', '')::numeric, NULLIF(v_item->>'total', '')::numeric, 0),
      NULLIF(trim(v_item->>'extra_info'), ''),
      v_polywood_sale_mode,
      v_polywood_length_m,
      CASE WHEN jsonb_typeof(v_item->'lots') = 'array' AND jsonb_array_length(v_item->'lots') > 0 THEN v_item->'lots' END
    )
    RETURNING id INTO v_item_id;

    v_item_ids := v_item_ids || jsonb_build_array(
      jsonb_build_object(
        'index', v_idx,
        'id', v_item_id,
        'product_id', NULLIF(v_item->>'product_id', '')::uuid,
        'polywood_sale_mode', v_polywood_sale_mode
      )
    );
    v_idx := v_idx + 1;
  END LOOP;

  IF v_decrement_stock THEN
    PERFORM public.apply_sale_stock_decrement(v_stock_demand);

    v_cogs_result := public.process_sale_fifo_cogs(
      v_sale_id,
      v_doc_no,
      COALESCE(v_idempotency, 'sale_invoice:' || v_sale_id::text) || ':cogs'
    );
    v_total_cogs := COALESCE((v_cogs_result->>'total_cogs')::numeric, 0);
    v_cogs_journal_id := NULLIF(v_cogs_result->>'cogs_journal_entry_id', '')::uuid;
  END IF;

  IF jsonb_typeof(v_payments) = 'array' THEN
    FOR v_pay IN SELECT value FROM jsonb_array_elements(v_payments)
    LOOP
      v_pay_amount := COALESCE(NULLIF(v_pay->>'amount', '')::numeric, 0);
      IF v_pay_amount <= 0 THEN
        CONTINUE;
      END IF;

      v_account_id := NULLIF(v_pay->>'account_id', '')::uuid;
      v_pay_method := COALESCE(NULLIF(trim(v_pay->>'method'), ''), 'Ödəniş');
      v_pay_date := public.invoice_payment_date(v_pay, v_doc_date);
      PERFORM public.use_document_date(v_pay_date);

      PERFORM public.post_cash_transaction(
        v_account_id,
        'Mədaxil',
        v_pay_amount,
        'Satış Ödənişi',
        format('Satış fakturası %s — %s', v_doc_no, v_pay_method),
        NULL,
        'sale',
        v_sale_id
      );
      PERFORM public.use_document_date(v_doc_date);
    END LOOP;
  END IF;

  v_add_exp_total := public.apply_document_additional_expenses(
    COALESCE(p_payload->'additional_expenses', '[]'::jsonb),
    'sale',
    v_sale_id,
    v_doc_no
  );

  UPDATE sales
  SET additional_expenses = COALESCE(p_payload->'additional_expenses', '[]'::jsonb),
      additional_expenses_total = v_add_exp_total
  WHERE id = v_sale_id;

  v_journal_id := public.post_sale_invoice_gl_journal(
    v_sale_id,
    v_doc_no,
    v_total_amount,
    v_customer_id,
    v_idempotency
  );

  PERFORM public.refresh_customer_ar_balance(v_customer_id);

  PERFORM public.use_document_date(NULL);

  v_result := jsonb_build_object(
    'success', true,
    'event_type', 'sales_invoice',
    'sale_id', v_sale_id,
    'doc_no', v_doc_no,
    'items', v_item_ids,
    'journal_entry_id', v_journal_id,
    'cogs_journal_entry_id', v_cogs_journal_id,
    'total_cogs', v_total_cogs,
    'total_amount', v_total_amount,
    'paid_amount', v_paid_amount,
    'remaining_balance', v_remaining
  );

  v_event_id := public.log_erp_event(
    'sales_invoice',
    'sales',
    v_sale_id,
    p_payload,
    COALESCE(v_cogs_journal_id, v_journal_id),
    v_idempotency,
    v_result
  );

  v_result := v_result || jsonb_build_object('event_id', v_event_id);
  RETURN v_result;
END;
$function$;

-- Sales posting (trigger): lots checked first, then each line out in its lot context.
CREATE OR REPLACE FUNCTION public.handle_sales_posted_inventory()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_li JSONB;
  v_line_demand JSONB;
  v_lkey TEXT;
  v_lpid UUID;
  v_lchk RECORD;
  v_items JSONB := '[]'::jsonb;
  v_stock_demand JSONB := '{}'::jsonb;
  v_line RECORD;
BEGIN
  IF NEW.status IS DISTINCT FROM 'posted' THEN
    RETURN NEW;
  END IF;

  IF COALESCE(OLD.status, '') = 'posted' THEN
    RETURN NEW;
  END IF;

  IF OLD.inventory_deducted_at IS NOT NULL THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'product_id', si.product_id,
        'quantity', si.quantity,
        'warehouse_id', si.warehouse_id,
        'polywood_sale_mode', si.polywood_sale_mode,
        'polywood_length_m', si.polywood_length_m,
        'skip_stock', (si.polywood_sale_mode IS NOT NULL AND btrim(si.polywood_sale_mode) <> ''),
        -- LOT-3: the line and its chosen lots.
        'id', si.id,
        'lots', si.lots
      )
      ORDER BY si.id
    ),
    '[]'::jsonb
  )
  INTO v_items
  FROM public.sale_items si
  WHERE si.sale_id = NEW.id;

  IF jsonb_array_length(v_items) = 0 THEN
    RETURN NEW;
  END IF;

  v_stock_demand := public.build_and_validate_sale_stock_demand(v_items);

  -- LOT-3: the chosen lots of every line are checked before any stock moves.
  FOR v_lchk IN
    SELECT si.product_id, public._lot_wh(si.warehouse_id) AS wh, si.quantity, si.lots
    FROM public.sale_items si
    WHERE si.sale_id = NEW.id AND jsonb_typeof(si.lots) = 'array' AND jsonb_array_length(si.lots) > 0
      AND (si.polywood_sale_mode IS NULL OR btrim(si.polywood_sale_mode) = '')
  LOOP
    PERFORM public._lot_check_choice(v_lchk.product_id, v_lchk.wh, v_lchk.quantity, v_lchk.lots);
  END LOOP;
  -- LOT-3: each line out in its lot context (its chosen lots, else FEFO; a kit's components FEFO).
  -- The totals are the same as apply_sale_stock_decrement(v_stock_demand), line by line.
  FOR v_li IN SELECT value FROM jsonb_array_elements(v_items) LOOP
    CONTINUE WHEN COALESCE((v_li->>'skip_stock')::boolean, false);
    v_line_demand := public.build_and_validate_sale_stock_demand(jsonb_build_array(v_li));
    FOR v_lkey IN SELECT jsonb_object_keys(COALESCE(v_line_demand, '{}'::jsonb)) LOOP
      v_lpid := split_part(v_lkey, ':', 1)::uuid;
      PERFORM public.lot_ctx_begin(jsonb_build_object(
        'doc_type', 'sale', 'doc_id', NEW.id, 'doc_line_id', v_li->>'id', 'doc_no', NEW.doc_no, 'product_id', v_lpid,
        'counterparty_type', 'customer', 'counterparty_id', NEW.customer_id)
        || CASE WHEN v_lpid::text = v_li->>'product_id' AND jsonb_typeof(v_li->'lots') = 'array'
                THEN jsonb_build_object('lots', v_li->'lots') ELSE '{}'::jsonb END);
      PERFORM public.stock_move_key(v_lkey, -COALESCE((v_line_demand->>v_lkey)::numeric, 0), true);
      PERFORM public.lot_ctx_end();
    END LOOP;
  END LOOP;

  FOR v_line IN
    SELECT
      si.id,
      si.product_id,
      si.quantity,
      si.warehouse_id,
      si.unit,
      p.name AS product_name
    FROM public.sale_items si
    LEFT JOIN public.products p ON p.id = si.product_id
    WHERE si.sale_id = NEW.id
      AND si.product_id IS NOT NULL
      AND COALESCE(si.quantity, 0) > 0
      AND (si.polywood_sale_mode IS NULL OR btrim(si.polywood_sale_mode) = '')
      AND NOT COALESCE(p.is_service, false)
  LOOP
    INSERT INTO public.stock_movements (
      product_id,
      warehouse_id,
      movement_type,
      quantity,
      unit,
      reference_type,
      reference_id,
      source_line_id,
      description,
      created_by
    )
    VALUES (
      v_line.product_id,
      v_line.warehouse_id,
      'out',
      v_line.quantity,
      COALESCE(v_line.unit, 'Ədəd'),
      'sale',
      NEW.id,
      v_line.id,
      format('Satış fakturası %s — %s', COALESCE(NEW.doc_no, NEW.id::text), COALESCE(v_line.product_name, '')),
      auth.uid()
    );
  END LOOP;

  NEW.inventory_deducted_at := NOW();
  RETURN NEW;
END;
$function$;

-- Sales reversal (cancel / void / amend): back to the lots the sale took.
CREATE OR REPLACE FUNCTION public._reverse_sales_invoice_posting(
  p_sale_id uuid, p_label text, p_reason text, p_keep_cash boolean DEFAULT false
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
  v_demand   JSONB := '{}'::jsonb;
  v_key      TEXT;
  v_units    NUMERIC;
  v_cash     INTEGER := 0;
  v_journals INTEGER := 0;
BEGIN
  -- 1. Stock lines (not dimensional, not services): give the quantity back,
  --    exploding kits through their BOM exactly as posting did.
  FOR v_line IN
    SELECT si.id, si.product_id, si.quantity, si.warehouse_id, si.unit, p.name AS product_name
    FROM public.sale_items si
    JOIN public.products p ON p.id = si.product_id
    WHERE si.sale_id = p_sale_id
      AND COALESCE(si.quantity, 0) > 0
      AND NULLIF(btrim(si.polywood_sale_mode), '') IS NULL
      AND COALESCE(si.sale_item_type, 'standard') <> 'service'
      AND NOT COALESCE(p.is_service, false)
  LOOP
    -- Back into the line's warehouse (fix F3); kits through their components.
    v_demand := public._stock_demand_add(v_demand, v_line.product_id, v_line.warehouse_id, v_line.quantity);

    INSERT INTO public.stock_movements (
      product_id, warehouse_id, movement_type, quantity, unit,
      reference_type, reference_id, source_line_id, description, created_by
    )
    VALUES (
      v_line.product_id, v_line.warehouse_id, 'in', v_line.quantity,
      COALESCE(v_line.unit, 'Ədəd'), 'sale_void', p_sale_id, v_line.id,
      format('Ləğv: satış fakturası %s — %s', v_label, COALESCE(v_line.product_name, '')),
      auth.uid()
    );
  END LOOP;

  FOR v_key IN SELECT jsonb_object_keys(v_demand)
  LOOP
    -- LOT-3: back to the lots the sale took.
    PERFORM public.lot_ctx_begin(jsonb_build_object(
      'doc_type', 'sale', 'doc_id', p_sale_id, 'product_id', split_part(v_key, ':', 1), 'mode', 'reverse',
      'counterparty_type', 'customer', 'counterparty_id', (SELECT customer_id FROM public.sales WHERE id = p_sale_id),
      'reverse_of', jsonb_build_object('doc_type', 'sale', 'doc_id', p_sale_id)));
    PERFORM public.stock_move_key(v_key, (v_demand->>v_key)::numeric, false);
    PERFORM public.lot_ctx_end();
  END LOOP;

  -- 2. Dimensional (Polywood) lines: put the cut pieces back.
  FOR v_line IN
    SELECT si.*, COALESCE(p.full_sheet_length_m, p.base_length, 4) AS sheet_length_m
    FROM public.sale_items si
    JOIN public.products p ON p.id = si.product_id
    WHERE si.sale_id = p_sale_id
      AND NULLIF(btrim(si.polywood_sale_mode), '') IS NOT NULL
  LOOP
    IF v_line.polywood_cut_details IS NOT NULL THEN
      PERFORM public.rollback_mixed_dimensional_sale(v_line.id);
      IF v_line.warehouse_id IS NOT NULL THEN
        UPDATE public.products
        SET stock = (
          SELECT COALESCE(SUM(length_m), 0)
          FROM public.polywood_pieces
          WHERE product_id = v_line.product_id
            AND status = 'available'
        )
        WHERE id = v_line.product_id;
      END IF;
    ELSE
      -- Sold before piece tracking: restore the metres.
      v_units := CASE
        WHEN v_line.polywood_sale_mode = 'full_sheet'
          THEN COALESCE(v_line.quantity, 0) * v_line.sheet_length_m
        WHEN v_line.sale_item_type = 'dimensional'
          THEN COALESCE(v_line.polywood_length_m, v_line.quantity, 0) * GREATEST(COALESCE(v_line.piece_count, 1), 1)
        ELSE COALESCE(v_line.polywood_length_m, v_line.quantity, 0)
      END;
      IF v_units > 0 THEN
        UPDATE public.products SET stock = COALESCE(stock, 0) + v_units WHERE id = v_line.product_id;
      END IF;
    END IF;
  END LOOP;

  -- 3. FIFO: give consumed quantities back to their layers.
  UPDATE public.inventory_batches b
  SET remaining_qty = b.remaining_qty + c.qty
  FROM (
    SELECT batch_id, SUM(quantity) AS qty
    FROM public.inventory_batch_consumptions
    WHERE sale_id = p_sale_id AND batch_id IS NOT NULL
    GROUP BY batch_id
  ) c
  WHERE b.id = c.batch_id;

  DELETE FROM public.inventory_batch_consumptions WHERE sale_id = p_sale_id;
  UPDATE public.sale_items SET cogs_amount = 0 WHERE sale_id = p_sale_id;

  -- 4. Cash received for the invoice (and paid additional expenses).
  IF NOT p_keep_cash THEN
    v_cash := public.reverse_document_cash_transactions('sale', p_sale_id, v_label, v_reason);
  END IF;

  -- 5. Pending warehouse slips for the invoice are void with it.
  DELETE FROM public.warehouse_slips
  WHERE source_type = 'sale' AND source_document_id = p_sale_id;

  -- 6. Invoice and COGS journals.
  v_journals := public.reverse_document_journals(p_sale_id, v_reason);

  RETURN jsonb_build_object('cash_reversed', v_cash, 'journals_reversed', v_journals);
END;
$function$;

-- Restore a sale's stock: back to the lots the sale took.
CREATE OR REPLACE FUNCTION public.restore_sale_stock(p_sale_id uuid)
   RETURNS integer
   LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path TO 'public'
  AS $function$
  DECLARE
    v_item RECORD;
    v_demand JSONB := '{}'::jsonb;
    v_key TEXT;
    v_restored INT := 0;
  BEGIN
    FOR v_item IN
      SELECT product_id, quantity, warehouse_id, polywood_sale_mode
      FROM sale_items
      WHERE sale_id = p_sale_id
    LOOP
      IF v_item.product_id IS NULL OR COALESCE(v_item.quantity, 0) <= 0 THEN
        CONTINUE;
      END IF;
      IF NULLIF(trim(COALESCE(v_item.polywood_sale_mode, '')), '') IS NOT NULL THEN
        CONTINUE;
      END IF;
      v_demand := public._stock_demand_add(v_demand, v_item.product_id, v_item.warehouse_id, v_item.quantity);
      v_restored := v_restored + 1;
    END LOOP;

    FOR v_key IN SELECT jsonb_object_keys(v_demand) LOOP
    -- LOT-3: back to the lots the sale took.
      PERFORM public.lot_ctx_begin(jsonb_build_object(
        'doc_type', 'sale', 'doc_id', p_sale_id, 'product_id', split_part(v_key, ':', 1), 'mode', 'reverse',
        'counterparty_type', 'customer', 'counterparty_id', (SELECT customer_id FROM public.sales WHERE id = p_sale_id),
        'reverse_of', jsonb_build_object('doc_type', 'sale', 'doc_id', p_sale_id)));
      PERFORM public.stock_move_key(v_key, (v_demand->>v_key)::numeric, false);
      PERFORM public.lot_ctx_end();
    END LOOP;

    RETURN v_restored;
  END;
  $function$;

-- Polywood / mixed sale: the sale line's context.
CREATE OR REPLACE FUNCTION public.process_mixed_dimensional_sale(p_product_id uuid, p_warehouse_id uuid, p_item_type text, p_sale_mode text DEFAULT NULL::text, p_amount numeric DEFAULT 0, p_piece_count integer DEFAULT 1, p_sale_item_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_product RECORD;
  v_base_length NUMERIC;
  v_remaining NUMERIC;
  v_target INTEGER;
  v_piece RECORD;
  v_new_piece_id UUID;
  v_leftover NUMERIC;
  v_steps JSONB := '[]'::jsonb;
  v_scrap JSONB := '[]'::jsonb;
  v_i INTEGER;
BEGIN
  -- LOT-3: the sale line's context (Polywood pieces keep their lot; an accessory out FEFO).
  IF p_sale_item_id IS NOT NULL THEN
    PERFORM public.lot_ctx_begin((
      SELECT jsonb_build_object('doc_type', 'sale', 'doc_id', si.sale_id, 'doc_line_id', si.id, 'doc_no', s.doc_no,
                                'product_id', p_product_id, 'counterparty_type', 'customer', 'counterparty_id', s.customer_id)
      FROM public.sale_items si JOIN public.sales s ON s.id = si.sale_id WHERE si.id = p_sale_item_id));
  END IF;
  IF p_item_type IS NULL THEN
    RAISE EXCEPTION 'item_type is required';
  END IF;

  IF p_item_type = 'service' THEN
    PERFORM public.lot_ctx_end();
    RETURN jsonb_build_object('ok', true, 'item_type', 'service', 'steps', v_steps);
  END IF;

  IF p_product_id IS NULL THEN
    RAISE EXCEPTION 'product_id is required';
  END IF;

  SELECT * INTO v_product FROM products WHERE id = p_product_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product % not found', p_product_id;
  END IF;

  IF p_item_type = 'accessory' THEN
    IF p_amount IS NULL OR p_amount <= 0 THEN
      RAISE EXCEPTION 'Accessory quantity must be positive';
    END IF;
    IF COALESCE(v_product.stock, 0) < p_amount THEN
      RAISE EXCEPTION 'Insufficient stock for "%": have %, need %', v_product.name, v_product.stock, p_amount;
    END IF;
    -- Out of the line's warehouse (default when none is sent), fix F3.
    PERFORM public._stock_move_doc(p_product_id, p_warehouse_id, -p_amount, true);
    PERFORM public.lot_ctx_end();
    RETURN jsonb_build_object('ok', true, 'item_type', 'accessory', 'deducted', p_amount);
  END IF;

  IF p_item_type <> 'dimensional' THEN
    RAISE EXCEPTION 'Unknown item_type %', p_item_type;
  END IF;

  IF p_warehouse_id IS NULL THEN
    RAISE EXCEPTION 'warehouse_id is required for dimensional items';
  END IF;

  v_base_length := COALESCE(v_product.base_length, v_product.full_sheet_length_m, 4);

  IF p_sale_mode = 'full_sheet' THEN
    v_target := ROUND(COALESCE(p_amount, 0))::INTEGER;
    IF v_target <= 0 THEN
      RAISE EXCEPTION 'Full sheet quantity must be positive';
    END IF;

    FOR v_piece IN
      SELECT * FROM polywood_pieces
      WHERE product_id = p_product_id AND warehouse_id = p_warehouse_id
        AND status = 'available' AND piece_type = 'full'
        AND ABS(length_m - v_base_length) < 0.001
      ORDER BY created_at ASC
      LIMIT v_target
      FOR UPDATE
    LOOP
      UPDATE polywood_pieces
      SET status = 'sold', sale_item_id = p_sale_item_id, updated_at = NOW()
      WHERE id = v_piece.id;
      v_steps := v_steps || jsonb_build_object(
        'piece_id', v_piece.id, 'action', 'consume', 'used_length', v_base_length
      );
      v_target := v_target - 1;
    END LOOP;

    IF v_target > 0 THEN
      RAISE EXCEPTION 'Insufficient full sheets for "%": missing % sheet(s)', v_product.name, v_target;
    END IF;

  ELSIF p_sale_mode IN ('meter', 'linear_m') THEN
    IF p_amount IS NULL OR p_amount <= 0 THEN
      RAISE EXCEPTION 'Length must be positive';
    END IF;

    FOR v_i IN 1..GREATEST(COALESCE(p_piece_count, 1), 1) LOOP
      v_remaining := ROUND(p_amount, 3);

      -- 1) Exact-length piece first (prefer an off-cut over a full sheet).
      SELECT * INTO v_piece FROM polywood_pieces
      WHERE product_id = p_product_id AND warehouse_id = p_warehouse_id
        AND status = 'available' AND ABS(length_m - v_remaining) < 0.001
      ORDER BY (piece_type = 'cut') DESC, created_at ASC
      LIMIT 1
      FOR UPDATE;

      IF FOUND THEN
        UPDATE polywood_pieces
        SET status = 'sold', sale_item_id = p_sale_item_id, updated_at = NOW()
        WHERE id = v_piece.id;
        v_steps := v_steps || jsonb_build_object(
          'piece_id', v_piece.id, 'action', 'consume', 'used_length', v_remaining
        );
        CONTINUE;
      END IF;

      -- 2) Smallest larger off-cut, else smallest larger full sheet.
      SELECT * INTO v_piece FROM polywood_pieces
      WHERE product_id = p_product_id AND warehouse_id = p_warehouse_id
        AND status = 'available' AND piece_type = 'cut'
        AND length_m > v_remaining + 0.001
      ORDER BY length_m ASC
      LIMIT 1
      FOR UPDATE;

      IF NOT FOUND THEN
        SELECT * INTO v_piece FROM polywood_pieces
        WHERE product_id = p_product_id AND warehouse_id = p_warehouse_id
          AND status = 'available' AND piece_type = 'full'
          AND length_m > v_remaining + 0.001
        ORDER BY length_m ASC
        LIMIT 1
        FOR UPDATE;
      END IF;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Insufficient material for "%" (need %m more)', v_product.name, v_remaining;
      END IF;

      v_leftover := ROUND(v_piece.length_m - v_remaining, 3);

      IF v_piece.piece_type = 'full' THEN
        -- Full sheet is consumed as raw material; remnant becomes a new off-cut.
        UPDATE polywood_pieces
        SET status = 'consumed', sale_item_id = p_sale_item_id, updated_at = NOW()
        WHERE id = v_piece.id;
        v_steps := v_steps || jsonb_build_object(
          'piece_id', v_piece.id, 'action', 'split_full',
          'used_length', v_remaining, 'scrap_length', v_leftover
        );

        IF v_leftover > 0.001 THEN
          INSERT INTO polywood_pieces (product_id, warehouse_id, length_m, piece_type, status, notes)
          VALUES (
            p_product_id, p_warehouse_id, v_leftover, 'cut', 'available',
            'Auto remnant from sale item ' || COALESCE(p_sale_item_id::text, 'n/a')
          )
          RETURNING id INTO v_new_piece_id;
          v_scrap := v_scrap || jsonb_build_object('piece_id', v_new_piece_id, 'length_m', v_leftover);
        END IF;
      ELSE
        -- Off-cut: shrink the existing piece in place, no new row needed.
        UPDATE polywood_pieces
        SET length_m = v_leftover, updated_at = NOW()
        WHERE id = v_piece.id;
        v_steps := v_steps || jsonb_build_object(
          'piece_id', v_piece.id, 'action', 'partial',
          'used_length', v_remaining, 'remaining_on_piece', v_leftover
        );
      END IF;
    END LOOP;
  ELSE
    RAISE EXCEPTION 'Unknown sale_mode % for dimensional item', p_sale_mode;
  END IF;

  IF p_sale_item_id IS NOT NULL THEN
    UPDATE sale_items
    SET polywood_cut_details = jsonb_build_object('steps', v_steps, 'scrap_created', v_scrap)
    WHERE id = p_sale_item_id;
  END IF;

  -- Keep products.stock in sync as "total metres currently in stock" for dimensional items.
  UPDATE products
  SET stock = (
    SELECT COALESCE(SUM(length_m), 0)
    FROM polywood_pieces
    WHERE product_id = p_product_id AND warehouse_id = p_warehouse_id AND status = 'available'
  )
  WHERE id = p_product_id;

  PERFORM public.lot_ctx_end();

  RETURN jsonb_build_object('ok', true, 'item_type', 'dimensional', 'steps', v_steps, 'scrap_created', v_scrap);
END;
$function$;


-- ─── 4. Write-offs, production, consignment (module tables guarded) ─────────

-- Write-off: chosen lots checked first, each line out in its lot context.
DO $do$
BEGIN
  IF to_regclass('public.inventory_writeoffs') IS NOT NULL THEN
    EXECUTE $fn$
CREATE OR REPLACE FUNCTION public._inventory_writeoff_apply(p_id uuid, p_doc_no text, p_warehouse_id uuid, p_items jsonb)
   RETURNS void
   LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path TO 'public'
  AS $function$
  DECLARE
    v_lot_ctx JSONB;
    v_item JSONB;
    v_product UUID;
    v_qty NUMERIC;
    v_line UUID;
  BEGIN
    -- LOT-3: the chosen lots of every line are checked before any stock moves.
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
      IF NULLIF(v_item->>'product_id', '') IS NOT NULL AND jsonb_typeof(v_item->'lots') = 'array' AND jsonb_array_length(v_item->'lots') > 0 THEN
        PERFORM public._lot_check_choice((v_item->>'product_id')::uuid, p_warehouse_id, COALESCE(NULLIF(v_item->>'quantity', '')::numeric, 0), v_item->'lots');
      END IF;
    END LOOP;
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
      v_product := NULLIF(v_item->>'product_id', '')::uuid;
      v_qty := COALESCE(NULLIF(v_item->>'quantity', '')::numeric, 0);
      IF v_product IS NULL OR v_qty <= 0 THEN
        CONTINUE;
      END IF;
      v_line := CASE WHEN COALESCE(v_item->>'id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                     THEN (v_item->>'id')::uuid END;
      -- LOT-3: out of the chosen lots, else FEFO.
      v_lot_ctx := jsonb_build_object('doc_type', 'inventory_writeoff', 'doc_id', p_id, 'doc_line_id', v_line, 'doc_no', p_doc_no, 'product_id', v_product);
      IF jsonb_typeof(v_item->'lots') = 'array' AND jsonb_array_length(v_item->'lots') > 0 THEN
        v_lot_ctx := v_lot_ctx || jsonb_build_object('lots', v_item->'lots');
      END IF;
      PERFORM public.lot_ctx_begin(v_lot_ctx);
      PERFORM public.stock_move(v_product, p_warehouse_id, -v_qty, true);
      PERFORM public.lot_ctx_end();
      INSERT INTO public.stock_movements (
        product_id, warehouse_id, movement_type, quantity, unit,
        reference_type, reference_id, source_line_id, description, created_by
      ) VALUES (
        v_product, p_warehouse_id, 'out', v_qty, COALESCE(NULLIF(v_item->>'unit', ''), 'Ədəd'),
        'writeoff', p_id, v_line, 'Zədələnmiş mal — ' || COALESCE(p_doc_no, ''), auth.uid()
      );
    END LOOP;
  END;
  $function$
    $fn$;
  END IF;
END
$do$;

-- Write-off update: reverse to its lots, then re-apply.
DO $do$
BEGIN
  IF to_regclass('public.inventory_writeoffs') IS NOT NULL THEN
    EXECUTE $fn$
CREATE OR REPLACE FUNCTION public.update_inventory_writeoff(p_id uuid, p_payload jsonb)
   RETURNS jsonb
   LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path TO 'public'
  AS $function$
  DECLARE
    v_doc public.inventory_writeoffs%ROWTYPE;
    v_items JSONB;
    v_item JSONB;
    v_wh UUID;
  BEGIN
    IF NOT public.require_permission('can_writeoff_inventory') THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'Silinmə üçün icazəniz yoxdur';
    END IF;
    SELECT * INTO v_doc FROM public.inventory_writeoffs WHERE id = p_id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Silinmə sənədi tapılmadı';
    END IF;
    v_items := public._inventory_writeoff_lines(p_payload);
    v_wh := (p_payload->>'warehouse_id')::uuid;

    FOR v_item IN SELECT value FROM jsonb_array_elements(COALESCE(v_doc.items, '[]'::jsonb)) LOOP
      IF NULLIF(v_item->>'product_id', '') IS NOT NULL AND COALESCE(NULLIF(v_item->>'quantity', '')::numeric, 0) > 0 THEN
        -- LOT-3: back to the lots the write-off took (then the new lines go out again).
        PERFORM public.lot_ctx_begin(jsonb_build_object(
          'doc_type', 'inventory_writeoff', 'doc_id', p_id, 'doc_no', v_doc.document_number,
          'product_id', v_item->>'product_id', 'mode', 'reverse',
          'reverse_of', jsonb_build_object('doc_type', 'inventory_writeoff', 'doc_id', p_id,
            'doc_line_id', CASE WHEN COALESCE(v_item->>'id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN v_item->>'id' END)));
        PERFORM public.stock_move((v_item->>'product_id')::uuid, v_doc.warehouse_id, (v_item->>'quantity')::numeric, false);
        PERFORM public.lot_ctx_end();
      END IF;
    END LOOP;
    DELETE FROM public.stock_movements WHERE reference_type = 'writeoff' AND reference_id = p_id;

    UPDATE public.inventory_writeoffs
    SET writeoff_date = COALESCE(NULLIF(p_payload->>'writeoff_date', '')::date, writeoff_date),
        warehouse_id = v_wh,
        checker_name = COALESCE(trim(p_payload->>'checker_name'), checker_name),
        items = v_items,
        notes = NULLIF(trim(COALESCE(p_payload->>'notes', '')), '')
    WHERE id = p_id;

    PERFORM public._inventory_writeoff_apply(p_id, v_doc.document_number, v_wh, v_items);
    RETURN jsonb_build_object('success', true, 'id', p_id);
  END;
  $function$
    $fn$;
  END IF;
END
$do$;

-- Production material issue: each material out of its lots.
DO $do$
BEGIN
  IF to_regclass('public.production_orders') IS NOT NULL AND to_regclass('public.production_materials') IS NOT NULL THEN
    EXECUTE $fn$
CREATE OR REPLACE FUNCTION public.process_production_material_issue_event(p_order_id uuid, p_material_ids uuid[] DEFAULT NULL::uuid[], p_update_status boolean DEFAULT NULL::boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_mat_lots JSONB;
  v_idempotency TEXT;
  v_cached JSONB;
  v_order production_orders%ROWTYPE;
  v_material RECORD;
  v_product RECORD;
  v_issue_cost NUMERIC := 0;
  v_journal_id UUID;
  v_event_id UUID;
  v_result JSONB;
  v_update_status BOOLEAN;
  v_pending_count INT;
  v_issued_count INT := 0;
  v_payload JSONB;
  v_issued_ids UUID[] := '{}';
  v_slip_id UUID;
  v_wh UUID;
BEGIN
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'order_required'
      USING ERRCODE = '22023',
            MESSAGE = 'İstehsal sifarişi identifikatoru tələb olunur';
  END IF;

  v_update_status := COALESCE(
    p_update_status,
    p_material_ids IS NULL OR cardinality(p_material_ids) = 0
  );

  v_idempotency := CASE
    WHEN p_material_ids IS NOT NULL AND cardinality(p_material_ids) > 0 THEN
      'production_material_issue:' || p_order_id::text || ':' || md5(p_material_ids::text)
    ELSE
      'production_material_issue:' || p_order_id::text
  END;

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

  IF v_update_status AND v_order.status IS DISTINCT FROM 'Draft' AND v_order.status IS DISTINCT FROM 'In-Progress' THEN
    RAISE EXCEPTION 'invalid_status'
      USING ERRCODE = '22023',
            MESSAGE = 'Material verilməsi yalnız «Layihə» və ya «İstehsalda» statusundan mümkündür';
  END IF;

  FOR v_material IN
    SELECT pm.*, p.inventory_mode, p.name AS product_display_name
    FROM production_materials pm
    LEFT JOIN products p ON p.id = pm.product_id
    WHERE pm.production_order_id = p_order_id
      AND COALESCE(pm.issued, false) = false
      AND (
        p_material_ids IS NULL
        OR cardinality(p_material_ids) = 0
        OR pm.id = ANY(p_material_ids)
      )
    ORDER BY pm.created_at NULLS LAST, pm.id
  LOOP
    IF v_material.product_id IS NULL THEN
      UPDATE production_materials
      SET issued = true,
          issued_at = COALESCE(issued_at, NOW())
      WHERE id = v_material.id;
      v_issued_ids := array_append(v_issued_ids, v_material.id);
      v_issued_count := v_issued_count + 1;
      CONTINUE;
    END IF;

    SELECT id, stock, inventory_mode, name
    INTO v_product
    FROM products
    WHERE id = v_material.product_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'product_not_found'
        USING ERRCODE = 'P0002',
              MESSAGE = format('Material çıxışı: %s — məhsul tapılmadı', COALESCE(v_material.product_display_name, v_material.product_id::text));
    END IF;

    IF COALESCE(v_product.inventory_mode, 'standard') <> 'polywood' THEN
      -- Out of the material's own warehouse (fix F3): material line, then the order's
      -- raw-material warehouse, then the order warehouse, then the default warehouse.
      v_wh := COALESCE(v_material.warehouse_id, v_order.raw_material_warehouse_id, v_order.warehouse_id,
                       public.stock_default_warehouse());
      -- LOT-3: out of the material's chosen lots (production_materials.lots), else FEFO.
      SELECT pm.lots INTO v_mat_lots FROM public.production_materials pm WHERE pm.id = v_material.id;
      IF jsonb_typeof(v_mat_lots) = 'array' AND jsonb_array_length(v_mat_lots) > 0 THEN
        PERFORM public._lot_check_choice(v_material.product_id, v_wh, COALESCE(v_material.quantity, 0), v_mat_lots);
      ELSE
        v_mat_lots := NULL;
      END IF;
      PERFORM public.lot_ctx_begin(jsonb_build_object(
        'doc_type', 'production_order', 'doc_id', p_order_id, 'doc_line_id', v_material.id, 'doc_no', v_order.order_no,
        'product_id', v_material.product_id)
        || CASE WHEN v_mat_lots IS NOT NULL THEN jsonb_build_object('lots', v_mat_lots) ELSE '{}'::jsonb END);
      PERFORM public.stock_move(v_material.product_id, v_wh, -COALESCE(v_material.quantity, 0), true);
      PERFORM public.lot_ctx_end();

      INSERT INTO stock_movements (
        product_id,
        warehouse_id,
        movement_type,
        quantity,
        unit,
        reference_type,
        reference_id,
        source_line_id,
        description,
        created_by
      )
      VALUES (
        v_material.product_id,
        v_wh,
        'out',
        COALESCE(v_material.quantity, 0),
        COALESCE(v_material.unit, 'Ədəd'),
        'production',
        p_order_id,
        v_material.id,
        'İstehsalat üçün material',
        auth.uid()
      );
    END IF;

    v_issue_cost := v_issue_cost + public.production_material_line_cost(
      v_material.quantity,
      v_material.unit_cost,
      v_material.line_cost
    );

    UPDATE production_materials
    SET issued = true,
        issued_at = COALESCE(issued_at, NOW())
    WHERE id = v_material.id;

    UPDATE production_stock_reservations
    SET status = 'consumed',
        consumed_at = COALESCE(consumed_at, NOW())
    WHERE production_material_id = v_material.id;

    v_issued_ids := array_append(v_issued_ids, v_material.id);
    v_issued_count := v_issued_count + 1;
  END LOOP;

  IF v_issued_count = 0 THEN
    IF p_material_ids IS NOT NULL AND cardinality(p_material_ids) > 0 THEN
      RAISE EXCEPTION 'materials_not_found'
        USING ERRCODE = 'P0002',
              MESSAGE = 'Verilməmiş material tapılmadı';
    END IF;
    RAISE EXCEPTION 'materials_required'
      USING ERRCODE = '22023',
            MESSAGE = 'Material çıxışı: BOM material sətri tapılmadı';
  END IF;

  IF v_issue_cost > 0.0001 THEN
    v_journal_id := public.post_journal_entry(
      jsonb_build_object(
        'source_type', 'production_material_issue',
        'source_id', p_order_id,
        'idempotency_key', v_idempotency,
        'memo', format('Material verilməsi — %s', v_order.order_no),
        'lines', jsonb_build_array(
          jsonb_build_object(
            'coa_code', '1350',
            'debit', v_issue_cost,
            'credit', 0,
            'line_memo', 'WIP — ' || v_order.order_no
          ),
          jsonb_build_object(
            'coa_code', '1300',
            'debit', 0,
            'credit', v_issue_cost,
            'line_memo', 'Xammal — ' || v_order.order_no
          )
        )
      )
    );
  END IF;

  v_slip_id := public.production_record_material_issue_slip(p_order_id, v_issued_ids);

  SELECT COUNT(*) INTO v_pending_count
  FROM production_materials
  WHERE production_order_id = p_order_id
    AND COALESCE(issued, false) = false;

  IF v_pending_count = 0 OR v_update_status THEN
    UPDATE production_orders
    SET materials_allocated = true,
        status = CASE
          WHEN v_update_status AND v_order.status = 'Draft' THEN 'In-Progress'
          ELSE status
        END,
        updated_at = NOW()
    WHERE id = p_order_id;
  END IF;

  v_payload := jsonb_build_object(
    'order_id', p_order_id,
    'material_ids', COALESCE(to_jsonb(p_material_ids), '[]'::jsonb),
    'update_status', v_update_status
  );

  v_result := jsonb_build_object(
    'success', true,
    'event_type', 'production_material_issue',
    'order_id', p_order_id,
    'issued_count', v_issued_count,
    'issue_cost', v_issue_cost,
    'journal_entry_id', v_journal_id,
    'warehouse_slip_id', v_slip_id,
    'materials_allocated', true,
    'status', CASE WHEN v_update_status THEN 'In-Progress' ELSE v_order.status END
  );

  v_event_id := public.log_erp_event(
    'production_material_issue',
    'production_orders',
    p_order_id,
    v_payload,
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

-- Production material return: back to the issued lots.
DO $do$
BEGIN
  IF to_regclass('public.production_orders') IS NOT NULL AND to_regclass('public.production_materials') IS NOT NULL THEN
    EXECUTE $fn$
CREATE OR REPLACE FUNCTION public.return_production_material_stock(p_material_id uuid)
   RETURNS numeric
   LANGUAGE plpgsql
   SECURITY DEFINER
   SET search_path TO 'public'
  AS $function$
  DECLARE
    v_ret NUMERIC;
    v_m RECORD;
    v_wh UUID;
  BEGIN
    IF auth.uid() IS NOT NULL AND NOT public.user_has_permission('can_manage_production') THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'İcazəniz yoxdur';
    END IF;
    SELECT pm.*, o.raw_material_warehouse_id, o.warehouse_id AS order_warehouse_id, o.order_no, p.inventory_mode
    INTO v_m
    FROM public.production_materials pm
    JOIN public.production_orders o ON o.id = pm.production_order_id
    LEFT JOIN public.products p ON p.id = pm.product_id
    WHERE pm.id = p_material_id;
    IF NOT FOUND OR v_m.product_id IS NULL OR NOT COALESCE(v_m.issued, false)
       OR v_m.inventory_mode = 'polywood' OR COALESCE(v_m.quantity, 0) <= 0 THEN
      RETURN NULL;
    END IF;
    v_wh := COALESCE(v_m.warehouse_id, v_m.raw_material_warehouse_id, v_m.order_warehouse_id);
    INSERT INTO public.stock_movements (
      product_id, warehouse_id, movement_type, quantity, unit,
      reference_type, reference_id, source_line_id, description, created_by
    ) VALUES (
      v_m.product_id, COALESCE(v_wh, public.stock_default_warehouse()), 'in', v_m.quantity, COALESCE(v_m.unit, 'Ədəd'),
      'production', v_m.production_order_id, v_m.id, 'İstehsalat materialı geri qaytarıldı — ' || COALESCE(v_m.order_no, ''), auth.uid()
    );
    -- LOT-3: back to the lots the issue took.
    PERFORM public.lot_ctx_begin(jsonb_build_object(
      'doc_type', 'production_order', 'doc_id', v_m.production_order_id, 'doc_line_id', v_m.id, 'doc_no', v_m.order_no,
      'product_id', v_m.product_id, 'mode', 'reverse',
      'reverse_of', jsonb_build_object('doc_type', 'production_order', 'doc_id', v_m.production_order_id, 'doc_line_id', v_m.id)));
    v_ret := public.stock_move(v_m.product_id, v_wh, v_m.quantity, false);
    PERFORM public.lot_ctx_end();
    RETURN v_ret;
  END;
  $function$
    $fn$;
  END IF;
END
$do$;

-- Production delivery: finished goods out to the customer in a lot context.
DO $do$
BEGIN
  IF to_regclass('public.production_orders') IS NOT NULL THEN
    EXECUTE $fn$
CREATE OR REPLACE FUNCTION public.process_production_delivery_event(p_order_id uuid, p_account_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_idempotency TEXT;
  v_cached JSONB;
  v_order production_orders%ROWTYPE;
  v_existing_sale_id UUID;
  v_sale_id UUID;
  v_product_id UUID;
  v_product_code TEXT;
  v_product_name TEXT;
  v_product_unit TEXT;
  v_sell_price NUMERIC;
  v_qty NUMERIC;
  v_project_price NUMERIC;
  v_install_fee NUMERIC;
  v_subtotal NUMERIC;
  v_advance NUMERIC;
  v_remaining NUMERIC;
  v_doc_no TEXT;
  v_material_cost NUMERIC := 0;
  v_outsource_cost NUMERIC := 0;
  v_expense_cost NUMERIC := 0;
  v_contractor_cost NUMERIC := 0;
  v_total_cost NUMERIC := 0;
  v_unit_cogs NUMERIC := 0;
  v_unit_sell NUMERIC := 0;
  v_stock NUMERIC := 0;
  v_payments JSONB := '[]'::jsonb;
  v_create_sale BOOLEAN := false;
  v_revenue_journal_id UUID;
  v_cogs_journal_id UUID;
  v_tx_id UUID;
  v_event_id UUID;
  v_result JSONB;
  v_payload JSONB;
BEGIN
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'order_required'
      USING ERRCODE = '22023',
            MESSAGE = 'İstehsal sifarişi identifikatoru tələb olunur';
  END IF;

  v_idempotency := 'production_delivery:' || p_order_id::text;
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

  IF v_order.sale_id IS NOT NULL AND v_order.status = 'Delivered' THEN
    SELECT doc_no INTO v_doc_no FROM sales WHERE id = v_order.sale_id;
    RETURN jsonb_build_object(
      'success', true,
      'event_type', 'production_delivery',
      'order_id', p_order_id,
      'order_type', v_order.type,
      'sale_id', v_order.sale_id,
      'doc_no', COALESCE(v_doc_no, v_order.order_no),
      'product_id', v_order.finished_product_id,
      'already_completed', true,
      'invoice_created', true
    );
  END IF;

  SELECT id INTO v_existing_sale_id
  FROM sales
  WHERE production_order_id = p_order_id
  LIMIT 1;

  IF v_existing_sale_id IS NOT NULL THEN
    RAISE EXCEPTION 'duplicate_sale_orphan'
      USING ERRCODE = '23505',
            MESSAGE = 'Bu sifariş üçün satış fakturası artıq mövcuddur, lakin sifariş bağlanmayıb. Administratorla əlaqə saxlayın.';
  END IF;

  IF v_order.status IS DISTINCT FROM 'Ready' THEN
    RAISE EXCEPTION 'order_not_ready'
      USING ERRCODE = '22023',
            MESSAGE = 'Təhvil yalnız «Hazır» statusundan verilə bilər';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM production_materials
    WHERE production_order_id = p_order_id
      AND COALESCE(issued, false) = false
  ) THEN
    RAISE EXCEPTION 'materials_pending'
      USING ERRCODE = '22023',
            MESSAGE = 'Bütün material sətirləri verilməlidir';
  END IF;

  v_qty := GREATEST(COALESCE(v_order.quantity, 1), 1);

  IF v_order.type = 'Series' THEN
    IF NOT COALESCE(v_order.finished_goods_posted, false) THEN
      RAISE EXCEPTION 'finished_goods_not_posted'
        USING ERRCODE = '22023',
              MESSAGE = 'Hazır məhsul anbara yazılmayıb. Ævvəlcə «Hazır» statusuna keçin.';
    END IF;

    IF v_order.finished_product_id IS NULL THEN
      RAISE EXCEPTION 'finished_product_required'
        USING ERRCODE = '22023',
              MESSAGE = 'Seriya sifarişi üçün hazır məhsul təyin edilməyib';
    END IF;

    v_product_id := v_order.finished_product_id;
    v_create_sale := v_order.customer_id IS NOT NULL;

    SELECT code, name, unit, COALESCE(sell_price, 0)
    INTO v_product_code, v_product_name, v_product_unit, v_sell_price
    FROM products
    WHERE id = v_product_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'finished_product_not_found'
        USING ERRCODE = 'P0002',
              MESSAGE = 'Hazır məhsul tapılmadı';
    END IF;

    SELECT stock INTO v_stock FROM products WHERE id = v_product_id FOR UPDATE;
    IF COALESCE(v_stock, 0) + 0.0001 < v_qty THEN
      RAISE EXCEPTION 'insufficient_finished_stock'
        USING ERRCODE = '22023',
              MESSAGE = format(
                'Hazır məhsul stok kifayət etmir (mövcud: %s, tələb: %s)',
                COALESCE(v_stock, 0),
                v_qty
              );
    END IF;

    v_total_cost := public.compute_production_wip_cost(p_order_id);

    IF v_create_sale THEN
      IF v_order.customer_id IS NULL THEN
        RAISE EXCEPTION 'customer_required'
          USING ERRCODE = '22023',
                MESSAGE = 'Təhvil üçün müştəri seçilməlidir';
      END IF;

      v_project_price := COALESCE(NULLIF(v_order.total_project_price, 0), v_sell_price * v_qty);
      IF v_project_price <= 0 THEN
        RAISE EXCEPTION 'invalid_total_price'
          USING ERRCODE = '22023',
                MESSAGE = 'Satış qiyməti sıfırdan böyük olmalıdır';
      END IF;

      v_install_fee := COALESCE(v_order.installation_fee, 0);
      v_subtotal := v_project_price + v_install_fee;
      v_advance := GREATEST(COALESCE(v_order.advance_payment, 0), 0);
      v_remaining := GREATEST(v_subtotal - v_advance, 0);

      IF v_advance > 0.0001 AND p_account_id IS NULL THEN
        RAISE EXCEPTION 'advance_account_required'
          USING ERRCODE = '22023',
                MESSAGE = 'Avans ödənişi üçün kassa/bank hesabı seçilməlidir';
      END IF;

      IF v_advance > 0.0001 THEN
        v_payments := jsonb_build_array(
          jsonb_build_object(
            'id', gen_random_uuid()::text,
            'method', 'Avans',
            'amount', v_advance,
            'account_id', p_account_id
          )
        );
      END IF;

      v_doc_no := 'SF-' || to_char(CURRENT_DATE, 'YYYY') || '-' || floor(10000 + random() * 90000)::int;

      INSERT INTO sales (
        doc_no, invoice_number, doc_date, customer_id, customer_name,
        seller_id, seller_name, warehouse_name, subtotal, discount_total, vat_total,
        total_amount, paid_amount, remaining_balance, delivery_type, delivery_fee,
        note, notes, production_order_id, payments
      )
      VALUES (
        v_doc_no, v_doc_no, CURRENT_DATE, v_order.customer_id, v_order.customer_name,
        auth.uid(), NULL, v_order.warehouse_name, v_subtotal, 0, 0,
        v_subtotal, v_advance, v_remaining,
        CASE WHEN v_install_fee > 0 THEN 'paid' ELSE 'free' END,
        v_install_fee,
        'Seriya istehsal təhvil: ' || v_order.order_no,
        COALESCE(v_order.notes, v_order.project_scope),
        p_order_id, v_payments
      )
      RETURNING id INTO v_sale_id;

      INSERT INTO sale_items (
        sale_id, product_id, product_code, product_name,
        warehouse_id, warehouse_name, quantity, unit,
        unit_price, discount_percent, vat_rate, line_total, extra_info
      )
      VALUES (
        v_sale_id, v_product_id, v_product_code, v_product_name,
        v_order.warehouse_id, v_order.warehouse_name, v_qty,
        COALESCE(v_product_unit, 'Ædəd'),
        CASE WHEN v_qty > 0 THEN ROUND(v_project_price / v_qty, 2) ELSE v_project_price END,
        0, 0, v_project_price,
        'Seriya istehsal — ' || v_order.order_no
      );

      IF v_install_fee > 0.0001 THEN
        INSERT INTO sale_items (
          sale_id, product_id, product_code, product_name,
          warehouse_id, warehouse_name, quantity, unit,
          unit_price, discount_percent, vat_rate, line_total, extra_info
        )
        VALUES (
          v_sale_id, NULL, NULL, 'Quraşdırma və çatdırılma',
          NULL, v_order.warehouse_name, 1, 'Xidmət',
          v_install_fee, 0, 0, v_install_fee, v_order.order_no
        );
      END IF;

      v_revenue_journal_id := public.post_journal_entry(
        jsonb_build_object(
          'source_type', 'production_delivery_revenue',
          'source_id', v_sale_id,
          'idempotency_key', v_idempotency || ':revenue',
          'memo', format('Seriya satış gəliri — %s', v_doc_no),
          'lines', jsonb_build_array(
            jsonb_build_object(
              'coa_code', '1200',
              'debit', v_subtotal,
              'credit', 0,
              'partner_type', 'partner',
              'partner_id', public._partner_ledger_partner(v_order.customer_id, NULL),
              'line_memo', 'AR — ' || v_doc_no
            ),
            jsonb_build_object(
              'coa_code', '4100',
              'debit', 0,
              'credit', v_subtotal,
              'line_memo', 'Gəlir — ' || v_doc_no
            )
          )
        )
      );

      IF v_advance > 0.0001 THEN
        IF v_order.advance_transaction_id IS NOT NULL THEN
          v_tx_id := v_order.advance_transaction_id;
        ELSE
          v_tx_id := public.post_cash_transaction(
            p_account_id,
            'Mədaxil',
            v_advance,
            'Satış Ödənişi',
            format('Seriya istehsal avansı — %s (%s)', v_doc_no, v_order.order_no),
            p_order_id,
            'production',
            p_order_id
          );
        END IF;
      END IF;

      PERFORM public.refresh_customer_ar_balance(v_order.customer_id);
    END IF;

    -- Out of the warehouse the finished goods went into (fix F3).
    -- LOT-3: delivered to the customer (FEFO: the order's production lot first in practice).
    PERFORM public.lot_ctx_begin(jsonb_build_object(
      'doc_type', 'production_delivery', 'doc_id', p_order_id, 'doc_no', v_order.order_no, 'product_id', v_product_id, 'counterparty_type', 'customer', 'counterparty_id', v_order.customer_id));
    PERFORM public.stock_move(v_product_id, COALESCE(v_order.furniture_warehouse_id, v_order.warehouse_id), -v_qty, true);
    PERFORM public.lot_ctx_end();

    IF v_total_cost > 0.0001 THEN
      v_cogs_journal_id := public.post_journal_entry(
        jsonb_build_object(
          'source_type', 'production_delivery_cogs',
          'source_id', p_order_id,
          'idempotency_key', v_idempotency || ':cogs',
          'memo', format('Seriya COGS — %s', v_order.order_no),
          'lines', jsonb_build_array(
            jsonb_build_object(
              'coa_code', '5100',
              'debit', v_total_cost,
              'credit', 0,
              'line_memo', 'COGS — ' || v_order.order_no
            ),
            jsonb_build_object(
              'coa_code', '1300',
              'debit', 0,
              'credit', v_total_cost,
              'line_memo', 'Inventar — ' || v_order.order_no
            )
          )
        )
      );
    END IF;

    UPDATE production_orders
    SET sale_id = COALESCE(v_sale_id, sale_id),
        delivered_at = NOW(),
        status = 'Delivered',
        updated_at = NOW()
    WHERE id = p_order_id;

    v_result := jsonb_build_object(
      'success', true,
      'event_type', 'production_delivery',
      'order_type', 'Series',
      'order_id', p_order_id,
      'sale_id', v_sale_id,
      'doc_no', COALESCE(v_doc_no, v_order.order_no),
      'product_id', v_product_id,
      'invoice_created', v_create_sale,
      'revenue_journal_entry_id', v_revenue_journal_id,
      'cogs_journal_entry_id', v_cogs_journal_id,
      'transaction_id', v_tx_id,
      'already_completed', false
    );

  ELSIF v_order.type = 'Custom' THEN
    IF v_order.customer_id IS NULL THEN
      RAISE EXCEPTION 'customer_required'
        USING ERRCODE = '22023',
              MESSAGE = 'Təhvil üçün müştəri seçilməlidir';
    END IF;

    v_project_price := COALESCE(v_order.total_project_price, 0);
    IF v_project_price <= 0 THEN
      RAISE EXCEPTION 'invalid_total_price'
        USING ERRCODE = '22023',
              MESSAGE = 'Layihə qiyməti sıfırdan böyük olmalıdır';
    END IF;

    v_install_fee := COALESCE(v_order.installation_fee, 0);
    v_subtotal := v_project_price + v_install_fee;
    v_advance := GREATEST(COALESCE(v_order.advance_payment, 0), 0);
    v_remaining := GREATEST(v_subtotal - v_advance, 0);

    IF v_advance > 0.0001 AND p_account_id IS NULL THEN
      RAISE EXCEPTION 'advance_account_required'
        USING ERRCODE = '22023',
              MESSAGE = 'Avans ödənişi üçün kassa/bank hesabı seçilməlidir';
    END IF;

    IF v_advance > 0.0001 THEN
      PERFORM id FROM accounts WHERE id = p_account_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'account_not_found'
          USING ERRCODE = 'P0002',
                MESSAGE = 'Seçilmiş kassa/bank hesabı tapılmadı';
      END IF;

      v_payments := jsonb_build_array(
        jsonb_build_object(
          'id', gen_random_uuid()::text,
          'method', 'Avans',
          'amount', v_advance,
          'account_id', p_account_id
        )
      );
    END IF;

    v_total_cost := public.compute_production_wip_cost(p_order_id);
    v_unit_cogs := CASE WHEN v_qty > 0 THEN ROUND(v_total_cost / v_qty, 2) ELSE 0 END;
    v_unit_sell := CASE WHEN v_qty > 0 THEN ROUND(v_subtotal / v_qty, 2) ELSE v_subtotal END;

    IF v_order.finished_product_id IS NOT NULL THEN
      v_product_id := v_order.finished_product_id;
      SELECT code, name, unit
      INTO v_product_code, v_product_name, v_product_unit
      FROM products
      WHERE id = v_product_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'finished_product_not_found'
          USING ERRCODE = 'P0002',
                MESSAGE = 'Hazır məhsul tapılmadı';
      END IF;
    ELSE
      v_product_code := 'MTO-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
      v_product_name := COALESCE(NULLIF(btrim(v_order.project_name), ''), v_order.order_no);
      v_product_unit := 'Ædəd';

      INSERT INTO products (
        code, name, category, subcategory, unit,
        buy_price, sell_price, stock, min_stock, extra_info
      )
      VALUES (
        v_product_code, v_product_name, 'Fərdi istehsal', 'Make-to-Order', v_product_unit,
        v_unit_cogs, v_unit_sell, 0, 0,
        'Production order ' || v_order.order_no
      )
      RETURNING id INTO v_product_id;
    END IF;

    SELECT stock INTO v_stock FROM products WHERE id = v_product_id FOR UPDATE;
    -- Make-to-order: in and out on the same warehouse (fix F3).
    -- LOT-3: in on a production lot of the order.
    PERFORM public.lot_ctx_begin(jsonb_build_object(
      'doc_type', 'production_order', 'doc_id', p_order_id, 'doc_no', v_order.order_no, 'product_id', v_product_id, 'new_lot', jsonb_build_object('origin_type', 'production')));
    PERFORM public.stock_move(v_product_id, COALESCE(v_order.furniture_warehouse_id, v_order.warehouse_id), v_qty, false);
    PERFORM public.lot_ctx_end();

    v_doc_no := 'SF-' || to_char(CURRENT_DATE, 'YYYY') || '-' || floor(10000 + random() * 90000)::int;

    INSERT INTO sales (
      doc_no, invoice_number, doc_date, customer_id, customer_name,
      seller_id, seller_name, warehouse_name, subtotal, discount_total, vat_total,
      total_amount, paid_amount, remaining_balance, delivery_type, delivery_fee,
      note, notes, production_order_id, payments
    )
    VALUES (
      v_doc_no, v_doc_no, CURRENT_DATE, v_order.customer_id, v_order.customer_name,
      auth.uid(), NULL, v_order.warehouse_name, v_subtotal, 0, 0,
      v_subtotal, v_advance, v_remaining,
      CASE WHEN v_install_fee > 0 THEN 'paid' ELSE 'free' END,
      v_install_fee,
      'Fərdi istehsal təhvil: ' || v_order.order_no,
      COALESCE(v_order.project_scope, v_order.notes),
      p_order_id, v_payments
    )
    RETURNING id INTO v_sale_id;

    INSERT INTO sale_items (
      sale_id, product_id, product_code, product_name,
      warehouse_id, warehouse_name, quantity, unit,
      unit_price, discount_percent, vat_rate, line_total, extra_info
    )
    VALUES (
      v_sale_id, v_product_id, v_product_code, v_product_name,
      v_order.warehouse_id, v_order.warehouse_name, v_qty,
      COALESCE(v_product_unit, 'Ædəd'),
      CASE WHEN v_qty > 0 THEN ROUND(v_project_price / v_qty, 2) ELSE v_project_price END,
      0, 0, v_project_price,
      'COGS ref: ' || v_order.order_no
    );

    IF v_install_fee > 0.0001 THEN
      INSERT INTO sale_items (
        sale_id, product_id, product_code, product_name,
        warehouse_id, warehouse_name, quantity, unit,
        unit_price, discount_percent, vat_rate, line_total, extra_info
      )
      VALUES (
        v_sale_id, NULL, NULL, 'Quraşdırma və çatdırılma',
        NULL, v_order.warehouse_name, 1, 'Xidmət',
        v_install_fee, 0, 0, v_install_fee, v_order.order_no
      );
    END IF;

    SELECT stock INTO v_stock FROM products WHERE id = v_product_id FOR UPDATE;
    IF COALESCE(v_stock, 0) + 0.0001 < v_qty THEN
      RAISE EXCEPTION 'insufficient_finished_stock'
        USING ERRCODE = '22023',
              MESSAGE = 'Hazır məhsul stok çıxışı mümkün deyil';
    END IF;

    PERFORM public.lot_ctx_begin(jsonb_build_object(
      'doc_type', 'production_delivery', 'doc_id', p_order_id, 'doc_no', v_order.order_no, 'product_id', v_product_id, 'counterparty_type', 'customer', 'counterparty_id', v_order.customer_id));
    PERFORM public.stock_move(v_product_id, COALESCE(v_order.furniture_warehouse_id, v_order.warehouse_id), -v_qty, true);
    PERFORM public.lot_ctx_end();

    v_revenue_journal_id := public.post_journal_entry(
      jsonb_build_object(
        'source_type', 'production_delivery_revenue',
        'source_id', v_sale_id,
        'idempotency_key', v_idempotency || ':revenue',
        'memo', format('Fərdi satış gəliri — %s', v_doc_no),
        'lines', jsonb_build_array(
          jsonb_build_object(
            'coa_code', '1200',
            'debit', v_subtotal,
            'credit', 0,
            'partner_type', 'partner',
            'partner_id', public._partner_ledger_partner(v_order.customer_id, NULL),
            'line_memo', 'AR — ' || v_doc_no
          ),
          jsonb_build_object(
            'coa_code', '4100',
            'debit', 0,
            'credit', v_subtotal,
            'line_memo', 'Gəlir — ' || v_doc_no
          )
        )
      )
    );

    IF v_total_cost > 0.0001 THEN
      v_cogs_journal_id := public.post_journal_entry(
        jsonb_build_object(
          'source_type', 'production_delivery_cogs',
          'source_id', p_order_id,
          'idempotency_key', v_idempotency || ':cogs',
          'memo', format('Fərdi COGS — %s', v_order.order_no),
          'lines', jsonb_build_array(
            jsonb_build_object(
              'coa_code', '5100',
              'debit', v_total_cost,
              'credit', 0,
              'line_memo', 'COGS — ' || v_order.order_no
            ),
            jsonb_build_object(
              'coa_code', '1350',
              'debit', 0,
              'credit', v_total_cost,
              'line_memo', 'WIP — ' || v_order.order_no
            )
          )
        )
      );
    END IF;

    IF v_advance > 0.0001 THEN
      IF v_order.advance_transaction_id IS NOT NULL THEN
        v_tx_id := v_order.advance_transaction_id;
      ELSE
        v_tx_id := public.post_cash_transaction(
          p_account_id,
          'Mədaxil',
          v_advance,
          'Satış Ödənişi',
          format('Fərdi istehsal avansı — %s (%s)', v_doc_no, v_order.order_no),
          p_order_id,
          'production',
          p_order_id
        );
      END IF;
    END IF;

    PERFORM public.refresh_customer_ar_balance(v_order.customer_id);

    UPDATE production_orders
    SET finished_product_id = v_product_id,
        finished_product_name = v_product_name,
        sale_id = v_sale_id,
        delivered_at = NOW(),
        finished_goods_posted = true,
        status = 'Delivered',
        updated_at = NOW()
    WHERE id = p_order_id;

    v_result := jsonb_build_object(
      'success', true,
      'event_type', 'production_delivery',
      'order_type', 'Custom',
      'order_id', p_order_id,
      'sale_id', v_sale_id,
      'doc_no', v_doc_no,
      'product_id', v_product_id,
      'invoice_created', true,
      'revenue_journal_entry_id', v_revenue_journal_id,
      'cogs_journal_entry_id', v_cogs_journal_id,
      'transaction_id', v_tx_id,
      'already_completed', false
    );
  ELSE
    RAISE EXCEPTION 'invalid_order_type'
      USING ERRCODE = '22023',
            MESSAGE = 'Naməlum istehsal sifarişi tipi';
  END IF;

  v_payload := jsonb_build_object(
    'order_id', p_order_id,
    'account_id', p_account_id
  );

  v_event_id := public.log_erp_event(
    'production_delivery',
    'production_orders',
    p_order_id,
    v_payload,
    COALESCE(v_revenue_journal_id, v_cogs_journal_id),
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

-- Consignment dispatch: out to the partner from the chosen lots.
DO $do$
BEGIN
  IF to_regclass('public.consignment_dispatches') IS NOT NULL AND to_regclass('public.consignment_partners') IS NOT NULL AND to_regclass('public.consignment_inventory') IS NOT NULL AND to_regclass('public.consignment_monthly_reports') IS NOT NULL THEN
    EXECUTE $fn$
CREATE OR REPLACE FUNCTION public.create_consignment_dispatch_atomic(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_partner_id UUID := NULLIF(p_payload->>'partner_id', '')::uuid;
  v_warehouse_id UUID := NULLIF(p_payload->>'warehouse_id', '')::uuid;
  v_warehouse_name TEXT := NULLIF(p_payload->>'warehouse_name', '');
  v_dispatch_date DATE := COALESCE(NULLIF(p_payload->>'dispatch_date', '')::date, CURRENT_DATE);
  v_notes TEXT := NULLIF(btrim(p_payload->>'notes'), '');
  v_sales_rep_id UUID := NULLIF(p_payload->>'sales_rep_id', '')::uuid;
  v_sales_rep_name TEXT := NULLIF(p_payload->>'sales_rep_name', '');
  v_dispatch_no TEXT := NULLIF(btrim(p_payload->>'dispatch_no'), '');
  v_items JSONB := COALESCE(p_payload->'items', '[]'::jsonb);
  v_item JSONB;
  v_product_id UUID;
  v_quantity NUMERIC;
  v_unit_price NUMERIC;
  v_available NUMERIC;
  v_product_name TEXT;
  v_dispatch_id UUID;
  v_now TIMESTAMPTZ := NOW();
  v_inv_id UUID;
  v_delivered NUMERIC;
  v_sold NUMERIC;
  v_returned NUMERIC;
  v_partner_name TEXT;
  v_result JSONB;
  v_created_by UUID := NULLIF(p_payload->>'created_by', '')::uuid;
BEGIN
  -- Permission is checked in JS (requirePermissionAction) before this RPC is
  -- called via the service-role admin client, which has no auth.uid() /
  -- session context - same convention as create_product_with_bom_atomic and
  -- set_customer_opening_balance_atomic.

  IF v_partner_id IS NULL THEN
    RAISE EXCEPTION 'partner_required' USING ERRCODE = '22023', MESSAGE = 'Tərəfdaş seçin';
  END IF;
  IF v_warehouse_id IS NULL THEN
    RAISE EXCEPTION 'warehouse_required' USING ERRCODE = '22023', MESSAGE = 'Anbar seçin';
  END IF;
  IF jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'items_required' USING ERRCODE = '22023', MESSAGE = 'Ən azı bir məhsul əlavə edin';
  END IF;

  -- Validate every line against live per-warehouse stock before touching anything.
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_items)
  LOOP
    v_product_id := NULLIF(v_item->>'product_id', '')::uuid;
    v_quantity := COALESCE((v_item->>'quantity')::numeric, 0);
    IF v_product_id IS NULL OR v_quantity <= 0 THEN
      RAISE EXCEPTION 'invalid_item' USING ERRCODE = '22023', MESSAGE = 'Sətirdə məhsul və ya miqdar yanlışdır';
    END IF;

    SELECT current_stock INTO v_available
    FROM public.warehouse_stocks
    WHERE product_id = v_product_id AND warehouse_id = v_warehouse_id
    FOR UPDATE;

    SELECT name INTO v_product_name FROM public.products WHERE id = v_product_id;
    IF v_product_name IS NULL THEN
      RAISE EXCEPTION 'product_not_found' USING ERRCODE = 'P0002', MESSAGE = 'Məhsul tapılmadı';
    END IF;

    IF COALESCE(v_available, 0) + 0.0001 < v_quantity THEN
      RAISE EXCEPTION 'insufficient_stock'
        USING ERRCODE = '22023',
              MESSAGE = format('%s: seçilmiş anbarda qalıq kifayət etmir (mövcud: %s)', v_product_name, COALESCE(v_available, 0));
    END IF;
  END LOOP;

  IF v_dispatch_no IS NULL THEN
    v_dispatch_no := 'CD-' || EXTRACT(YEAR FROM v_now)::text || '-' || floor(random() * 90000 + 10000)::int::text;
  END IF;

  INSERT INTO public.consignment_dispatches (
    dispatch_no, partner_id, warehouse_id, warehouse_name, dispatch_date,
    status, items, notes, sales_rep_id, sales_rep_name, created_by
  )
  VALUES (
    v_dispatch_no, v_partner_id, v_warehouse_id, v_warehouse_name, v_dispatch_date,
    'delivered', v_items, v_notes, v_sales_rep_id, v_sales_rep_name, v_created_by
  )
  RETURNING id INTO v_dispatch_id;

  -- LOT-3: the chosen lots of every line are checked before any stock moves.
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_items)
  LOOP
    IF jsonb_typeof(v_item->'lots') = 'array' AND jsonb_array_length(v_item->'lots') > 0 THEN
      PERFORM public._lot_check_choice((v_item->>'product_id')::uuid, v_warehouse_id, (v_item->>'quantity')::numeric, v_item->'lots');
    END IF;
  END LOOP;

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_items)
  LOOP
    v_product_id := (v_item->>'product_id')::uuid;
    v_quantity := (v_item->>'quantity')::numeric;
    v_unit_price := COALESCE((v_item->>'unit_price')::numeric, 0);

    -- LOT-3: out to the partner from the chosen lots, else FEFO.
    PERFORM public.lot_ctx_begin(jsonb_build_object(
      'doc_type', 'consignment_dispatch', 'doc_id', v_dispatch_id, 'doc_no', v_dispatch_no, 'product_id', v_product_id,
      'counterparty_type', 'partner', 'counterparty_id', v_partner_id)
      || CASE WHEN jsonb_typeof(v_item->'lots') = 'array' AND jsonb_array_length(v_item->'lots') > 0
              THEN jsonb_build_object('lots', v_item->'lots') ELSE '{}'::jsonb END);
    PERFORM public.consignment_adjust_warehouse_stock(v_product_id, v_warehouse_id, -v_quantity);
    PERFORM public.lot_ctx_end();

    INSERT INTO public.stock_movements (
      product_id, warehouse_id, movement_type, quantity, unit,
      reference_type, reference_id, description, created_by
    )
    VALUES (
      v_product_id, v_warehouse_id, 'out', v_quantity, COALESCE(v_item->>'unit', 'Ədəd'),
      'consignment_dispatch', v_dispatch_id,
      format('Əmanət mal çıxışı %s', v_dispatch_no), v_created_by
    );

    SELECT id, delivered_qty, sold_qty, returned_qty INTO v_inv_id, v_delivered, v_sold, v_returned
    FROM public.consignment_inventory
    WHERE partner_id = v_partner_id AND product_id = v_product_id
    FOR UPDATE;

    IF v_inv_id IS NOT NULL THEN
      v_delivered := COALESCE(v_delivered, 0) + v_quantity;
      UPDATE public.consignment_inventory
      SET delivered_qty = v_delivered,
          remaining_qty = GREATEST(0, v_delivered - COALESCE(v_sold, 0) - COALESCE(v_returned, 0)),
          unit_price = COALESCE(v_unit_price, unit_price),
          product_name = COALESCE(v_item->>'product_name', product_name),
          product_code = COALESCE(v_item->>'product_code', product_code),
          category = COALESCE(v_item->>'category', category),
          unit = COALESCE(v_item->>'unit', unit),
          last_dispatch_at = v_now,
          updated_at = v_now
      WHERE id = v_inv_id;
    ELSE
      INSERT INTO public.consignment_inventory (
        partner_id, product_id, product_code, product_name, category, unit,
        delivered_qty, sold_qty, returned_qty, remaining_qty, unit_price,
        last_dispatch_at, updated_at
      )
      VALUES (
        v_partner_id, v_product_id, v_item->>'product_code', v_item->>'product_name',
        v_item->>'category', COALESCE(v_item->>'unit', 'Ədəd'),
        v_quantity, 0, 0, v_quantity, v_unit_price, v_now, v_now
      );
    END IF;
  END LOOP;

  SELECT COALESCE(company_name, name) INTO v_partner_name
  FROM public.consignment_partners WHERE id = v_partner_id;

  SELECT to_jsonb(d) || jsonb_build_object('partner_name', v_partner_name)
  INTO v_result
  FROM public.consignment_dispatches d
  WHERE d.id = v_dispatch_id;

  RETURN v_result;
END;
$function$
    $fn$;
  END IF;
END
$do$;

-- Consignment settlement: returns back to the partner's lots.
DO $do$
BEGIN
  IF to_regclass('public.consignment_dispatches') IS NOT NULL AND to_regclass('public.consignment_partners') IS NOT NULL AND to_regclass('public.consignment_inventory') IS NOT NULL AND to_regclass('public.consignment_monthly_reports') IS NOT NULL THEN
    EXECUTE $fn$
CREATE OR REPLACE FUNCTION public.settle_consignment_partner_atomic(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_partner_id UUID := NULLIF(p_payload->>'partner_id', '')::uuid;
  v_period TEXT := p_payload->>'report_period';
  v_sales_rep_id UUID := NULLIF(p_payload->>'sales_rep_id', '')::uuid;
  v_sales_rep_name TEXT := NULLIF(p_payload->>'sales_rep_name', '');
  v_notes TEXT := NULLIF(btrim(p_payload->>'notes'), '');
  v_return_warehouse_id UUID := NULLIF(p_payload->>'return_warehouse_id', '')::uuid;
  v_report_no TEXT := NULLIF(btrim(p_payload->>'report_no'), '');
  v_lines JSONB := COALESCE(p_payload->'lines', '[]'::jsonb);
  v_line JSONB;
  v_product_id UUID;
  v_qty_sold NUMERIC;
  v_qty_returned NUMERIC;
  v_unit_price NUMERIC;
  v_inv RECORD;
  v_sold_items JSONB := '[]'::jsonb;
  v_returned_items JSONB := '[]'::jsonb;
  v_total_amount NUMERIC := 0;
  v_now TIMESTAMPTZ := NOW();
  v_partner RECORD;
  v_partner_name TEXT;
  v_sale_id UUID;
  v_invoice_no TEXT;
  v_journal_id UUID;
  v_report_id UUID;
  v_result JSONB;
  v_any_sold BOOLEAN := FALSE;
  v_any_returned BOOLEAN := FALSE;
  v_created_by UUID := NULLIF(p_payload->>'created_by', '')::uuid;
BEGIN
  -- Permission is checked in JS (requirePermissionAction) before this RPC is
  -- called via the service-role admin client - see create_consignment_dispatch_atomic.

  IF v_partner_id IS NULL THEN
    RAISE EXCEPTION 'partner_required' USING ERRCODE = '22023', MESSAGE = 'Tərəfdaş seçin';
  END IF;
  IF v_period IS NULL OR v_period !~ '^\d{4}-\d{2}$' THEN
    RAISE EXCEPTION 'invalid_period' USING ERRCODE = '22023', MESSAGE = 'Dövr YYYY-MM formatında olmalıdır';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.consignment_monthly_reports
    WHERE partner_id = v_partner_id AND report_period = v_period
  ) THEN
    RAISE EXCEPTION 'already_settled' USING ERRCODE = '22023', MESSAGE = 'Bu tərəfdaş üçün həmin ay artıq hesabat yazılıb';
  END IF;
  IF jsonb_array_length(v_lines) = 0 THEN
    RAISE EXCEPTION 'lines_required' USING ERRCODE = '22023', MESSAGE = 'Ən azı bir sətir daxil edin';
  END IF;

  SELECT * INTO v_partner FROM public.consignment_partners WHERE id = v_partner_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'partner_not_found' USING ERRCODE = 'P0002', MESSAGE = 'Tərəfdaş tapılmadı';
  END IF;
  v_partner_name := COALESCE(v_partner.company_name, v_partner.name);

  -- Validate + lock every touched consignment_inventory row up front.
  FOR v_line IN SELECT value FROM jsonb_array_elements(v_lines)
  LOOP
    v_product_id := NULLIF(v_line->>'product_id', '')::uuid;
    v_qty_sold := COALESCE((v_line->>'quantity_sold')::numeric, 0);
    v_qty_returned := COALESCE((v_line->>'quantity_returned')::numeric, 0);
    IF v_product_id IS NULL OR (v_qty_sold <= 0 AND v_qty_returned <= 0) THEN
      CONTINUE;
    END IF;

    SELECT * INTO v_inv FROM public.consignment_inventory
    WHERE partner_id = v_partner_id AND product_id = v_product_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'product_not_in_consignment' USING ERRCODE = '22023', MESSAGE = 'Məhsul tərəfdaş stokunda yoxdur';
    END IF;

    IF (v_qty_sold + v_qty_returned) - GREATEST(0, v_inv.delivered_qty - v_inv.sold_qty - v_inv.returned_qty) > 0.0001 THEN
      RAISE EXCEPTION 'qty_exceeds_remaining'
        USING ERRCODE = '22023',
              MESSAGE = format('%s: satılan + qaytarılan miqdar qalıqdan çoxdur', v_inv.product_name);
    END IF;
  END LOOP;

  IF v_return_warehouse_id IS NULL THEN
    FOR v_line IN SELECT value FROM jsonb_array_elements(v_lines)
    LOOP
      IF COALESCE((v_line->>'quantity_returned')::numeric, 0) > 0 THEN
        RAISE EXCEPTION 'return_warehouse_required' USING ERRCODE = '22023', MESSAGE = 'Qaytarılan mal üçün anbar seçin';
      END IF;
    END LOOP;
  END IF;

  -- Build sold/returned line snapshots and apply stock/inventory changes.
  FOR v_line IN SELECT value FROM jsonb_array_elements(v_lines)
  LOOP
    v_product_id := NULLIF(v_line->>'product_id', '')::uuid;
    v_qty_sold := COALESCE((v_line->>'quantity_sold')::numeric, 0);
    v_qty_returned := COALESCE((v_line->>'quantity_returned')::numeric, 0);
    IF v_product_id IS NULL OR (v_qty_sold <= 0 AND v_qty_returned <= 0) THEN
      CONTINUE;
    END IF;

    SELECT * INTO v_inv FROM public.consignment_inventory
    WHERE partner_id = v_partner_id AND product_id = v_product_id
    FOR UPDATE;

    v_unit_price := COALESCE((v_line->>'unit_price')::numeric, v_inv.unit_price);

    IF v_qty_sold > 0 THEN
      v_any_sold := TRUE;
      v_total_amount := v_total_amount + (v_qty_sold * v_unit_price);
      v_sold_items := v_sold_items || jsonb_build_array(jsonb_build_object(
        'product_id', v_product_id,
        'product_code', v_inv.product_code,
        'product_name', v_inv.product_name,
        'quantity_sold', v_qty_sold,
        'unit_price', v_unit_price,
        'total_price', v_qty_sold * v_unit_price
      ));
    END IF;

    IF v_qty_returned > 0 THEN
      v_any_returned := TRUE;
      v_returned_items := v_returned_items || jsonb_build_array(jsonb_build_object(
        'product_id', v_product_id,
        'product_code', v_inv.product_code,
        'product_name', v_inv.product_name,
        'quantity', v_qty_returned,
        'unit', v_inv.unit,
        'unit_price', v_unit_price
      ));

      -- LOT-3: a return goes back to the lots that went out to this partner (latest first).
      PERFORM public.lot_ctx_begin(jsonb_build_object(
        'doc_type', 'consignment_settlement', 'product_id', v_product_id,
        'counterparty_type', 'partner', 'counterparty_id', v_partner_id,
        'lots', public._lot_partner_return_lots(v_partner_id, v_product_id, v_qty_returned),
        'new_lot', jsonb_build_object('origin_type', 'return')));
      PERFORM public.consignment_adjust_warehouse_stock(v_product_id, v_return_warehouse_id, v_qty_returned);
      PERFORM public.lot_ctx_end();

      INSERT INTO public.stock_movements (
        product_id, warehouse_id, movement_type, quantity, unit,
        reference_type, reference_id, description, created_by
      )
      VALUES (
        v_product_id, v_return_warehouse_id, 'in', v_qty_returned, COALESCE(v_inv.unit, 'Ədəd'),
        'consignment_return', v_partner_id,
        format('Əmanət hesablaşması qaytarma — %s %s', v_partner_name, v_period), v_created_by
      );
    END IF;

    UPDATE public.consignment_inventory
    SET sold_qty = sold_qty + v_qty_sold,
        returned_qty = returned_qty + v_qty_returned,
        remaining_qty = GREATEST(0, v_inv.delivered_qty - (v_inv.sold_qty + v_qty_sold) - (v_inv.returned_qty + v_qty_returned)),
        updated_at = v_now
    WHERE id = v_inv.id;
  END LOOP;

  IF NOT v_any_sold AND NOT v_any_returned THEN
    RAISE EXCEPTION 'nothing_to_settle' USING ERRCODE = '22023', MESSAGE = 'Satılan və ya qaytarılan məhsul daxil edin';
  END IF;

  IF v_any_sold THEN
    v_invoice_no := 'CNS-' || EXTRACT(YEAR FROM v_now)::text || '-' || floor(random() * 90000 + 10000)::int::text;

    INSERT INTO public.sales (
      doc_no, invoice_number, doc_date, customer_id, customer_name, warehouse_name,
      subtotal, discount_total, vat_total, total_amount, paid_amount, remaining_balance,
      note, notes
    )
    VALUES (
      v_invoice_no, v_invoice_no, (v_period || '-01')::date, v_partner.customer_id, v_partner_name,
      'Əmanət / ' || v_partner_name,
      v_total_amount, 0, 0, v_total_amount, 0, v_total_amount,
      format('Əmanət satış hesabatı %s', v_period), format('Consignment settlement %s', v_period)
    )
    RETURNING id INTO v_sale_id;

    INSERT INTO public.sale_items (
      sale_id, product_id, product_code, product_name, warehouse_id, warehouse_name,
      quantity, unit, unit_price, discount_percent, vat_rate, line_total, extra_info
    )
    SELECT
      v_sale_id,
      (item->>'product_id')::uuid,
      item->>'product_code',
      item->>'product_name',
      NULL,
      'Əmanət / ' || v_partner_name,
      (item->>'quantity_sold')::numeric,
      'Ədəd',
      (item->>'unit_price')::numeric,
      0, 0,
      (item->>'total_price')::numeric,
      NULL
    FROM jsonb_array_elements(v_sold_items) AS item;

    v_journal_id := public.post_sale_invoice_gl_journal(
      v_sale_id, v_invoice_no, v_total_amount, v_partner.customer_id,
      'consignment_settlement:' || v_sale_id::text
    );

    IF v_partner.customer_id IS NOT NULL THEN
      PERFORM public.refresh_customer_ar_balance(v_partner.customer_id);
    END IF;
  END IF;

  IF v_report_no IS NULL THEN
    v_report_no := 'CM-' || EXTRACT(YEAR FROM v_now)::text || '-' || floor(random() * 90000 + 10000)::int::text;
  END IF;

  INSERT INTO public.consignment_monthly_reports (
    report_no, partner_id, report_period, sold_items, returned_items, total_amount,
    invoice_id, notes, sales_rep_id, sales_rep_name, created_by
  )
  VALUES (
    v_report_no, v_partner_id, v_period, v_sold_items, v_returned_items, v_total_amount,
    v_sale_id, v_notes, v_sales_rep_id, v_sales_rep_name, v_created_by
  )
  RETURNING id INTO v_report_id;

  SELECT to_jsonb(r) || jsonb_build_object('partner_name', v_partner_name)
  INTO v_result
  FROM public.consignment_monthly_reports r
  WHERE r.id = v_report_id;

  RETURN v_result;
END;
$function$
    $fn$;
  END IF;
END
$do$;


-- ─── 5. Stock transfer in one transaction ───────────────────────────────────
-- The same tables and numbering as src/modules/inventory/lib/stockTransferServer.ts; the API
-- route calls it when LOT_TRACKING is on (else the old path). p_payload:
--   {from_warehouse_id, to_warehouse_id, transfer_date, reference_number?, notes?, created_by?,
--    items: [{product_id, offcut_id?, quantity, product_code?, product_name?, unit?, barcode?,
--             available_stock?, lots?: [{lot_id, qty}]}]}
-- Each line leaves the source on its chosen lots (else FEFO) and enters the target on exactly
-- those lots (mode mirror). A Polywood offcut moves its piece; its lot goes along.
-- Returns {success: true, transfer_id, reference_number}; a refused transfer raises (nothing moved).
DO $do$
BEGIN
  IF to_regclass('public.stock_transfers') IS NOT NULL AND to_regclass('public.stock_transfer_items') IS NOT NULL THEN
    EXECUTE $fn$
CREATE OR REPLACE FUNCTION public.post_stock_transfer(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from    UUID := public._lot_uuid(p_payload ->> 'from_warehouse_id');
  v_to      UUID := public._lot_uuid(p_payload ->> 'to_warehouse_id');
  v_user    UUID := public._lot_uuid(p_payload ->> 'created_by');
  v_date    DATE := COALESCE(NULLIF(p_payload ->> 'transfer_date', '')::date, public.document_today());
  v_ref     TEXT := NULLIF(btrim(p_payload ->> 'reference_number'), '');
  v_lines   JSONB := '[]'::jsonb;
  v_item    JSONB;
  v_pid     UUID;
  v_offcut  UUID;
  v_qty     NUMERIC;
  v_mode    TEXT;
  v_avail   NUMERIC;
  v_name    TEXT;
  v_unit    TEXT;
  v_id      UUID;
  v_line_id UUID;
  v_lots    JSONB;
  v_desc    TEXT;
BEGIN
  IF v_from IS NULL OR v_to IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Anbarları seçin';
  END IF;
  IF v_from = v_to THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Çıxış və giriş anbarı eyni ola bilməz';
  END IF;
  IF jsonb_typeof(p_payload -> 'items') = 'array' THEN
    SELECT COALESCE(jsonb_agg(value), '[]'::jsonb) INTO v_lines
    FROM jsonb_array_elements(p_payload -> 'items')
    WHERE public._lot_uuid(value ->> 'product_id') IS NOT NULL AND COALESCE(NULLIF(value ->> 'quantity', '')::numeric, 0) > 0;
  END IF;
  IF jsonb_array_length(v_lines) = 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Ən azı bir sətir əlavə edin';
  END IF;

  -- Everything is checked before anything moves: quantities, offcuts, chosen lots.
  FOR v_item IN SELECT value FROM jsonb_array_elements(v_lines) LOOP
    v_pid := (v_item ->> 'product_id')::uuid;
    v_offcut := public._lot_uuid(v_item ->> 'offcut_id');
    v_qty := (v_item ->> 'quantity')::numeric;
    SELECT p.name, p.inventory_mode INTO v_name, v_mode FROM public.products p WHERE p.id = v_pid FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = format('Məhsul tapılmadı: %s', v_pid);
    END IF;
    v_name := COALESCE(NULLIF(v_item ->> 'product_name', ''), v_name);
    IF v_offcut IS NOT NULL THEN
      IF NOT EXISTS (SELECT 1 FROM public.polywood_pieces pp WHERE pp.id = v_offcut AND pp.product_id = v_pid AND pp.warehouse_id = v_from) THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = format('%s: qırıq parça çıxış anbarında tapılmadı', v_name);
      END IF;
    ELSE
      IF v_mode IS DISTINCT FROM 'polywood' THEN
        v_avail := public.stock_available(v_pid, v_from);
      ELSE
        v_avail := COALESCE(NULLIF(v_item ->> 'available_stock', '')::numeric, v_qty);
      END IF;
      IF COALESCE(v_avail, 0) + 0.000001 < v_qty THEN
        RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = format('%s: transfer miqdarı mövcud qalıqdan çoxdur', v_name);
      END IF;
      IF jsonb_typeof(v_item -> 'lots') = 'array' AND jsonb_array_length(v_item -> 'lots') > 0 THEN
        PERFORM public._lot_check_choice(v_pid, v_from, v_qty, v_item -> 'lots', v_user);
      END IF;
    END IF;
  END LOOP;

  IF v_ref IS NULL THEN
    v_ref := 'TRN-' || EXTRACT(YEAR FROM v_date)::int || '-' || (1000 + floor(random() * 9000))::int;
  END IF;
  v_desc := 'Anbarlar arası transfer — ' || v_ref;

  INSERT INTO public.stock_transfers (reference_number, from_warehouse_id, to_warehouse_id, transfer_date, status, notes, created_by)
  VALUES (v_ref, v_from, v_to, v_date, 'completed', NULLIF(btrim(p_payload ->> 'notes'), ''), v_user)
  RETURNING id INTO v_id;

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_lines) LOOP
    v_pid := (v_item ->> 'product_id')::uuid;
    v_offcut := public._lot_uuid(v_item ->> 'offcut_id');
    v_qty := (v_item ->> 'quantity')::numeric;

    INSERT INTO public.stock_transfer_items (transfer_id, product_id, offcut_id, quantity, product_code, product_name, unit, barcode)
    VALUES (v_id, v_pid, v_offcut, v_qty, v_item ->> 'product_code', v_item ->> 'product_name', v_item ->> 'unit',
            NULLIF(v_item ->> 'barcode', ''))
    RETURNING id INTO v_line_id;

    IF v_offcut IS NOT NULL THEN
      -- The piece moves; the lot triggers move its lot with it.
      PERFORM public.lot_ctx_begin(jsonb_build_object(
        'doc_type', 'stock_transfer', 'doc_id', v_id, 'doc_line_id', v_line_id, 'doc_no', v_ref, 'product_id', v_pid,
        'counterparty_type', 'warehouse', 'counterparty_id', v_to));
      UPDATE public.polywood_pieces SET warehouse_id = v_to WHERE id = v_offcut;
      PERFORM public.lot_ctx_end();
    ELSE
      v_lots := CASE WHEN jsonb_typeof(v_item -> 'lots') = 'array' AND jsonb_array_length(v_item -> 'lots') > 0
                     THEN v_item -> 'lots' END;
      -- Out of the source: the chosen lots, else FEFO.
      PERFORM public.lot_ctx_begin(jsonb_build_object(
        'doc_type', 'stock_transfer', 'doc_id', v_id, 'doc_line_id', v_line_id, 'doc_no', v_ref, 'product_id', v_pid,
        'counterparty_type', 'warehouse', 'counterparty_id', v_to)
        || CASE WHEN v_lots IS NOT NULL THEN jsonb_build_object('lots', v_lots) ELSE '{}'::jsonb END);
      PERFORM public.adjust_warehouse_stock(v_pid, v_from, -v_qty);
      -- Into the target: the same lots.
      PERFORM public.lot_ctx_begin(jsonb_build_object(
        'doc_type', 'stock_transfer', 'doc_id', v_id, 'doc_line_id', v_line_id, 'doc_no', v_ref, 'product_id', v_pid,
        'counterparty_type', 'warehouse', 'counterparty_id', v_from, 'mode', 'mirror',
        'mirror_of', jsonb_build_object('doc_type', 'stock_transfer', 'doc_id', v_id, 'doc_line_id', v_line_id)));
      PERFORM public.adjust_warehouse_stock(v_pid, v_to, v_qty);
      PERFORM public.lot_ctx_end();
    END IF;

    SELECT unit INTO v_unit FROM public.products WHERE id = v_pid;
    INSERT INTO public.stock_movements (product_id, warehouse_id, movement_type, quantity, unit, reference_type, reference_id, description, created_by)
    VALUES (v_pid, v_from, 'out', v_qty, COALESCE(v_unit, NULLIF(v_item ->> 'unit', ''), 'Ədəd'), 'TRANSFER_OUT', v_id, v_desc, v_user),
           (v_pid, v_to,   'in',  v_qty, COALESCE(v_unit, NULLIF(v_item ->> 'unit', ''), 'Ədəd'), 'TRANSFER_IN',  v_id, v_desc, v_user);
  END LOOP;

  RETURN jsonb_build_object('success', true, 'transfer_id', v_id, 'reference_number', v_ref);
END;
$$
    $fn$;
    EXECUTE 'REVOKE ALL ON FUNCTION public.post_stock_transfer(JSONB) FROM PUBLIC, anon, authenticated';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.post_stock_transfer(JSONB) TO service_role';
  END IF;
END
$do$;

-- ─── 6. Grants ──────────────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION public._lots_can_user(UUID, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._lot_check_choice(UUID, UUID, NUMERIC, JSONB, UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._lot_partner_return_lots(UUID, UUID, NUMERIC) FROM PUBLIC, anon, authenticated;
