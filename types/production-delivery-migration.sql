-- Custom production delivery — atomic ERP integration (run in Supabase SQL Editor)
-- Prerequisites: production_orders, sales, sale_items, products, customers, accounts, transactions

ALTER TABLE production_orders
  ADD COLUMN IF NOT EXISTS sale_id UUID REFERENCES sales(id) ON DELETE SET NULL;

ALTER TABLE production_orders
  ADD COLUMN IF NOT EXISTS delivered_at TIMESTAMPTZ;

ALTER TABLE sales
  ADD COLUMN IF NOT EXISTS production_order_id UUID REFERENCES production_orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_production_orders_sale
  ON production_orders (sale_id);

CREATE INDEX IF NOT EXISTS idx_sales_production_order
  ON sales (production_order_id);

-- Prevent duplicate invoices for the same production order at DB level
CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_production_order_unique
  ON sales (production_order_id)
  WHERE production_order_id IS NOT NULL;

DROP FUNCTION IF EXISTS public.complete_custom_production_delivery(UUID);
DROP FUNCTION IF EXISTS public.complete_custom_production_delivery_atomic(UUID, UUID, TEXT, UUID);

CREATE OR REPLACE FUNCTION public.complete_custom_production_delivery_atomic(
  p_order_id UUID,
  p_account_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order production_orders%ROWTYPE;
  v_existing_sale_id UUID;
  v_sale_id UUID;
  v_product_id UUID;
  v_product_code TEXT;
  v_product_name TEXT;
  v_product_unit TEXT;
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
  v_customer_balance NUMERIC := 0;
  v_account_balance NUMERIC := 0;
  v_payments JSONB := '[]'::jsonb;
BEGIN
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

  IF v_order.type IS DISTINCT FROM 'Custom' THEN
    RAISE EXCEPTION 'invalid_order_type'
      USING ERRCODE = '22023',
            MESSAGE = 'Yalnız fərdi (Custom) sifarişlər üçün təhvil inteqrasiyası aktivdir';
  END IF;

  -- Idempotent success: already delivered and linked
  IF v_order.sale_id IS NOT NULL AND v_order.status = 'Delivered' THEN
    SELECT doc_no INTO v_doc_no FROM sales WHERE id = v_order.sale_id;
    RETURN jsonb_build_object(
      'sale_id', v_order.sale_id,
      'doc_no', COALESCE(v_doc_no, v_order.order_no),
      'product_id', v_order.finished_product_id,
      'already_completed', true
    );
  END IF;

  -- Orphan / duplicate prevention
  SELECT id INTO v_existing_sale_id
  FROM sales
  WHERE production_order_id = p_order_id
  LIMIT 1;

  IF v_existing_sale_id IS NOT NULL THEN
    RAISE EXCEPTION 'duplicate_sale_orphan'
      USING ERRCODE = '23505',
            MESSAGE = 'Bu sifariş üçün satış fakturası artıq mövcuddur, lakin sifariş bağlanmayıb. Administratorla əlaqə saxlayın.';
  END IF;

  IF v_order.sale_id IS NOT NULL THEN
    RAISE EXCEPTION 'sale_already_linked'
      USING ERRCODE = '23505',
            MESSAGE = 'Sifariş artıq satış fakturasına bağlıdır';
  END IF;

  IF v_order.status IS DISTINCT FROM 'Ready' THEN
    RAISE EXCEPTION 'order_not_ready'
      USING ERRCODE = '22023',
            MESSAGE = 'Təhvil yalnız «Hazır» statusundan verilə bilər';
  END IF;

  IF v_order.customer_id IS NULL THEN
    RAISE EXCEPTION 'customer_required'
      USING ERRCODE = '22023',
            MESSAGE = 'Təhvil üçün müştəri (customer_id) tələb olunur';
  END IF;

  v_project_price := COALESCE(v_order.total_project_price, 0);
  IF v_project_price <= 0 THEN
    RAISE EXCEPTION 'invalid_total_price'
      USING ERRCODE = '22023',
            MESSAGE = 'Layihə qiyməti sıfırdan böyük olmalıdır';
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
    SELECT balance INTO v_account_balance
    FROM accounts
    WHERE id = p_account_id
    FOR UPDATE;

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

  SELECT COALESCE(SUM(
    COALESCE(
      NULLIF(line_cost, 0),
      COALESCE(quantity, 0) * COALESCE(unit_cost, 0)
    )
  ), 0)
  INTO v_material_cost
  FROM production_materials
  WHERE production_order_id = p_order_id
    AND COALESCE(issued, false) = true;

  SELECT COALESCE(SUM(COALESCE(total_cost, 0)), 0)
  INTO v_outsource_cost
  FROM production_outsourcing
  WHERE production_order_id = p_order_id;

  SELECT COALESCE(SUM(COALESCE(amount, 0)), 0)
  INTO v_expense_cost
  FROM production_expenses
  WHERE production_order_id = p_order_id;

  SELECT COALESCE(SUM(COALESCE(calculated_fee, 0)), 0)
  INTO v_contractor_cost
  FROM production_contractors
  WHERE production_order_id = p_order_id;

  v_total_cost := v_material_cost + v_outsource_cost + v_expense_cost + v_contractor_cost;
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
    v_product_unit := 'Ədəd';

    INSERT INTO products (
      code, name, category, subcategory, unit,
      buy_price, sell_price, stock, min_stock, extra_info
    )
    VALUES (
      v_product_code,
      v_product_name,
      'Fərdi istehsal',
      'Make-to-Order',
      v_product_unit,
      v_unit_cogs,
      v_unit_sell,
      0,
      0,
      'Production order ' || v_order.order_no
    )
    RETURNING id INTO v_product_id;
  END IF;

  SELECT stock INTO v_stock FROM products WHERE id = v_product_id FOR UPDATE;
  UPDATE products SET stock = COALESCE(v_stock, 0) + v_qty WHERE id = v_product_id;

  v_doc_no := 'SF-' || to_char(CURRENT_DATE, 'YYYY') || '-' || floor(10000 + random() * 90000)::int;

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
    delivery_type,
    delivery_fee,
    note,
    notes,
    production_order_id,
    payments
  )
  VALUES (
    v_doc_no,
    v_doc_no,
    CURRENT_DATE,
    v_order.customer_id,
    v_order.customer_name,
    auth.uid(),
    NULL,
    v_order.warehouse_name,
    v_subtotal,
    0,
    0,
    v_subtotal,
    v_advance,
    v_remaining,
    CASE WHEN v_install_fee > 0 THEN 'paid' ELSE 'free' END,
    v_install_fee,
    'Fərdi istehsal təhvil: ' || v_order.order_no,
    COALESCE(v_order.project_scope, v_order.notes),
    p_order_id,
    v_payments
  )
  RETURNING id INTO v_sale_id;

  INSERT INTO sale_items (
    sale_id, product_id, product_code, product_name,
    warehouse_id, warehouse_name, quantity, unit,
    unit_price, discount_percent, vat_rate, line_total, extra_info
  )
  VALUES (
    v_sale_id,
    v_product_id,
    v_product_code,
    v_product_name,
    v_order.warehouse_id,
    v_order.warehouse_name,
    v_qty,
    COALESCE(v_product_unit, 'Ədəd'),
    CASE WHEN v_qty > 0 THEN ROUND(v_project_price / v_qty, 2) ELSE v_project_price END,
    0,
    0,
    v_project_price,
    'COGS ref: ' || v_order.order_no
  );

  IF v_install_fee > 0.0001 THEN
    INSERT INTO sale_items (
      sale_id, product_id, product_code, product_name,
      warehouse_id, warehouse_name, quantity, unit,
      unit_price, discount_percent, vat_rate, line_total, extra_info
    )
    VALUES (
      v_sale_id,
      NULL,
      NULL,
      'Quraşdırma və çatdırılma',
      NULL,
      v_order.warehouse_name,
      1,
      'Xidmət',
      v_install_fee,
      0,
      0,
      v_install_fee,
      v_order.order_no
    );
  END IF;

  SELECT stock INTO v_stock FROM products WHERE id = v_product_id FOR UPDATE;
  IF COALESCE(v_stock, 0) + 0.0001 < v_qty THEN
    RAISE EXCEPTION 'insufficient_finished_stock'
      USING ERRCODE = '22023',
            MESSAGE = 'Hazır məhsul stok çıxışı mümkün deyil';
  END IF;
  UPDATE products SET stock = COALESCE(v_stock, 0) - v_qty WHERE id = v_product_id;

  PERFORM public.refresh_customer_ar_balance(v_order.customer_id);

  IF v_advance > 0.0001 THEN
    INSERT INTO transactions (
      account_id, type, amount, category, production_order_id, notes
    )
    VALUES (
      p_account_id,
      'Mədaxil',
      v_advance,
      'Satış Ödənişi',
      p_order_id,
      'Fərdi istehsal avansı — ' || v_doc_no || ' (' || v_order.order_no || ')'
    );

    UPDATE accounts
    SET balance = COALESCE(v_account_balance, 0) + v_advance
    WHERE id = p_account_id;
  END IF;

  UPDATE production_orders
  SET
    finished_product_id = v_product_id,
    finished_product_name = v_product_name,
    sale_id = v_sale_id,
    delivered_at = NOW(),
    finished_goods_posted = true,
    status = 'Delivered',
    updated_at = NOW()
  WHERE id = p_order_id;

  RETURN jsonb_build_object(
    'sale_id', v_sale_id,
    'doc_no', v_doc_no,
    'product_id', v_product_id,
    'already_completed', false
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_custom_production_delivery_atomic(
  UUID, UUID
) TO authenticated;
