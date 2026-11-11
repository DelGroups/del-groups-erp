-- ============================================================================
-- GL partner tags (LED-2): every journal line on 1200 (receivables) and 2100
-- (payables) carries the right journal_entry_lines.partner_id (a partners.id), so the
-- GL by partner equals the partner ledger (LED-1, partner_ledger_movements).
--
-- Going forward only: no existing line, amount or account changes here. History:
-- supabase/scripts/gl_partner_tags_report.sql (read-only) and
-- gl_partner_tags_backfill.sql (Del decides).
--
-- 1. Invoice payments: post_cash_transaction and _post_payment_lines put the partner
--    of the paid document (sale, purchase, production order) on their 1200 / 2100
--    counter line. Signatures, accounts, amounts and idempotency keys unchanged.
-- 2. set_customer_opening_balance_atomic / set_supplier_opening_balance_atomic passed
--    customers.id / suppliers.id as partner_id; the foreign key to partners.id made
--    every change fail (and roll back). They now resolve the partner, and check the
--    caller (can_manage_settings or admin, like their server actions; anon no longer).
-- 3. process_production_delivery_event passed the customer id on its 1200 lines; now
--    the partner (production module only).
-- 4. The partner ledger view (LED-1) also counts a production delivery's invoice, which
--    is booked although saved as a draft (read-only; nothing staff see changes).
-- Function bodies are the current ones (pg_get_functiondef), changed only on those lines.
-- Not changed here (known, separate): the hardcoded 1100 cash line. Safe to re-run.
-- Needs 20261111100000_partner_ledger.sql (LED-1) first.
-- ============================================================================

DO $$
BEGIN
  IF to_regprocedure('public._partner_ledger_partner(uuid, uuid)') IS NULL
     OR to_regprocedure('public._partner_ledger_production_order(uuid)') IS NULL THEN
    RAISE EXCEPTION 'Run 20261111100000_partner_ledger.sql (LED-1) before 20261112100000_gl_partner_tags.sql';
  END IF;
END;
$$;

-- ─── Helpers ────────────────────────────────────────────────────────────────

-- The partner (partners.id) of a document a cash row is linked to: a sale, a purchase or
-- a production order (the same partner the partner ledger, LED-1, uses). NULL otherwise.
CREATE OR REPLACE FUNCTION public._gl_partner_for_source(p_source_type TEXT, p_source_id UUID)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_partner UUID;
BEGIN
  IF p_source_id IS NULL THEN
    RETURN NULL;
  END IF;
  CASE lower(btrim(COALESCE(p_source_type, '')))
    WHEN 'sale' THEN
      SELECT COALESCE(s.partner_id, public._partner_ledger_partner(s.customer_id, NULL)) INTO v_partner
      FROM public.sales s WHERE s.id = p_source_id;
    WHEN 'purchase' THEN
      SELECT COALESCE(p.partner_id, public._partner_ledger_partner(NULL, p.supplier_id)) INTO v_partner
      FROM public.purchases p WHERE p.id = p_source_id;
    WHEN 'production' THEN
      -- Production module: read only where installed (see _partner_ledger_production_order).
      v_partner := (public._partner_ledger_production_order(p_source_id)).partner_id;
    ELSE
      v_partner := NULL;
  END CASE;
  RETURN v_partner;
END;
$$;

-- The partner fields of a journal line: only on 1200 / 2100 and only with a partner.
CREATE OR REPLACE FUNCTION public._gl_partner_tag(p_coa_code TEXT, p_partner UUID)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN p_partner IS NOT NULL AND p_coa_code IN ('1200', '2100')
              THEN jsonb_build_object('partner_type', 'partner', 'partner_id', p_partner)
              ELSE '{}'::jsonb END;
$$;

