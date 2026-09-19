-- ============================================================================
-- General-ledger integrity: period locking, reversal (storno), immutability.
--
-- Why: on 2026-09-19 the ledger held two lines dated 2026-09-14 for document
-- SS-2026-00001 (262.00 AZN, AR debit / revenue credit) whose sales row no
-- longer existed. voidSaleInvoiceDirect hard-deletes the sales row and never
-- touches journal_entries, so every void leaves orphaned postings behind and
-- frees the document number for reuse. Receivables and revenue both read
-- 265.00 while real sales were 3.00.
--
-- 1C never deletes a posted document; it posts a reversing entry (сторно).
-- This migration puts that machinery in place and makes the deletion path
-- impossible rather than merely discouraged.
-- ============================================================================

-- ─── 1. Accounting periods (закрытие периода) ────────────────────────────────

CREATE TABLE IF NOT EXISTS public.accounting_periods (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  period_year  INTEGER NOT NULL,
  period_month INTEGER NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  status       TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  closed_at    TIMESTAMPTZ,
  closed_by    UUID REFERENCES auth.users(id),
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (period_year, period_month)
);

COMMENT ON TABLE public.accounting_periods IS
  'Fiscal period register. A closed period rejects any ledger movement dated inside it.';

ALTER TABLE public.accounting_periods ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "accounting_periods_read" ON public.accounting_periods;
CREATE POLICY "accounting_periods_read" ON public.accounting_periods
  FOR SELECT TO authenticated USING (true);

REVOKE ALL ON TABLE public.accounting_periods FROM anon;
GRANT SELECT ON TABLE public.accounting_periods TO authenticated;

CREATE OR REPLACE FUNCTION public.is_accounting_period_closed(p_date DATE)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.accounting_periods
    WHERE period_year = EXTRACT(YEAR FROM p_date)::int
      AND period_month = EXTRACT(MONTH FROM p_date)::int
      AND status = 'closed'
  );
$$;

-- A period with no row is open. Absence never blocks work.
CREATE OR REPLACE FUNCTION public.assert_accounting_period_open(p_date DATE)
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.is_accounting_period_closed(p_date) THEN
    RAISE EXCEPTION 'period_closed'
      USING ERRCODE = '22023',
            MESSAGE = format(
              'Bu tarix bağlı maliyyə dövrünə düşür (%s). Əvvəlcə dövrü açın.',
              to_char(p_date, 'YYYY-MM')
            );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_journal_entry_period()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_date DATE;
BEGIN
  v_date := COALESCE(
    (CASE WHEN TG_OP = 'DELETE' THEN OLD.entry_date ELSE NEW.entry_date END),
    (CASE WHEN TG_OP = 'DELETE' THEN OLD.date::date ELSE NEW.date::date END),
    CURRENT_DATE
  );
  PERFORM public.assert_accounting_period_open(v_date);
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_journal_entries_period_guard ON public.journal_entries;
CREATE TRIGGER trg_journal_entries_period_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.journal_entries
  FOR EACH ROW EXECUTE FUNCTION public.guard_journal_entry_period();

-- ─── 2. Ledger immutability ──────────────────────────────────────────────────

-- journal_entry_lines cascaded on delete, so removing one header silently
-- destroyed its lines. A posted entry is corrected by reversal, never removal.
ALTER TABLE public.journal_entry_lines
  DROP CONSTRAINT IF EXISTS journal_entry_lines_journal_entry_id_fkey;

ALTER TABLE public.journal_entry_lines
  ADD CONSTRAINT journal_entry_lines_journal_entry_id_fkey
  FOREIGN KEY (journal_entry_id) REFERENCES public.journal_entries(id)
  ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION public.block_journal_entry_delete()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'ledger_immutable'
    USING ERRCODE = '42501',
          MESSAGE = 'Müxabirləşmə silinə bilməz. Düzəliş üçün storno sənədi yaradın (reverse_journal_entry).';
