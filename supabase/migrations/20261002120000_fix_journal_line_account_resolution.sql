-- Fix: "journal_entry_lines violates foreign key constraint journal_entry_lines_coa_id_fkey"
--
-- create_journal_entry (20260910160000) resolved a line's GL account as
-- COALESCE(line.account_id, line.coa_id), treating "account_id" as the
-- chart_of_accounts id. Legacy callers routed through post_journal_entry —
-- post_cash_transaction and therefore create_account_atomic (opening balance),
-- cash Mədaxil/Məxaric — send "account_id" = public.accounts.id (Kassa/Bank)
-- together with "coa_code". The cash account UUID was written into coa_id and
-- the insert failed.
--
-- Resolution order now: explicit coa_id → account/coa code → account_id only
-- when it really is a chart_of_accounts row. A line "account_id" that points at
-- public.accounts is stored as the cash account (journal_entry_lines.account_id).

CREATE OR REPLACE FUNCTION public.create_journal_entry(p_payload JSONB)
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
    'JE-' || to_char(v_entry_date, 'YYYYMMDD') || '-' || floor(1000 + random() * 9000)::int
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

    -- "account_id" is a GL account only when it exists in the chart of accounts;
    -- otherwise it is the Kassa/Bank account sent by legacy cash flows.
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
$$;

GRANT EXECUTE ON FUNCTION public.create_journal_entry(JSONB) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