REVOKE ALL ON FUNCTION public._gl_partner_for_source(TEXT, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._gl_partner_for_source(TEXT, UUID) TO service_role;
REVOKE ALL ON FUNCTION public._gl_partner_tag(TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._gl_partner_tag(TEXT, UUID) TO authenticated, service_role;

-- ─── 1. Invoice payments ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.post_cash_transaction(p_account_id uuid, p_type text, p_amount numeric, p_category text, p_notes text DEFAULT NULL::text, p_production_order_id uuid DEFAULT NULL::uuid, p_source_type text DEFAULT NULL::text, p_source_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_balance NUMERIC;
  v_tx_id UUID;
  v_type TEXT;
  v_category TEXT;
  v_journal_id UUID;
  v_counter_coa TEXT;
  v_memo TEXT;
BEGIN
  IF p_account_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Kassa/bank hesabı mütləqdir';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Məbləğ sıfırdan böyük olmalıdır';
  END IF;

  v_type := trim(COALESCE(p_type, ''));
  -- Legacy migrations stored Azerbaijani labels with broken encoding (MÉ™daxil / MÉ™xaric).
  IF v_type LIKE 'M%daxil' THEN
    v_type := 'Mədaxil';
  ELSIF v_type LIKE 'M%xaric' THEN
    v_type := 'Məxaric';
  END IF;

  IF v_type IS DISTINCT FROM 'Mədaxil' AND v_type IS DISTINCT FROM 'Məxaric' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Əməliyyat növü Mədaxil və ya Məxaric olmalıdır';
  END IF;

  v_category := COALESCE(NULLIF(trim(p_category), ''), 'Digər');
  v_memo := COALESCE(NULLIF(trim(p_notes), ''), v_category);

  IF public.resolve_coa_id('1100') IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0002',
      MESSAGE = 'Hesab planında 1100 (Kassa/Bank) tapılmadı — chart-of-accounts miqrasiyasını yoxlayın';
  END IF;

  SELECT balance INTO v_balance
  FROM public.accounts
  WHERE id = p_account_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Kassa/bank hesabı tapılmadı';
  END IF;

  IF v_type = 'Məxaric' AND COALESCE(v_balance, 0) + 0.0001 < p_amount THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Kassa/bank balansı kifayət etmir';
  END IF;

  INSERT INTO public.transactions (
    account_id, type, amount, category, notes, production_order_id, source_type, source_id
  )
  VALUES (
    p_account_id,
    v_type,
    p_amount,
    v_category,
    NULLIF(trim(p_notes), ''),
    p_production_order_id,
    NULLIF(trim(p_source_type), ''),
    p_source_id
  )
  RETURNING id INTO v_tx_id;

  IF v_type = 'Mədaxil' THEN
    UPDATE public.accounts
    SET balance = COALESCE(v_balance, 0) + p_amount
    WHERE id = p_account_id;

    v_counter_coa := public.coa_credit_for_cash_in(v_category);
    v_journal_id := public.post_journal_entry(
      jsonb_build_object(
        'source_type', 'cash_transaction',
        'source_id', v_tx_id,
        'idempotency_key', 'cash_tx:' || v_tx_id::text,
        'memo', v_memo,
        'lines', jsonb_build_array(
          jsonb_build_object(
            'coa_code', '1100',
            'debit', p_amount,
            'credit', 0,
            'account_id', p_account_id,
            'line_memo', v_memo
          ),
          jsonb_build_object(
            'coa_code', v_counter_coa,
            'debit', 0,
            'credit', p_amount,
            'line_memo', v_category
          -- LED-2: the partner of the paid document on a 1200 / 2100 counter line.
          ) || public._gl_partner_tag(v_counter_coa, CASE WHEN v_counter_coa IN ('1200', '2100') THEN public._gl_partner_for_source(p_source_type, p_source_id) END)
        )
      )
    );
  ELSE
    UPDATE public.accounts
    SET balance = COALESCE(v_balance, 0) - p_amount
    WHERE id = p_account_id;

    v_counter_coa := public.coa_debit_for_cash_out(v_category);
    v_journal_id := public.post_journal_entry(
      jsonb_build_object(
        'source_type', 'cash_transaction',
        'source_id', v_tx_id,
        'idempotency_key', 'cash_tx:' || v_tx_id::text,
        'memo', v_memo,
        'lines', jsonb_build_array(
          jsonb_build_object(
            'coa_code', v_counter_coa,
            'debit', p_amount,
            'credit', 0,
            'line_memo', v_category
          -- LED-2: the partner of the paid document on a 1200 / 2100 counter line.
          ) || public._gl_partner_tag(v_counter_coa, CASE WHEN v_counter_coa IN ('1200', '2100') THEN public._gl_partner_for_source(p_source_type, p_source_id) END),
          jsonb_build_object(
            'coa_code', '1100',
            'debit', 0,
            'credit', p_amount,
            'account_id', p_account_id,
            'line_memo', v_memo
          )
        )
      )
    );
  END IF;

  UPDATE public.transactions
  SET journal_entry_id = v_journal_id
  WHERE id = v_tx_id;

  RETURN v_tx_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public._post_payment_lines(p_direction text, p_lines jsonb, p_category text, p_notes text, p_source_type text, p_source_id uuid, p_idempotency text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_line    JSONB;
  v_amount  NUMERIC;
  v_total   NUMERIC := 0;
  v_balance NUMERIC;
  v_name    TEXT;
  v_tx      UUID;
  v_txs     UUID[] := '{}';
  v_jl      JSONB := '[]'::jsonb;
  v_counter TEXT;
  v_memo    TEXT;
  v_journal UUID;
  v_in      BOOLEAN := p_direction = 'in';
BEGIN
  v_memo := COALESCE(NULLIF(btrim(p_notes), ''), p_category);
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    v_amount := (v_line->>'amount')::numeric;
    SELECT balance, name INTO v_balance, v_name FROM public.accounts WHERE id = (v_line->>'account_id')::uuid FOR UPDATE;
    IF NOT v_in AND COALESCE(v_balance, 0) + 0.0001 < v_amount THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = format('Kassa/bank balansı kifayət etmir: %s (lazım: %s, mövcud: %s)', v_name,
          trim(to_char(v_amount, 'FM999999990.00')), trim(to_char(COALESCE(v_balance, 0), 'FM999999990.00')));
    END IF;
    INSERT INTO public.transactions (account_id, type, amount, category, notes, source_type, source_id)
    VALUES ((v_line->>'account_id')::uuid, CASE WHEN v_in THEN 'Mədaxil' ELSE 'Məxaric' END, v_amount, p_category,
            COALESCE(v_line->>'note', v_memo) || ' — ' || (v_line->>'method'), p_source_type, p_source_id)
    RETURNING id INTO v_tx;
    v_txs := v_txs || v_tx;
    UPDATE public.accounts SET balance = COALESCE(v_balance, 0) + CASE WHEN v_in THEN v_amount ELSE -v_amount END
    WHERE id = (v_line->>'account_id')::uuid;
    v_jl := v_jl || jsonb_build_array(jsonb_build_object(
      'coa_code', '1100',
      'debit', CASE WHEN v_in THEN v_amount ELSE 0 END,
      'credit', CASE WHEN v_in THEN 0 ELSE v_amount END,
      'account_id', v_line->>'account_id',
      'line_memo', COALESCE(v_line->>'note', v_memo) || ' — ' || (v_line->>'method')));
    v_total := v_total + v_amount;
  END LOOP;

  v_counter := CASE WHEN v_in THEN public.coa_credit_for_cash_in(p_category) ELSE public.coa_debit_for_cash_out(p_category) END;
  v_jl := jsonb_build_array(jsonb_build_object(
      'coa_code', v_counter,
      'debit', CASE WHEN v_in THEN 0 ELSE v_total END,
      'credit', CASE WHEN v_in THEN v_total ELSE 0 END,
      'line_memo', p_category)
      -- LED-2: the partner of the paid document on a 1200 / 2100 counter line.
      || public._gl_partner_tag(v_counter, CASE WHEN v_counter IN ('1200', '2100') THEN public._gl_partner_for_source(p_source_type, p_source_id) END)) || v_jl;
  v_journal := public.post_journal_entry(jsonb_build_object(
    'source_type', 'payment_lines',
    'source_id', v_txs[1],
    'idempotency_key', COALESCE(p_idempotency, 'payment_lines:' || v_txs[1]::text),
    'memo', v_memo,
    'lines', v_jl));
  UPDATE public.transactions SET journal_entry_id = v_journal WHERE id = ANY (v_txs);
  RETURN jsonb_build_object('journal_entry_id', v_journal, 'transaction_ids', to_jsonb(v_txs));
END;
$function$;

-- ─── 2. Opening balances: partners.id, and only for those who may set them ─

-- The server actions require can_manage_settings and call with the service role (no
-- auth.uid()); a signed-in caller needs the same right (or admin).
CREATE OR REPLACE FUNCTION public._opening_balance_authorize()
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT (public.is_active_user() AND (public.user_is_admin() OR public.has_permission('can_manage_settings'))) THEN
    RAISE EXCEPTION '%', 'forbidden' USING ERRCODE = '42501';
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public._opening_balance_authorize() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._opening_balance_authorize() TO service_role;

CREATE OR REPLACE FUNCTION public.set_customer_opening_balance_atomic(
  p_customer_id UUID,
  p_opening_balance NUMERIC
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old NUMERIC;
  v_new NUMERIC := GREATEST(COALESCE(p_opening_balance, 0), 0);
  v_delta NUMERIC;
BEGIN
  PERFORM public._opening_balance_authorize();

  SELECT COALESCE(opening_balance, 0) INTO v_old
  FROM public.customers
  WHERE id = p_customer_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Müştəri tapılmadı';
  END IF;

  v_delta := v_new - v_old;

  UPDATE public.customers
  SET opening_balance = v_new
  WHERE id = p_customer_id;

  IF abs(v_delta) > 0.0001 THEN
    PERFORM public.create_journal_entry(jsonb_build_object(
      'document_type', 'customer_opening_balance',
      'document_id', p_customer_id,
      'description', 'Müştəri ilkin qalığı',
      'lines', jsonb_build_array(
        jsonb_build_object(
          'account_code', '1200',
          'debit', GREATEST(v_delta, 0),
          'credit', GREATEST(-v_delta, 0)
        ) || public._gl_partner_tag('1200', public._partner_ledger_partner(p_customer_id, NULL)),
        jsonb_build_object(
          'account_code', '3900',
          'debit', GREATEST(-v_delta, 0),
          'credit', GREATEST(v_delta, 0)
        )
      )
    ));
  END IF;

  RETURN public.refresh_customer_ar_balance(p_customer_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.set_supplier_opening_balance_atomic(
  p_supplier_id UUID,
  p_opening_balance NUMERIC
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old NUMERIC;
  v_new NUMERIC := GREATEST(COALESCE(p_opening_balance, 0), 0);
  v_delta NUMERIC;
BEGIN
  PERFORM public._opening_balance_authorize();

  SELECT COALESCE(opening_balance, 0) INTO v_old
  FROM public.suppliers
  WHERE id = p_supplier_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Təchizatçı tapılmadı';
  END IF;

  v_delta := v_new - v_old;

  UPDATE public.suppliers
  SET opening_balance = v_new
  WHERE id = p_supplier_id;

  IF abs(v_delta) > 0.0001 THEN
    PERFORM public.create_journal_entry(jsonb_build_object(
      'document_type', 'supplier_opening_balance',
      'document_id', p_supplier_id,
      'description', 'Təchizatçı ilkin qalığı',
      'lines', jsonb_build_array(
        jsonb_build_object(
          'account_code', '3900',
          'debit', GREATEST(v_delta, 0),
          'credit', GREATEST(-v_delta, 0)
        ),
        jsonb_build_object(
          'account_code', '2100',
          'debit', GREATEST(-v_delta, 0),
          'credit', GREATEST(v_delta, 0)
        ) || public._gl_partner_tag('2100', public._partner_ledger_partner(NULL, p_supplier_id))
      )
    ));
  END IF;

  RETURN public.refresh_supplier_ap_balance(p_supplier_id);
END;
$$;

-- Was granted to PUBLIC and anon by the baseline: signed-in users and the server only.
REVOKE ALL ON FUNCTION public.set_customer_opening_balance_atomic(UUID, NUMERIC) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.set_supplier_opening_balance_atomic(UUID, NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_customer_opening_balance_atomic(UUID, NUMERIC) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.set_supplier_opening_balance_atomic(UUID, NUMERIC) TO authenticated, service_role;

-- ─── 3. Production deliveries (module) ──────────────────────────────────────

DO $guard$
BEGIN
  IF to_regclass('public.production_orders') IS NULL OR to_regclass('public.production_materials') IS NULL THEN
    RETURN;
  END IF;

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
    PERFORM public.stock_move(v_product_id, COALESCE(v_order.furniture_warehouse_id, v_order.warehouse_id), -v_qty, true);

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
    PERFORM public.stock_move(v_product_id, COALESCE(v_order.furniture_warehouse_id, v_order.warehouse_id), v_qty, false);

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

    PERFORM public.stock_move(v_product_id, COALESCE(v_order.furniture_warehouse_id, v_order.warehouse_id), -v_qty, true);

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
$function$;
  $fn$;
END;
$guard$;

-- ─── 4. Partner ledger (LED-1): production deliveries count ─────────────────

-- The LED-1 view, unchanged but for the sales rule (marked LED-2).
CREATE OR REPLACE VIEW public.partner_ledger_movements
WITH (security_invoker = true)
AS
WITH
sale_docs AS (
  SELECT s.*, COALESCE(s.partner_id, public._partner_ledger_partner(s.customer_id, NULL)) AS ledger_partner
  FROM public.sales s
),
purchase_docs AS (
  SELECT p.*, COALESCE(p.partner_id, public._partner_ledger_partner(NULL, p.supplier_id)) AS ledger_partner
  FROM public.purchases p
),
-- Cash rows paid against an invoice or a production order (flows 7, 8, 22). post_cash_transaction
-- and _post_payment_lines link them with source_type / source_id; older rows may carry
-- reference_type / reference_id instead. Extra costs paid with an invoice ("Əlavə Xərc…") go to
-- third parties, not to the partner, and are left out.
invoice_cash_base AS (
  SELECT t.id, t.type, t.amount, COALESCE(t.transaction_date, t.created_at) AS moved_at, t.created_at, t.notes,
         CASE WHEN t.reference_type IN ('sale', 'purchase') THEN t.reference_type ELSE t.source_type END AS doc_kind,
         CASE WHEN t.reference_type IN ('sale', 'purchase') THEN t.reference_id ELSE t.source_id END AS doc_id
  FROM public.transactions t
  WHERE COALESCE(t.reference_type, '') <> 'storno'
    AND ((t.reference_type IN ('sale', 'purchase') AND t.reference_id IS NOT NULL)
      OR (t.source_type IN ('sale', 'purchase', 'production') AND t.source_id IS NOT NULL))
    AND COALESCE(t.category, '') NOT LIKE 'Əlavə Xərc%'
    AND COALESCE(t.amount, 0) > 0
),
-- ... and their storno rows (flow 9): the reversal of a payment, dated its own day.
invoice_cash AS (
  SELECT b.*, 'payment'::text AS kind FROM invoice_cash_base b
  UNION ALL
  SELECT r.id, r.type, r.amount, COALESCE(r.transaction_date, r.created_at), r.created_at, r.notes,
         b.doc_kind, b.doc_id, 'storno'
  FROM public.transactions r
  JOIN invoice_cash_base b ON b.id = r.reference_id
  WHERE r.reference_type = 'storno'
),
-- Import journal lines with a partner (flows 11-16). A reversal belongs to the entry it reverses.
import_lines AS (
  SELECT l.id, l.partner_id, l.debit, l.credit, l.line_memo,
         e.id AS entry_id, COALESCE(e.reversal_of, e.id) AS source_entry, e.entry_date, e.document_type,
         e.document_id, e.created_by, COALESCE(e.posted_at, e.date) AS posted_at, e.reversal_of
  FROM public.journal_entry_lines l
  JOIN public.journal_entries e ON e.id = l.journal_entry_id
  JOIN public.chart_of_accounts a ON a.id = l.coa_id
  WHERE e.document_type LIKE 'import%'
    AND a.code IN ('1200', '2100')
    AND l.partner_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.partners pa WHERE pa.id = l.partner_id)
)
-- 1. Customer opening balance. Opening balances are what was owed before the ERP: dated
-- 1900-01-01 so they come before every movement and are in every as-of balance.
SELECT
  public._partner_ledger_partner(c.id, NULL) AS partner_id,
  DATE '1900-01-01' AS entry_date,
  'opening_customer'::text AS source_type,
  c.id AS source_id,
  NULL::text AS doc_no,
  'Müştəri ilkin qalığı'::text AS description,
  round(GREATEST(c.opening_balance, 0), 2) AS debit,
  round(GREATEST(-c.opening_balance, 0), 2) AS credit,
  'AZN'::text AS currency_code,
  round(c.opening_balance, 2) AS amount_fc,
  1::numeric AS rate,
  NULL::date AS due_date,
  NULL::uuid AS created_by,
  c.created_at AS created_at,
  'receivable'::text AS side
FROM public.customers c
WHERE COALESCE(c.opening_balance, 0) <> 0
  AND public._partner_ledger_partner(c.id, NULL) IS NOT NULL

UNION ALL
-- 2. Supplier opening balance (positive = we owe them).
SELECT
  public._partner_ledger_partner(NULL, su.id),
  DATE '1900-01-01',
  'opening_supplier',
  su.id,
  NULL,
  'Təchizatçı ilkin qalığı',
  round(GREATEST(-su.opening_balance, 0), 2),
  round(GREATEST(su.opening_balance, 0), 2),
  'AZN',
  round(-su.opening_balance, 2),
  1,
  NULL,
  NULL,
  su.created_at,
  'payable'
FROM public.suppliers su
WHERE COALESCE(su.opening_balance, 0) <> 0
  AND public._partner_ledger_partner(NULL, su.id) IS NOT NULL

UNION ALL
-- 3. Posted sales invoices (AZN total; the header currency is informational).
SELECT
  s.ledger_partner,
  COALESCE(s.doc_date, public._partner_ledger_day(s.created_at)),
  'sale',
  s.id,
  COALESCE(NULLIF(btrim(s.doc_no), ''), NULLIF(btrim(s.invoice_number), ''), left(s.id::text, 8)),
  'Satış fakturası',
  round(COALESCE(s.total_amount, 0), 2),
  0,
  CASE WHEN upper(COALESCE(NULLIF(btrim(s.currency), ''), 'AZN')) <> 'AZN' AND COALESCE(s.exchange_rate, 0) > 0
       THEN upper(btrim(s.currency)) ELSE 'AZN' END,
  CASE WHEN upper(COALESCE(NULLIF(btrim(s.currency), ''), 'AZN')) <> 'AZN' AND COALESCE(s.exchange_rate, 0) > 0
       THEN round(COALESCE(s.total_amount, 0) / s.exchange_rate, 2) ELSE round(COALESCE(s.total_amount, 0), 2) END,
  CASE WHEN upper(COALESCE(NULLIF(btrim(s.currency), ''), 'AZN')) <> 'AZN' AND COALESCE(s.exchange_rate, 0) > 0
       THEN s.exchange_rate ELSE 1 END,
  s.due_date,
  s.created_by,
  s.created_at,
  'receivable'
FROM sale_docs s
WHERE s.ledger_partner IS NOT NULL
  AND (public._partner_ledger_doc_live(s.status)
       -- LED-2: a production delivery's invoice is booked (revenue, stock, advance) although
       -- process_production_delivery_event saves it with the column default 'draft'.
       OR (s.production_order_id IS NOT NULL AND lower(btrim(COALESCE(s.status, ''))) = 'draft'))
  AND COALESCE(s.total_amount, 0) <> 0

UNION ALL
-- 4. Posted purchase invoices.
SELECT
  p.ledger_partner,
  COALESCE(p.doc_date, public._partner_ledger_day(p.created_at)),
  'purchase',
  p.id,
  COALESCE(NULLIF(btrim(p.invoice_number), ''), left(p.id::text, 8)),
  'Alış fakturası',
  0,
  round(COALESCE(p.total_amount, 0), 2),
  'AZN',
  round(COALESCE(p.total_amount, 0), 2),
  1,
  p.due_date,
  p.created_by,
  p.created_at,
  'payable'
FROM purchase_docs p
WHERE p.ledger_partner IS NOT NULL
  AND public._partner_ledger_doc_live(p.status)
  AND COALESCE(p.total_amount, 0) <> 0

UNION ALL
-- 5-9, 22. Invoice and production-order payments and their reversals. Money in reduces
-- what the partner owes (credit), money out increases it (debit). Cash counts even on a
-- draft or cancelled invoice: the money moved (a refund comes as its storno row).
SELECT
  COALESCE(sd.ledger_partner, pd.ledger_partner, po.partner_id),
  public._partner_ledger_day(ic.moved_at),
  CASE WHEN ic.kind = 'storno' THEN ic.doc_kind || '_payment_reversal' ELSE ic.doc_kind || '_payment' END,
  ic.id,
  COALESCE(NULLIF(btrim(sd.doc_no), ''), NULLIF(btrim(sd.invoice_number), ''), NULLIF(btrim(pd.invoice_number), ''), po.order_no, left(ic.doc_id::text, 8)),
  COALESCE(NULLIF(btrim(ic.notes), ''), CASE WHEN ic.doc_kind = 'purchase' THEN 'Alış ödənişi' ELSE 'Satış ödənişi' END),
  CASE WHEN ic.type LIKE 'M%daxil' THEN 0 ELSE round(ic.amount, 2) END,
  CASE WHEN ic.type LIKE 'M%daxil' THEN round(ic.amount, 2) ELSE 0 END,
  'AZN',
  round(ic.amount, 2),
  1,
  NULL::date,
  NULL::uuid,
  ic.created_at,
  CASE WHEN ic.doc_kind = 'purchase' THEN 'payable' ELSE 'receivable' END
FROM invoice_cash ic
LEFT JOIN sale_docs sd ON ic.doc_kind = 'sale' AND sd.id = ic.doc_id
LEFT JOIN purchase_docs pd ON ic.doc_kind = 'purchase' AND pd.id = ic.doc_id
LEFT JOIN LATERAL public._partner_ledger_production_order(CASE WHEN ic.doc_kind = 'production' THEN ic.doc_id END) po ON TRUE
WHERE COALESCE(sd.ledger_partner, pd.ledger_partner, po.partner_id) IS NOT NULL
  AND COALESCE(ic.amount, 0) > 0

UNION ALL
-- 10. Partner payments not tied to an invoice. The copies written by import payments and
-- advances (their cash row has an import source) come from the import journal lines
-- below, at the settled amount.
SELECT
  pay.partner_id,
  public._partner_ledger_day(pay.payment_date),
  'partner_payment',
  pay.id,
  NULL,
  COALESCE(NULLIF(btrim(pay.reference_note), ''), CASE WHEN pay.payment_type = 'in' THEN 'Ödəniş qəbul edildi' ELSE 'Ödəniş edildi' END),
  CASE WHEN pay.payment_type = 'out' THEN round(pay.amount, 2) ELSE 0 END,
  CASE WHEN pay.payment_type = 'in' THEN round(pay.amount, 2) ELSE 0 END,
  'AZN',
  round(pay.amount, 2),
  1,
  NULL,
  pay.created_by,
  pay.created_at,
  -- A refund stays on the partner's own side; only a partner who is both goes by direction.
  CASE WHEN pr.is_supplier AND NOT pr.is_customer THEN 'payable'
       WHEN pr.is_customer AND NOT pr.is_supplier THEN 'receivable'
       WHEN pay.payment_type = 'in' THEN 'receivable' ELSE 'payable' END
FROM public.payments pay
LEFT JOIN public.partners pr ON pr.id = pay.partner_id
WHERE NOT EXISTS (
    SELECT 1 FROM public.transactions t
    WHERE t.id = pay.transaction_id AND COALESCE(t.source_type, '') LIKE 'import%'
  )

UNION ALL
-- 11-16. Imports, from their journal lines on 1200 / 2100 (settled amounts and FX
-- corrections are only there). Currency details when the entry belongs to exactly
-- one import payment, prepayment or payable of this partner.
SELECT
  il.partner_id,
  il.entry_date,
  CASE WHEN il.reversal_of IS NOT NULL THEN il.document_type || '_reversal' ELSE il.document_type END,
  il.id,
  sh.number,
  COALESCE(NULLIF(btrim(il.line_memo), ''), 'İdxal'),
  round(il.debit, 2),
  round(il.credit, 2),
  COALESCE(fx.currency_code, 'AZN'),
  COALESCE(fx.amount_fc, round(il.debit + il.credit, 2)),
  COALESCE(fx.rate, 1),
  NULL::date,
  il.created_by,
  il.posted_at,
  'payable'
FROM import_lines il
LEFT JOIN public.import_shipments sh ON sh.id = il.document_id
LEFT JOIN LATERAL (
  -- One row only when exactly one import document matches (else AZN, see the spec).
  SELECT min(x.currency_code) AS currency_code, min(x.amount_fc) AS amount_fc, min(x.rate) AS rate
  FROM (
    SELECT ip.currency_code, ip.amount_fc, ip.payment_rate AS rate
    FROM public.import_payments ip WHERE ip.journal_entry_id = il.source_entry
    UNION ALL
    SELECT pp.currency_code, pp.amount_fc, pp.rate
    FROM public.import_prepayments pp WHERE pp.journal_entry_id = il.source_entry
    UNION ALL
    SELECT py.currency_code, py.amount_fc, py.booking_rate
    FROM public.import_payables py
    WHERE py.journal_entry_id = il.source_entry
      AND public._partner_ledger_partner(NULL, py.partner_id) = il.partner_id
  ) x
  HAVING count(*) = 1
) fx ON TRUE;

NOTIFY pgrst, 'reload schema';
