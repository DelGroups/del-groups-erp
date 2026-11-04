-- ============================================================================
-- IMP-5: one payment from several accounts (every payment form), "Pay" on every import cost,
-- and the import shipment as a staged, trackable process.
--
-- Requires 20261104100000_imports_line_warehouses.sql (IMP-4) and the imports migrations before it.
--
-- A. Payment lines. A payment may come from (or go to) several cash / bank accounts at once:
--    "lines" [{account_id, amount, method, note}]. It is ONE payment event and ONE journal
--    entry (Dt counterparty / Kt each account, the reverse for money in), one idempotency key,
--    the period lock and the payment-date rules as before. Old calls without "lines" work
--    unchanged.
--      process_invoice_payment_event(p_payload)   payload.lines (sales and purchase invoices)
--      create_partner_payment(p_payload)          payload.lines (one payments row per line)
--      pay_import_payable / prepay_import_supplier  each split may carry method and note
--
-- B. Pay an import cost. A cost already posted (shipment confirmed, or added later) is paid
--    with pay_import_payable on its payable. A cost of a draft shipment is paid in advance:
--    pay_import_cost_advance posts Dt 2100 partner / Kt each account (a cost-linked advance in
--    import_prepayments.cost_line_id). On confirm the cost posts as before (Dt 1360 / 1410 / 6190,
--    Cr 2100 partner) and its advances settle its payable, an exchange difference to 6260 / 4960
--    as when a payable is paid; supplier (goods) prepayments are now only those without a cost.
--    The draft save keeps cost ids and refuses to change or remove a cost that has payments.
--
-- C. Stages and tracking. Transport and tracking fields on the shipment, the "cleared" step
--    (clear_import_shipment), tracking updates at every stage (update_import_tracking, ETA
--    changes logged), manual milestones (log_import_event) and an event log
--    (import_shipment_events) written by triggers on status changes, costs and payments.
--
-- Accounting that stays exactly as approved: goods Dr 1360 / Cr 2100 supplier; capitalized cost
-- Dr 1360 (+ Dr 1410 VAT) / Cr 2100 partner; customs VAT Dr 1410; other costs Dr 6190; receipt
-- Dr 1300 / Cr 1360; late costs 1300 / 5100; payment Dr 2100 / Cr cash with 4960 / 6260.
-- Safe to re-run.
-- ============================================================================

-- ─── A1. Payment lines: parse and post ──────────────────────────────────────

-- Normalised lines [{account_id, amount, method, note}] from a payload; NULL when there are none.
CREATE OR REPLACE FUNCTION public._payment_lines(p_lines JSONB)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_line   JSONB;
  v_out    JSONB := '[]'::jsonb;
  v_amount NUMERIC;
  v_acc    UUID;
  v_seen   UUID[] := '{}';
BEGIN
  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RETURN NULL;
  END IF;
  IF jsonb_array_length(p_lines) > 20 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'payment_lines_too_many: Bir ödənişdə ən çox 20 hesab ola bilər';
  END IF;
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    v_amount := round(COALESCE(NULLIF(v_line->>'amount', '')::numeric, 0), 2);
    v_acc := NULLIF(v_line->>'account_id', '')::uuid;
    IF v_acc IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Kassa/bank hesabı seçilməlidir';
    END IF;
    IF v_amount <= 0 THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Məbləğ sıfırdan böyük olmalıdır';
    END IF;
    IF v_acc = ANY (v_seen) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'payment_lines_duplicate_account: Bir hesab ödənişdə yalnız bir dəfə ola bilər';
    END IF;
    PERFORM 1 FROM public.accounts WHERE id = v_acc;
    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Seçilmiş kassa/bank hesabı tapılmadı';
    END IF;
    v_seen := v_seen || v_acc;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'account_id', v_acc,
      'amount', v_amount,
      'method', COALESCE(NULLIF(btrim(v_line->>'method'), ''), 'Ödəniş'),
      'note', NULLIF(btrim(v_line->>'note'), '')
    ));
  END LOOP;
  RETURN v_out;
END;
$$;

-- The cash side of a multi-line payment: one transaction per account (balance checked for money
-- out), one journal entry: the counter account (p_counter_coa) for the total against 1100 with
-- each account. Same accounts as post_cash_transaction, but one entry for the whole payment.
-- Returns {journal_entry_id, transaction_ids}.
CREATE OR REPLACE FUNCTION public._post_payment_lines(
  p_direction   TEXT,
  p_lines       JSONB,
  p_category    TEXT,
  p_notes       TEXT,
  p_source_type TEXT,
  p_source_id   UUID,
  p_idempotency TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
      'line_memo', p_category)) || v_jl;
  v_journal := public.post_journal_entry(jsonb_build_object(
    'source_type', 'payment_lines',
    'source_id', v_txs[1],
    'idempotency_key', COALESCE(p_idempotency, 'payment_lines:' || v_txs[1]::text),
    'memo', v_memo,
    'lines', v_jl));
  UPDATE public.transactions SET journal_entry_id = v_journal WHERE id = ANY (v_txs);
  RETURN jsonb_build_object('journal_entry_id', v_journal, 'transaction_ids', to_jsonb(v_txs));
