-- ============================================================================
-- Inventory count: "Yadda saxla" (save progress).
--
-- Counting can span hours or days. save_count_progress persists a batch of
-- counted quantities while the document stays in_progress. It only UPDATEs
-- inventory_count_items (plus the header's progress counters) — it never
-- touches stock, stock_movements, FIFO layers, pieces or the ledger. Those
-- happen exclusively in inventory_count_post.
--
-- p_lines: [{ "line_id": uuid, "kind": "qty", "actual_qty": number|null }
--          | { "line_id": uuid, "kind": "pieces", "full_sheets": int|null,
--              "cut_pieces": number[]|null }]
-- A null quantity (or an empty piece breakdown) marks the line uncounted.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.save_count_progress(
  p_count_id UUID,
  p_lines    JSONB,
  p_actor    UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor   UUID := COALESCE(auth.uid(), p_actor);
  v_doc     public.inventory_counts;
  v_item    JSONB;
  v_line_id UUID;
  v_kind    TEXT;
  v_qty     NUMERIC;
  v_full    INTEGER;
  v_cuts    JSONB;
  v_cleared BOOLEAN;
  v_rows    INTEGER;
  v_ids     UUID[] := '{}';
BEGIN
  PERFORM public._inventory_count_authorize('can_writeoff_inventory');
  v_doc := public._inventory_count_lock(p_count_id, ARRAY['in_progress']);

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' THEN
    RAISE EXCEPTION '%', 'Sətirlər massiv olmalıdır' USING ERRCODE = '22023';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_lines) LOOP
    v_line_id := NULLIF(v_item->>'line_id', '')::uuid;
    v_kind := v_item->>'kind';

    IF v_kind = 'qty' THEN
      v_qty := NULLIF(v_item->>'actual_qty', '')::numeric;
      IF v_qty IS NOT NULL AND v_qty < 0 THEN
        RAISE EXCEPTION '%', 'Miqdar mənfi ola bilməz' USING ERRCODE = '22023';
      END IF;

      UPDATE public.inventory_count_items
      SET actual_qty = v_qty,
          counted_at = CASE WHEN v_qty IS NULL THEN NULL ELSE NOW() END,
          counted_by = CASE WHEN v_qty IS NULL THEN NULL ELSE v_actor END
      WHERE id = v_line_id AND count_id = v_doc.id AND NOT is_metric;

    ELSIF v_kind = 'pieces' THEN
      v_full := NULLIF(v_item->>'full_sheets', '')::integer;
      IF v_full IS NOT NULL AND v_full < 0 THEN
        RAISE EXCEPTION '%', 'Tam vərəq sayı mənfi ola bilməz' USING ERRCODE = '22023';
      END IF;

      SELECT COALESCE(jsonb_agg(ROUND(value::numeric, 3) ORDER BY ordinality), '[]'::jsonb)
      INTO v_cuts
      FROM jsonb_array_elements_text(
        CASE WHEN jsonb_typeof(v_item->'cut_pieces') = 'array' THEN v_item->'cut_pieces' ELSE '[]'::jsonb END
      ) WITH ORDINALITY
      WHERE value::numeric > 0;

      v_cleared := v_full IS NULL AND jsonb_array_length(v_cuts) = 0;

      UPDATE public.inventory_count_items
      SET actual_full_sheets = CASE WHEN v_cleared THEN NULL ELSE COALESCE(v_full, 0) END,
          actual_cut_pieces  = CASE WHEN v_cleared THEN NULL ELSE v_cuts END,
          scanned_piece_ids  = CASE WHEN v_cleared THEN '[]'::jsonb ELSE scanned_piece_ids END,
          counted_at = CASE WHEN v_cleared THEN NULL ELSE NOW() END,
          counted_by = CASE WHEN v_cleared THEN NULL ELSE v_actor END
      WHERE id = v_line_id AND count_id = v_doc.id AND is_metric;

    ELSE
      RAISE EXCEPTION '%', format('Naməlum sətir növü: %s', COALESCE(v_kind, 'null')) USING ERRCODE = '22023';
    END IF;

    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 0 THEN
      RAISE EXCEPTION '%', 'Sayım sətri tapılmadı' USING ERRCODE = 'P0002';
    END IF;
    v_ids := v_ids || v_line_id;
  END LOOP;

  PERFORM public.inventory_count_refresh_totals(v_doc.id);

  RETURN COALESCE(
    (SELECT jsonb_agg(to_jsonb(i)) FROM public.inventory_count_items i WHERE i.id = ANY (v_ids)),
    '[]'::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION public.save_count_progress(UUID, JSONB, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_count_progress(UUID, JSONB, UUID) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
