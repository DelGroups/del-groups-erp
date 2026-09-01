-- Universal financial linkage: transaction source provenance + document additional expenses
-- Run AFTER account-mutations.sql, journal-engine-migration.sql, erp-events-migration.sql

-- ─── Transaction source linkage ───────────────────────────────────────────────

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS source_type TEXT;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS source_id UUID;

CREATE INDEX IF NOT EXISTS idx_transactions_source
  ON transactions (source_type, source_id)
  WHERE source_type IS NOT NULL;

-- ─── Document additional expenses (landed costs) ────────────────────────────────

ALTER TABLE sales ADD COLUMN IF NOT EXISTS additional_expenses JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS additional_expenses_total NUMERIC NOT NULL DEFAULT 0;

ALTER TABLE purchases ADD COLUMN IF NOT EXISTS additional_expenses JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS additional_expenses_total NUMERIC NOT NULL DEFAULT 0;

ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS advance_account_id UUID REFERENCES accounts(id);
ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS additional_expenses JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE production_orders ADD COLUMN IF NOT EXISTS additional_expenses_total NUMERIC NOT NULL DEFAULT 0;

-- Polywood line detail (optional columns on sale_items)
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS polywood_width_m NUMERIC;
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS polywood_pieces NUMERIC;
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS polywood_total_area_m2 NUMERIC;
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS polywood_cutting_option TEXT;
ALTER TABLE sale_items ADD COLUMN IF NOT EXISTS polywood_edge_option TEXT;

-- ─── Post paid additional expenses and return total ───────────────────────────

CREATE OR REPLACE FUNCTION public.apply_document_additional_expenses(
  p_expenses JSONB,
  p_source_type TEXT,
  p_source_id UUID,
  p_doc_ref TEXT
)
RETURNS NUMERIC
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_exp JSONB;
  v_amount NUMERIC;
  v_total NUMERIC := 0;
  v_account_id UUID;
  v_label TEXT;
  v_paid BOOLEAN;
BEGIN
  IF p_expenses IS NULL OR jsonb_typeof(p_expenses) <> 'array' THEN
    RETURN 0;
  END IF;

  FOR v_exp IN SELECT value FROM jsonb_array_elements(p_expenses)
  LOOP
    v_amount := COALESCE(NULLIF(v_exp->>'amount', '')::numeric, 0);
    IF v_amount <= 0 THEN
      CONTINUE;
    END IF;
    v_total := v_total + v_amount;
    v_paid := COALESCE((v_exp->>'paid_immediately')::boolean, false);
    IF NOT v_paid THEN
      CONTINUE;
    END IF;

    v_account_id := NULLIF(v_exp->>'account_id', '')::uuid;
    IF v_account_id IS NULL THEN
      RAISE EXCEPTION 'account_required_for_expense'
        USING ERRCODE = '22023',
              MESSAGE = 'Ödənilən əlavə xərc üçün kassa/bank hesabı seçilməlidir';
    END IF;

    v_label := COALESCE(NULLIF(trim(v_exp->>'label'), ''), 'Əlavə xərc');

    PERFORM public.post_cash_transaction(
      v_account_id,
      'Məxaric',
      v_amount,
      'Əlavə Xərc',
      format('%s — %s', p_doc_ref, v_label),
      NULL,
      p_source_type,
      p_source_id
    );
  END LOOP;

  RETURN v_total;
END;
$$;

GRANT EXECUTE ON FUNCTION public.apply_document_additional_expenses(JSONB, TEXT, UUID, TEXT) TO authenticated;
