-- Partners module: banking fields, credit limit, soft delete.

ALTER TABLE partners ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS bank_name TEXT;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS iban TEXT;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS credit_limit NUMERIC NOT NULL DEFAULT 0;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE partners ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_partners_is_deleted ON partners (is_deleted) WHERE is_deleted = FALSE;

CREATE OR REPLACE FUNCTION public.merge_partners(
  p_source_partner_id UUID,
  p_target_partner_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source partners%ROWTYPE;
  v_target partners%ROWTYPE;
  v_sales_moved INT := 0;
  v_purchases_moved INT := 0;
BEGIN
  IF p_source_partner_id IS NULL OR p_target_partner_id IS NULL THEN
    RAISE EXCEPTION 'partner_ids_required'
      USING ERRCODE = '22023',
            MESSAGE = 'Hər iki tərəfdaş seçilməlidir';
  END IF;

  IF p_source_partner_id = p_target_partner_id THEN
    RAISE EXCEPTION 'same_partner'
      USING ERRCODE = '22023',
            MESSAGE = 'Eyni tərəfdaş seçilə bilməz';
  END IF;

  SELECT * INTO v_source FROM partners WHERE id = p_source_partner_id AND is_deleted = FALSE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'source_not_found'
      USING ERRCODE = 'P0002',
            MESSAGE = 'Mənbə tərəfdaş tapılmadı';
  END IF;

  SELECT * INTO v_target FROM partners WHERE id = p_target_partner_id AND is_deleted = FALSE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'target_not_found'
      USING ERRCODE = 'P0002',
            MESSAGE = 'Hədəf tərəfdaş tapılmadı';
  END IF;

  UPDATE sales
  SET partner_id = p_target_partner_id
  WHERE partner_id = p_source_partner_id;
  GET DIAGNOSTICS v_sales_moved = ROW_COUNT;

  IF v_source.customer_id IS NOT NULL THEN
    UPDATE sales
    SET partner_id = p_target_partner_id
    WHERE partner_id IS NULL
      AND customer_id = v_source.customer_id;
    v_sales_moved := v_sales_moved + ROW_COUNT;
  END IF;

  UPDATE purchases
  SET partner_id = p_target_partner_id
  WHERE partner_id = p_source_partner_id;
  GET DIAGNOSTICS v_purchases_moved = ROW_COUNT;

  IF v_source.supplier_id IS NOT NULL THEN
    UPDATE purchases
    SET partner_id = p_target_partner_id
    WHERE partner_id IS NULL
      AND supplier_id = v_source.supplier_id;
    v_purchases_moved := v_purchases_moved + ROW_COUNT;
  END IF;

  UPDATE partners
  SET
    is_customer = (v_target.is_customer OR v_source.is_customer),
    is_supplier = (v_target.is_supplier OR v_source.is_supplier),
    customer_id = COALESCE(v_target.customer_id, v_source.customer_id),
    supplier_id = COALESCE(v_target.supplier_id, v_source.supplier_id),
    email = COALESCE(NULLIF(trim(v_target.email), ''), NULLIF(trim(v_source.email), '')),
    bank_name = COALESCE(NULLIF(trim(v_target.bank_name), ''), NULLIF(trim(v_source.bank_name), '')),
    iban = COALESCE(NULLIF(trim(v_target.iban), ''), NULLIF(trim(v_source.iban), '')),
    credit_limit = GREATEST(COALESCE(v_target.credit_limit, 0), COALESCE(v_source.credit_limit, 0)),
    voen = COALESCE(NULLIF(trim(v_target.voen), ''), NULLIF(trim(v_source.voen), ''))
  WHERE id = p_target_partner_id;

  UPDATE partners
  SET
    is_deleted = TRUE,
    deleted_at = NOW()
  WHERE id = p_source_partner_id;

  RETURN jsonb_build_object(
    'target_partner_id', p_target_partner_id,
    'source_partner_id', p_source_partner_id,
    'sales_moved', v_sales_moved,
    'purchases_moved', v_purchases_moved
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.merge_partners(UUID, UUID) TO authenticated;
