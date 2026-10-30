-- ============================================================================
-- Purchase invoices: who created the document (prompt 24c, "Created by" list column).
--
-- public.purchases had no created_by. New column, filled for every signed-in insert by
-- set_created_by_from_auth() (migration 20261028140000, which must run first); the purchase submit RPCs (save_purchase_invoice_draft, create_purchase_atomic, process_purchase_receipt_event) insert without naming created_by, so the trigger fills it.
-- Old rows: backfilled from audit_logs where an insert of the row was logged
-- (action CREATE/INSERT, the user still exists); the rest stay null and lists show "—".
-- A tenant without the module (no public.purchases) skips the file. Safe to re-run.
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('public.purchases') IS NULL THEN
    RAISE NOTICE 'public.purchases does not exist (module not installed): nothing to do';
    RETURN;
  END IF;

  ALTER TABLE public.purchases
    ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users (id) ON DELETE SET NULL DEFAULT auth.uid();

  COMMENT ON COLUMN public.purchases.created_by IS 'Prompt 24c: user who created the row (auth.uid() at insert).';

  CREATE INDEX IF NOT EXISTS idx_purchases_created_by ON public.purchases (created_by);

  DROP TRIGGER IF EXISTS trg_purchases_set_created_by ON public.purchases;
  CREATE TRIGGER trg_purchases_set_created_by
    BEFORE INSERT ON public.purchases
    FOR EACH ROW EXECUTE FUNCTION public.set_created_by_from_auth();

  UPDATE public.purchases AS t
  SET created_by = a.user_id
  FROM (
    SELECT DISTINCT ON (l.record_id) l.record_id, l.user_id
    FROM public.audit_logs l
    WHERE l.table_name = 'purchases'
      AND lower(l.action) IN ('create', 'insert')
      AND l.user_id IS NOT NULL
      AND l.record_id IS NOT NULL
    ORDER BY l.record_id, l.created_at
  ) AS a
  WHERE t.id = a.record_id
    AND t.created_by IS NULL
    AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = a.user_id);
END;
$$;
