-- ============================================================================
-- Journal entry numbers never collide.
--
-- create_journal_entry numbered entries 'JE-<date>-' || a random 1000..9999: about
-- 9,000 numbers a day with no check, so with ~100 entries in a day two of them collide
-- with ~40% chance and the posting fails on journal_entries_entry_no_key (seen in CI and
-- possible in production on a busy day).
--
-- Now: 'JE-<date>-' || a 6-digit counter from the sequence journal_entry_no_seq. Same
-- prefix and date; the counter has 6 digits, so it can never equal an old 4-digit number.
-- An entry_no passed in the payload is still used as it is. Only the numbering line of
-- the current function body (pg_get_functiondef) changes. Safe to re-run.
-- ============================================================================

CREATE SEQUENCE IF NOT EXISTS public.journal_entry_no_seq;
REVOKE ALL ON SEQUENCE public.journal_entry_no_seq FROM PUBLIC, anon, authenticated;
GRANT USAGE, SELECT ON SEQUENCE public.journal_entry_no_seq TO service_role;

CREATE OR REPLACE FUNCTION public.create_journal_entry(p_payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_lines JSONB;
  v_line JSONB;
  v_entry_id UUID;
  v_entry_no TEXT;
  v_idempotency TEXT;
  v_total_debit NUMERIC := 0;
  v_total_credit NUMERIC := 0;
  v_account_id UUID;
  v_account_code TEXT;
  v_line_account_id UUID;
  v_cash_account_id UUID;
  v_debit NUMERIC;
  v_credit NUMERIC;
  v_idx INT := 0;
  v_document_type TEXT;
  v_document_id UUID;
  v_description TEXT;
  v_date TIMESTAMPTZ;
  v_entry_date DATE;
BEGIN
  IF p_payload IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Journal payload tələb olunur';
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
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Journal sətirləri tələb olunur';
  END IF;

  FOR v_idx IN 0 .. jsonb_array_length(v_lines) - 1 LOOP
    v_line := v_lines->v_idx;
    v_debit := COALESCE((v_line->>'debit')::numeric, 0);
    v_credit := COALESCE((v_line->>'credit')::numeric, 0);

    IF v_debit < 0 OR v_credit < 0 THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Debet və kredit mənfi ola bilməz';
    END IF;

    IF v_debit > 0 AND v_credit > 0 THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'Eyni sətirdə debet və kredit eyni vaxtda ola bilməz';
    END IF;

    v_total_debit := v_total_debit + v_debit;
    v_total_credit := v_total_credit + v_credit;
  END LOOP;

  IF abs(v_total_debit - v_total_credit) > 0.0001 THEN
    RAISE EXCEPTION USING
      ERRCODE = '22023',
      MESSAGE = format('Journal balanssızdir (debet=%s, kredit=%s)', v_total_debit, v_total_credit);
  END IF;

  v_document_type := COALESCE(
    NULLIF(trim(p_payload->>'document_type'), ''),
    NULLIF(trim(p_payload->>'source_type'), ''),
    'manual'
  );
  v_document_id := COALESCE(
    NULLIF(p_payload->>'document_id', '')::uuid,
    NULLIF(p_payload->>'source_id', '')::uuid
  );
  v_description := COALESCE(
    NULLIF(trim(p_payload->>'description'), ''),
    NULLIF(trim(p_payload->>'memo'), '')
  );
  v_date := COALESCE(
    NULLIF(p_payload->>'date', '')::timestamptz,
    NULLIF(p_payload->>'entry_date', '')::date::timestamptz,
    NOW()
  );
  v_entry_date := COALESCE(
    NULLIF(p_payload->>'entry_date', '')::date,
    (v_date AT TIME ZONE 'UTC')::date,
    CURRENT_DATE
  );

  v_entry_no := COALESCE(
    NULLIF(trim(p_payload->>'entry_no'), ''),
    -- A counter, never repeated (4 random digits gave only 9,000 numbers a day and collided).
    'JE-' || to_char(v_entry_date, 'YYYYMMDD') || '-' || lpad(nextval('public.journal_entry_no_seq')::text, 6, '0')
  );

  INSERT INTO public.journal_entries (
    entry_no,
    entry_date,
    date,
    source_type,
    source_id,
    document_type,
    document_id,
    description,
    idempotency_key,
    memo,
    created_by
  )
  VALUES (
    v_entry_no,
    v_entry_date,
    v_date,
    v_document_type,
    v_document_id,
    v_document_type,
    v_document_id,
    v_description,
    v_idempotency,
    v_description,
    auth.uid()
  )
  RETURNING id INTO v_entry_id;

  FOR v_idx IN 0 .. jsonb_array_length(v_lines) - 1 LOOP
    v_line := v_lines->v_idx;

    v_line_account_id := NULLIF(v_line->>'account_id', '')::uuid;
    v_cash_account_id := NULLIF(v_line->>'cash_account_id', '')::uuid;
    v_account_id := NULLIF(v_line->>'coa_id', '')::uuid;
    v_account_code := COALESCE(
      NULLIF(trim(v_line->>'account_code'), ''),
      NULLIF(trim(v_line->>'coa_code'), '')
    );

    IF v_account_id IS NULL AND v_account_code IS NOT NULL THEN
      v_account_id := public.resolve_gl_account_id(v_account_code);
    END IF;

    IF v_account_id IS NULL AND v_line_account_id IS NOT NULL
       AND EXISTS (SELECT 1 FROM public.chart_of_accounts WHERE id = v_line_account_id) THEN
      v_account_id := v_line_account_id;
    END IF;

    IF v_cash_account_id IS NULL AND v_line_account_id IS NOT NULL
       AND v_line_account_id IS DISTINCT FROM v_account_id
       AND EXISTS (SELECT 1 FROM public.accounts WHERE id = v_line_account_id) THEN
      v_cash_account_id := v_line_account_id;
    END IF;

    IF v_account_id IS NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0002',
        MESSAGE = format(
          'Hesab tapılmadı: %s',
          COALESCE(v_account_code, v_line->>'coa_id', v_line->>'account_id')
        );
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
      v_account_id,
      COALESCE((v_line->>'debit')::numeric, 0),
      COALESCE((v_line->>'credit')::numeric, 0),
      NULLIF(trim(v_line->>'partner_type'), ''),
      NULLIF(v_line->>'partner_id', '')::uuid,
      v_cash_account_id,
      COALESCE(
        NULLIF(trim(v_line->>'line_memo'), ''),
        NULLIF(trim(v_line->>'memo'), '')
      )
    );
  END LOOP;

  RETURN v_entry_id;
END;
$function$;

NOTIFY pgrst, 'reload schema';
