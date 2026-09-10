-- Phase 1: 1C-style double-entry accounting core (General Ledger foundation)
--
-- Naming map (existing ERP ↔ 1C spec):
--   chart_of_accounts  → Hesablar Planı / GL "accounts" (code, name, type, is_active)
--   journal_entries    → Müxabirləşmə başlığı (header)
--   journal_entry_lines → Debet/Kredit sətirləri (physical storage)
--   journal_lines (view) → 1C-spec alias (entry_id, account_id, partner_id, debit, credit)
--
-- NOTE: public.accounts remains cash/bank operational accounts (Kassa/Bank).

-- ─── 1. Chart of Accounts (Hesablar Planı) ───────────────────────────────────

ALTER TABLE public.chart_of_accounts
  DROP CONSTRAINT IF EXISTS chart_of_accounts_account_type_check;

ALTER TABLE public.chart_of_accounts
  ADD CONSTRAINT chart_of_accounts_account_type_check
  CHECK (
    account_type IN (
      'asset', 'liability', 'equity', 'income', 'revenue', 'expense', 'contra'
    )
  );

COMMENT ON TABLE public.chart_of_accounts IS
  'General Ledger Chart of Accounts (Hesablar Planı). Maps to 1C-style accounts.';

-- 1C-spec read model (public.accounts is reserved for Kassa/Bank cash accounts)
CREATE OR REPLACE VIEW public.gl_accounts AS
SELECT
  id,
  code,
  name,
  CASE
    WHEN account_type = 'income' THEN 'revenue'
    ELSE account_type
  END AS type,
  is_active
FROM public.chart_of_accounts;

COMMENT ON VIEW public.gl_accounts IS
  '1C-style GL accounts view. Physical storage: chart_of_accounts.';

-- Standard commercial trading company base accounts (1C-style codes)
INSERT INTO public.chart_of_accounts (code, name, account_type, is_active)
VALUES
  ('1000', 'Kassa', 'asset', true),
  ('1200', 'Alıcılar (Debitor borclar)', 'asset', true),
  ('2100', 'Təchizatçılar (Kreditor borclar)', 'liability', true),
  ('4000', 'Satış gəliri', 'revenue', true),
  ('5000', 'Satılan malların maya dəyəri (COGS)', 'expense', true),
  ('6000', 'Ümumi xərclər', 'expense', true)
ON CONFLICT (code) DO UPDATE
SET
  name = EXCLUDED.name,
  account_type = EXCLUDED.account_type,
  is_active = true;

-- Keep legacy codes used by existing cash/journal flows
INSERT INTO public.chart_of_accounts (code, name, account_type, is_active)
VALUES
  ('1100', 'Kassa və Bank', 'asset', true),
  ('1300', 'Anbar / Inventar', 'asset', true),
  ('1350', 'WIP / İstehsalat inventarı', 'asset', true),
  ('3900', 'İlkin qalıq kapitalı', 'equity', true),
  ('4100', 'Satış gəliri (köhnə kod)', 'revenue', true),
  ('4990', 'Digər gəlir', 'revenue', true),
  ('5100', 'Maya dəyəri (COGS)', 'expense', true),
  ('6100', 'Əməliyyat xərcləri', 'expense', true),
  ('6190', 'Digər xərc', 'expense', true)
ON CONFLICT (code) DO UPDATE
SET
  name = EXCLUDED.name,
  account_type = EXCLUDED.account_type,
  is_active = true;

-- ─── 2. Journal entry header (1C document / müxabirləşmə) ────────────────────

ALTER TABLE public.journal_entries
  ADD COLUMN IF NOT EXISTS date TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS document_type TEXT,
  ADD COLUMN IF NOT EXISTS document_id UUID,
  ADD COLUMN IF NOT EXISTS description TEXT;

UPDATE public.journal_entries
SET
  date = COALESCE(date, (entry_date::timestamptz AT TIME ZONE 'UTC'), posted_at, NOW()),
  document_type = COALESCE(document_type, source_type),
  document_id = COALESCE(document_id, source_id),
  description = COALESCE(description, memo)
WHERE date IS NULL
   OR document_type IS NULL
   OR document_id IS NULL
   OR description IS NULL;

ALTER TABLE public.journal_entries
  ALTER COLUMN date SET DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_journal_entries_document
  ON public.journal_entries (document_type, document_id)
  WHERE document_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_journal_entries_date
  ON public.journal_entries (date DESC);

