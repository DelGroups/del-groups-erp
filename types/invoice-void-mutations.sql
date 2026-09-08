-- Del Groups ERP — Safe invoice void / cancellation (sales + purchases)
-- Run AFTER types/customer-ar-mutations.sql, types/account-mutations.sql,
-- types/sale-mutations.sql, types/purchase-mutations.sql, types/payment-mutations.sql.
--
-- Reverts stock, clears linked cash transactions, and marks documents cancelled
-- instead of hard-deleting rows that still have child records.

-- ─── Helpers ────────────────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.is_invoice_cancelled(TEXT);

CREATE OR REPLACE FUNCTION public.is_invoice_cancelled(p_status TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(trim(COALESCE(p_status, ''))) IN (
    'cancelled',
    'ləğv edildi',
    'legv edildi',
    'void',
    'voided'
  );
$$;

DROP FUNCTION IF EXISTS public.reconcile_accounts_for_transactions(UUID[]);

CREATE OR REPLACE FUNCTION public.reconcile_accounts_for_transactions(p_account_ids UUID[])
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_account_id UUID;
BEGIN
  IF p_account_ids IS NULL THEN
    RETURN;
  END IF;

  FOREACH v_account_id IN ARRAY p_account_ids
  LOOP
    IF v_account_id IS NOT NULL THEN
      PERFORM public.reconcile_account_balance_atomic(v_account_id);
    END IF;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.reconcile_accounts_for_transactions(UUID[]) TO authenticated;

DROP FUNCTION IF EXISTS public.delete_document_cash_transactions(TEXT, UUID, TEXT);

-- Deletes ledger rows for a document and reconciles affected account balances.
CREATE OR REPLACE FUNCTION public.delete_document_cash_transactions(
  p_source_type TEXT,
  p_source_id UUID,
  p_doc_label TEXT DEFAULT NULL
)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tx RECORD;
  v_deleted INT := 0;
  v_account_ids UUID[] := ARRAY[]::UUID[];
  v_label TEXT;
BEGIN
  v_label := trim(COALESCE(p_doc_label, ''));

  FOR v_tx IN
    SELECT id, account_id
    FROM transactions
    WHERE (
      (p_source_id IS NOT NULL AND source_type = p_source_type AND source_id = p_source_id)
      OR (
        v_label <> ''
        AND COALESCE(source_type, '') = ''
        AND COALESCE(source_id::text, '') = ''
        AND notes ILIKE '%' || v_label || '%'
      )
    )
  LOOP
    DELETE FROM transactions WHERE id = v_tx.id;
    v_deleted := v_deleted + 1;
    IF v_tx.account_id IS NOT NULL
       AND NOT v_tx.account_id = ANY (v_account_ids) THEN
      v_account_ids := array_append(v_account_ids, v_tx.account_id);
    END IF;
  END LOOP;

  PERFORM public.reconcile_accounts_for_transactions(v_account_ids);
  RETURN v_deleted;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_document_cash_transactions(TEXT, UUID, TEXT) TO authenticated;

DROP FUNCTION IF EXISTS public.restore_sale_stock(UUID);

CREATE OR REPLACE FUNCTION public.restore_sale_stock(p_sale_id UUID)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item RECORD;
  v_qty NUMERIC;
  v_restored INT := 0;
BEGIN
  FOR v_item IN
    SELECT product_id, quantity, polywood_sale_mode
    FROM sale_items
    WHERE sale_id = p_sale_id
  LOOP
    IF v_item.product_id IS NULL THEN
      CONTINUE;
    END IF;
    IF NULLIF(trim(COALESCE(v_item.polywood_sale_mode, '')), '') IS NOT NULL THEN
      CONTINUE;
    END IF;

    v_qty := COALESCE(v_item.quantity, 0);
    IF v_qty <= 0 THEN
      CONTINUE;
    END IF;

    UPDATE products
    SET stock = COALESCE(stock, 0) + v_qty
    WHERE id = v_item.product_id;

    v_restored := v_restored + 1;
  END LOOP;

  RETURN v_restored;
END;
$$;

GRANT EXECUTE ON FUNCTION public.restore_sale_stock(UUID) TO authenticated;

DROP FUNCTION IF EXISTS public.revert_purchase_stock(UUID);

CREATE OR REPLACE FUNCTION public.revert_purchase_stock(p_purchase_id UUID)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item RECORD;
  v_qty NUMERIC;
  v_stock NUMERIC;
  v_reverted INT := 0;
BEGIN
  FOR v_item IN
    SELECT product_id, quantity
    FROM purchase_items
    WHERE purchase_id = p_purchase_id
  LOOP
    IF v_item.product_id IS NULL THEN
      CONTINUE;
    END IF;

    v_qty := COALESCE(v_item.quantity, 0);
    IF v_qty <= 0 THEN
      CONTINUE;
    END IF;

    SELECT stock INTO v_stock
    FROM products
    WHERE id = v_item.product_id
    FOR UPDATE;

    UPDATE products
    SET stock = GREATEST(COALESCE(v_stock, 0) - v_qty, 0)
    WHERE id = v_item.product_id;

    v_reverted := v_reverted + 1;
  END LOOP;

  RETURN v_reverted;
END;
$$;

GRANT EXECUTE ON FUNCTION public.revert_purchase_stock(UUID) TO authenticated;

-- ─── Void sale invoice ───────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.void_sale_atomic(UUID, TEXT);

CREATE OR REPLACE FUNCTION public.void_sale_atomic(
  p_sale_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_sale sales%ROWTYPE;
  v_note TEXT;
  v_doc_label TEXT;
  v_tx_deleted INT;
  v_stock_restored INT;
BEGIN
  IF NOT public.require_permission('can_delete_sales')
     AND NOT public.require_permission('can_edit_sales') THEN
    RAISE EXCEPTION 'forbidden'
      USING ERRCODE = '42501',
            MESSAGE = 'Satış ləğvi üçün icazəniz yoxdur';
  END IF;

  SELECT * INTO v_sale
  FROM sales
  WHERE id = p_sale_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'sale_not_found'
      USING ERRCODE = 'P0002',
            MESSAGE = 'Satış fakturası tapılmadı';
  END IF;

  IF public.is_invoice_cancelled(v_sale.status) THEN
    RETURN jsonb_build_object(
      'sale_id', p_sale_id,
      'already_void', true,
      'status', v_sale.status
    );
  END IF;

  v_doc_label := COALESCE(NULLIF(trim(v_sale.doc_no), ''), NULLIF(trim(v_sale.invoice_number), ''), p_sale_id::text);
  v_note := trim(COALESCE(p_reason, ''));
  IF v_note = '' THEN
    v_note := 'Satış fakturası ləğv edildi';
  END IF;

  v_stock_restored := public.restore_sale_stock(p_sale_id);
  v_tx_deleted := public.delete_document_cash_transactions('sale', p_sale_id, v_doc_label);

  UPDATE warehouse_slips
  SET status = 'rejected'
  WHERE source_type = 'sale'
    AND source_document_id = p_sale_id
    AND status = 'pending';

  DELETE FROM sales_commissions WHERE sale_id = p_sale_id;

  UPDATE sales
  SET
    status = 'cancelled',
    paid_amount = 0,
    remaining_balance = 0,
    payments = '[]'::jsonb,
    warehouse_sent = FALSE,
    warehouse_slip_status = NULL,
    note = COALESCE(note, v_note),
    notes = CASE
      WHEN notes IS NULL OR trim(notes) = '' THEN v_note
      ELSE notes || E'\n' || v_note
    END
  WHERE id = p_sale_id;

  IF v_sale.customer_id IS NOT NULL THEN
    PERFORM public.refresh_customer_ar_balance(v_sale.customer_id);
  END IF;

  RETURN jsonb_build_object(
    'sale_id', p_sale_id,
    'already_void', false,
    'status', 'cancelled',
    'stock_lines_restored', v_stock_restored,
    'transactions_removed', v_tx_deleted
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.void_sale_atomic(UUID, TEXT) TO authenticated;

-- ─── Void purchase invoice ───────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.void_purchase_atomic(UUID, TEXT);

CREATE OR REPLACE FUNCTION public.void_purchase_atomic(
  p_purchase_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_purchase purchases%ROWTYPE;
  v_note TEXT;
  v_doc_label TEXT;
  v_tx_deleted INT;
  v_stock_reverted INT;
  v_supplier_balance NUMERIC;
BEGIN
  IF NOT public.require_permission('can_delete_purchases')
     AND NOT public.require_permission('can_edit_purchases') THEN
    RAISE EXCEPTION 'forbidden'
      USING ERRCODE = '42501',
            MESSAGE = 'Alış ləğvi üçün icazəniz yoxdur';
  END IF;

  SELECT * INTO v_purchase
  FROM purchases
  WHERE id = p_purchase_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'purchase_not_found'
      USING ERRCODE = 'P0002',
            MESSAGE = 'Alış fakturası tapılmadı';
  END IF;

  IF public.is_invoice_cancelled(v_purchase.status) THEN
    RETURN jsonb_build_object(
      'purchase_id', p_purchase_id,
      'already_void', true,
      'status', v_purchase.status
    );
  END IF;

  v_doc_label := COALESCE(NULLIF(trim(v_purchase.invoice_number), ''), p_purchase_id::text);
  v_note := trim(COALESCE(p_reason, ''));
  IF v_note = '' THEN
    v_note := 'Alış fakturası ləğv edildi';
  END IF;

  v_stock_reverted := public.revert_purchase_stock(p_purchase_id);
  v_tx_deleted := public.delete_document_cash_transactions('purchase', p_purchase_id, v_doc_label);

  IF v_purchase.supplier_id IS NOT NULL AND COALESCE(v_purchase.debt_amount, 0) > 0.0001 THEN
    SELECT balance INTO v_supplier_balance
    FROM suppliers
    WHERE id = v_purchase.supplier_id
    FOR UPDATE;

    UPDATE suppliers
    SET balance = GREATEST(COALESCE(v_supplier_balance, 0) - COALESCE(v_purchase.debt_amount, 0), 0)
    WHERE id = v_purchase.supplier_id;
  END IF;

  UPDATE warehouse_slips
  SET status = 'rejected'
  WHERE source_type = 'purchase'
    AND source_document_id = p_purchase_id
    AND status = 'pending';

  UPDATE purchases
  SET
    status = 'cancelled',
    paid_amount = 0,
    debt_amount = 0,
    warehouse_sent = FALSE,
    warehouse_slip_status = NULL,
    notes = CASE
      WHEN notes IS NULL OR trim(notes) = '' THEN v_note
      ELSE notes || E'\n' || v_note
    END
  WHERE id = p_purchase_id;

  RETURN jsonb_build_object(
    'purchase_id', p_purchase_id,
    'already_void', false,
    'status', 'cancelled',
    'stock_lines_reverted', v_stock_reverted,
    'transactions_removed', v_tx_deleted
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.void_purchase_atomic(UUID, TEXT) TO authenticated;
