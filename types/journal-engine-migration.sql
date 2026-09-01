-- Del Groups ERP — Journal Engine (Phase 1 double-entry)
-- Run AFTER types/chart-of-accounts-migration.sql

CREATE TABLE IF NOT EXISTS public.journal_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_no TEXT NOT NULL,
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  source_type TEXT NOT NULL,
  source_id UUID,
  idempotency_key TEXT,
  memo TEXT,
  posted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_journal_entries_idempotency
  ON public.journal_entries (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_journal_entries_source
  ON public.journal_entries (source_type, source_id);

CREATE TABLE IF NOT EXISTS public.journal_entry_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  journal_entry_id UUID NOT NULL REFERENCES public.journal_entries(id) ON DELETE CASCADE,
  coa_id UUID NOT NULL REFERENCES public.chart_of_accounts(id),
  debit NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (debit >= 0),
  credit NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (credit >= 0),
  partner_type TEXT,
  partner_id UUID,
  account_id UUID REFERENCES public.accounts(id) ON DELETE SET NULL,
  line_memo TEXT,
  CHECK (NOT (debit > 0 AND credit > 0))
);

CREATE INDEX IF NOT EXISTS idx_journal_entry_lines_entry
  ON public.journal_entry_lines (journal_entry_id);

ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS journal_entry_id UUID REFERENCES public.journal_entries(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.resolve_coa_id(p_code TEXT)
RETURNS UUID
LANGUAGE sql
STABLE
AS $$
  SELECT id
  FROM public.chart_of_accounts
  WHERE code = trim(p_code)
    AND is_active = true
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.post_journal_entry(p_payload JSONB)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lines JSONB;
  v_line JSONB;
  v_entry_id UUID;
  v_entry_no TEXT;
  v_idempotency TEXT;
  v_total_debit NUMERIC := 0;
  v_total_credit NUMERIC := 0;
  v_coa_id UUID;
  v_coa_code TEXT;
  v_debit NUMERIC;
  v_credit NUMERIC;
  v_idx INT := 0;
BEGIN
  IF p_payload IS NULL THEN
    RAISE EXCEPTION 'invalid_payload'
      USING ERRCODE = '22023',
            MESSAGE = 'Journal payload tələb olunur';
  END IF;

  v_idempotency := NULLIF(trim(p_payload->>'idempotency_key'), '');
  IF v_idempotency IS NOT NULL THEN
    SELECT id INTO v_entry_id
    FROM public.journal_entries
    WHERE idempotency_key = v_idempotency
    LIMIT 1;
    IF FOUND THEN
      RETURN v_entry_id;
    END IF;
  END IF;

  v_lines := COALESCE(p_payload->'lines', '[]'::jsonb);
  IF jsonb_typeof(v_lines) <> 'array' OR jsonb_array_length(v_lines) = 0 THEN
    RAISE EXCEPTION 'lines_required'
      USING ERRCODE = '22023',
            MESSAGE = 'Journal sətirləri tələb olunur';
  END IF;

  FOR v_idx IN 0 .. jsonb_array_length(v_lines) - 1 LOOP
    v_line := v_lines->v_idx;
    v_debit := COALESCE((v_line->>'debit')::numeric, 0);
    v_credit := COALESCE((v_line->>'credit')::numeric, 0);
    v_total_debit := v_total_debit + v_debit;
    v_total_credit := v_total_credit + v_credit;
  END LOOP;

  IF abs(v_total_debit - v_total_credit) > 0.01 THEN
    RAISE EXCEPTION 'unbalanced_journal'
      USING ERRCODE = '22023',
            MESSAGE = format(
              'Journal balanssızdir (debit=%s, credit=%s)',
              v_total_debit,
              v_total_credit
            );
  END IF;

  v_entry_no := COALESCE(
    NULLIF(trim(p_payload->>'entry_no'), ''),
    'JE-' || to_char(CURRENT_DATE, 'YYYYMMDD') || '-' || floor(1000 + random() * 9000)::int
  );

  INSERT INTO public.journal_entries (
    entry_no,
    entry_date,
    source_type,
    source_id,
    idempotency_key,
    memo,
    created_by
  )
  VALUES (
    v_entry_no,
    COALESCE(NULLIF(p_payload->>'entry_date', '')::date, CURRENT_DATE),
    COALESCE(NULLIF(trim(p_payload->>'source_type'), ''), 'manual'),
    NULLIF(p_payload->>'source_id', '')::uuid,
    v_idempotency,
    NULLIF(trim(p_payload->>'memo'), ''),
    auth.uid()
  )
  RETURNING id INTO v_entry_id;

  FOR v_idx IN 0 .. jsonb_array_length(v_lines) - 1 LOOP
    v_line := v_lines->v_idx;
    v_coa_id := NULLIF(v_line->>'coa_id', '')::uuid;
    v_coa_code := NULLIF(trim(v_line->>'coa_code'), '');

    IF v_coa_id IS NULL AND v_coa_code IS NOT NULL THEN
      v_coa_id := public.resolve_coa_id(v_coa_code);
    END IF;

    IF v_coa_id IS NULL THEN
      RAISE EXCEPTION 'coa_not_found'
        USING ERRCODE = 'P0002',
              MESSAGE = format('Hesab planı tapılmadı: %s', COALESCE(v_coa_code, v_line->>'coa_id'));
    END IF;

    INSERT INTO public.journal_entry_lines (
      journal_entry_id,
      coa_id,
      debit,
      credit,
      partner_type,
      partner_id,
      account_id,
      line_memo
    )
    VALUES (
      v_entry_id,
      v_coa_id,
      COALESCE((v_line->>'debit')::numeric, 0),
      COALESCE((v_line->>'credit')::numeric, 0),
      NULLIF(trim(v_line->>'partner_type'), ''),
      NULLIF(v_line->>'partner_id', '')::uuid,
      NULLIF(v_line->>'account_id', '')::uuid,
      NULLIF(trim(v_line->>'line_memo'), '')
    );
  END LOOP;

  RETURN v_entry_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.post_journal_entry(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_coa_id(TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