END;
$$;
REVOKE ALL ON FUNCTION public._payment_lines(JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._post_payment_lines(TEXT, JSONB, TEXT, TEXT, TEXT, UUID, TEXT) FROM PUBLIC, anon, authenticated;

-- ─── A2. Invoice payments: one event for several accounts ───────────────────

-- As 20261029100000_backdated_invoices_payments.sql, plus payload.lines: several accounts, one
-- payment event, one journal entry (Dt each account / Cr customers for a sale; Dt suppliers / Cr
-- each account for a purchase). Without lines: the single account_id path, unchanged.
CREATE OR REPLACE FUNCTION public.process_invoice_payment_event(p_payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_idempotency TEXT;
  v_cached JSONB;
  v_document_type TEXT;
  v_document_id UUID;
  v_amount NUMERIC;
  v_account_id UUID;
  v_method TEXT;
  v_notes TEXT;
  v_payment_id TEXT;
  v_total_amount NUMERIC;
  v_paid_amount NUMERIC;
  v_remaining NUMERIC;
  v_debt_amount NUMERIC;
  v_new_paid NUMERIC;
  v_new_remaining NUMERIC;
  v_new_debt NUMERIC;
  v_customer_id UUID;
  v_supplier_id UUID;
  v_doc_label TEXT;
  v_payments JSONB;
  v_new_payment JSONB;
  v_status TEXT;
  v_tx_id UUID;
  v_journal_id UUID;
  v_event_id UUID;
  v_result JSONB;
  v_event_type TEXT;
  v_source_table TEXT;
  v_payment_date DATE;
  v_doc_date DATE;
  v_lines JSONB;
  v_line JSONB;
  v_posted JSONB;
  i INT := 0;
BEGIN
  IF p_payload IS NULL THEN
    RAISE EXCEPTION 'invalid_payload'
      USING ERRCODE = '22023',
            MESSAGE = 'Ödəniş event payload göndərilməyib';
  END IF;

  v_idempotency := NULLIF(trim(p_payload->>'idempotency_key'), '');
  IF v_idempotency IS NOT NULL THEN
    v_cached := public.find_erp_event_by_idempotency(v_idempotency);
    IF v_cached IS NOT NULL THEN
      RETURN v_cached->'result';
    END IF;
  END IF;

  v_document_type := lower(trim(COALESCE(p_payload->>'document_type', '')));
  v_document_id := NULLIF(p_payload->>'document_id', '')::uuid;
  v_lines := public._payment_lines(p_payload->'lines');
  IF v_lines IS NOT NULL THEN
    SELECT COALESCE(SUM((x->>'amount')::numeric), 0) INTO v_amount FROM jsonb_array_elements(v_lines) x;
    v_account_id := (v_lines->0->>'account_id')::uuid;
    v_method := CASE WHEN jsonb_array_length(v_lines) = 1 THEN v_lines->0->>'method' ELSE 'Bir neçə hesab' END;
  ELSE
    v_amount := COALESCE(NULLIF(p_payload->>'amount', '')::numeric, 0);
    v_account_id := NULLIF(p_payload->>'account_id', '')::uuid;
    v_method := COALESCE(NULLIF(trim(p_payload->>'method'), ''), 'Ödəniş');
  END IF;
  v_notes := NULLIF(trim(p_payload->>'notes'), '');
  v_payment_id := COALESCE(NULLIF(trim(p_payload->>'payment_id'), ''), gen_random_uuid()::text);
  -- Optional payment date (YYYY-MM-DD). The customer may have paid days earlier.
  v_payment_date := COALESCE(NULLIF(trim(p_payload->>'payment_date'), '')::date, public.document_today());

  IF v_payment_date > CURRENT_DATE + 1 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Ödəniş tarixi gələcəkdə ola bilməz';
  END IF;

  IF v_document_id IS NULL THEN
    RAISE EXCEPTION 'document_required'
      USING ERRCODE = '22023',
            MESSAGE = 'Sənəd identifikatoru tələb olunur';
  END IF;

  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'invalid_amount'
      USING ERRCODE = '22023',
            MESSAGE = 'Məbləğ sıfırdan böyük olmalıdır';
  END IF;

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'account_required'
      USING ERRCODE = '22023',
            MESSAGE = 'Kassa/bank hesabı seçilməlidir';
  END IF;

  PERFORM id FROM accounts WHERE id = v_account_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_not_found'
      USING ERRCODE = 'P0002',
            MESSAGE = 'Seçilmiş kassa/bank hesabı tapılmadı';
  END IF;

  IF v_document_type = 'sale' THEN
    IF NOT (
      public.require_permission('can_edit_sales')
      OR public.require_permission('can_create_invoice')
      OR public.require_permission('can_manage_finance')
    ) THEN
      RAISE EXCEPTION 'forbidden'
        USING ERRCODE = '42501',
              MESSAGE = 'Satış ödənişi üçün icazəniz yoxdur';
    END IF;

    SELECT total_amount, paid_amount, remaining_balance, customer_id, doc_no, payments, doc_date
    INTO v_total_amount, v_paid_amount, v_remaining, v_customer_id, v_doc_label, v_payments, v_doc_date
    FROM sales
    WHERE id = v_document_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'sale_not_found'
        USING ERRCODE = 'P0002',
              MESSAGE = 'Satış fakturası tapılmadı';
    END IF;

    PERFORM public.assert_payment_not_before_document(v_payment_date, v_doc_date);

    v_total_amount := COALESCE(v_total_amount, 0);
    v_paid_amount := COALESCE(v_paid_amount, 0);
    v_remaining := GREATEST(COALESCE(v_remaining, v_total_amount - v_paid_amount), 0);

    IF v_amount > v_remaining + 0.0001 THEN
      RAISE EXCEPTION 'overpayment'
        USING ERRCODE = '22023',
              MESSAGE = format('Qalan borc: %s AZN', trim(to_char(v_remaining, 'FM999999990.00')));
    END IF;

    v_new_paid := v_paid_amount + v_amount;
    v_new_remaining := GREATEST(v_total_amount - v_new_paid, 0);

    IF v_lines IS NULL THEN
      v_payments := COALESCE(v_payments, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
        'id', v_payment_id, 'account_id', v_account_id::text, 'method', v_method, 'amount', v_amount, 'date', v_payment_date::text));
    ELSE
      -- One entry per account in the invoice's payment list; the same payment id prefix.
      FOR v_line IN SELECT value FROM jsonb_array_elements(v_lines) LOOP
        i := i + 1;
        v_payments := COALESCE(v_payments, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
          'id', v_payment_id || CASE WHEN i > 1 THEN '-' || i::text ELSE '' END, 'payment_group', v_payment_id,
          'account_id', v_line->>'account_id', 'method', v_line->>'method', 'amount', (v_line->>'amount')::numeric,
          'date', v_payment_date::text));
      END LOOP;
    END IF;

    UPDATE sales
    SET paid_amount = v_new_paid,
        remaining_balance = v_new_remaining,
        payments = v_payments
    WHERE id = v_document_id;

    PERFORM public.use_document_date(v_payment_date);
    IF v_lines IS NULL THEN
      v_tx_id := public.post_cash_transaction(
        v_account_id,
        'Mədaxil',
        v_amount,
        'Satış Ödənişi',
        COALESCE(v_notes, format('Satış fakturası %s — %s', COALESCE(v_doc_label, v_document_id::text), v_method)),
        NULL,
        'sale',
        v_document_id
      );
      SELECT journal_entry_id INTO v_journal_id FROM transactions WHERE id = v_tx_id;
    ELSE
      v_posted := public._post_payment_lines('in', v_lines, 'Satış Ödənişi',
        COALESCE(v_notes, format('Satış fakturası %s', COALESCE(v_doc_label, v_document_id::text))), 'sale', v_document_id,
        CASE WHEN v_idempotency IS NOT NULL THEN 'payment_lines:' || v_idempotency END);
      v_journal_id := (v_posted->>'journal_entry_id')::uuid;
      v_tx_id := (v_posted->'transaction_ids'->>0)::uuid;
    END IF;

    PERFORM public.use_document_date(NULL);

    IF v_customer_id IS NOT NULL THEN
      PERFORM public.refresh_customer_ar_balance(v_customer_id);
    END IF;

    v_event_type := 'invoice_payment_sale';
    v_source_table := 'sales';

    v_result := jsonb_build_object(
      'success', true,
      'event_type', v_event_type,
      'document_type', 'sale',
      'document_id', v_document_id,
      'transaction_id', v_tx_id,
      'transaction_ids', COALESCE(v_posted->'transaction_ids', jsonb_build_array(v_tx_id)),
      'journal_entry_id', v_journal_id,
      'paid_amount', v_new_paid,
      'remaining_balance', v_new_remaining
    );
  ELSIF v_document_type = 'purchase' THEN
    IF NOT (
      public.require_permission('can_edit_purchases')
      OR public.require_permission('can_create_purchase')
      OR public.require_permission('can_manage_finance')
    ) THEN
      RAISE EXCEPTION 'forbidden'
        USING ERRCODE = '42501',
              MESSAGE = 'Alış ödənişi üçün icazəniz yoxdur';
    END IF;

    SELECT total_amount, paid_amount, debt_amount, supplier_id, invoice_number, doc_date
    INTO v_total_amount, v_paid_amount, v_debt_amount, v_supplier_id, v_doc_label, v_doc_date
    FROM purchases
    WHERE id = v_document_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'purchase_not_found'
        USING ERRCODE = 'P0002',
              MESSAGE = 'Alış fakturası tapılmadı';
    END IF;

    PERFORM public.assert_payment_not_before_document(v_payment_date, v_doc_date);

    v_total_amount := COALESCE(v_total_amount, 0);
    v_paid_amount := COALESCE(v_paid_amount, 0);
    v_debt_amount := GREATEST(COALESCE(v_debt_amount, v_total_amount - v_paid_amount), 0);

    IF v_amount > v_debt_amount + 0.0001 THEN
      RAISE EXCEPTION 'overpayment'
        USING ERRCODE = '22023',
              MESSAGE = format('Qalan borc: %s AZN', trim(to_char(v_debt_amount, 'FM999999990.00')));
    END IF;

    v_new_paid := v_paid_amount + v_amount;
    v_new_debt := GREATEST(v_total_amount - v_new_paid, 0);
    v_status := CASE WHEN v_new_debt > 0.0001 THEN 'Borclu' ELSE 'Ödənilib' END;

    UPDATE purchases
    SET paid_amount = v_new_paid,
        debt_amount = v_new_debt
    WHERE id = v_document_id;

    PERFORM public.use_document_date(v_payment_date);
    IF v_lines IS NULL THEN
      v_tx_id := public.post_cash_transaction(
        v_account_id,
        'Məxaric',
        v_amount,
        'Alış Ödənişi',
        COALESCE(v_notes, format('Alış fakturası %s — %s', COALESCE(v_doc_label, v_document_id::text), v_method)),
        NULL,
        'purchase',
        v_document_id
      );
      SELECT journal_entry_id INTO v_journal_id FROM transactions WHERE id = v_tx_id;
    ELSE
      v_posted := public._post_payment_lines('out', v_lines, 'Alış Ödənişi',
        COALESCE(v_notes, format('Alış fakturası %s', COALESCE(v_doc_label, v_document_id::text))), 'purchase', v_document_id,
        CASE WHEN v_idempotency IS NOT NULL THEN 'payment_lines:' || v_idempotency END);
      v_journal_id := (v_posted->>'journal_entry_id')::uuid;
      v_tx_id := (v_posted->'transaction_ids'->>0)::uuid;
    END IF;

    PERFORM public.use_document_date(NULL);

    IF v_supplier_id IS NOT NULL THEN
      PERFORM public.refresh_supplier_ap_balance(v_supplier_id);
    END IF;

    v_event_type := 'invoice_payment_purchase';
    v_source_table := 'purchases';

    v_result := jsonb_build_object(
      'success', true,
      'event_type', v_event_type,
      'document_type', 'purchase',
      'document_id', v_document_id,
      'transaction_id', v_tx_id,
      'transaction_ids', COALESCE(v_posted->'transaction_ids', jsonb_build_array(v_tx_id)),
      'journal_entry_id', v_journal_id,
      'paid_amount', v_new_paid,
      'debt_amount', v_new_debt,
      'status', v_status
    );
  ELSE
    RAISE EXCEPTION 'invalid_document_type'
      USING ERRCODE = '22023',
            MESSAGE = 'document_type «sale» və ya «purchase» olmalıdır';
  END IF;

  v_event_id := public.log_erp_event(
    v_event_type,
    v_source_table,
    v_document_id,
    p_payload,
    v_journal_id,
    v_idempotency,
    v_result
  );

  RETURN v_result || jsonb_build_object('event_id', v_event_id);
END;
$$;
GRANT EXECUTE ON FUNCTION public.process_invoice_payment_event(JSONB) TO authenticated;

-- ─── A3. Partner payments: one event for several accounts ───────────────────

