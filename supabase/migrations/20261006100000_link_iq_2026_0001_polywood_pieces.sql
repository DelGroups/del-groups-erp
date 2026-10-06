-- ============================================================================
-- IQ-2026-0001 (MAHIA MATT, 3 × 4 m): link its pieces to the document so it
-- can be returned to draft.
--
-- The document was posted on 2026-09-14, before polywood_pieces had a
-- source_document_id column (20260924120000). unpost_inventory_initial_balance
-- therefore refuses it ("metrik hissələr köhnə qaydada təsdiqlənib…").
--
-- Verified on production 2026-10-06 (read-only):
--   * it is the only posted document with an unlinked metric line;
--   * MAHIA MATT has exactly 3 pieces, all 4 m, 'available', unsold, in the
--     document's warehouse, created 2026-09-14 09:08:24 by this posting;
--   * stock 12 m, one FIFO batch of 12 m untouched, one 'in' movement of 12 m.
--
-- This only sets source_document_id on those 3 pieces. Stock, batches and the
-- ledger are unchanged; the regular "Qaralamaya qaytar" button then reverses
-- everything as usual. Every check below aborts the migration if the data no
-- longer looks exactly like this, and running it twice is a no-op.
-- ============================================================================

DO $$
DECLARE
  c_doc     CONSTANT UUID := '7bc66e71-5c88-4f41-9aa2-b294a80e8a10';
  c_product CONSTANT UUID := 'b1952166-502d-4611-be6e-9efb8e26e014';
  v_doc     RECORD;
  v_linked  INTEGER;
  v_pieces  INTEGER;
  v_meters  NUMERIC;
  v_updated INTEGER;
BEGIN
  SELECT id, status, warehouse_id INTO v_doc
  FROM public.inventory_initial_balances
  WHERE id = c_doc
  FOR UPDATE;

  IF NOT FOUND OR v_doc.status <> 'posted' THEN
    RAISE NOTICE 'IQ-2026-0001 is not posted; nothing to do.';
    RETURN;
  END IF;

  SELECT count(*) INTO v_linked
  FROM public.polywood_pieces
  WHERE source_document_id = c_doc AND product_id = c_product;

  IF v_linked > 0 THEN
    RAISE NOTICE 'IQ-2026-0001 pieces already linked; nothing to do.';
    RETURN;
  END IF;

  -- Every piece of this product must be one this document created.
  SELECT count(*), COALESCE(sum(length_m), 0) INTO v_pieces, v_meters
  FROM public.polywood_pieces
  WHERE product_id = c_product;

  IF v_pieces <> 3 OR v_meters <> 12 OR EXISTS (
    SELECT 1 FROM public.polywood_pieces
    WHERE product_id = c_product
      AND (status <> 'available'
           OR sale_item_id IS NOT NULL
           OR source_document_id IS NOT NULL
           OR warehouse_id IS DISTINCT FROM v_doc.warehouse_id)
  ) THEN
    RAISE EXCEPTION 'MAHIA MATT pieces changed since 2026-10-06 (count %, metres %); not linking.',
      v_pieces, v_meters;
  END IF;

  UPDATE public.polywood_pieces
  SET source_document_id = c_doc,
      updated_at = NOW()
  WHERE product_id = c_product
    AND source_document_id IS NULL;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RAISE NOTICE 'Linked % MAHIA MATT pieces to IQ-2026-0001.', v_updated;
END;
$$;
