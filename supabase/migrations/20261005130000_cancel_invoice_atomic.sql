-- Atomic cancellation (ləğv) of sales and purchase invoices.
--
-- Until now src/lib/invoices/voidInvoiceDirect.ts cancelled a document from
-- the app in six separate requests: restore stock (read-modify-write), adjust
-- kassa balances, DELETE the cash transactions, delete warehouse slips,
-- reverse the journals, set the status. Problems found 2026-10-05:
--
--   * Any step failing left the document half-cancelled; a retry restored
--     stock a second time.
--   * Drafts and already-cancelled invoices could be "voided" too: a draft
--     never took stock out, yet cancelling it added its quantities to stock;
--     cancelling twice restored twice.
--   * Cash rows were deleted, but their ledger entry (source_type
--     'cash_transaction', not linked to the invoice) was never reversed, so GL
--     1100 kept money the kassa no longer had. Balances were clamped at 0
--     instead of being refused.
--   * FIFO layers consumed by the sale were not given back, so after a
--     cancellation GL 1300 and Σ inventory_batches drift apart (1.00 AZN today
--     from SS-2026-00001). A cancelled purchase left its FIFO batches in place.
--
-- cancel_sales_invoice_atomic / cancel_purchase_invoice_atomic do the whole
-- job in one transaction. A draft is only marked cancelled. A posted document
-- gets every effect reversed and keeps its history: cash is reversed with a
-- storno transaction and a storno journal, never deleted.

BEGIN;

