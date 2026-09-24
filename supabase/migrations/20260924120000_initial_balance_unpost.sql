-- ============================================================================
-- Stok Girişi və İlkin Qalıq: "Qaralamaya qaytar" (unpost / отмена проведения).
--
-- A posted document is never raw-edited or deleted. Unposting reverses every
-- effect of postInitialBalanceDocumentAction in one transaction and returns
-- the document to draft so it can be corrected and posted again:
--
--   stock_movements   → offsetting 'out' rows (STORNO); originals are kept
--   inventory_batches → removed, but only while fully unconsumed (FIFO intact)
--   polywood_pieces   → pieces this document created are removed, only while
--                       every one of them is still 'available'
--   products / warehouse_stocks → stock and weighted buy price restored
--   journal_entries   → reversed via reverse_document_journals (storno)
--
-- If any quantity from the document has already been sold, consumed or cut,
-- unposting is refused: reversing it would drive stock negative. Correct it
-- with a write-off or a new receipt instead.
-- ============================================================================

-- Pieces created by a posting now remember their source document, so an
-- unpost can find exactly those pieces and no others.
ALTER TABLE public.polywood_pieces
  ADD COLUMN IF NOT EXISTS source_document_id UUID;

CREATE INDEX IF NOT EXISTS idx_polywood_pieces_source_document
  ON public.polywood_pieces (source_document_id)
  WHERE source_document_id IS NOT NULL;

ALTER TABLE public.inventory_initial_balances
  ADD COLUMN IF NOT EXISTS unposted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS unposted_by UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS unpost_reason TEXT;

