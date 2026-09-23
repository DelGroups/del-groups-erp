-- Reverts the buy-side of Multi-Tier Pricing: purchase prices must stay a
-- single flat value (products.buy_price). Multi-tier pricing applies only to
-- Sales - sell_price/price_wholesale/price_distributor and sale_items are
-- untouched. Safe to drop outright: these columns were only added earlier
-- this session and have no real data.

ALTER TABLE products
  DROP COLUMN IF EXISTS buy_price_wholesale,
  DROP COLUMN IF EXISTS buy_price_distributor;

ALTER TABLE purchase_items
  DROP COLUMN IF EXISTS price_tier;

ALTER TABLE suppliers
  DROP COLUMN IF EXISTS default_price_tier;

-- ─── save_purchase_invoice_draft: drop price_tier from the item insert ──────

CREATE OR REPLACE FUNCTION public.save_purchase_invoice_draft(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
      is_official, contract_id, vat_mode, subtotal_amount, vat_rate, vat_amount, grand_total,
      currency_breakdown
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
      NULLIF(v_header->>'grand_total', '')::numeric,
      COALESCE(v_header->'currency_breakdown', '{}'::jsonb)
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
      grand_total = NULLIF(v_header->>'grand_total', '')::numeric,
      currency_breakdown = COALESCE(v_header->'currency_breakdown', currency_breakdown, '{}'::jsonb)
    WHERE id = v_purchase_id;

    DELETE FROM purchase_items WHERE purchase_id = v_purchase_id;
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(v_items)
  LOOP
    INSERT INTO purchase_items (
      purchase_id, product_id, product_code, product_name, quantity, unit, unit_price, total_price,
      currency, exchange_rate
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
      COALESCE(NULLIF(trim(v_item->>'currency'), ''), 'AZN'),
      COALESCE(NULLIF(v_item->>'exchange_rate', '')::numeric, 1)
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
$$;

-- ─── create_product_with_bom_atomic: drop buy-side tier columns ─────────────

CREATE OR REPLACE FUNCTION public.create_product_with_bom_atomic(
  p_product JSONB,
  p_bom_rows JSONB DEFAULT '[]'::jsonb,
  p_is_composite BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product public.products;
  v_row JSONB;
  v_component_id UUID;
  v_quantity NUMERIC;
  v_bom_count INT := 0;
  v_is_service BOOLEAN := COALESCE((p_product->>'is_service')::boolean, false);
BEGIN
  IF p_product IS NULL OR COALESCE(btrim(p_product->>'name'), '') = '' THEN
    RAISE EXCEPTION 'product_name_required'
      USING ERRCODE = '22023',
            MESSAGE = 'Məhsul adı tələb olunur';
  END IF;

  INSERT INTO public.products (
    code,
    name,
    category,
    subcategory,
    unit,
    buy_price,
    sell_price,
    price_wholesale,
    price_distributor,
    stock,
    min_stock,
    min_stock_level,
    barcode,
    qr_code,
    extra_info,
    category_id,
    is_dimensional,
    is_service,
    is_composite,
    base_length,
    base_width
  )
  VALUES (
    COALESCE(
      NULLIF(btrim(p_product->>'code'), ''),
      'PRD-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))
    ),
    btrim(p_product->>'name'),
    COALESCE(NULLIF(btrim(p_product->>'category'), ''), 'Ümumi'),
    NULLIF(btrim(p_product->>'subcategory'), ''),
    COALESCE(NULLIF(btrim(p_product->>'unit'), ''), 'Ədəd'),
    COALESCE((p_product->>'buy_price')::numeric, 0),
    COALESCE((p_product->>'sell_price')::numeric, 0),
    NULLIF(p_product->>'price_wholesale', '')::numeric,
    NULLIF(p_product->>'price_distributor', '')::numeric,
    CASE WHEN v_is_service THEN 0 ELSE COALESCE((p_product->>'stock')::numeric, 0) END,
    CASE WHEN v_is_service THEN 0 ELSE COALESCE((p_product->>'min_stock')::numeric, 0) END,
    CASE
      WHEN v_is_service THEN 0
      ELSE COALESCE(
        (p_product->>'min_stock_level')::numeric,
        (p_product->>'min_stock')::numeric,
        0
      )
    END,
    NULLIF(btrim(p_product->>'barcode'), ''),
    NULLIF(btrim(p_product->>'qr_code'), ''),
    NULLIF(btrim(p_product->>'extra_info'), ''),
    NULLIF(p_product->>'category_id', '')::uuid,
    COALESCE((p_product->>'is_dimensional')::boolean, false),
    v_is_service,
    CASE WHEN v_is_service THEN false ELSE COALESCE(p_is_composite, false) END,
    NULLIF(p_product->>'base_length', '')::numeric,
    NULLIF(p_product->>'base_width', '')::numeric
  )
  RETURNING * INTO v_product;

  IF p_is_composite AND NOT v_is_service THEN
    FOR v_row IN
      SELECT value FROM jsonb_array_elements(COALESCE(p_bom_rows, '[]'::jsonb))
    LOOP
      v_component_id := NULLIF(v_row->>'component_product_id', '')::uuid;
      v_quantity := COALESCE((v_row->>'quantity')::numeric, 0);

      IF v_component_id IS NULL OR v_quantity <= 0 THEN
        CONTINUE;
      END IF;

      IF v_component_id = v_product.id THEN
        DELETE FROM public.products WHERE id = v_product.id;
        RAISE EXCEPTION 'bom_self_reference'
          USING ERRCODE = '22023',
                MESSAGE = 'Komplekt komponenti öz məhsuluna bərabər ola bilməz';
      END IF;

      INSERT INTO public.product_bom (parent_product_id, component_product_id, quantity)
      VALUES (v_product.id, v_component_id, v_quantity);

      v_bom_count := v_bom_count + 1;
    END LOOP;

    IF v_bom_count = 0 THEN
      DELETE FROM public.products WHERE id = v_product.id;
      RAISE EXCEPTION 'bom_rows_required'
        USING ERRCODE = '22023',
              MESSAGE = 'Komplekt üçün ən azı bir komponent tələb olunur';
    END IF;
  END IF;

  RETURN to_jsonb(v_product);
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_purchase_invoice_draft(JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_product_with_bom_atomic(JSONB, JSONB, BOOLEAN)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
