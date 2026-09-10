-- Phase 3: FIFO inventory batches + COGS journal automation

-- ─── 1. Inventory batches ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.inventory_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  document_id UUID,
  document_type TEXT NOT NULL DEFAULT 'purchase',
  unit_cost NUMERIC(14, 4) NOT NULL CHECK (unit_cost >= 0),
  initial_qty NUMERIC(14, 4) NOT NULL CHECK (initial_qty > 0),
  remaining_qty NUMERIC(14, 4) NOT NULL CHECK (remaining_qty >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inventory_batches_product_fifo
  ON public.inventory_batches (product_id, created_at ASC, id ASC)
  WHERE remaining_qty > 0;

CREATE INDEX IF NOT EXISTS idx_inventory_batches_document
  ON public.inventory_batches (document_type, document_id);

CREATE TABLE IF NOT EXISTS public.inventory_batch_consumptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id UUID NOT NULL REFERENCES public.sales(id) ON DELETE CASCADE,
  sale_item_id UUID REFERENCES public.sale_items(id) ON DELETE SET NULL,
  batch_id UUID REFERENCES public.inventory_batches(id) ON DELETE SET NULL,
  product_id UUID NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  quantity NUMERIC(14, 4) NOT NULL CHECK (quantity > 0),
  unit_cost NUMERIC(14, 4) NOT NULL CHECK (unit_cost >= 0),
  cogs_amount NUMERIC(14, 2) NOT NULL CHECK (cogs_amount >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inventory_batch_consumptions_sale
  ON public.inventory_batch_consumptions (sale_id);

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS total_cogs NUMERIC(14, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS cogs_journal_entry_id UUID REFERENCES public.journal_entries(id) ON DELETE SET NULL;

ALTER TABLE public.sale_items
  ADD COLUMN IF NOT EXISTS cogs_amount NUMERIC(14, 2) NOT NULL DEFAULT 0;

-- ─── 2. Batch creation (purchase / import) ───────────────────────────────────

CREATE OR REPLACE FUNCTION public.create_inventory_batch(
  p_product_id UUID,
  p_document_id UUID,
  p_document_type TEXT,
  p_unit_cost NUMERIC,
  p_quantity NUMERIC
)
RETURNS UUID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_batch_id UUID;
  v_qty NUMERIC := COALESCE(p_quantity, 0);
  v_cost NUMERIC := COALESCE(p_unit_cost, 0);
BEGIN
  IF p_product_id IS NULL OR v_qty <= 0 THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.inventory_batches (
    product_id,
    document_id,
    document_type,
    unit_cost,
    initial_qty,
    remaining_qty
  )
  VALUES (
    p_product_id,
    p_document_id,
    COALESCE(NULLIF(trim(p_document_type), ''), 'purchase'),
    GREATEST(v_cost, 0),
    v_qty,
    v_qty
  )
  RETURNING id INTO v_batch_id;

  RETURN v_batch_id;
END;
$$;

-- ─── 3. FIFO depletion (row-locked, oldest batch first) ──────────────────────

CREATE OR REPLACE FUNCTION public.fifo_deplete_product(
  p_product_id UUID,
  p_quantity NUMERIC,
  p_sale_id UUID,
  p_sale_item_id UUID
)
RETURNS NUMERIC
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_remaining NUMERIC := COALESCE(p_quantity, 0);
  v_batch RECORD;
  v_take NUMERIC;
  v_line_cogs NUMERIC := 0;
  v_fallback_cost NUMERIC := 0;
BEGIN
  IF p_product_id IS NULL OR v_remaining <= 0 THEN
    RETURN 0;
  END IF;

  FOR v_batch IN
    SELECT id, remaining_qty, unit_cost
    FROM public.inventory_batches
    WHERE product_id = p_product_id
      AND remaining_qty > 0
    ORDER BY created_at ASC, id ASC
    FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0.0001;

    v_take := LEAST(v_remaining, v_batch.remaining_qty);

    UPDATE public.inventory_batches
    SET remaining_qty = remaining_qty - v_take
    WHERE id = v_batch.id;

    INSERT INTO public.inventory_batch_consumptions (
      sale_id,
      sale_item_id,
      batch_id,
      product_id,
      quantity,
      unit_cost,
      cogs_amount
    )
    VALUES (
      p_sale_id,
      p_sale_item_id,
      v_batch.id,
      p_product_id,
      v_take,
      v_batch.unit_cost,
      ROUND(v_take * v_batch.unit_cost, 2)
    );

    v_line_cogs := v_line_cogs + ROUND(v_take * v_batch.unit_cost, 2);
    v_remaining := v_remaining - v_take;
  END LOOP;

  IF v_remaining > 0.0001 THEN
    SELECT COALESCE(buy_price, 0) INTO v_fallback_cost
    FROM public.products
    WHERE id = p_product_id;

    IF COALESCE(v_fallback_cost, 0) <= 0 THEN
      RAISE EXCEPTION 'insufficient_fifo_batches'
        USING ERRCODE = '22023',
              MESSAGE = format(
                'FIFO batch stoku kifayət etmir (məhsul %s, qalıq miqdar %s)',
                p_product_id,
                trim(to_char(v_remaining, 'FM999999990.00'))
              );
    END IF;

    INSERT INTO public.inventory_batch_consumptions (
      sale_id,
      sale_item_id,
      batch_id,
      product_id,
      quantity,
      unit_cost,
      cogs_amount
    )
    VALUES (
      p_sale_id,
      p_sale_item_id,
      NULL,
      p_product_id,
      v_remaining,
      v_fallback_cost,
      ROUND(v_remaining * v_fallback_cost, 2)
    );

    v_line_cogs := v_line_cogs + ROUND(v_remaining * v_fallback_cost, 2);
  END IF;

  RETURN ROUND(v_line_cogs, 2);
END;
$$;

-- ─── 4. COGS journal + sale processing ─────────────────────────────────────

CREATE OR REPLACE FUNCTION public.post_sale_cogs_journal(
  p_sale_id UUID,
  p_doc_no TEXT,
  p_total_cogs NUMERIC,
  p_idempotency TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_amount NUMERIC := ROUND(COALESCE(p_total_cogs, 0), 2);
BEGIN
  IF v_amount <= 0 THEN
    RETURN NULL;
  END IF;

  RETURN public.create_journal_entry(
    jsonb_build_object(
      'document_type', 'sale_cogs',
      'document_id', p_sale_id,
      'source_type', 'sale_cogs',
      'source_id', p_sale_id,
      'idempotency_key', COALESCE(p_idempotency, 'sale_cogs:' || p_sale_id::text),
      'description', format('Satış COGS — %s', COALESCE(p_doc_no, p_sale_id::text)),
      'memo', format('Satış COGS — %s', COALESCE(p_doc_no, p_sale_id::text)),
      'lines', jsonb_build_array(
        jsonb_build_object(
          'account_code', '5000',
          'debit', v_amount,
          'credit', 0,
          'line_memo', 'Maya dəyəri (COGS)'
        ),
        jsonb_build_object(
          'account_code', '1300',
          'debit', 0,
          'credit', v_amount,
          'line_memo', 'Anbar ehtiyatları'
        )
      )
    )
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.process_sale_fifo_cogs(
  p_sale_id UUID,
  p_doc_no TEXT DEFAULT NULL,
  p_idempotency TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_item RECORD;
  v_line_cogs NUMERIC;
  v_total_cogs NUMERIC := 0;
  v_cogs_journal_id UUID;
  v_doc_no TEXT;
BEGIN
  IF p_sale_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'sale_id tələb olunur';
  END IF;

  SELECT COALESCE(NULLIF(trim(doc_no), ''), id::text)
  INTO v_doc_no
  FROM public.sales
  WHERE id = p_sale_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'sale_not_found' USING ERRCODE = 'P0002', MESSAGE = 'Satış tapılmadı';
  END IF;

  v_doc_no := COALESCE(NULLIF(trim(p_doc_no), ''), v_doc_no);

  FOR v_item IN
    SELECT id, product_id, quantity, polywood_sale_mode
    FROM public.sale_items
    WHERE sale_id = p_sale_id
    ORDER BY id
    FOR UPDATE
  LOOP
    IF v_item.product_id IS NULL OR COALESCE(v_item.quantity, 0) <= 0 THEN
      CONTINUE;
    END IF;

    IF v_item.polywood_sale_mode IS NOT NULL THEN
      CONTINUE;
    END IF;

    v_line_cogs := public.fifo_deplete_product(
      v_item.product_id,
      v_item.quantity,
      p_sale_id,
      v_item.id
    );

    UPDATE public.sale_items
    SET cogs_amount = v_line_cogs
    WHERE id = v_item.id;

    v_total_cogs := v_total_cogs + v_line_cogs;
  END LOOP;

  v_total_cogs := ROUND(v_total_cogs, 2);
  v_cogs_journal_id := public.post_sale_cogs_journal(
    p_sale_id,
    v_doc_no,
    v_total_cogs,
    COALESCE(p_idempotency, 'sale_cogs:' || p_sale_id::text)
  );

  UPDATE public.sales
  SET total_cogs = v_total_cogs,
      cogs_journal_entry_id = v_cogs_journal_id
  WHERE id = p_sale_id;

  RETURN jsonb_build_object(
    'total_cogs', v_total_cogs,
    'cogs_journal_entry_id', v_cogs_journal_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_inventory_batch(UUID, UUID, TEXT, NUMERIC, NUMERIC) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.fifo_deplete_product(UUID, NUMERIC, UUID, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.post_sale_cogs_journal(UUID, TEXT, NUMERIC, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.process_sale_fifo_cogs(UUID, TEXT, TEXT) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
