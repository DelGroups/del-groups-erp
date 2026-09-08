-- Fix void_sale_atomic: remove reference to sales_commissions (table may not exist).

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