CREATE OR REPLACE FUNCTION public.unpost_inventory_initial_balance(
  p_document_id UUID,
  p_reason      TEXT DEFAULT NULL,
  p_actor       UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Server actions call through the service role (no auth.uid()) and pass the
  -- already-authorised user in p_actor; a signed-in caller is always itself.
  v_actor      UUID := COALESCE(auth.uid(), p_actor);
  v_doc        RECORD;
  v_ref        TEXT;
  v_label      TEXT;
  r            RECORD;
  v_is_metric  BOOLEAN;
  v_value      NUMERIC;
  v_old_stock  NUMERIC;
  v_old_buy    NUMERIC;
  v_new_stock  NUMERIC;
  v_new_buy    NUMERIC;
  v_moves      INTEGER := 0;
  v_journals   INTEGER := 0;
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT (public.user_is_admin() OR public.has_permission('can_unpost_inventory')) THEN
    RAISE EXCEPTION '%', 'forbidden' USING ERRCODE = '42501';
  END IF;

  IF p_document_id IS NULL THEN
    RAISE EXCEPTION '%', 'Sənəd ID-si göstərilməyib' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_doc
  FROM public.inventory_initial_balances
  WHERE id = p_document_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION '%', 'Sənəd tapılmadı' USING ERRCODE = 'P0002';
  END IF;

  IF v_doc.status <> 'posted' THEN
    RAISE EXCEPTION '%', 'Yalnız təsdiqlənmiş sənəd qaralamaya qaytarıla bilər' USING ERRCODE = '22023';
  END IF;

  IF public.is_accounting_period_closed(v_doc.doc_date) THEN
    RAISE EXCEPTION '%', format(
      'Sənəd tarixi bağlı maliyyə dövrünə düşür (%s). Əvvəlcə dövrü açın.',
      to_char(v_doc.doc_date, 'YYYY-MM')
    ) USING ERRCODE = '22023';
  END IF;

  v_ref := CASE WHEN v_doc.entry_type = 'receipt' THEN 'stock_receipt' ELSE 'initial_balance' END;
  v_label := v_doc.document_number;

  -- ─── Guards: nothing from this document may have left the warehouse ──────

  IF EXISTS (
    SELECT 1 FROM public.inventory_batches
    WHERE document_id = p_document_id
      AND document_type = v_ref
      AND remaining_qty < initial_qty
  ) THEN
    RAISE EXCEPTION '%',
      'Bu sənədlə daxil olan stokun bir hissəsi artıq satılıb və ya istifadə olunub. Qaralamaya qaytarmaq mümkün deyil — silinmə və ya düzəliş sənədi ilə düzəldin.'
      USING ERRCODE = '22023';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.polywood_pieces
    WHERE source_document_id = p_document_id
      AND status <> 'available'
  ) THEN
    RAISE EXCEPTION '%',
      'Bu sənədlə daxil olan hissələrin bəziləri artıq satılıb və ya kəsilib. Qaralamaya qaytarmaq mümkün deyil.'
      USING ERRCODE = '22023';
  END IF;

  -- Metric lines posted before pieces were linked to their document cannot be
  -- told apart from other pieces of the same product, so refuse rather than guess.
  IF EXISTS (
    SELECT 1 FROM public.inventory_initial_balance_items i
    WHERE i.document_id = p_document_id
      AND i.is_metric
      AND NOT EXISTS (
        SELECT 1 FROM public.polywood_pieces pp
        WHERE pp.source_document_id = p_document_id
          AND pp.product_id = i.product_id
      )
  ) THEN
    RAISE EXCEPTION '%',
      'Bu sənəddəki metrik hissələr köhnə qaydada təsdiqlənib və sənədə bağlı deyil. Avtomatik geri qaytarmaq mümkün deyil — administratorla əlaqə saxlayın.'
      USING ERRCODE = '22023';
  END IF;

  -- ─── Reverse stock, per product and warehouse ────────────────────────────
  -- Net the document's own movements so earlier post/unpost cycles cancel out.

  FOR r IN
    SELECT
      m.product_id,
      m.warehouse_id,
      MIN(m.unit) AS unit,
      SUM(CASE WHEN m.movement_type = 'in' THEN m.quantity ELSE -m.quantity END) AS net_qty
    FROM public.stock_movements m
    WHERE m.reference_id = p_document_id
      AND m.reference_type = v_ref
    GROUP BY m.product_id, m.warehouse_id
    HAVING SUM(CASE WHEN m.movement_type = 'in' THEN m.quantity ELSE -m.quantity END) > 0.0005
  LOOP
    SELECT EXISTS (
      SELECT 1 FROM public.inventory_initial_balance_items i
      WHERE i.document_id = p_document_id AND i.product_id = r.product_id AND i.is_metric
    ) INTO v_is_metric;

    SELECT COALESCE(SUM(
      (CASE WHEN i.is_metric THEN COALESCE(i.metric_total_meters, i.quantity) ELSE i.quantity END) * i.unit_cost
    ), 0)
    INTO v_value
    FROM public.inventory_initial_balance_items i
    WHERE i.document_id = p_document_id AND i.product_id = r.product_id;

    SELECT COALESCE(stock, 0), COALESCE(buy_price, 0)
    INTO v_old_stock, v_old_buy
    FROM public.products
    WHERE id = r.product_id
    FOR UPDATE;

    IF v_is_metric THEN
      DELETE FROM public.polywood_pieces
      WHERE source_document_id = p_document_id
        AND product_id = r.product_id;

      -- Same rule as syncPolywoodProductStockFromPieces: stock = available metres.
      SELECT ROUND(COALESCE(SUM(length_m), 0), 3)
      INTO v_new_stock
      FROM public.polywood_pieces
      WHERE product_id = r.product_id
        AND warehouse_id = r.warehouse_id
        AND status = 'available';
    ELSE
      IF v_old_stock + 0.0005 < r.net_qty THEN
        RAISE EXCEPTION '%', format(
          'Məhsulun cari qalığı (%s) bu sənədin daxil etdiyi miqdardan (%s) azdır — stok artıq çıxarılıb. Qaralamaya qaytarmaq mümkün deyil.',
          v_old_stock, r.net_qty
        ) USING ERRCODE = '22023';
      END IF;
      v_new_stock := v_old_stock - r.net_qty;
    END IF;

    -- Undo the weighted-average cost the posting applied.
    v_new_buy := v_old_buy;
    IF v_new_stock > 0 THEN
      v_new_buy := ROUND((v_old_stock * v_old_buy - v_value) / v_new_stock, 2);
      IF v_new_buy < 0 THEN
        v_new_buy := v_old_buy;
      END IF;
    END IF;

    UPDATE public.products
    SET stock = v_new_stock, buy_price = v_new_buy
    WHERE id = r.product_id;

    UPDATE public.warehouse_stocks
    SET current_stock = v_new_stock,
        piece_lengths = CASE WHEN v_is_metric THEN (
          SELECT COALESCE(jsonb_agg(pp.length_m ORDER BY pp.length_m DESC), '[]'::jsonb)
          FROM public.polywood_pieces pp
          WHERE pp.product_id = r.product_id
            AND pp.warehouse_id = r.warehouse_id
            AND pp.status = 'available'
        ) ELSE piece_lengths END,
        updated_at = NOW()
    WHERE product_id = r.product_id
      AND warehouse_id IS NOT DISTINCT FROM r.warehouse_id;

    INSERT INTO public.stock_movements (
      product_id, warehouse_id, movement_type, quantity, unit,
      reference_type, reference_id, description, created_by
    )
    VALUES (
      r.product_id, r.warehouse_id, 'out', r.net_qty, r.unit,
      v_ref, p_document_id, 'STORNO: ' || v_label, v_actor
    );

    v_moves := v_moves + 1;
  END LOOP;

  IF v_moves = 0 AND EXISTS (
    SELECT 1 FROM public.inventory_initial_balance_items WHERE document_id = p_document_id
  ) THEN
    RAISE EXCEPTION '%',
      'Bu sənəd üçün anbar hərəkəti tapılmadı. Avtomatik geri qaytarmaq mümkün deyil — administratorla əlaqə saxlayın.'
      USING ERRCODE = '22023';
  END IF;

  -- FIFO layers were verified untouched above; re-posting creates fresh ones.
  DELETE FROM public.inventory_batches
  WHERE document_id = p_document_id
    AND document_type = v_ref;

  -- Ledger is immutable: offset any postings with storno entries.
  v_journals := public.reverse_document_journals(
    p_document_id,
    'Qaralamaya qaytarıldı: ' || v_label || COALESCE(' — ' || NULLIF(trim(p_reason), ''), '')
  );

  UPDATE public.inventory_initial_balances
  SET status = 'draft',
      posted_at = NULL,
      posted_by = NULL,
      unposted_at = NOW(),
      unposted_by = v_actor,
      unpost_reason = NULLIF(trim(p_reason), ''),
      updated_at = NOW()
  WHERE id = p_document_id;

  RETURN jsonb_build_object(
    'document_number', v_label,
    'movements_reversed', v_moves,
    'journals_reversed', v_journals
  );
END;
$$;

REVOKE ALL ON FUNCTION public.unpost_inventory_initial_balance(UUID, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unpost_inventory_initial_balance(UUID, TEXT, UUID) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