-- As 20261029100000_backdated_invoices_payments.sql, plus payload.lines. With lines the caller
-- sends payment_method 'lines' (an older database refuses it instead of paying everything from
-- one default account); one payments row per account, all on ONE journal entry (Dt 2100
-- partner / Kt each account, or Dt each account / Kt 1200 partner for money in). The first row
-- carries the idempotency key, the others the key with ":n".
CREATE OR REPLACE FUNCTION public.create_partner_payment(p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_idempotency TEXT;
  v_existing public.payments%ROWTYPE;
  v_partner_id UUID;
  v_amount NUMERIC;
  v_payment_type TEXT;
  v_payment_method TEXT;
  v_payment_date TIMESTAMPTZ;
  v_reference_note TEXT;
  v_cash_account_id UUID;
  v_balance NUMERIC;
  v_payment_id UUID;
  v_tx_id UUID;
  v_journal_id UUID;
  v_tx_type TEXT;
  v_category TEXT;
  v_lines JSONB;
  v_line JSONB;
  v_jl JSONB := '[]'::jsonb;
  v_payment_ids UUID[] := '{}';
  v_tx_ids UUID[] := '{}';
  v_name TEXT;
  v_method TEXT;
  v_memo TEXT;
  i INT := 0;
BEGIN
  IF p_payload IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Ödəniş payload tələb olunur';
  END IF;

  IF NOT public.require_permission('can_manage_finance') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501', MESSAGE = 'Maliyyə əməliyyatı üçün icazəniz yoxdur';
  END IF;

  v_idempotency := NULLIF(trim(p_payload->>'idempotency_key'), '');
  IF v_idempotency IS NOT NULL THEN
    SELECT * INTO v_existing FROM public.payments WHERE idempotency_key = v_idempotency LIMIT 1;
    IF FOUND THEN
      RETURN jsonb_build_object(
        'success', true,
        'payment_id', v_existing.id,
        'journal_entry_id', v_existing.journal_entry_id,
        'transaction_id', v_existing.transaction_id,
        'idempotent', true
      );
    END IF;
  END IF;

  v_partner_id := NULLIF(p_payload->>'partner_id', '')::uuid;
  v_payment_type := lower(trim(COALESCE(p_payload->>'payment_type', '')));
  v_payment_method := lower(trim(COALESCE(p_payload->>'payment_method', 'cash')));
  v_payment_date := COALESCE(NULLIF(p_payload->>'payment_date', '')::timestamptz, NOW());
  v_reference_note := NULLIF(trim(p_payload->>'reference_note'), '');
  v_cash_account_id := NULLIF(p_payload->>'cash_account_id', '')::uuid;
  v_lines := public._payment_lines(p_payload->'lines');
  IF v_lines IS NOT NULL THEN
    SELECT COALESCE(SUM((x->>'amount')::numeric), 0) INTO v_amount FROM jsonb_array_elements(v_lines) x;
  ELSE
    v_amount := COALESCE(NULLIF(p_payload->>'amount', '')::numeric, 0);
  END IF;

  IF v_partner_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Tərəfdaş seçilməlidir';
  END IF;
  IF v_amount <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Məbləğ sıfırdan böyük olmalıdır';
  END IF;
  IF v_payment_type NOT IN ('in', 'out') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'payment_type «in» və ya «out» olmalıdır';
  END IF;
  IF v_lines IS NULL AND v_payment_method NOT IN ('cash', 'bank') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'payment_method «cash» və ya «bank» olmalıdır';
  END IF;

  PERFORM id FROM public.partners WHERE id = v_partner_id AND is_deleted = FALSE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'partner_not_found' USING ERRCODE = 'P0002', MESSAGE = 'Tərəfdaş tapılmadı';
  END IF;

  v_tx_type := CASE WHEN v_payment_type = 'in' THEN 'Mədaxil' ELSE 'Məxaric' END;
  v_category := CASE WHEN v_payment_type = 'in' THEN 'Tərəfdaşdan mədaxil' ELSE 'Tərəfdaşa məxaric' END;

  -- Several accounts: one payments row and one transaction per account, one journal entry.
  IF v_lines IS NOT NULL THEN
    v_memo := COALESCE(v_reference_note, 'Tərəfdaş ödənişi');
    PERFORM public.use_document_date((v_payment_date AT TIME ZONE 'Asia/Baku')::date);
    FOR v_line IN SELECT value FROM jsonb_array_elements(v_lines) LOOP
      i := i + 1;
      v_amount := (v_line->>'amount')::numeric;
      v_cash_account_id := (v_line->>'account_id')::uuid;
      v_method := CASE WHEN lower(v_line->>'method') IN ('cash', 'nağd', 'nagd') THEN 'cash' ELSE 'bank' END;
      SELECT balance, name INTO v_balance, v_name FROM public.accounts WHERE id = v_cash_account_id FOR UPDATE;
      IF v_payment_type = 'out' AND COALESCE(v_balance, 0) + 0.0001 < v_amount THEN
        RAISE EXCEPTION 'insufficient_balance' USING ERRCODE = '22023', MESSAGE = format('Hesab balansı kifayət etmir: %s', v_name);
      END IF;
      INSERT INTO public.payments (payment_date, partner_id, amount, payment_type, payment_method, reference_note, cash_account_id, idempotency_key, created_by)
      VALUES (v_payment_date, v_partner_id, v_amount, v_payment_type, v_method, COALESCE(v_line->>'note', v_reference_note), v_cash_account_id,
              CASE WHEN v_idempotency IS NULL THEN NULL WHEN i = 1 THEN v_idempotency ELSE v_idempotency || ':' || i::text END, auth.uid())
      RETURNING id INTO v_payment_id;
      v_payment_ids := v_payment_ids || v_payment_id;
      INSERT INTO public.transactions (account_id, amount, type, unified_type, category, notes, description, transaction_date, created_at,
                                       reference_type, reference_id, source_type, source_id)
      VALUES (v_cash_account_id, v_amount, v_tx_type, CASE WHEN v_payment_type = 'in' THEN 'INCOME' ELSE 'EXPENSE' END, v_category,
              COALESCE(v_line->>'note', v_reference_note, v_category), COALESCE(v_line->>'note', v_reference_note, v_category),
              v_payment_date, NOW(), 'partner_payment', v_payment_id, 'partner_payment', v_payment_id)
      RETURNING id INTO v_tx_id;
      v_tx_ids := v_tx_ids || v_tx_id;
      UPDATE public.payments SET transaction_id = v_tx_id WHERE id = v_payment_id;
      UPDATE public.accounts SET balance = COALESCE(v_balance, 0) + CASE WHEN v_payment_type = 'in' THEN v_amount ELSE -v_amount END
      WHERE id = v_cash_account_id;
      v_jl := v_jl || jsonb_build_array(jsonb_build_object(
        'account_code', public.gl_coa_for_payment_method(v_method),
        'debit', CASE WHEN v_payment_type = 'in' THEN v_amount ELSE 0 END,
        'credit', CASE WHEN v_payment_type = 'in' THEN 0 ELSE v_amount END,
        'cash_account_id', v_cash_account_id,
        'line_memo', COALESCE(v_line->>'note', v_memo) || ' — ' || (v_line->>'method')));
    END LOOP;
    SELECT COALESCE(SUM((x->>'amount')::numeric), 0) INTO v_amount FROM jsonb_array_elements(v_lines) x;
    v_jl := jsonb_build_array(jsonb_build_object(
      'account_code', CASE WHEN v_payment_type = 'in' THEN '1200' ELSE '2100' END,
      'debit', CASE WHEN v_payment_type = 'in' THEN 0 ELSE v_amount END,
      'credit', CASE WHEN v_payment_type = 'in' THEN v_amount ELSE 0 END,
      'partner_type', 'partner',
      'partner_id', v_partner_id,
      'line_memo', CASE WHEN v_payment_type = 'in' THEN 'Alacaq azaldılması — ' ELSE 'Öhdəlik azaldılması — ' END || v_memo)) || v_jl;
    v_journal_id := public.create_journal_entry(jsonb_build_object(
      'document_type', CASE WHEN v_payment_type = 'in' THEN 'payment_receipt' ELSE 'payment_disbursement' END,
      'document_id', v_payment_ids[1],
      'source_type', CASE WHEN v_payment_type = 'in' THEN 'payment_receipt' ELSE 'payment_disbursement' END,
      'source_id', v_payment_ids[1],
      'idempotency_key', 'partner_payment:' || v_payment_ids[1]::text,
      'description', v_memo,
      'memo', v_memo,
      'lines', v_jl));
    PERFORM public.use_document_date(NULL);
    UPDATE public.payments SET journal_entry_id = v_journal_id WHERE id = ANY (v_payment_ids);
    UPDATE public.transactions SET journal_entry_id = v_journal_id WHERE id = ANY (v_tx_ids);
    PERFORM public.refresh_partner_linked_balances(v_partner_id);
    RETURN jsonb_build_object(
      'success', true,
      'payment_id', v_payment_ids[1],
      'payment_ids', to_jsonb(v_payment_ids),
      'journal_entry_id', v_journal_id,
      'transaction_id', v_tx_ids[1],
      'transaction_ids', to_jsonb(v_tx_ids)
    );
  END IF;

  -- One account: unchanged.
  IF v_cash_account_id IS NULL THEN
    v_cash_account_id := public.resolve_default_cash_account_id(v_payment_method);
  END IF;
  IF v_cash_account_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Kassa/bank hesabı tapılmadı';
  END IF;

  SELECT balance INTO v_balance FROM public.accounts WHERE id = v_cash_account_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'account_not_found' USING ERRCODE = 'P0002', MESSAGE = 'Kassa/bank hesabı tapılmadı';
  END IF;
  IF v_payment_type = 'out' AND COALESCE(v_balance, 0) + 0.0001 < v_amount THEN
    RAISE EXCEPTION 'insufficient_balance' USING ERRCODE = '22023', MESSAGE = 'Hesab balansı kifayət etmir';
  END IF;

  INSERT INTO public.payments (payment_date, partner_id, amount, payment_type, payment_method, reference_note, cash_account_id, idempotency_key, created_by)
  VALUES (v_payment_date, v_partner_id, v_amount, v_payment_type, v_payment_method, v_reference_note, v_cash_account_id, v_idempotency, auth.uid())
  RETURNING id INTO v_payment_id;

  INSERT INTO public.transactions (account_id, amount, type, unified_type, category, notes, description, transaction_date, created_at,
                                   reference_type, reference_id, source_type, source_id)
  VALUES (v_cash_account_id, v_amount, v_tx_type, CASE WHEN v_payment_type = 'in' THEN 'INCOME' ELSE 'EXPENSE' END, v_category,
          COALESCE(v_reference_note, v_category), COALESCE(v_reference_note, v_category), v_payment_date, NOW(),
          'partner_payment', v_payment_id, 'partner_payment', v_payment_id)
  RETURNING id INTO v_tx_id;

  IF v_payment_type = 'in' THEN
    UPDATE public.accounts SET balance = COALESCE(v_balance, 0) + v_amount WHERE id = v_cash_account_id;
  ELSE
    UPDATE public.accounts SET balance = COALESCE(v_balance, 0) - v_amount WHERE id = v_cash_account_id;
  END IF;

  PERFORM public.use_document_date((v_payment_date AT TIME ZONE 'Asia/Baku')::date);
  v_journal_id := public.post_partner_payment_gl_journal(
    v_payment_id, v_partner_id, v_amount, v_payment_type, v_payment_method, v_cash_account_id, v_reference_note);
  PERFORM public.use_document_date(NULL);

  UPDATE public.payments SET journal_entry_id = v_journal_id, transaction_id = v_tx_id WHERE id = v_payment_id;
  UPDATE public.transactions SET journal_entry_id = v_journal_id WHERE id = v_tx_id;

  PERFORM public.refresh_partner_linked_balances(v_partner_id);

  RETURN jsonb_build_object('success', true, 'payment_id', v_payment_id, 'journal_entry_id', v_journal_id, 'transaction_id', v_tx_id);
END;
$function$;

-- ─── B1. Columns: tracking, cost-linked advances ────────────────────────────

ALTER TABLE public.import_shipments ADD COLUMN IF NOT EXISTS transport_mode TEXT;
ALTER TABLE public.import_shipments ADD COLUMN IF NOT EXISTS carrier_id UUID REFERENCES public.suppliers (id) ON DELETE SET NULL;
ALTER TABLE public.import_shipments ADD COLUMN IF NOT EXISTS tracking_no TEXT;
ALTER TABLE public.import_shipments ADD COLUMN IF NOT EXISTS vehicle_no TEXT;
ALTER TABLE public.import_shipments ADD COLUMN IF NOT EXISTS etd DATE;
ALTER TABLE public.import_shipments ADD COLUMN IF NOT EXISTS eta DATE;
ALTER TABLE public.import_shipments ADD COLUMN IF NOT EXISTS departed_on DATE;
ALTER TABLE public.import_shipments ADD COLUMN IF NOT EXISTS arrived_on DATE;
ALTER TABLE public.import_shipments ADD COLUMN IF NOT EXISTS cleared_on DATE;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_shipments_transport_mode_check') THEN
    ALTER TABLE public.import_shipments ADD CONSTRAINT import_shipments_transport_mode_check
      CHECK (transport_mode IS NULL OR transport_mode IN ('road', 'sea', 'rail', 'air', 'multimodal'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_shipments_tracking_len_check') THEN
    ALTER TABLE public.import_shipments ADD CONSTRAINT import_shipments_tracking_len_check
      CHECK ((tracking_no IS NULL OR length(tracking_no) <= 100) AND (vehicle_no IS NULL OR length(vehicle_no) <= 100));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS import_shipments_eta_idx ON public.import_shipments (eta) WHERE eta IS NOT NULL;
CREATE INDEX IF NOT EXISTS import_shipments_carrier_idx ON public.import_shipments (carrier_id) WHERE carrier_id IS NOT NULL;

-- A payment for one cost of a draft shipment (IMP-5). The draft save keeps cost ids (and
-- re-inserts the row in the same transaction), so the foreign key is checked at commit.
ALTER TABLE public.import_prepayments ADD COLUMN IF NOT EXISTS cost_line_id UUID;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'import_prepayments_cost_line_fk') THEN
    ALTER TABLE public.import_prepayments ADD CONSTRAINT import_prepayments_cost_line_fk
      FOREIGN KEY (cost_line_id) REFERENCES public.import_cost_lines (id) DEFERRABLE INITIALLY DEFERRED;
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS import_prepayments_cost_idx ON public.import_prepayments (cost_line_id) WHERE cost_line_id IS NOT NULL;
COMMENT ON COLUMN public.import_prepayments.cost_line_id IS
  'IMP-5: a payment for this cost of a draft shipment (Dt 2100 partner). NULL = a supplier prepayment for the goods.';

-- ─── B2. Event log ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.import_shipment_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id UUID NOT NULL REFERENCES public.import_shipments (id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('created', 'confirmed', 'departed', 'eta_changed', 'arrived_customs', 'cleared',
                                            'received_partial', 'received', 'cost_added', 'cost_paid', 'supplier_paid',
                                            'closed', 'reopened', 'cancelled', 'note')),
  event_date  DATE NOT NULL,
  note        TEXT CHECK (note IS NULL OR length(note) <= 1000),
  -- Figures of automatic events (amount, currency, cost type, old and new ETA …) for the timeline.
  data        JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by  UUID DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS import_shipment_events_shipment_idx ON public.import_shipment_events (shipment_id, event_date, created_at);

-- Read like the other import tables; written only by the functions and triggers below.
ALTER TABLE public.import_shipment_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS import_shipment_events_select ON public.import_shipment_events;
CREATE POLICY import_shipment_events_select ON public.import_shipment_events FOR SELECT TO authenticated
  USING ((SELECT public.imports_can_read()));
GRANT SELECT ON public.import_shipment_events TO authenticated;
GRANT ALL ON public.import_shipment_events TO service_role;

-- The document date being posted (use_document_date), else today in Baku.
CREATE OR REPLACE FUNCTION public._imports_event_date()
RETURNS DATE
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(NULLIF(current_setting('app.document_date', true), '')::date, public.document_today());
$$;

CREATE OR REPLACE FUNCTION public._imports_log_event(p_shipment UUID, p_kind TEXT, p_date DATE, p_note TEXT DEFAULT NULL, p_data JSONB DEFAULT '{}'::jsonb)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO public.import_shipment_events (shipment_id, kind, event_date, note, data)
  VALUES (p_shipment, p_kind, COALESCE(p_date, public._imports_event_date()), NULLIF(btrim(p_note), ''), COALESCE(p_data, '{}'::jsonb))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public._imports_log_event(UUID, TEXT, DATE, TEXT, JSONB) FROM PUBLIC, anon, authenticated;

-- Automatic events: the existing posting functions are not changed for this; the triggers see
-- every status change, every cost added after the draft and every payment.
CREATE OR REPLACE FUNCTION public._imports_events_shipment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_kind TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public._imports_log_event(NEW.id, 'created', (NEW.created_at AT TIME ZONE 'Asia/Baku')::date);
    RETURN NEW;
  END IF;
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;
  v_kind := CASE
    WHEN NEW.status = 'confirmed' THEN 'confirmed'
    WHEN NEW.status = 'cleared' THEN 'cleared'
    WHEN NEW.status = 'partially_received' THEN 'received_partial'
    WHEN NEW.status = 'received' AND OLD.status = 'closed' THEN 'reopened'
    WHEN NEW.status = 'received' THEN 'received'
    WHEN NEW.status = 'closed' THEN 'closed'
    WHEN NEW.status = 'cancelled' THEN 'cancelled'
  END;
  IF v_kind IS NOT NULL THEN
    PERFORM public._imports_log_event(NEW.id, v_kind,
      CASE WHEN v_kind = 'cleared' THEN COALESCE(NEW.cleared_on, public._imports_event_date()) ELSE public._imports_event_date() END,
      CASE WHEN v_kind = 'cancelled' THEN NEW.cancel_reason END,
      jsonb_build_object('from', OLD.status, 'to', NEW.status));
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_import_shipments_events ON public.import_shipments;
CREATE TRIGGER trg_import_shipments_events AFTER INSERT OR UPDATE OF status ON public.import_shipments
  FOR EACH ROW EXECUTE FUNCTION public._imports_events_shipment();

CREATE OR REPLACE FUNCTION public._imports_events_cost()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Draft saves re-insert every cost; only costs added after confirmation are events.
  IF NEW.added_at_status IS DISTINCT FROM 'draft' THEN
    PERFORM public._imports_log_event(NEW.shipment_id, 'cost_added', NULL, NEW.description, jsonb_build_object(
      'cost_type', NEW.cost_type, 'amount', NEW.amount, 'currency', NEW.currency_code, 'estimate', NEW.is_estimate));
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_import_cost_lines_events ON public.import_cost_lines;
CREATE TRIGGER trg_import_cost_lines_events AFTER INSERT ON public.import_cost_lines
  FOR EACH ROW EXECUTE FUNCTION public._imports_events_cost();

CREATE OR REPLACE FUNCTION public._imports_events_payment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_p    public.import_payables;
  v_cost public.import_cost_lines;
BEGIN
  IF TG_TABLE_NAME = 'import_payments' THEN
    SELECT * INTO v_p FROM public.import_payables WHERE id = NEW.payable_id;
    IF v_p.source = 'cost' THEN
      SELECT * INTO v_cost FROM public.import_cost_lines WHERE id = v_p.cost_line_id;
    END IF;
    PERFORM public._imports_log_event(NEW.shipment_id, CASE WHEN v_p.source = 'cost' THEN 'cost_paid' ELSE 'supplier_paid' END,
      NEW.payment_date, NEW.note, jsonb_build_object(
        'amount_azn', NEW.amount_azn, 'amount_fc', NEW.amount_fc, 'currency', NEW.currency_code,
        'cost_type', v_cost.cost_type, 'cost_description', v_cost.description, 'partner_id', v_p.partner_id));
  ELSE
    IF NEW.cost_line_id IS NOT NULL THEN
      SELECT * INTO v_cost FROM public.import_cost_lines WHERE id = NEW.cost_line_id;
    END IF;
    PERFORM public._imports_log_event(NEW.shipment_id, CASE WHEN NEW.cost_line_id IS NOT NULL THEN 'cost_paid' ELSE 'supplier_paid' END,
      NEW.payment_date, NEW.note, jsonb_build_object(
        'amount_azn', NEW.amount_azn, 'amount_fc', NEW.amount_fc, 'currency', NEW.currency_code, 'advance', true,
        'cost_type', v_cost.cost_type, 'cost_description', v_cost.description, 'partner_id', NEW.partner_id));
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_import_payments_events ON public.import_payments;
CREATE TRIGGER trg_import_payments_events AFTER INSERT ON public.import_payments
  FOR EACH ROW EXECUTE FUNCTION public._imports_events_payment();
DROP TRIGGER IF EXISTS trg_import_prepayments_events ON public.import_prepayments;
CREATE TRIGGER trg_import_prepayments_events AFTER INSERT ON public.import_prepayments
  FOR EACH ROW EXECUTE FUNCTION public._imports_events_payment();

-- Shipments created before this migration get their "created" event once.
INSERT INTO public.import_shipment_events (shipment_id, kind, event_date, created_by, created_at)
SELECT s.id, 'created', (s.created_at AT TIME ZONE 'Asia/Baku')::date, s.created_by, s.created_at
FROM public.import_shipments s
WHERE NOT EXISTS (SELECT 1 FROM public.import_shipment_events e WHERE e.shipment_id = s.id AND e.kind = 'created');

-- ─── B3. Payment method of an import payment line ───────────────────────────

-- payments.payment_method is 'cash' or 'bank': the line's method when given (cash; transfer and
-- card are bank), else the account's type, as before.
CREATE OR REPLACE FUNCTION public._imports_payment_method(p_account_id UUID, p_method TEXT)
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN lower(COALESCE(p_method, '')) IN ('cash', 'nağd', 'nagd') THEN 'cash'
    WHEN lower(COALESCE(p_method, '')) IN ('transfer', 'card', 'bank', 'köçürmə', 'kart') THEN 'bank'
    WHEN COALESCE((SELECT type FROM public.accounts WHERE id = p_account_id), '') ILIKE '%bank%' THEN 'bank'
    ELSE 'cash'
  END;
$$;
REVOKE ALL ON FUNCTION public._imports_payment_method(UUID, TEXT) FROM PUBLIC, anon, authenticated;

-- ─── B4. Import payments: method and note per account line ──────────────────

-- As 20261030120000_imports_fx.sql (same signature); each split may now carry "method"
-- (cash / transfer / card) and "note". One entry: Dr 2100 booking value / Cr each account /
-- 6260 or 4960.
CREATE OR REPLACE FUNCTION public.pay_import_payable(
  p_payable_id      UUID,
  p_payment_date    DATE,
  p_note            TEXT,
  p_splits          JSONB,
  p_idempotency_key TEXT DEFAULT NULL,
  p_amount_fc       NUMERIC DEFAULT NULL,
  p_rate            NUMERIC DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_done     JSONB := public._imports_op_get(p_idempotency_key);
  v_p        public.import_payables;
  v_s        public.import_shipments;
  v_split    JSONB;
  v_amount   NUMERIC;
  v_total    NUMERIC := 0;
  v_open_fc  NUMERIC;
  v_open_azn NUMERIC;
  v_fc       NUMERIC;
  v_rate     NUMERIC;
  v_settle   NUMERIC;
  v_diff     NUMERIC;
  v_pay      UUID;
  v_tx       UUID;
  v_lines    JSONB := '[]'::jsonb;
  v_journal  UUID;
  v_partner  UUID;
  v_label    TEXT;
  v_note     TEXT;
  v_payment_ids UUID[] := '{}';
  v_tx_ids   UUID[] := '{}';
  v_date     DATE := COALESCE(p_payment_date, public.document_today());
BEGIN
  IF v_done IS NOT NULL THEN RETURN v_done; END IF;
  PERFORM public._imports_require('manage');

  SELECT * INTO v_p FROM public.import_payables WHERE id = p_payable_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'imports_not_found: Borc tapılmadı';
  END IF;
  SELECT * INTO v_s FROM public.import_shipments WHERE id = v_p.shipment_id;
  IF v_s.status IN ('closed', 'cancelled') OR v_p.status <> 'open' THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'imports_cannot_pay: Bu borc ödənilə bilməz (bağlı idxal və ya ödənilib)';
  END IF;
  IF v_date < v_p.document_date THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = format('imports_payment_before_document: Ödəniş tarixi (%s) borcun tarixindən (%s) əvvəl ola bilməz',
        to_char(v_date, 'DD.MM.YYYY'), to_char(v_p.document_date, 'DD.MM.YYYY'));
  END IF;
  IF p_splits IS NULL OR jsonb_typeof(p_splits) <> 'array' OR jsonb_array_length(p_splits) = 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'imports_splits_required: Ən azı bir hesab seçin';
  END IF;
  FOR v_split IN SELECT value FROM jsonb_array_elements(p_splits) LOOP
    v_amount := round(COALESCE((v_split->>'amount')::numeric, 0), 2);
    IF v_amount <= 0 OR NULLIF(v_split->>'account_id', '') IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'imports_invalid_split: Hər hissədə hesab və müsbət məbləğ olmalıdır';
    END IF;
    v_total := v_total + v_amount;
  END LOOP;

  v_open_fc := v_p.amount_fc - v_p.paid_fc;
  v_open_azn := v_p.amount_azn - v_p.paid_azn;

  IF v_p.currency_code = 'AZN' THEN
    v_fc := v_total;
    v_rate := 1;
    IF v_total > v_open_azn + 0.005 THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = format('imports_overpay: Ödəniş (%s) qalıq borcdan (%s) çoxdur', v_total, v_open_azn);
    END IF;
    v_settle := v_total;
  ELSE
    v_fc := round(COALESCE(p_amount_fc, 0), 2);
    v_rate := COALESCE(p_rate, 0);
    IF v_fc <= 0 OR v_rate <= 0 THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = format('imports_fx_required: %s borcu üçün valyuta məbləği və ödəniş günü məzənnəsi lazımdır', v_p.currency_code);
    END IF;
    IF v_fc > v_open_fc + 0.005 THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = format('imports_overpay: Ödəniş (%s %s) qalıq borcdan (%s %s) çoxdur', v_fc, v_p.currency_code, v_open_fc, v_p.currency_code);
    END IF;
    IF abs(v_total - round(v_fc * v_rate, 2)) > 0.011 THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = format('imports_splits_mismatch: Hesablardan çıxan (%s AZN) %s %s × %s = %s AZN-ə bərabər deyil',
          v_total, v_fc, v_p.currency_code, v_rate, round(v_fc * v_rate, 2));
    END IF;
    v_settle := CASE WHEN v_fc >= v_open_fc - 0.005 THEN v_open_azn
                     ELSE round(v_open_azn * v_fc / NULLIF(v_open_fc, 0), 2) END;
  END IF;
  v_diff := round(v_total - v_settle, 2);

  PERFORM public.use_document_date(v_date);
  v_label := format('%s — %s', v_s.number, COALESCE(NULLIF(btrim(p_note), ''), 'İdxal ödənişi'));
  v_partner := public.resolve_unified_partner_id(NULL, v_p.partner_id);

  INSERT INTO public.import_payments (payable_id, shipment_id, payment_date, note, amount_azn, currency_code, amount_fc, payment_rate, settled_azn, fx_difference_azn)
  VALUES (p_payable_id, v_s.id, v_date, NULLIF(btrim(p_note), ''), v_total, v_p.currency_code, v_fc, v_rate, v_settle, v_diff)
  RETURNING id INTO v_pay;

  v_lines := v_lines || public._imports_line('2100', v_settle, 'Kreditor ödənişi — ' || v_label, v_partner);
  IF v_diff > 0 THEN
    v_lines := v_lines || public._imports_line('6260', v_diff, format('Məzənnə fərqi (zərər) — %s: %s %s, %s → %s', v_label, v_fc, v_p.currency_code, round(v_settle / NULLIF(v_fc, 0), 6), v_rate));
  ELSIF v_diff < 0 THEN
    v_lines := v_lines || public._imports_line('4960', v_diff, format('Məzənnə fərqi (gəlir) — %s: %s %s, %s → %s', v_label, v_fc, v_p.currency_code, round(v_settle / NULLIF(v_fc, 0), 6), v_rate));
  END IF;

  FOR v_split IN SELECT value FROM jsonb_array_elements(p_splits) LOOP
    v_amount := round((v_split->>'amount')::numeric, 2);
    v_note := 'İdxal ödənişi — ' || v_label || COALESCE(' · ' || NULLIF(btrim(v_split->>'note'), ''), '');
    v_tx := public._imports_cash_out((v_split->>'account_id')::uuid, v_amount, v_note, v_s.id, 'import_payment', v_pay);
    v_tx_ids := v_tx_ids || v_tx;
    INSERT INTO public.import_payment_splits (payment_id, account_id, amount_azn, transaction_id)
    VALUES (v_pay, (v_split->>'account_id')::uuid, v_amount, v_tx);
    v_lines := v_lines || public._imports_line(public._imports_cash_coa((v_split->>'account_id')::uuid), -v_amount, v_label, NULL, (v_split->>'account_id')::uuid);
    IF v_partner IS NOT NULL THEN
      INSERT INTO public.payments (payment_date, partner_id, amount, payment_type, payment_method, reference_note, cash_account_id, transaction_id, idempotency_key, created_by)
      VALUES (COALESCE(public.document_timestamp(), NOW()), v_partner, v_amount, 'out',
              public._imports_payment_method((v_split->>'account_id')::uuid, v_split->>'method'),
              v_note, (v_split->>'account_id')::uuid, v_tx,
              'import_payment:' || v_pay::text || ':' || v_tx::text, auth.uid())
      RETURNING id INTO v_tx;
      v_payment_ids := v_payment_ids || v_tx;
    END IF;
  END LOOP;

  v_journal := public.create_journal_entry(jsonb_build_object(
    'document_type', 'import_payment',
    'document_id', v_s.id,
    'idempotency_key', 'import_payment:' || v_pay::text,
    'entry_date', v_date,
    'description', format('İdxal %s: ödəniş%s', v_s.number,
      CASE WHEN v_p.currency_code <> 'AZN' THEN format(' %s %s × %s', v_fc, v_p.currency_code, v_rate) ELSE '' END),
    'lines', v_lines
  ));
  UPDATE public.import_payments SET journal_entry_id = v_journal WHERE id = v_pay;
  UPDATE public.transactions SET journal_entry_id = v_journal WHERE id = ANY (v_tx_ids);
  UPDATE public.payments SET journal_entry_id = v_journal WHERE id = ANY (v_payment_ids);
  UPDATE public.import_payables
  SET paid_azn = round(paid_azn + v_settle, 2),
      paid_fc = round(paid_fc + v_fc, 2),
      status = CASE WHEN round(paid_fc + v_fc, 2) >= amount_fc - 0.005 THEN 'paid' ELSE 'open' END
  WHERE id = p_payable_id;
  PERFORM public.use_document_date(NULL);
  PERFORM public.refresh_supplier_ap_balance(v_p.partner_id);

  RETURN public._imports_op_put(p_idempotency_key, 'pay', v_s.id, jsonb_build_object(
    'success', true, 'payment_id', v_pay, 'journal_entry_id', v_journal, 'amount_azn', v_total,
    'amount_fc', v_fc, 'settled_azn', v_settle, 'fx_difference_azn', v_diff,
    'remaining_fc', round(v_open_fc - v_fc, 2), 'remaining_azn', round(v_open_azn - v_settle, 2)));
END;
$$;

-- Shared by the supplier prepayment and the cost advance: the cash side and the entry
-- (Dt 2100 partner / Cr each account), one payments row per account. Returns the journal id.
CREATE OR REPLACE FUNCTION public._imports_advance_post(
  p_prepayment  UUID,
  p_shipment    public.import_shipments,
  p_supplier    UUID,
  p_splits      JSONB,
  p_label       TEXT,
  p_doc_type    TEXT,
  p_description TEXT,
  p_date        DATE
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_split   JSONB;
  v_amount  NUMERIC;
  v_total   NUMERIC := 0;
  v_tx      UUID;
  v_pid     UUID;
  v_tx_ids  UUID[] := '{}';
  v_payment_ids UUID[] := '{}';
  v_lines   JSONB := '[]'::jsonb;
  v_journal UUID;
  v_partner UUID := public.resolve_unified_partner_id(NULL, p_supplier);
  v_note    TEXT;
BEGIN
  FOR v_split IN SELECT value FROM jsonb_array_elements(p_splits) LOOP
    v_amount := round((v_split->>'amount')::numeric, 2);
    v_total := v_total + v_amount;
    v_note := p_label || COALESCE(' · ' || NULLIF(btrim(v_split->>'note'), ''), '');
    v_tx := public._imports_cash_out((v_split->>'account_id')::uuid, v_amount, v_note, p_shipment.id, p_doc_type, p_prepayment);
    v_tx_ids := v_tx_ids || v_tx;
    v_lines := v_lines || public._imports_line(public._imports_cash_coa((v_split->>'account_id')::uuid), -v_amount, p_label, NULL, (v_split->>'account_id')::uuid);
    IF v_partner IS NOT NULL THEN
      INSERT INTO public.payments (payment_date, partner_id, amount, payment_type, payment_method, reference_note, cash_account_id, transaction_id, idempotency_key, created_by)
      VALUES (COALESCE(public.document_timestamp(), NOW()), v_partner, v_amount, 'out',
              public._imports_payment_method((v_split->>'account_id')::uuid, v_split->>'method'),
              v_note, (v_split->>'account_id')::uuid, v_tx, p_doc_type || ':' || p_prepayment::text || ':' || v_tx::text, auth.uid())
      RETURNING id INTO v_pid;
      v_payment_ids := v_payment_ids || v_pid;
    END IF;
  END LOOP;
  v_lines := jsonb_build_array(public._imports_line('2100', v_total, p_label, v_partner)) || v_lines;

  v_journal := public.create_journal_entry(jsonb_build_object(
    'document_type', p_doc_type,
    'document_id', p_shipment.id,
    'idempotency_key', p_doc_type || ':' || p_prepayment::text,
    'entry_date', p_date,
    'description', p_description,
    'lines', v_lines
  ));
  UPDATE public.import_prepayments SET journal_entry_id = v_journal WHERE id = p_prepayment;
  UPDATE public.transactions SET journal_entry_id = v_journal WHERE id = ANY (v_tx_ids);
  UPDATE public.payments SET journal_entry_id = v_journal WHERE id = ANY (v_payment_ids);
  RETURN v_journal;
END;
$$;
REVOKE ALL ON FUNCTION public._imports_advance_post(UUID, public.import_shipments, UUID, JSONB, TEXT, TEXT, TEXT, DATE) FROM PUBLIC, anon, authenticated;

-- Sum check of payment splits [{account_id, amount, method?, note?}] in AZN.
CREATE OR REPLACE FUNCTION public._imports_splits_total(p_splits JSONB)
RETURNS NUMERIC
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_split  JSONB;
  v_amount NUMERIC;
  v_total  NUMERIC := 0;
BEGIN
  IF p_splits IS NULL OR jsonb_typeof(p_splits) <> 'array' OR jsonb_array_length(p_splits) = 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'imports_splits_required: Ən azı bir hesab seçin';
  END IF;
  FOR v_split IN SELECT value FROM jsonb_array_elements(p_splits) LOOP
    v_amount := round(COALESCE((v_split->>'amount')::numeric, 0), 2);
    IF v_amount <= 0 OR NULLIF(v_split->>'account_id', '') IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'imports_invalid_split: Hər hissədə hesab və müsbət məbləğ olmalıdır';
    END IF;
    v_total := v_total + v_amount;
  END LOOP;
  RETURN v_total;
END;
$$;

-- As 20261030120000_imports_fx.sql (same signature); splits may carry method and note. Only
-- the goods: a payment for one cost goes through pay_import_cost_advance.
CREATE OR REPLACE FUNCTION public.prepay_import_supplier(
  p_shipment_id     UUID,
  p_payment_date    DATE,
  p_note            TEXT,
  p_amount_fc       NUMERIC,
  p_rate            NUMERIC,
  p_splits          JSONB,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_done    JSONB := public._imports_op_get(p_idempotency_key);
  v_s       public.import_shipments;
  v_fc      NUMERIC := round(COALESCE(p_amount_fc, 0), 2);
  v_rate    NUMERIC;
  v_azn     NUMERIC;
  v_total   NUMERIC;
  v_prep    UUID;
  v_journal UUID;
  v_label   TEXT;
  v_date    DATE := COALESCE(p_payment_date, public.document_today());
BEGIN
  IF v_done IS NOT NULL THEN RETURN v_done; END IF;
  PERFORM public._imports_require('manage');
  SELECT * INTO v_s FROM public.import_shipments WHERE id = p_shipment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'imports_not_found: İdxal sənədi tapılmadı';
  END IF;
  IF v_s.status <> 'draft' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'imports_prepay_draft_only: Avans yalnız faktura təsdiqlənməzdən əvvəl (qaralamada) verilir';
  END IF;
  IF v_s.supplier_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'imports_supplier_required: Təchizatçı seçilməyib';
  END IF;
  v_rate := CASE WHEN v_s.currency_code = 'AZN' THEN 1 ELSE COALESCE(p_rate, 0) END;
  IF v_fc <= 0 OR v_rate <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'imports_fx_required: Avansın məbləği və məzənnəsi lazımdır';
  END IF;
  v_azn := round(v_fc * v_rate, 2);
  v_total := public._imports_splits_total(p_splits);
  IF abs(v_total - v_azn) > 0.011 THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = format('imports_splits_mismatch: Hesablardan çıxan (%s AZN) avansa (%s AZN) bərabər deyil', v_total, v_azn);
  END IF;

  PERFORM public.use_document_date(v_date);
  v_label := format('Təchizatçıya avans — %s — %s', v_s.number, COALESCE(NULLIF(btrim(p_note), ''), 'Təchizatçıya avans'));
  INSERT INTO public.import_prepayments (shipment_id, partner_id, payment_date, note, currency_code, amount_fc, rate, amount_azn)
  VALUES (p_shipment_id, v_s.supplier_id, v_date, NULLIF(btrim(p_note), ''), v_s.currency_code, v_fc, v_rate, v_total)
  RETURNING id INTO v_prep;
  v_journal := public._imports_advance_post(v_prep, v_s, v_s.supplier_id, p_splits, v_label, 'import_prepayment',
    format('İdxal %s: təchizatçıya avans %s %s × %s', v_s.number, v_fc, v_s.currency_code, v_rate), v_date);
  PERFORM public.use_document_date(NULL);

  RETURN public._imports_op_put(p_idempotency_key, 'prepay', p_shipment_id, jsonb_build_object(
    'success', true, 'prepayment_id', v_prep, 'journal_entry_id', v_journal, 'amount_azn', v_total, 'amount_fc', v_fc));
END;
$$;

-- What a cost comes to in its own currency, VAT included (as its payable is booked on confirm).
CREATE OR REPLACE FUNCTION public._imports_cost_total_fc(p_cost public.import_cost_lines)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT round(
    (round(p_cost.amount * (CASE WHEN p_cost.currency_code = 'AZN' THEN 1 ELSE p_cost.rate_to_azn END), 2) + COALESCE(p_cost.vat_amount_azn, 0))
    / (CASE WHEN p_cost.currency_code = 'AZN' THEN 1 ELSE p_cost.rate_to_azn END), 2);
$$;

-- ─── B5. Pay one cost of a draft shipment ───────────────────────────────────

-- The cost is not posted yet (that happens on confirm). The payment is an advance to the
-- cost's partner: Dt 2100 partner / Cr each account, in import_prepayments with cost_line_id.
-- p_amount_fc in the cost's currency at p_rate (AZN per unit on the payment date; 1 for AZN);
-- the splits [{account_id, amount, method?, note?}] add up to amount_fc × rate. Partial
-- payments are allowed; more than the cost (VAT included) is refused. On confirm the advances
-- settle the cost's payable (see confirm_import_shipment).
CREATE OR REPLACE FUNCTION public.pay_import_cost_advance(
  p_cost_line_id    UUID,
  p_payment_date    DATE,
  p_note            TEXT,
  p_amount_fc       NUMERIC,
  p_rate            NUMERIC,
  p_splits          JSONB,
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_done    JSONB := public._imports_op_get(p_idempotency_key);
  v_cost    public.import_cost_lines;
  v_s       public.import_shipments;
  v_fc      NUMERIC := round(COALESCE(p_amount_fc, 0), 2);
  v_rate    NUMERIC;
  v_azn     NUMERIC;
  v_total   NUMERIC;
  v_due_fc  NUMERIC;
  v_paid_fc NUMERIC;
  v_prep    UUID;
  v_journal UUID;
  v_label   TEXT;
  v_date    DATE := COALESCE(p_payment_date, public.document_today());
BEGIN
  IF v_done IS NOT NULL THEN RETURN v_done; END IF;
  PERFORM public._imports_require('manage');
  SELECT * INTO v_cost FROM public.import_cost_lines WHERE id = p_cost_line_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'imports_not_found: Xərc tapılmadı';
  END IF;
  SELECT * INTO v_s FROM public.import_shipments WHERE id = v_cost.shipment_id FOR UPDATE;
  IF v_s.status <> 'draft' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'imports_cost_posted: Xərc artıq qeydə alınıb; borcu «Ödənişlər» bölməsindən ödəyin';
  END IF;
  IF v_cost.partner_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'imports_cost_partner_required: Ödəmək üçün xərcin tərəfini («Kimə ödənilir») seçin və qaralamanı saxlayın';
  END IF;
  IF v_s.invoice_date IS NOT NULL AND v_date < v_s.invoice_date THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = format('imports_payment_before_document: Ödəniş tarixi (%s) faktura tarixindən (%s) əvvəl ola bilməz',
        to_char(v_date, 'DD.MM.YYYY'), to_char(v_s.invoice_date, 'DD.MM.YYYY'));
  END IF;
  v_rate := CASE WHEN v_cost.currency_code = 'AZN' THEN 1 ELSE COALESCE(p_rate, 0) END;
  IF v_fc <= 0 OR v_rate <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'imports_fx_required: Ödənişin məbləği və məzənnəsi lazımdır';
  END IF;
  v_due_fc := public._imports_cost_total_fc(v_cost);
  SELECT COALESCE(SUM(amount_fc), 0) INTO v_paid_fc FROM public.import_prepayments WHERE cost_line_id = v_cost.id AND status = 'open';
  IF v_fc > v_due_fc - v_paid_fc + 0.005 THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = format('imports_overpay: Ödəniş (%s %s) qalıqdan (%s %s) çoxdur', v_fc, v_cost.currency_code, round(v_due_fc - v_paid_fc, 2), v_cost.currency_code);
  END IF;
  v_azn := round(v_fc * v_rate, 2);
  v_total := public._imports_splits_total(p_splits);
  IF abs(v_total - v_azn) > 0.011 THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = format('imports_splits_mismatch: Hesablardan çıxan (%s AZN) ödənişə (%s AZN) bərabər deyil', v_total, v_azn);
  END IF;

  PERFORM public.use_document_date(v_date);
  v_label := format('İdxal xərci — %s — %s', v_s.number, COALESCE(NULLIF(btrim(v_cost.description), ''), v_cost.cost_type));
  INSERT INTO public.import_prepayments (shipment_id, partner_id, payment_date, note, currency_code, amount_fc, rate, amount_azn, cost_line_id)
  VALUES (v_s.id, v_cost.partner_id, v_date, NULLIF(btrim(p_note), ''), v_cost.currency_code, v_fc, v_rate, v_total, v_cost.id)
  RETURNING id INTO v_prep;
  v_journal := public._imports_advance_post(v_prep, v_s, v_cost.partner_id, p_splits, v_label, 'import_cost_advance',
    format('İdxal %s: xərc ödənişi %s %s', v_s.number, v_fc, v_cost.currency_code), v_date);
  PERFORM public.use_document_date(NULL);
  PERFORM public.refresh_supplier_ap_balance(v_cost.partner_id);

  RETURN public._imports_op_put(p_idempotency_key, 'cost_advance', v_s.id, jsonb_build_object(
    'success', true, 'prepayment_id', v_prep, 'journal_entry_id', v_journal, 'amount_azn', v_total, 'amount_fc', v_fc,
    'remaining_fc', round(v_due_fc - v_paid_fc - v_fc, 2)));
END;
$$;

-- ─── B6. Confirm: cost advances settle their cost's payable ─────────────────

-- As 20261030120000_imports_fx.sql, with two changes:
--   * supplier prepayments for the goods are only those without a cost (cost_line_id IS NULL);
--   * a cost paid while the shipment was a draft posts as every cost (Dt 1360 / 1410 / 6190,
--     Cr 2100 partner) and its advances then settle that payable: the payable's paid amounts
--     grow by the booking value of what was paid; when the advance's AZN differs from that
--     booking value (another rate), the difference goes to 6260 (loss) or 4960 (gain) with
--     2100 the other way, exactly as pay_import_payable does on a later payment.
CREATE OR REPLACE FUNCTION public.confirm_import_shipment(p_id UUID, p_date DATE DEFAULT NULL, p_idempotency_key TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_done     JSONB := public._imports_op_get(p_idempotency_key);
  v_s        public.import_shipments;
  v_cost     public.import_cost_lines;
  v_date     DATE;
  v_goods    NUMERIC;
  v_goods_fc NUMERIC;
  v_amount   NUMERIC;
  v_part     JSONB;
  v_lines    JSONB := '[]'::jsonb;
  v_txs      JSONB := '[]'::jsonb;
  v_journal  UUID;
  v_partner  UUID;
  v_alloc    NUMERIC;
  v_prep_fc  NUMERIC;
  v_prep_azn NUMERIC;
  v_rate_eff NUMERIC;
  v_payable  UUID;
  v_cp       public.import_payables;
  v_adv_fc   NUMERIC;
  v_adv_azn  NUMERIC;
  v_settle   NUMERIC;
  v_diff     NUMERIC;
  v_clabel   TEXT;
BEGIN
  IF v_done IS NOT NULL THEN RETURN v_done; END IF;
  PERFORM public._imports_require('approve');

  SELECT * INTO v_s FROM public.import_shipments WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'imports_not_found: İdxal sənədi tapılmadı';
  END IF;
  IF v_s.status <> 'draft' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'imports_not_draft: Yalnız qaralama təsdiqlənə bilər';
  END IF;
  IF v_s.supplier_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'imports_supplier_required: Təchizatçı seçilməyib';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.import_shipment_lines WHERE shipment_id = p_id) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'imports_no_lines: Məhsul əlavə edilməyib';
  END IF;

  v_date := COALESCE(p_date, v_s.invoice_date, public.document_today());
  PERFORM public.use_document_date(v_date);

  SELECT COALESCE(SUM(round(qty_purchase_unit * unit_price_fc * v_s.invoice_rate, 2)), 0),
         COALESCE(SUM(qty_purchase_unit * unit_price_fc), 0)
  INTO v_goods, v_goods_fc
  FROM public.import_shipment_lines WHERE shipment_id = p_id;
  v_goods_fc := round(v_goods_fc, 2);

  -- Supplier prepayments for the goods (IMP-3): the prepaid part at the prepayment rate.
  SELECT COALESCE(SUM(amount_fc), 0), COALESCE(SUM(amount_azn), 0) INTO v_prep_fc, v_prep_azn
  FROM public.import_prepayments WHERE shipment_id = p_id AND status = 'open' AND cost_line_id IS NULL;
  IF v_prep_fc > v_goods_fc + 0.005 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = format(
      'imports_prepayment_exceeds: Avans (%s %s) malın dəyərindən (%s %s) çoxdur', v_prep_fc, v_s.currency_code, v_goods_fc, v_s.currency_code);
  END IF;
  IF v_prep_fc > 0 AND v_goods_fc > 0 THEN
    v_rate_eff := round((v_prep_azn + (v_goods_fc - v_prep_fc) * v_s.invoice_rate) / v_goods_fc, 6);
    UPDATE public.import_shipments SET goods_rate_azn = v_rate_eff WHERE id = p_id;
    SELECT COALESCE(SUM(round(qty_purchase_unit * unit_price_fc * v_rate_eff, 2)), 0) INTO v_goods
    FROM public.import_shipment_lines WHERE shipment_id = p_id;
  END IF;

  -- Goods: Dr 1360 / Cr 2100 supplier, and the supplier's payable.
  v_partner := public.resolve_unified_partner_id(NULL, v_s.supplier_id);
  IF v_goods > 0 THEN
    v_lines := v_lines
      || public._imports_line('1360', v_goods, 'Yolda olan mallar — ' || v_s.number)
      || public._imports_line('2100', -v_goods, 'Təchizatçı — ' || v_s.number || COALESCE(' / ' || v_s.invoice_no, ''), v_partner);
    INSERT INTO public.import_payables (shipment_id, partner_id, source, document_date, currency_code, amount_fc, booking_rate, amount_azn, paid_fc, paid_azn, status)
    VALUES (p_id, v_s.supplier_id, 'goods', v_date, v_s.currency_code, v_goods_fc, v_s.invoice_rate, v_goods,
            v_prep_fc, LEAST(v_prep_azn, v_goods),
            CASE WHEN v_prep_fc > 0 AND v_prep_fc >= v_goods_fc - 0.005 THEN 'paid' ELSE 'open' END)
    RETURNING id INTO v_payable;
    UPDATE public.import_prepayments SET status = 'applied', payable_id = v_payable
    WHERE shipment_id = p_id AND status = 'open' AND cost_line_id IS NULL;
  END IF;

  -- Every cost line: its split must still add up (the split is saved with the draft).
  FOR v_cost IN SELECT * FROM public.import_cost_lines WHERE shipment_id = p_id ORDER BY position LOOP
    v_amount := round(v_cost.amount * (CASE WHEN v_cost.currency_code = 'AZN' THEN 1 ELSE v_cost.rate_to_azn END), 2);
    IF v_cost.is_capitalized AND v_cost.cost_type <> 'customs_vat' THEN
      SELECT COALESCE(SUM(amount_azn), 0) INTO v_alloc FROM public.import_cost_allocations WHERE cost_line_id = v_cost.id;
      IF abs(v_alloc - v_amount) > 0.005 THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
          MESSAGE = 'imports_allocation_stale: Xərc bölgüsü köhnədir, qaralamanı yenidən saxlayın';
      END IF;
    END IF;
    SELECT COALESCE(SUM(amount_fc), 0), COALESCE(SUM(amount_azn), 0) INTO v_adv_fc, v_adv_azn
    FROM public.import_prepayments WHERE cost_line_id = v_cost.id AND status = 'open';
    IF v_adv_fc > 0 AND v_cost.paid_now THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = 'imports_cost_paid_twice: Ödənilmiş xərc «indi ödənilib» kimi də qeyd olunub; birini götürün';
    END IF;
    IF v_cost.paid_now AND v_cost.cash_account_id IS NOT NULL THEN
      v_part := public._imports_cost_lines(v_cost, v_s, v_amount, v_cost.vat_amount_azn,
        jsonb_build_array(jsonb_build_object('account_id', v_cost.cash_account_id, 'amount', v_amount + v_cost.vat_amount_azn)), v_date);
    ELSE
      v_part := public._imports_cost_lines(v_cost, v_s, v_amount, v_cost.vat_amount_azn, NULL, v_date);
    END IF;
    v_lines := v_lines || (v_part->'lines');
    v_txs := v_txs || (v_part->'transactions');

    -- IMP-5: payments made for this cost while a draft settle its payable now.
    IF v_adv_fc > 0 THEN
      SELECT * INTO v_cp FROM public.import_payables WHERE cost_line_id = v_cost.id AND status <> 'cancelled' FOR UPDATE;
      IF NOT FOUND OR v_adv_fc > v_cp.amount_fc - v_cp.paid_fc + 0.005 THEN
        RAISE EXCEPTION USING ERRCODE = '22023',
          MESSAGE = format('imports_cost_overpaid: «%s» üçün ödənilən (%s %s) xərcdən çoxdur', COALESCE(v_cost.description, v_cost.cost_type), v_adv_fc, v_cost.currency_code);
      END IF;
      v_settle := CASE WHEN v_adv_fc >= v_cp.amount_fc - v_cp.paid_fc - 0.005 THEN round(v_cp.amount_azn - v_cp.paid_azn, 2)
                       ELSE round((v_cp.amount_azn - v_cp.paid_azn) * v_adv_fc / NULLIF(v_cp.amount_fc - v_cp.paid_fc, 0), 2) END;
      v_diff := round(v_adv_azn - v_settle, 2);
      v_clabel := format('%s — %s', v_s.number, COALESCE(NULLIF(v_cost.description, ''), v_cost.cost_type));
      IF v_diff <> 0 THEN
        v_lines := v_lines
          || public._imports_line('2100', -v_diff, 'Xərc avansı, məzənnə fərqi — ' || v_clabel, public.resolve_unified_partner_id(NULL, v_cost.partner_id))
          || public._imports_line(CASE WHEN v_diff > 0 THEN '6260' ELSE '4960' END, v_diff,
               format('Məzənnə fərqi (%s) — %s', CASE WHEN v_diff > 0 THEN 'zərər' ELSE 'gəlir' END, v_clabel));
      END IF;
      UPDATE public.import_payables
      SET paid_azn = round(paid_azn + v_settle, 2),
          paid_fc = round(paid_fc + v_adv_fc, 2),
          status = CASE WHEN round(paid_fc + v_adv_fc, 2) >= amount_fc - 0.005 THEN 'paid' ELSE 'open' END
      WHERE id = v_cp.id;
      UPDATE public.import_prepayments SET status = 'applied', payable_id = v_cp.id WHERE cost_line_id = v_cost.id AND status = 'open';
    END IF;
  END LOOP;

  IF jsonb_array_length(v_lines) > 0 THEN
    v_journal := public.create_journal_entry(jsonb_build_object(
      'document_type', 'import_confirm',
      'document_id', p_id,
      'idempotency_key', 'import_confirm:' || p_id::text,
      'entry_date', v_date,
      'description', format('İdxal %s təsdiqi%s', v_s.number, COALESCE(' — ' || v_s.invoice_no, '')),
      'lines', v_lines
    ));
    UPDATE public.transactions SET journal_entry_id = v_journal
    WHERE id IN (SELECT (x #>> '{}')::uuid FROM jsonb_array_elements(v_txs) x);
    UPDATE public.import_payables SET journal_entry_id = v_journal WHERE shipment_id = p_id AND journal_entry_id IS NULL;
  END IF;

  UPDATE public.import_shipments SET status = 'confirmed', confirmed_at = NOW(), confirm_date = v_date WHERE id = p_id;
  PERFORM public.use_document_date(NULL);
  PERFORM public.refresh_supplier_ap_balance(v_s.supplier_id);
  FOR v_cost IN SELECT DISTINCT ON (partner_id) * FROM public.import_cost_lines WHERE shipment_id = p_id AND partner_id IS NOT NULL LOOP
    PERFORM public.refresh_supplier_ap_balance(v_cost.partner_id);
  END LOOP;

  RETURN public._imports_op_put(p_idempotency_key, 'confirm', p_id,
    jsonb_build_object('success', true, 'shipment_id', p_id, 'status', 'confirmed', 'journal_entry_id', v_journal));
END;
$$;

-- ─── B7. The draft save keeps cost ids and locks paid costs ─────────────────

-- As 20261104100000_imports_line_warehouses.sql (same signature). New:
--   * a cost line sent with its stored id keeps that id (payments of a draft cost refer to it);
--   * a cost with payments (pay_import_cost_advance) cannot be removed, and its amount,
--     currency, rate, VAT, capitalized flag and partner cannot change; its split method and
--     allocation stay editable.
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
      vat_amount_azn, is_capitalized, split_method, is_estimate, added_at_status, paid_now, cash_account_id, created_by)
    select case when (c ->> 'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                     and (c ->> 'id')::uuid = any (v_old_ids)
                then (c ->> 'id')::uuid else gen_random_uuid() end,
           v_id, (c ->> 'position')::int, c ->> 'cost_type', (c ->> 'partner_id')::uuid, c ->> 'description',
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

-- ─── B8. Stages: cleared, tracking and milestones ───────────────────────────

-- "Gömrükdən buraxıldı": a confirmed shipment is cleared once the customs declaration number,
-- its date and the customs rate are there (a customs rate still following the invoice is stored
-- as the invoice rate). Posts nothing; receiving stays allowed from "confirmed" as before.
CREATE OR REPLACE FUNCTION public.clear_import_shipment(p_id UUID, p_date DATE DEFAULT NULL, p_idempotency_key TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_done JSONB := public._imports_op_get(p_idempotency_key);
  v_s    public.import_shipments;
  v_date DATE;
BEGIN
  IF v_done IS NOT NULL THEN RETURN v_done; END IF;
  PERFORM public._imports_require('approve');
  SELECT * INTO v_s FROM public.import_shipments WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'imports_not_found: İdxal sənədi tapılmadı';
  END IF;
  IF v_s.status <> 'confirmed' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'imports_cannot_clear: Yalnız təsdiqlənmiş (yolda olan) idxal gömrükdən buraxıla bilər';
  END IF;
  IF NULLIF(btrim(v_s.customs_declaration_no), '') IS NULL OR v_s.customs_declaration_date IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'imports_declaration_required: Gömrük bəyannaməsinin nömrəsini və tarixini daxil edin';
  END IF;
  v_date := COALESCE(p_date, v_s.customs_declaration_date, public.document_today());
  IF v_date < COALESCE(v_s.confirm_date, v_date) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'imports_date_before_confirm: Tarix təsdiq tarixindən əvvəl ola bilməz';
  END IF;
  PERFORM public.use_document_date(v_date);
  UPDATE public.import_shipments
  SET status = 'cleared',
      cleared_on = v_date,
      arrived_on = COALESCE(arrived_on, v_date),
      customs_rate = COALESCE(customs_rate, CASE WHEN currency_code = 'AZN' THEN 1 ELSE invoice_rate END)
  WHERE id = p_id;
  PERFORM public.use_document_date(NULL);
  RETURN public._imports_op_put(p_idempotency_key, 'clear', p_id, jsonb_build_object('success', true, 'shipment_id', p_id, 'status', 'cleared'));
END;
$$;

-- Transport and tracking at any stage before closing (and the customs declaration once the
-- shipment is no longer a draft: a draft saves it with the form). Only the keys present in
-- p_fields change. An ETA change, a first departure or arrival date are logged.
CREATE OR REPLACE FUNCTION public.update_import_tracking(p_id UUID, p_fields JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_s   public.import_shipments;
  v_new public.import_shipments;
  f     JSONB := COALESCE(p_fields, '{}'::jsonb);
BEGIN
  PERFORM public._imports_require('manage');
  SELECT * INTO v_s FROM public.import_shipments WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'imports_not_found: İdxal sənədi tapılmadı';
  END IF;
  IF v_s.status IN ('closed', 'cancelled') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'imports_tracking_closed: Bağlı və ya ləğv edilmiş idxal dəyişdirilə bilməz';
  END IF;
  IF f ? 'transport_mode' AND NULLIF(f->>'transport_mode', '') IS NOT NULL AND f->>'transport_mode' NOT IN ('road', 'sea', 'rail', 'air', 'multimodal') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'imports_invalid_transport: Nəqliyyat növü yanlışdır';
  END IF;

  UPDATE public.import_shipments SET
    transport_mode = CASE WHEN f ? 'transport_mode' THEN NULLIF(f->>'transport_mode', '') ELSE transport_mode END,
    carrier_id = CASE WHEN f ? 'carrier_id' THEN NULLIF(f->>'carrier_id', '')::uuid ELSE carrier_id END,
    tracking_no = CASE WHEN f ? 'tracking_no' THEN NULLIF(btrim(f->>'tracking_no'), '') ELSE tracking_no END,
    vehicle_no = CASE WHEN f ? 'vehicle_no' THEN NULLIF(btrim(f->>'vehicle_no'), '') ELSE vehicle_no END,
    etd = CASE WHEN f ? 'etd' THEN NULLIF(f->>'etd', '')::date ELSE etd END,
    eta = CASE WHEN f ? 'eta' THEN NULLIF(f->>'eta', '')::date ELSE eta END,
    departed_on = CASE WHEN f ? 'departed_on' THEN NULLIF(f->>'departed_on', '')::date ELSE departed_on END,
    arrived_on = CASE WHEN f ? 'arrived_on' THEN NULLIF(f->>'arrived_on', '')::date ELSE arrived_on END,
    customs_declaration_no = CASE WHEN v_s.status <> 'draft' AND f ? 'customs_declaration_no' THEN NULLIF(btrim(f->>'customs_declaration_no'), '') ELSE customs_declaration_no END,
    customs_declaration_date = CASE WHEN v_s.status <> 'draft' AND f ? 'customs_declaration_date' THEN NULLIF(f->>'customs_declaration_date', '')::date ELSE customs_declaration_date END,
    customs_rate = CASE WHEN v_s.status <> 'draft' AND f ? 'customs_rate' THEN NULLIF(f->>'customs_rate', '')::numeric ELSE customs_rate END
  WHERE id = p_id
  RETURNING * INTO v_new;

  IF v_new.eta IS DISTINCT FROM v_s.eta AND v_s.eta IS NOT NULL THEN
    PERFORM public._imports_log_event(p_id, 'eta_changed', public.document_today(), NULLIF(btrim(f->>'note'), ''),
      jsonb_build_object('from', v_s.eta, 'to', v_new.eta));
  END IF;
  IF v_new.departed_on IS NOT NULL AND v_s.departed_on IS NULL THEN
    PERFORM public._imports_log_event(p_id, 'departed', v_new.departed_on, NULL, '{}'::jsonb);
  END IF;
  IF v_new.arrived_on IS NOT NULL AND v_s.arrived_on IS NULL THEN
    PERFORM public._imports_log_event(p_id, 'arrived_customs', v_new.arrived_on, NULL, '{}'::jsonb);
  END IF;
  RETURN jsonb_build_object('success', true, 'shipment_id', p_id);
END;
$$;

-- A manual milestone or note on the timeline: departed, arrived_customs (they also set the
-- shipment's date when it has none yet) or note.
CREATE OR REPLACE FUNCTION public.log_import_event(p_shipment_id UUID, p_kind TEXT, p_event_date DATE DEFAULT NULL, p_note TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_s    public.import_shipments;
  v_date DATE := COALESCE(p_event_date, public.document_today());
  v_id   UUID;
BEGIN
  PERFORM public._imports_require('manage');
  IF p_kind NOT IN ('departed', 'arrived_customs', 'note') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'imports_invalid_event: Bu qeyd növü əl ilə yazıla bilməz';
  END IF;
  IF p_kind = 'note' AND NULLIF(btrim(p_note), '') IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'imports_note_required: Qeydin mətnini yazın';
  END IF;
  SELECT * INTO v_s FROM public.import_shipments WHERE id = p_shipment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'imports_not_found: İdxal sənədi tapılmadı';
  END IF;
  IF v_date > public.document_today() + 1 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'imports_future_event: Baş verməmiş hadisəni qeyd etmək olmaz';
  END IF;
  IF p_kind = 'departed' THEN
    UPDATE public.import_shipments SET departed_on = COALESCE(departed_on, v_date) WHERE id = p_shipment_id;
  ELSIF p_kind = 'arrived_customs' THEN
    UPDATE public.import_shipments SET arrived_on = COALESCE(arrived_on, v_date) WHERE id = p_shipment_id;
  END IF;
  v_id := public._imports_log_event(p_shipment_id, p_kind, v_date, p_note, '{}'::jsonb);
  RETURN jsonb_build_object('success', true, 'event_id', v_id);
END;
$$;

-- ─── B9. Grants ─────────────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION public._imports_event_date() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._imports_splits_total(JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._imports_cost_total_fc(public.import_cost_lines) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._imports_events_shipment() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._imports_events_cost() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._imports_events_payment() FROM PUBLIC, anon, authenticated;
-- Called with the user's session: each checks imports.manage / imports.approve itself.
REVOKE ALL ON FUNCTION public.pay_import_cost_advance(UUID, DATE, TEXT, NUMERIC, NUMERIC, JSONB, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.clear_import_shipment(UUID, DATE, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_import_tracking(UUID, JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.log_import_event(UUID, TEXT, DATE, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pay_import_cost_advance(UUID, DATE, TEXT, NUMERIC, NUMERIC, JSONB, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.clear_import_shipment(UUID, DATE, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.update_import_tracking(UUID, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.log_import_event(UUID, TEXT, DATE, TEXT) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.confirm_import_shipment(UUID, DATE, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pay_import_payable(UUID, DATE, TEXT, JSONB, TEXT, NUMERIC, NUMERIC) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.prepay_import_supplier(UUID, DATE, TEXT, NUMERIC, NUMERIC, JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_import_shipment(UUID, DATE, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pay_import_payable(UUID, DATE, TEXT, JSONB, TEXT, NUMERIC, NUMERIC) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.prepay_import_supplier(UUID, DATE, TEXT, NUMERIC, NUMERIC, JSONB, TEXT) TO authenticated, service_role;

notify pgrst, 'reload schema';
