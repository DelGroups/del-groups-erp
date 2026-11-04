-- Imports module ("İdxal"), UI-5 item a: delete a draft import document.
--
-- A draft with nothing posted can be deleted (its lines, costs and splits go with it: ON DELETE
-- CASCADE in 20261030100000_imports_core.sql). "Nothing posted" means no supplier prepayment
-- (prepay_import_supplier is draft-only and posts cash, payments and a journal entry) and no
-- journal entry that points at the shipment. Anything else is cancelled instead
-- (cancel_import_shipment, with a reason), which reverses its entries.
--
--   delete_import_draft(p_id)     the checked, atomic delete the app calls
--   import_shipments_delete        the direct-delete policy refuses the same cases, so a delete
--                                  through the API can never orphan a posted prepayment
--
-- Re-runnable: CREATE OR REPLACE / DROP POLICY IF EXISTS.

CREATE OR REPLACE FUNCTION public.import_shipment_has_postings(p_shipment UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.import_prepayments p WHERE p.shipment_id = p_shipment)
      OR EXISTS (SELECT 1 FROM public.journal_entries j WHERE j.document_id = p_shipment AND j.document_type LIKE 'import%');
$$;

REVOKE ALL ON FUNCTION public.import_shipment_has_postings(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_shipment_has_postings(UUID) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.delete_import_draft(p_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_s public.import_shipments;
BEGIN
  PERFORM public._imports_require('manage');
  SELECT * INTO v_s FROM public.import_shipments WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'imports_not_found: İdxal sənədi tapılmadı';
  END IF;
  IF v_s.status <> 'draft' THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'imports_delete_draft_only: Yalnız qaralama silinə bilər; təsdiqlənmiş idxalı ləğv edin';
  END IF;
  IF public.import_shipment_has_postings(p_id) THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = 'imports_delete_has_postings: Bu qaralamada avans ödənişi var; silmək əvəzinə ləğv edin';
  END IF;

  DELETE FROM public.import_shipments WHERE id = p_id;

  RETURN jsonb_build_object('success', true, 'shipment_id', p_id, 'number', v_s.number);
END;
$$;

REVOKE ALL ON FUNCTION public.delete_import_draft(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_import_draft(UUID) TO authenticated, service_role;

DROP POLICY IF EXISTS import_shipments_delete ON public.import_shipments;
CREATE POLICY import_shipments_delete ON public.import_shipments FOR DELETE TO authenticated
  USING ((SELECT public.imports_can('manage')) AND status = 'draft' AND NOT public.import_shipment_has_postings(id));