-- ─── Shared: reverse the cash movements of one document ─────────────────────
CREATE OR REPLACE FUNCTION public.reverse_document_cash_transactions(
  p_source_type TEXT,
  p_source_id   UUID,
  p_doc_label   TEXT,
  p_reason      TEXT
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r          RECORD;
  v_balance  NUMERIC;
  v_is_in    BOOLEAN;
  v_journal  UUID;
  v_count    INTEGER := 0;
BEGIN
  FOR r IN
    SELECT t.*
    FROM public.transactions t
    WHERE (
        (t.source_type = p_source_type AND t.source_id = p_source_id)
        -- Rows written before source linkage existed carry the number in notes.
        OR (t.source_type IS NULL AND t.source_id IS NULL
            AND NULLIF(trim(p_doc_label), '') IS NOT NULL
            AND t.notes ILIKE '%' || trim(p_doc_label) || '%')
      )
      AND COALESCE(t.reference_type, '') <> 'storno'
      AND NOT EXISTS (
        SELECT 1 FROM public.transactions s
        WHERE s.reference_type = 'storno' AND s.reference_id = t.id
      )
    ORDER BY t.created_at, t.id
    FOR UPDATE OF t
  LOOP
    IF r.account_id IS NULL OR COALESCE(r.amount, 0) <= 0 THEN
      CONTINUE;
    END IF;

    v_is_in := r.type LIKE 'M%daxil';

    SELECT balance INTO v_balance
    FROM public.accounts
    WHERE id = r.account_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION USING ERRCODE = 'P0002',
        MESSAGE = format('%s: ödənişin kassa/bank hesabı tapılmadı', p_doc_label);
    END IF;

    -- Money received is paid back out of the same kassa/bank.
    IF v_is_in AND COALESCE(v_balance, 0) + 0.0001 < r.amount THEN
      RAISE EXCEPTION USING ERRCODE = '22023',
        MESSAGE = format(
          '%s: geri qaytarmaq üçün kassa/bank balansı kifayət etmir (lazım: %s, mövcud: %s)',
          p_doc_label,
          trim(to_char(r.amount, 'FM999999990.00')),
          trim(to_char(COALESCE(v_balance, 0), 'FM999999990.00'))
        );
    END IF;

    UPDATE public.accounts
    SET balance = COALESCE(balance, 0) + CASE WHEN v_is_in THEN -r.amount ELSE r.amount END
    WHERE id = r.account_id;

    v_journal := NULL;
    IF r.journal_entry_id IS NOT NULL THEN
      v_journal := public.reverse_journal_entry(r.journal_entry_id, p_reason);
    END IF;

    INSERT INTO public.transactions (
      account_id, type, amount, category, notes,
      source_type, source_id, reference_type, reference_id, journal_entry_id
    )
    VALUES (
      r.account_id,
      CASE WHEN v_is_in THEN 'Məxaric' ELSE 'Mədaxil' END,
      r.amount,
      COALESCE(r.category, 'Digər') || ' (storno)',
      format('STORNO: %s — %s', COALESCE(r.notes, p_doc_label), p_reason),
      r.source_type,
      r.source_id,
      'storno',
      r.id,
      v_journal
    );

    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.reverse_document_cash_transactions(TEXT, UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;

-- ─── Sales ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cancel_sales_invoice_atomic(
  p_sale_id UUID,
  p_reason  TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale     public.sales%ROWTYPE;
  v_label    TEXT;
  v_reason   TEXT;
  v_line     RECORD;
  v_demand   JSONB := '{}'::jsonb;
  v_key      TEXT;
  v_units    NUMERIC;
  v_cash     INTEGER := 0;
  v_journals INTEGER := 0;
BEGIN
  IF p_sale_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Satış ID göndərilməyib';
  END IF;

  IF NOT (public.require_permission('can_delete_sales')
          OR public.require_permission('can_edit_sales')) THEN
    RAISE EXCEPTION 'forbidden'
      USING ERRCODE = '42501', MESSAGE = 'Satış ləğvi üçün icazəniz yoxdur';
  END IF;

  SELECT * INTO v_sale FROM public.sales WHERE id = p_sale_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Satış fakturası tapılmadı';
  END IF;

  v_label := COALESCE(NULLIF(trim(v_sale.doc_no), ''), NULLIF(trim(v_sale.invoice_number), ''), p_sale_id::text);
  v_reason := COALESCE(NULLIF(trim(p_reason), ''), format('Satış fakturası %s ləğv edildi', v_label));

  IF v_sale.status IN ('cancelled', 'void', 'voided') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = format('%s artıq ləğv edilib', v_label);
  END IF;

  -- A draft never moved stock, cash or the ledger.
  IF v_sale.status = 'draft' THEN
    UPDATE public.sales SET status = 'cancelled', remaining_balance = 0 WHERE id = p_sale_id;
    RETURN jsonb_build_object('success', true, 'sale_id', p_sale_id, 'doc_no', v_label,
                              'was', 'draft');
  END IF;

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
    v_demand := public.merge_stock_demand(v_demand, v_line.product_id, v_line.quantity);

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
    UPDATE public.products
    SET stock = COALESCE(stock, 0) + (v_demand->>v_key)::numeric
    WHERE id = v_key::uuid;
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
            AND warehouse_id = v_line.warehouse_id
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
  v_cash := public.reverse_document_cash_transactions('sale', p_sale_id, v_label, v_reason);

  -- 5. Pending warehouse slips for the invoice are void with it.
  DELETE FROM public.warehouse_slips
  WHERE source_type = 'sale' AND source_document_id = p_sale_id;

  -- 6. Invoice and COGS journals.
  v_journals := public.reverse_document_journals(p_sale_id, v_reason);

  UPDATE public.sales
  SET status = 'cancelled',
      remaining_balance = 0,
      total_cogs = 0
  WHERE id = p_sale_id;

  PERFORM public.refresh_customer_ar_balance(v_sale.customer_id);

  RETURN jsonb_build_object(
    'success', true,
    'sale_id', p_sale_id,
    'doc_no', v_label,
    'was', 'posted',
    'cash_reversed', v_cash,
    'journals_reversed', v_journals
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_sales_invoice_atomic(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_sales_invoice_atomic(UUID, TEXT) TO authenticated, service_role;

-- ─── Purchases ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.cancel_purchase_invoice_atomic(
  p_purchase_id UUID,
  p_reason      TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_purchase public.purchases%ROWTYPE;
  v_label    TEXT;
  v_reason   TEXT;
  v_line     RECORD;
  v_stock    NUMERIC;
  v_cash     INTEGER := 0;
  v_journals INTEGER := 0;
BEGIN
  IF p_purchase_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Alış ID göndərilməyib';
  END IF;

  IF NOT (public.require_permission('can_delete_purchases')
          OR public.require_permission('can_edit_purchases')) THEN
    RAISE EXCEPTION 'forbidden'
      USING ERRCODE = '42501', MESSAGE = 'Alış ləğvi üçün icazəniz yoxdur';
  END IF;

  SELECT * INTO v_purchase FROM public.purchases WHERE id = p_purchase_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'Alış fakturası tapılmadı';
  END IF;

  v_label := COALESCE(NULLIF(trim(v_purchase.invoice_number), ''), p_purchase_id::text);
  v_reason := COALESCE(NULLIF(trim(p_reason), ''), format('Alış fakturası %s ləğv edildi', v_label));

  IF v_purchase.status IN ('cancelled', 'void', 'voided') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = format('%s artıq ləğv edilib', v_label);
  END IF;

  IF v_purchase.status = 'draft' THEN
    UPDATE public.purchases SET status = 'cancelled', debt_amount = 0 WHERE id = p_purchase_id;
    RETURN jsonb_build_object('success', true, 'purchase_id', p_purchase_id,
                              'invoice_number', v_label, 'was', 'draft');
  END IF;

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
    UPDATE public.products SET stock = COALESCE(v_stock, 0) - v_line.qty WHERE id = v_line.product_id;
  END LOOP;

  -- 2. Its FIFO layers (all unconsumed, checked above).
  DELETE FROM public.inventory_batches WHERE document_id = p_purchase_id;

  -- 3. Cash paid to the supplier (and paid additional expenses) comes back.
  v_cash := public.reverse_document_cash_transactions('purchase', p_purchase_id, v_label, v_reason);

  DELETE FROM public.warehouse_slips
  WHERE source_type = 'purchase' AND source_document_id = p_purchase_id;

  -- 4. Bill journal.
  v_journals := public.reverse_document_journals(p_purchase_id, v_reason);

  UPDATE public.purchases
  SET status = 'cancelled',
      debt_amount = 0
  WHERE id = p_purchase_id;

  PERFORM public.refresh_supplier_ap_balance(v_purchase.supplier_id);

  RETURN jsonb_build_object(
    'success', true,
    'purchase_id', p_purchase_id,
    'invoice_number', v_label,
    'was', 'posted',
    'cash_reversed', v_cash,
    'journals_reversed', v_journals
  );
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_purchase_invoice_atomic(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_purchase_invoice_atomic(UUID, TEXT) TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