CREATE OR REPLACE FUNCTION public.sync_journal_entry_document_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.date IS NULL THEN
    NEW.date := COALESCE((NEW.entry_date::timestamptz), NEW.posted_at, NOW());
  END IF;

  IF NEW.document_type IS NULL AND NEW.source_type IS NOT NULL THEN
    NEW.document_type := NEW.source_type;
  END IF;

  IF NEW.document_id IS NULL AND NEW.source_id IS NOT NULL THEN
    NEW.document_id := NEW.source_id;
  END IF;

  IF NEW.description IS NULL AND NEW.memo IS NOT NULL THEN
    NEW.description := NEW.memo;
  END IF;

  IF NEW.source_type IS NULL AND NEW.document_type IS NOT NULL THEN
    NEW.source_type := NEW.document_type;
  END IF;

  IF NEW.source_id IS NULL AND NEW.document_id IS NOT NULL THEN
    NEW.source_id := NEW.document_id;
  END IF;

  IF NEW.memo IS NULL AND NEW.description IS NOT NULL THEN
    NEW.memo := NEW.description;
  END IF;

  IF NEW.entry_date IS NULL AND NEW.date IS NOT NULL THEN
    NEW.entry_date := (NEW.date AT TIME ZONE 'UTC')::date;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_journal_entries_sync_document_fields ON public.journal_entries;
CREATE TRIGGER trg_journal_entries_sync_document_fields
  BEFORE INSERT OR UPDATE ON public.journal_entries
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_journal_entry_document_fields();

-- ─── 3. Journal lines (Debet/Kredit) ─────────────────────────────────────────

DO $$
BEGIN
  IF to_regclass('public.partners') IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint
      WHERE conname = 'journal_entry_lines_partner_id_fkey'
    ) THEN
      ALTER TABLE public.journal_entry_lines
        ADD CONSTRAINT journal_entry_lines_partner_id_fkey
        FOREIGN KEY (partner_id) REFERENCES public.partners(id) ON DELETE SET NULL;
    END IF;
  END IF;
END $$;

CREATE OR REPLACE VIEW public.journal_lines AS
SELECT
  jel.id,
  jel.journal_entry_id AS entry_id,
  jel.coa_id AS account_id,
  jel.partner_id,
  jel.debit,
  jel.credit
FROM public.journal_entry_lines jel;

COMMENT ON VIEW public.journal_lines IS
  '1C-style journal lines view. Physical rows live in journal_entry_lines; account_id maps to chart_of_accounts.id.';

-- ─── 4. Balance enforcement (SUM debit = SUM credit per entry) ───────────────

CREATE OR REPLACE FUNCTION public.assert_journal_entry_balanced()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_entry_id UUID;
  v_debit NUMERIC;
  v_credit NUMERIC;
  v_line_count INT;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_entry_id := OLD.journal_entry_id;
  ELSE
    v_entry_id := NEW.journal_entry_id;
  END IF;

  SELECT
    COALESCE(SUM(debit), 0),
    COALESCE(SUM(credit), 0),
    COUNT(*)
  INTO v_debit, v_credit, v_line_count
  FROM public.journal_entry_lines
  WHERE journal_entry_id = v_entry_id;

  IF v_line_count = 0 THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF abs(v_debit - v_credit) > 0.0001 THEN
    RAISE EXCEPTION 'journal_unbalanced'
      USING ERRCODE = '22023',
            MESSAGE = format(
              'Müxabirləşmə balanssızdir: debet=%s, kredit=%s (entry_id=%s)',
              v_debit,
              v_credit,
              v_entry_id
            );
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_journal_entry_lines_balance ON public.journal_entry_lines;
CREATE CONSTRAINT TRIGGER trg_journal_entry_lines_balance
  AFTER INSERT OR UPDATE OR DELETE ON public.journal_entry_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW
  EXECUTE FUNCTION public.assert_journal_entry_balanced();

-- ─── 5. Account resolver (code → chart_of_accounts.id) ───────────────────────

CREATE OR REPLACE FUNCTION public.resolve_gl_account_id(p_code TEXT)
RETURNS UUID
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT id
  FROM public.chart_of_accounts
  WHERE code = trim(p_code)
    AND is_active = true
  LIMIT 1;
$$;

-- ─── 6. Canonical create_journal_entry RPC (1C-style payload) ────────────────

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

    v_account_id := COALESCE(
      NULLIF(v_line->>'account_id', '')::uuid,
      NULLIF(v_line->>'coa_id', '')::uuid
    );
    v_account_code := COALESCE(
      NULLIF(trim(v_line->>'account_code'), ''),
      NULLIF(trim(v_line->>'coa_code'), '')
    );

    IF v_account_id IS NULL AND v_account_code IS NOT NULL THEN
      v_account_id := public.resolve_gl_account_id(v_account_code);
    END IF;

    IF v_account_id IS NULL THEN
      RAISE EXCEPTION USING
        ERRCODE = 'P0002',
        MESSAGE = format('Hesab tapılmadı: %s', COALESCE(v_account_code, v_line->>'account_id', v_line->>'coa_id'));
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
      NULLIF(v_line->>'cash_account_id', '')::uuid,
      COALESCE(
        NULLIF(trim(v_line->>'line_memo'), ''),
        NULLIF(trim(v_line->>'memo'), '')
      )
    );
  END LOOP;

  RETURN v_entry_id;
END;
$$;

-- Backward-compatible wrapper used by existing cash/production flows
CREATE OR REPLACE FUNCTION public.post_journal_entry(p_payload JSONB)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.create_journal_entry(p_payload);
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_gl_account_id(TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.create_journal_entry(JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.post_journal_entry(JSONB) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