END;
$$;

DROP TRIGGER IF EXISTS trg_journal_entries_no_delete ON public.journal_entries;
CREATE TRIGGER trg_journal_entries_no_delete
  BEFORE DELETE ON public.journal_entries
  FOR EACH ROW EXECUTE FUNCTION public.block_journal_entry_delete();

DROP TRIGGER IF EXISTS trg_journal_entry_lines_no_delete ON public.journal_entry_lines;
CREATE TRIGGER trg_journal_entry_lines_no_delete
  BEFORE DELETE ON public.journal_entry_lines
  FOR EACH ROW EXECUTE FUNCTION public.block_journal_entry_delete();

-- ─── 3. Reversal (сторно) ────────────────────────────────────────────────────

ALTER TABLE public.journal_entries
  ADD COLUMN IF NOT EXISTS reversal_of UUID REFERENCES public.journal_entries(id),
  ADD COLUMN IF NOT EXISTS reversed_by UUID REFERENCES public.journal_entries(id),
  ADD COLUMN IF NOT EXISTS reversal_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_journal_entries_reversal_of
  ON public.journal_entries (reversal_of) WHERE reversal_of IS NOT NULL;

CREATE OR REPLACE FUNCTION public.reverse_journal_entry(
  p_entry_id UUID,
  p_reason   TEXT DEFAULT NULL,
  p_date     DATE DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_src    RECORD;
  v_new_id UUID;
  v_date   DATE;
BEGIN
  SELECT * INTO v_src FROM public.journal_entries WHERE id = p_entry_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'entry_not_found'
      USING ERRCODE = 'P0002', MESSAGE = 'Müxabirləşmə tapılmadı';
  END IF;

  IF v_src.reversed_by IS NOT NULL THEN
    RETURN v_src.reversed_by;           -- idempotent
  END IF;

  IF v_src.reversal_of IS NOT NULL THEN
    RAISE EXCEPTION 'already_a_reversal'
      USING ERRCODE = '22023', MESSAGE = 'Storno sənədi yenidən stornolana bilməz';
  END IF;

  -- Reverse into the original period when it is open, otherwise today.
  v_date := COALESCE(p_date, v_src.entry_date, CURRENT_DATE);
  IF public.is_accounting_period_closed(v_date) THEN
    v_date := CURRENT_DATE;
  END IF;

  INSERT INTO public.journal_entries (
    entry_no, entry_date, date, source_type, source_id,
    document_type, document_id, memo, description,
    idempotency_key, reversal_of, reversal_reason, created_by
  )
  VALUES (
    'STORNO-' || v_src.entry_no,
    v_date,
    v_date::timestamptz,
    v_src.source_type,
    v_src.source_id,
    v_src.document_type,
    v_src.document_id,
    'STORNO: ' || COALESCE(v_src.memo, v_src.entry_no),
    COALESCE(p_reason, 'Storno: ' || COALESCE(v_src.description, v_src.entry_no)),
    'storno:' || p_entry_id::text,
    p_entry_id,
    p_reason,
    auth.uid()
  )
  RETURNING id INTO v_new_id;

  -- Swap debit and credit, keep account and analytics.
  INSERT INTO public.journal_entry_lines (
    journal_entry_id, coa_id, debit, credit, partner_type, partner_id, account_id, line_memo
  )
  SELECT v_new_id, l.coa_id, l.credit, l.debit, l.partner_type, l.partner_id, l.account_id,
         'STORNO: ' || COALESCE(l.line_memo, '')
  FROM public.journal_entry_lines l
  WHERE l.journal_entry_id = p_entry_id;

  UPDATE public.journal_entries SET reversed_by = v_new_id WHERE id = p_entry_id;

  RETURN v_new_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.reverse_document_journals(
  p_document_id UUID,
  p_reason      TEXT DEFAULT NULL
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r     RECORD;
  v_cnt INTEGER := 0;
BEGIN
  FOR r IN
    SELECT id FROM public.journal_entries
    WHERE COALESCE(document_id, source_id) = p_document_id
      AND reversal_of IS NULL
      AND reversed_by IS NULL
  LOOP
    PERFORM public.reverse_journal_entry(r.id, p_reason);
    v_cnt := v_cnt + 1;
  END LOOP;
  RETURN v_cnt;
END;
$$;

-- ─── 4. Orphan diagnostic ────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.gl_orphaned_document_entries AS
SELECT
  je.id,
  je.entry_no,
  je.entry_date,
  je.source_type,
  COALESCE(je.document_id, je.source_id) AS document_id,
  je.memo,
  (SELECT COALESCE(SUM(l.debit), 0) FROM public.journal_entry_lines l
     WHERE l.journal_entry_id = je.id) AS total_debit
FROM public.journal_entries je
WHERE COALESCE(je.document_id, je.source_id) IS NOT NULL
  AND je.reversal_of IS NULL
  AND je.reversed_by IS NULL
  AND (je.source_type ILIKE '%invoice%'
       OR je.source_type ILIKE '%sale%'
       OR je.source_type ILIKE '%purchase%')
  AND NOT EXISTS (SELECT 1 FROM public.sales s
                    WHERE s.id = COALESCE(je.document_id, je.source_id))
  AND NOT EXISTS (SELECT 1 FROM public.purchases p
                    WHERE p.id = COALESCE(je.document_id, je.source_id));

COMMENT ON VIEW public.gl_orphaned_document_entries IS
  'Posted entries whose sales/purchase document no longer exists. Inspect before reversing.';

REVOKE ALL ON public.gl_orphaned_document_entries FROM anon;
GRANT SELECT ON public.gl_orphaned_document_entries TO authenticated;

CREATE OR REPLACE FUNCTION public.reverse_orphaned_document_journals(p_reason TEXT DEFAULT 'Sənədi silinmiş müxabirləşmənin stornosu')
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r     RECORD;
  v_cnt INTEGER := 0;
BEGIN
  FOR r IN SELECT id FROM public.gl_orphaned_document_entries LOOP
    PERFORM public.reverse_journal_entry(r.id, p_reason);
    v_cnt := v_cnt + 1;
  END LOOP;
  RETURN v_cnt;
END;
$$;

-- ─── 5. Stop documents with ledger history from being deleted ────────────────

CREATE OR REPLACE FUNCTION public.block_delete_of_posted_document()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.journal_entries je
    WHERE COALESCE(je.document_id, je.source_id) = OLD.id
      AND je.reversed_by IS NULL
      AND je.reversal_of IS NULL
  ) THEN
    RAISE EXCEPTION 'document_has_ledger_entries'
      USING ERRCODE = '42501',
            MESSAGE = 'Müxabirləşməsi olan sənəd silinə bilməz. Ləğv edin — sistem storno yaradacaq.';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_sales_block_posted_delete ON public.sales;
CREATE TRIGGER trg_sales_block_posted_delete
  BEFORE DELETE ON public.sales
  FOR EACH ROW EXECUTE FUNCTION public.block_delete_of_posted_document();

DROP TRIGGER IF EXISTS trg_purchases_block_posted_delete ON public.purchases;
CREATE TRIGGER trg_purchases_block_posted_delete
  BEFORE DELETE ON public.purchases
  FOR EACH ROW EXECUTE FUNCTION public.block_delete_of_posted_document();

-- ─── 6. Grants ───────────────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION public.reverse_journal_entry(UUID, TEXT, DATE) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reverse_document_journals(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reverse_orphaned_document_journals(TEXT) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.reverse_journal_entry(UUID, TEXT, DATE) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reverse_document_journals(UUID, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.reverse_orphaned_document_journals(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.is_accounting_period_closed(DATE) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.assert_accounting_period_open(DATE) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
