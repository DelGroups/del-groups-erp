-- P0-3: post opening stock / stock receipts to the general ledger.
--
-- postInitialBalanceDocumentAction raised stock and created FIFO batches
-- (inventory_batches) but never wrote a journal entry, so GL 1300 stayed at
-- -2.00 while ~109k AZN of approved IQ documents sat in stock.
--
--   opening_balance: Dr 1300 Anbar / Cr 3900 İlkin qalıq kapitalı
--   receipt:         Dr 1300 Anbar / Cr 2150 Alınmış, fakturası gözlənilən mallar
--
-- The amount is the document's FIFO batch value, Σ(initial_qty × unit_cost),
-- so GL 1300 agrees with the valuation layers by construction. The entry is
-- dated doc_date and linked by document_id, so the existing unpost
-- (unpost_inventory_initial_balance → reverse_document_journals) reverses it.
--
-- Atomic: a closed accounting period (trg_journal_entries_period_guard) or any
-- other error rolls the whole migration back, backfill included.

BEGIN;

-- ─── 1. Clearing account for receipts awaiting the supplier invoice ──────────
INSERT INTO public.chart_of_accounts (code, name, account_type)
VALUES ('2150', 'Alınmış, fakturası gözlənilən mallar', 'liability')
ON CONFLICT (code) DO NOTHING;

-- ─── 2. Posting function (idempotent per posting cycle) ──────────────────────
CREATE OR REPLACE FUNCTION public.post_initial_balance_journal(p_document_id UUID)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_doc       public.inventory_initial_balances%ROWTYPE;
  v_existing  UUID;
  v_amount    NUMERIC;
  v_counter   TEXT;
  v_label     TEXT;
  v_cycle     INTEGER;
BEGIN
  SELECT * INTO v_doc
  FROM public.inventory_initial_balances
  WHERE id = p_document_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'P0002', MESSAGE = 'İlkin qalıq sənədi tapılmadı';
  END IF;

  -- Called while posting (still draft) or for an already posted document (backfill).
  IF v_doc.status NOT IN ('draft', 'posted') THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = format('%s: ləğv edilmiş sənəd üçün mühasibat yazılışı edilmir', v_doc.document_number);
  END IF;

  -- An original (not a storno) entry that has not been reversed means the
  -- document is already in the ledger: return it instead of posting twice.
  SELECT id INTO v_existing
  FROM public.journal_entries
  WHERE COALESCE(document_id, source_id) = p_document_id
    AND reversal_of IS NULL
    AND reversed_by IS NULL
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN v_existing;
  END IF;

  SELECT round(SUM(initial_qty * unit_cost), 2) INTO v_amount
  FROM public.inventory_batches
  WHERE document_id = p_document_id;

  IF v_amount IS NULL OR v_amount <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = '22023',
      MESSAGE = format('%s: FIFO partiyası tapılmadı — mühasibat yazılışı edilmədi', v_doc.document_number);
  END IF;

  IF v_doc.entry_type = 'receipt' THEN
    v_counter := '2150';
    v_label := 'Stok qəbulu';
  ELSE
    v_counter := '3900';
    v_label := 'İlkin qalıq';
  END IF;

  -- Each unpost/repost cycle needs its own idempotency key.
  SELECT COUNT(*) + 1 INTO v_cycle
  FROM public.journal_entries
  WHERE COALESCE(document_id, source_id) = p_document_id
    AND reversal_of IS NULL;

  RETURN public.create_journal_entry(
    jsonb_build_object(
      'entry_date', v_doc.doc_date,
      'source_type', 'inventory_initial_balance',
      'source_id', p_document_id,
      'document_type', 'inventory_initial_balance',
      'document_id', p_document_id,
      'idempotency_key', format('inventory_initial_balance:%s:%s', p_document_id, v_cycle),
      'memo', format('%s — %s', v_label, v_doc.document_number),
      'lines', jsonb_build_array(
        jsonb_build_object('coa_code', '1300', 'debit', v_amount, 'credit', 0,
                           'line_memo', v_doc.document_number),
        jsonb_build_object('coa_code', v_counter, 'debit', 0, 'credit', v_amount,
                           'line_memo', v_doc.document_number)
      )
    )
  );
END;
$$;

-- Only the server (service_role) posts; users go through the posting action.
REVOKE ALL ON FUNCTION public.post_initial_balance_journal(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.post_initial_balance_journal(UUID) TO service_role;

-- ─── 3. Backfill already posted documents, each on its own doc_date ──────────
DO $$
DECLARE
  r RECORD;
  v_entry UUID;
BEGIN
  FOR r IN
    SELECT id, document_number
    FROM public.inventory_initial_balances
    WHERE status = 'posted'
    ORDER BY doc_date, document_number
  LOOP
    v_entry := public.post_initial_balance_journal(r.id);
    RAISE NOTICE '% -> journal %', r.document_number, v_entry;
  END LOOP;
END;
$$;

COMMIT;

NOTIFY pgrst, 'reload schema';
