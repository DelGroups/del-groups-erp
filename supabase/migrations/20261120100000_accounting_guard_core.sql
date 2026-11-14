-- ============================================================================
-- Accounting Guard, core (GUARD-1): a read-only rule engine that scans the ledger
-- and the documents for errors and suspicious entries and stores what it finds.
-- Plan: docs/accounting-guard-plan.md.
--
-- HARD RULE: the guard NEVER posts, edits, reverses or deletes business data.
-- It only READS business tables (journal_entries, journal_entry_lines, sales,
-- sale_items, purchases, payments, transactions, accounts, expenses, partners,
-- audit_logs, invoice_amendments, ...) and WRITES only to its own guard_* tables
-- (plus one audit_logs row when an admin changes a finding's status).
-- It adds no trigger to sales, purchases, payments, journal_entries or any other
-- posting path: posting a document is never slowed down or broken by the guard.
-- supabase/tests/accounting_guard.sql checks both (row counts and checksums of the
-- business tables before / after a scan, and no trigger calls a guard function).
--
-- Objects:
--   guard_rules           one row per check: category, default severity, enabled, params
--   guard_runs            one row per scan
--   guard_findings        one row per problem, unique by fingerprint
--   guard_finding_events  every status change of a finding (who, from, to, why)
--   guard_check_<code>()  one function per rule, the same output columns for all
--   guard_scan()          runs the enabled rules in scope and upserts the findings
--   guard_set_finding_status()  admin: acknowledge / resolve / false positive / reopen
--
-- Access: admins only. RLS on every table, SELECT for admins, no write policy: writes
-- go through the SECURITY DEFINER functions above. Service-role callers (server
-- code, a scheduled job, the SQL editor) have no auth.uid() and are trusted, like
-- stock_integrity_report(). The app shows the guard only when ACCOUNTING_GUARD=true.
--
-- Safe to re-run: CREATE ... IF NOT EXISTS, CREATE OR REPLACE, seed rows keep the
-- enabled flag and params an admin may have changed.
-- ============================================================================

-- ─── 1. Tables ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.guard_rules (
  code             TEXT PRIMARY KEY,
  category         TEXT NOT NULL,
  default_severity TEXT NOT NULL,
  enabled          BOOLEAN NOT NULL DEFAULT TRUE,
  params           JSONB NOT NULL DEFAULT '{}'::jsonb,
  description_key  TEXT NOT NULL,
  disabled_reason  TEXT,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT guard_rules_category_check CHECK (category IN ('ledger', 'documents', 'cash', 'partners', 'products', 'stock')),
  CONSTRAINT guard_rules_severity_check CHECK (default_severity IN ('critical', 'high', 'medium', 'low')),
  CONSTRAINT guard_rules_params_object CHECK (jsonb_typeof(params) = 'object')
);

CREATE TABLE IF NOT EXISTS public.guard_runs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger        TEXT NOT NULL DEFAULT 'manual',
  scope          TEXT[],
  since          TIMESTAMPTZ,
  started_by     UUID,
  started_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at    TIMESTAMPTZ,
  status         TEXT NOT NULL DEFAULT 'running',
  rules_run      TEXT[] NOT NULL DEFAULT '{}',
  new_count      INTEGER NOT NULL DEFAULT 0,
  open_count     INTEGER NOT NULL DEFAULT 0,
  resolved_count INTEGER NOT NULL DEFAULT 0,
  error          TEXT,
  rule_errors    JSONB NOT NULL DEFAULT '{}'::jsonb,
  CONSTRAINT guard_runs_trigger_check CHECK (trigger IN ('manual', 'button', 'scheduled')),
  CONSTRAINT guard_runs_status_check CHECK (status IN ('running', 'ok', 'partial', 'failed'))
);
CREATE INDEX IF NOT EXISTS idx_guard_runs_started ON public.guard_runs (started_at DESC);

CREATE TABLE IF NOT EXISTS public.guard_findings (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_code      TEXT NOT NULL REFERENCES public.guard_rules (code) ON UPDATE CASCADE,
  severity       TEXT NOT NULL,
  fingerprint    TEXT NOT NULL UNIQUE,
  entity_type    TEXT,
  entity_id      UUID,
  doc_no         TEXT,
  doc_date       DATE,
  partner_type   TEXT,
  partner_id     UUID,
  amount         NUMERIC,
  details        JSONB NOT NULL DEFAULT '{}'::jsonb,
  details_hash   TEXT,
  status         TEXT NOT NULL DEFAULT 'open',
  first_seen_run UUID REFERENCES public.guard_runs (id) ON DELETE SET NULL,
  last_seen_run  UUID REFERENCES public.guard_runs (id) ON DELETE SET NULL,
  first_seen_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_by    UUID,
  resolved_at    TIMESTAMPTZ,
  note           TEXT,
  CONSTRAINT guard_findings_severity_check CHECK (severity IN ('critical', 'high', 'medium', 'low')),
  CONSTRAINT guard_findings_status_check CHECK (status IN ('open', 'acknowledged', 'resolved', 'auto_resolved', 'false_positive'))
);
CREATE INDEX IF NOT EXISTS idx_guard_findings_rule_status ON public.guard_findings (rule_code, status);
CREATE INDEX IF NOT EXISTS idx_guard_findings_status_severity ON public.guard_findings (status, severity);
CREATE INDEX IF NOT EXISTS idx_guard_findings_entity ON public.guard_findings (entity_type, entity_id);

CREATE TABLE IF NOT EXISTS public.guard_finding_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  finding_id  UUID NOT NULL REFERENCES public.guard_findings (id) ON DELETE CASCADE,
  run_id      UUID REFERENCES public.guard_runs (id) ON DELETE SET NULL,
  actor       UUID,
  from_status TEXT,
  to_status   TEXT NOT NULL,
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_guard_finding_events_finding ON public.guard_finding_events (finding_id, created_at DESC);

-- ─── 2. Access ──────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._guard_is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(public.is_active_user() AND public.user_is_admin(), FALSE);
$$;

-- The _stock_integrity_authorize pattern: a signed-in caller must be an admin;
-- service-role callers (no auth.uid()) have been checked by the server.
CREATE OR REPLACE FUNCTION public._guard_authorize()
RETURNS VOID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT public._guard_is_admin() THEN
    RAISE EXCEPTION '%', 'forbidden' USING ERRCODE = '42501';
  END IF;
END;
$$;

ALTER TABLE public.guard_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guard_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guard_findings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guard_finding_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS guard_rules_select ON public.guard_rules;
CREATE POLICY guard_rules_select ON public.guard_rules FOR SELECT TO authenticated USING (public._guard_is_admin());
DROP POLICY IF EXISTS guard_runs_select ON public.guard_runs;
CREATE POLICY guard_runs_select ON public.guard_runs FOR SELECT TO authenticated USING (public._guard_is_admin());
DROP POLICY IF EXISTS guard_findings_select ON public.guard_findings;
CREATE POLICY guard_findings_select ON public.guard_findings FOR SELECT TO authenticated USING (public._guard_is_admin());
DROP POLICY IF EXISTS guard_finding_events_select ON public.guard_finding_events;
CREATE POLICY guard_finding_events_select ON public.guard_finding_events FOR SELECT TO authenticated USING (public._guard_is_admin());

REVOKE ALL ON public.guard_rules, public.guard_runs, public.guard_findings, public.guard_finding_events FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.guard_rules, public.guard_runs, public.guard_findings, public.guard_finding_events TO authenticated;
GRANT ALL ON public.guard_rules, public.guard_runs, public.guard_findings, public.guard_finding_events TO service_role;

-- ─── 3. Helpers ─────────────────────────────────────────────────────────────

-- The company's calendar day (Baku), like the partner ledger.
CREATE OR REPLACE FUNCTION public._guard_today()
RETURNS DATE
LANGUAGE sql
STABLE
AS $$
  SELECT (NOW() AT TIME ZONE 'Asia/Baku')::date;
$$;

CREATE OR REPLACE FUNCTION public._guard_num(p_params JSONB, p_key TEXT, p_default NUMERIC)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(NULLIF(p_params ->> p_key, '')::numeric, p_default);
$$;

-- Signed amount of a cash row: Mədaxil = in, Məxaric = out (older rows have broken
-- encoding, matched like post_cash_transaction does). Other types count as 0.
CREATE OR REPLACE FUNCTION public._guard_tx_signed(p_type TEXT, p_amount NUMERIC)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN btrim(COALESCE(p_type, '')) LIKE 'M%daxil' THEN COALESCE(p_amount, 0)
    WHEN btrim(COALESCE(p_type, '')) LIKE 'M%xaric' THEN -COALESCE(p_amount, 0)
    ELSE 0
  END;
$$;

-- The journal entries a document owns: a sale's invoice entry ('invoice', older 'sale'),
-- a purchase's bill ('bill', older 'purchase'). Live = neither reversed nor a reversal.
CREATE OR REPLACE FUNCTION public._guard_main_entry_types(p_doc TEXT)
RETURNS TEXT[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_doc
    WHEN 'sale' THEN ARRAY['invoice', 'sale']
    WHEN 'purchase' THEN ARRAY['bill', 'purchase']
    ELSE ARRAY[]::text[]
  END;
$$;

-- The part of a finding that decides whether it changed "materially": the amount and
-- the details without values that move by themselves every day.
CREATE OR REPLACE FUNCTION public._guard_details_hash(p_amount NUMERIC, p_details JSONB)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT md5(COALESCE(round(p_amount, 2)::text, '') || '|' ||
             COALESCE((COALESCE(p_details, '{}'::jsonb) - 'age_days' - 'as_of')::text, ''));
$$;

-- Does an expense exist? The expenses module may not be installed on a tenant
-- (supabase/modules/expenses): then no expense entry can point at one, and an entry that
-- names an expense counts as an orphan only when the table exists.
CREATE OR REPLACE FUNCTION public._guard_expense_exists(p_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_found BOOLEAN;
BEGIN
  IF to_regclass('public.expenses') IS NULL THEN
    RETURN TRUE;
  END IF;
  EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.expenses WHERE id = $1)' INTO v_found USING p_id;
  RETURN v_found;
END;
$$;

-- ─── 4. Rules: A, the general ledger ───────────────────────────────────────
-- Every rule returns the same columns. severity NULL = the rule's default severity.
-- Fingerprint = rule code + stable ids (never an amount that can change).

-- A1 unbalanced journal entry (sum of debits <> sum of credits).
CREATE OR REPLACE FUNCTION public.guard_check_a1(p_params JSONB, p_since TIMESTAMPTZ)
RETURNS TABLE (fingerprint TEXT, severity TEXT, entity_type TEXT, entity_id UUID, doc_no TEXT, doc_date DATE,
               partner_type TEXT, partner_id UUID, amount NUMERIC, details JSONB)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH l AS (
    SELECT jl.journal_entry_id, round(COALESCE(sum(jl.debit), 0), 2) AS d, round(COALESCE(sum(jl.credit), 0), 2) AS c
    FROM public.journal_entry_lines jl
    GROUP BY jl.journal_entry_id
  )
  SELECT 'A1:' || je.id, NULL::text, 'journal_entry', je.id, je.entry_no, je.entry_date, NULL::text, NULL::uuid,
         abs(l.d - l.c),
         jsonb_build_object('debit', l.d, 'credit', l.c, 'document_type', je.document_type, 'document_id', je.document_id)
  FROM public.journal_entries je
  JOIN l ON l.journal_entry_id = je.id
  WHERE abs(l.d - l.c) > public._guard_num(p_params, 'tolerance', 0.01)
    AND (p_since IS NULL OR je.posted_at >= p_since OR je.date >= p_since);
$$;

-- A2 entry with no lines, or only zero lines.
CREATE OR REPLACE FUNCTION public.guard_check_a2(p_params JSONB, p_since TIMESTAMPTZ)
RETURNS TABLE (fingerprint TEXT, severity TEXT, entity_type TEXT, entity_id UUID, doc_no TEXT, doc_date DATE,
               partner_type TEXT, partner_id UUID, amount NUMERIC, details JSONB)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH l AS (
    SELECT jl.journal_entry_id, count(*) AS n,
           COALESCE(sum(abs(COALESCE(jl.debit, 0)) + abs(COALESCE(jl.credit, 0))), 0) AS total
    FROM public.journal_entry_lines jl
    GROUP BY jl.journal_entry_id
  )
  SELECT 'A2:' || je.id, NULL::text, 'journal_entry', je.id, je.entry_no, je.entry_date, NULL::text, NULL::uuid,
         NULL::numeric,
         jsonb_build_object('lines', COALESCE(l.n, 0), 'kind', CASE WHEN l.n IS NULL THEN 'no_lines' ELSE 'zero_lines' END,
                            'document_type', je.document_type, 'document_id', je.document_id)
  FROM public.journal_entries je
  LEFT JOIN l ON l.journal_entry_id = je.id
  WHERE (l.n IS NULL OR l.total = 0)
    AND (p_since IS NULL OR je.posted_at >= p_since OR je.date >= p_since);
$$;

-- A3 orphan entry: the source document it names does not exist any more.
-- Only live entries (a reversed pair may outlive a deleted document on purpose).
CREATE OR REPLACE FUNCTION public.guard_check_a3(p_params JSONB, p_since TIMESTAMPTZ)
RETURNS TABLE (fingerprint TEXT, severity TEXT, entity_type TEXT, entity_id UUID, doc_no TEXT, doc_date DATE,
               partner_type TEXT, partner_id UUID, amount NUMERIC, details JSONB)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH e AS (
    SELECT je.*, COALESCE(je.document_id, je.source_id) AS doc_id, COALESCE(je.document_type, je.source_type) AS doc_type
    FROM public.journal_entries je
    WHERE je.reversal_of IS NULL AND je.reversed_by IS NULL
      AND COALESCE(je.document_id, je.source_id) IS NOT NULL
      AND (p_since IS NULL OR je.posted_at >= p_since OR je.date >= p_since)
  )
  SELECT 'A3:' || e.id, NULL::text, 'journal_entry', e.id, e.entry_no, e.entry_date, NULL::text, NULL::uuid,
         (SELECT round(COALESCE(sum(jl.debit), 0), 2) FROM public.journal_entry_lines jl WHERE jl.journal_entry_id = e.id),
         jsonb_build_object('document_type', e.doc_type, 'document_id', e.doc_id)
  FROM e
  WHERE CASE
    WHEN e.doc_type IN ('invoice', 'sale', 'sale_cogs') THEN NOT EXISTS (SELECT 1 FROM public.sales s WHERE s.id = e.doc_id)
    WHEN e.doc_type IN ('bill', 'purchase') THEN NOT EXISTS (SELECT 1 FROM public.purchases p WHERE p.id = e.doc_id)
    WHEN e.doc_type = 'cash_transaction' THEN NOT EXISTS (SELECT 1 FROM public.transactions t WHERE t.id = e.doc_id)
    WHEN e.doc_type IN ('payment_receipt', 'payment_disbursement') THEN
      NOT EXISTS (SELECT 1 FROM public.payments py WHERE py.id = e.doc_id OR py.journal_entry_id = e.id)
    WHEN e.doc_type = 'expense' THEN NOT public._guard_expense_exists(e.doc_id)
    ELSE FALSE
  END;
$$;

-- A4 posted sale / purchase / payment with no journal entry, or a sale with
-- total_cogs > 0 and no COGS entry.
CREATE OR REPLACE FUNCTION public.guard_check_a4(p_params JSONB, p_since TIMESTAMPTZ)
RETURNS TABLE (fingerprint TEXT, severity TEXT, entity_type TEXT, entity_id UUID, doc_no TEXT, doc_date DATE,
               partner_type TEXT, partner_id UUID, amount NUMERIC, details JSONB)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT 'A4:sale:' || s.id, NULL::text, 'sale', s.id, COALESCE(s.doc_no, s.invoice_number), s.doc_date,
         'partner', s.partner_id, s.total_amount, jsonb_build_object('kind', 'no_entry')
  FROM public.sales s
  WHERE s.status = 'posted' AND COALESCE(s.total_amount, 0) > 0
    AND (p_since IS NULL OR s.created_at >= p_since OR s.updated_at >= p_since OR s.posted_at >= p_since)
    AND NOT EXISTS (
      SELECT 1 FROM public.journal_entries je
      WHERE COALESCE(je.document_id, je.source_id) = s.id
        AND COALESCE(je.document_type, je.source_type) = ANY (public._guard_main_entry_types('sale'))
        AND je.reversal_of IS NULL AND je.reversed_by IS NULL)
  UNION ALL
  SELECT 'A4:sale_cogs:' || s.id, NULL::text, 'sale', s.id, COALESCE(s.doc_no, s.invoice_number), s.doc_date,
         'partner', s.partner_id, s.total_cogs, jsonb_build_object('kind', 'no_cogs_entry')
  FROM public.sales s
  WHERE s.status = 'posted' AND COALESCE(s.total_cogs, 0) > 0
    AND (p_since IS NULL OR s.created_at >= p_since OR s.updated_at >= p_since OR s.posted_at >= p_since)
    AND NOT EXISTS (SELECT 1 FROM public.journal_entries je WHERE je.id = s.cogs_journal_entry_id)
    AND NOT EXISTS (
      SELECT 1 FROM public.journal_entries je
      WHERE COALESCE(je.document_id, je.source_id) = s.id
        AND COALESCE(je.document_type, je.source_type) = 'sale_cogs'
        AND je.reversal_of IS NULL AND je.reversed_by IS NULL)
  UNION ALL
  SELECT 'A4:purchase:' || p.id, NULL::text, 'purchase', p.id, p.invoice_number, p.doc_date,
         'partner', p.partner_id, p.total_amount, jsonb_build_object('kind', 'no_entry')
  FROM public.purchases p
  WHERE p.status = 'posted' AND COALESCE(p.total_amount, 0) > 0
    AND (p_since IS NULL OR p.created_at >= p_since OR p.updated_at >= p_since OR p.posted_at >= p_since)
    AND NOT EXISTS (
      SELECT 1 FROM public.journal_entries je
      WHERE COALESCE(je.document_id, je.source_id) = p.id
        AND COALESCE(je.document_type, je.source_type) = ANY (public._guard_main_entry_types('purchase'))
        AND je.reversal_of IS NULL AND je.reversed_by IS NULL)
  UNION ALL
  SELECT 'A4:payment:' || py.id, NULL::text, 'payment', py.id, NULL::text, (py.payment_date AT TIME ZONE 'Asia/Baku')::date,
         'partner', py.partner_id, py.amount, jsonb_build_object('kind', 'no_entry', 'payment_type', py.payment_type)
  FROM public.payments py
  WHERE COALESCE(py.amount, 0) > 0
    AND (p_since IS NULL OR py.created_at >= p_since)
    AND NOT EXISTS (SELECT 1 FROM public.journal_entries je WHERE je.id = py.journal_entry_id);
$$;

-- A5 document total differs from its journal entry (tolerance params.tolerance).
CREATE OR REPLACE FUNCTION public.guard_check_a5(p_params JSONB, p_since TIMESTAMPTZ)
RETURNS TABLE (fingerprint TEXT, severity TEXT, entity_type TEXT, entity_id UUID, doc_no TEXT, doc_date DATE,
               partner_type TEXT, partner_id UUID, amount NUMERIC, details JSONB)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH tol AS (SELECT public._guard_num(p_params, 'tolerance', 0.01) AS v),
  sale_gl AS (
    SELECT COALESCE(je.document_id, je.source_id) AS doc_id, round(sum(jl.debit), 2) AS gl
    FROM public.journal_entries je
    JOIN public.journal_entry_lines jl ON jl.journal_entry_id = je.id
    WHERE COALESCE(je.document_type, je.source_type) = ANY (public._guard_main_entry_types('sale'))
      AND je.reversal_of IS NULL AND je.reversed_by IS NULL
    GROUP BY 1
  ),
  purchase_gl AS (
    SELECT COALESCE(je.document_id, je.source_id) AS doc_id, round(sum(jl.debit), 2) AS gl
    FROM public.journal_entries je
    JOIN public.journal_entry_lines jl ON jl.journal_entry_id = je.id
    WHERE COALESCE(je.document_type, je.source_type) = ANY (public._guard_main_entry_types('purchase'))
      AND je.reversal_of IS NULL AND je.reversed_by IS NULL
    GROUP BY 1
  ),
  pay AS (
    SELECT py.journal_entry_id, round(sum(py.amount), 2) AS amount, min(py.id::text)::uuid AS first_id,
           min(py.partner_id::text)::uuid AS partner_id, min(py.payment_date) AS payment_date, count(*) AS n
    FROM public.payments py
    WHERE py.journal_entry_id IS NOT NULL
      AND (p_since IS NULL OR py.created_at >= p_since)
    GROUP BY py.journal_entry_id
  ),
  pay_gl AS (
    SELECT jl.journal_entry_id, round(sum(jl.debit), 2) AS gl
    FROM public.journal_entry_lines jl
    WHERE jl.journal_entry_id IN (SELECT journal_entry_id FROM pay)
    GROUP BY 1
  )
  SELECT 'A5:sale:' || s.id, NULL::text, 'sale', s.id, COALESCE(s.doc_no, s.invoice_number), s.doc_date,
         'partner', s.partner_id, abs(round(s.total_amount, 2) - g.gl),
         jsonb_build_object('document_total', round(s.total_amount, 2), 'entry_total', g.gl)
  FROM public.sales s JOIN sale_gl g ON g.doc_id = s.id
  WHERE s.status = 'posted' AND abs(round(COALESCE(s.total_amount, 0), 2) - g.gl) > (SELECT v FROM tol)
    AND (p_since IS NULL OR s.created_at >= p_since OR s.updated_at >= p_since OR s.posted_at >= p_since)
  UNION ALL
  SELECT 'A5:purchase:' || p.id, NULL::text, 'purchase', p.id, p.invoice_number, p.doc_date,
         'partner', p.partner_id, abs(round(p.total_amount, 2) - g.gl),
         jsonb_build_object('document_total', round(p.total_amount, 2), 'entry_total', g.gl)
  FROM public.purchases p JOIN purchase_gl g ON g.doc_id = p.id
  WHERE p.status = 'posted' AND abs(round(COALESCE(p.total_amount, 0), 2) - g.gl) > (SELECT v FROM tol)
    AND (p_since IS NULL OR p.created_at >= p_since OR p.updated_at >= p_since OR p.posted_at >= p_since)
  UNION ALL
  SELECT 'A5:payment:' || pay.journal_entry_id, NULL::text, 'payment', pay.first_id, NULL::text,
         (pay.payment_date AT TIME ZONE 'Asia/Baku')::date, 'partner', pay.partner_id, abs(pay.amount - g.gl),
         jsonb_build_object('document_total', pay.amount, 'entry_total', g.gl, 'journal_entry_id', pay.journal_entry_id, 'payments', pay.n)
  FROM pay JOIN pay_gl g ON g.journal_entry_id = pay.journal_entry_id
  WHERE abs(pay.amount - g.gl) > (SELECT v FROM tol);
$$;

-- A6 the same source posted twice: two live entries (not a reversal pair) of the same
-- document type for the same document. params.document_types = the types that own
-- exactly one live entry per document.
CREATE OR REPLACE FUNCTION public.guard_check_a6(p_params JSONB, p_since TIMESTAMPTZ)
RETURNS TABLE (fingerprint TEXT, severity TEXT, entity_type TEXT, entity_id UUID, doc_no TEXT, doc_date DATE,
               partner_type TEXT, partner_id UUID, amount NUMERIC, details JSONB)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH types AS (
    SELECT COALESCE(
      (SELECT array_agg(x) FROM jsonb_array_elements_text(p_params -> 'document_types') x),
      ARRAY['invoice', 'sale', 'bill', 'purchase', 'sale_cogs', 'payment_receipt', 'payment_disbursement',
            'cash_transaction']
    ) AS v
  ),
  live AS (
    SELECT je.id, je.entry_no, je.entry_date, je.posted_at, je.date,
           CASE WHEN COALESCE(je.document_type, je.source_type) = 'sale' THEN 'invoice'
                WHEN COALESCE(je.document_type, je.source_type) = 'purchase' THEN 'bill'
                ELSE COALESCE(je.document_type, je.source_type) END AS doc_type,
           COALESCE(je.document_id, je.source_id) AS doc_id,
           (SELECT round(COALESCE(sum(jl.debit), 0), 2) FROM public.journal_entry_lines jl WHERE jl.journal_entry_id = je.id) AS total
    FROM public.journal_entries je
    WHERE je.reversal_of IS NULL AND je.reversed_by IS NULL
      AND COALESCE(je.document_id, je.source_id) IS NOT NULL
      AND COALESCE(je.document_type, je.source_type) = ANY ((SELECT v FROM types)::text[])
  )
  SELECT 'A6:' || l.doc_type || ':' || l.doc_id, NULL::text, l.doc_type, l.doc_id, min(l.entry_no), min(l.entry_date),
         NULL::text, NULL::uuid, sum(l.total),
         jsonb_build_object('entries', count(*), 'entry_ids', jsonb_agg(l.id ORDER BY l.entry_no), 'entry_nos', jsonb_agg(l.entry_no ORDER BY l.entry_no))
  FROM live l
  GROUP BY l.doc_type, l.doc_id
  HAVING count(*) > 1
     AND (p_since IS NULL OR max(l.posted_at) >= p_since OR max(l.date) >= p_since);
$$;

-- A7 entry dated in a closed accounting period but posted after the period closed.
CREATE OR REPLACE FUNCTION public.guard_check_a7(p_params JSONB, p_since TIMESTAMPTZ)
RETURNS TABLE (fingerprint TEXT, severity TEXT, entity_type TEXT, entity_id UUID, doc_no TEXT, doc_date DATE,
               partner_type TEXT, partner_id UUID, amount NUMERIC, details JSONB)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT 'A7:' || je.id, NULL::text, 'journal_entry', je.id, je.entry_no, je.entry_date, NULL::text, NULL::uuid,
         (SELECT round(COALESCE(sum(jl.debit), 0), 2) FROM public.journal_entry_lines jl WHERE jl.journal_entry_id = je.id),
         jsonb_build_object('period', format('%s-%s', ap.period_year, lpad(ap.period_month::text, 2, '0')),
                            'closed_at', ap.closed_at, 'posted_at', je.posted_at, 'document_type', je.document_type)
  FROM public.journal_entries je
  JOIN public.accounting_periods ap
    ON ap.period_year = EXTRACT(YEAR FROM je.entry_date)::int
   AND ap.period_month = EXTRACT(MONTH FROM je.entry_date)::int
  WHERE ap.status = 'closed' AND ap.closed_at IS NOT NULL
    AND je.posted_at > ap.closed_at
    AND (p_since IS NULL OR je.posted_at >= p_since);
$$;

-- A8 broken reversal chain: a link to a missing entry, a link the other side does not
-- return, an entry reversed twice, or a reversal whose amount differs from the original.
CREATE OR REPLACE FUNCTION public.guard_check_a8(p_params JSONB, p_since TIMESTAMPTZ)
RETURNS TABLE (fingerprint TEXT, severity TEXT, entity_type TEXT, entity_id UUID, doc_no TEXT, doc_date DATE,
               partner_type TEXT, partner_id UUID, amount NUMERIC, details JSONB)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH tot AS (
    SELECT jl.journal_entry_id, round(COALESCE(sum(jl.debit), 0), 2) AS d, round(COALESCE(sum(jl.credit), 0), 2) AS c
    FROM public.journal_entry_lines jl GROUP BY 1
  )
  SELECT 'A8:reversed_by:' || je.id, NULL::text, 'journal_entry', je.id, je.entry_no, je.entry_date, NULL::text, NULL::uuid,
         NULL::numeric,
         jsonb_build_object('kind', CASE WHEN t.id IS NULL THEN 'reversal_missing' ELSE 'reversal_not_linked_back' END,
                            'reversed_by', je.reversed_by, 'reversal_reversal_of', t.reversal_of)
  FROM public.journal_entries je
  LEFT JOIN public.journal_entries t ON t.id = je.reversed_by
  WHERE je.reversed_by IS NOT NULL AND (t.id IS NULL OR t.reversal_of IS DISTINCT FROM je.id)
  UNION ALL
  SELECT 'A8:reversal_of:' || je.id, NULL::text, 'journal_entry', je.id, je.entry_no, je.entry_date, NULL::text, NULL::uuid,
         NULL::numeric,
         jsonb_build_object('kind', CASE WHEN o.id IS NULL THEN 'original_missing' ELSE 'original_not_linked_back' END,
                            'reversal_of', je.reversal_of, 'original_reversed_by', o.reversed_by)
  FROM public.journal_entries je
  LEFT JOIN public.journal_entries o ON o.id = je.reversal_of
  WHERE je.reversal_of IS NOT NULL AND (o.id IS NULL OR o.reversed_by IS DISTINCT FROM je.id)
    -- One reversal of an entry reversed twice is reported once, as 'double' below.
    AND NOT (o.id IS NOT NULL AND (SELECT count(*) FROM public.journal_entries x WHERE x.reversal_of = o.id) > 1)
  UNION ALL
  SELECT 'A8:double:' || o.id, NULL::text, 'journal_entry', o.id, o.entry_no, o.entry_date, NULL::text, NULL::uuid,
         NULL::numeric,
         jsonb_build_object('kind', 'reversed_twice', 'reversals', (SELECT jsonb_agg(x.id ORDER BY x.entry_no) FROM public.journal_entries x WHERE x.reversal_of = o.id))
  FROM public.journal_entries o
  WHERE (SELECT count(*) FROM public.journal_entries x WHERE x.reversal_of = o.id) > 1
  UNION ALL
  SELECT 'A8:amount:' || r.id, NULL::text, 'journal_entry', r.id, r.entry_no, r.entry_date, NULL::text, NULL::uuid,
         abs(tr.d - tor.c),
         jsonb_build_object('kind', 'amount_differs', 'reversal_of', o.id, 'original_debit', tor.d, 'original_credit', tor.c,
                            'reversal_debit', tr.d, 'reversal_credit', tr.c)
  FROM public.journal_entries r
  JOIN public.journal_entries o ON o.id = r.reversal_of AND o.reversed_by = r.id
  JOIN tot tr ON tr.journal_entry_id = r.id
  JOIN tot tor ON tor.journal_entry_id = o.id
  WHERE abs(tr.d - tor.c) > public._guard_num(p_params, 'tolerance', 0.01)
     OR abs(tr.c - tor.d) > public._guard_num(p_params, 'tolerance', 0.01);
$$;

-- A9 cash / bank account balance (accounts.balance, what the cash screens show) differs
-- from its ledger lines: lines that name the account on a cash ledger (params.cash_codes,
-- default 1000 / 1100) or on the account's own ledger (accounts.coa_id).
CREATE OR REPLACE FUNCTION public.guard_check_a9(p_params JSONB, p_since TIMESTAMPTZ)
RETURNS TABLE (fingerprint TEXT, severity TEXT, entity_type TEXT, entity_id UUID, doc_no TEXT, doc_date DATE,
               partner_type TEXT, partner_id UUID, amount NUMERIC, details JSONB)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH codes AS (
    SELECT COALESCE((SELECT array_agg(x) FROM jsonb_array_elements_text(p_params -> 'cash_codes') x), ARRAY['1000', '1100']) AS v
  ),
  gl AS (
    SELECT a.id AS account_id, round(COALESCE(sum(jl.debit - jl.credit), 0), 2) AS gl
    FROM public.accounts a
    LEFT JOIN public.journal_entry_lines jl ON jl.account_id = a.id
    LEFT JOIN public.chart_of_accounts c ON c.id = jl.coa_id
    WHERE jl.id IS NULL OR c.code = ANY ((SELECT v FROM codes)::text[]) OR jl.coa_id = a.coa_id
    GROUP BY a.id
  )
  SELECT 'A9:' || a.id, NULL::text, 'account', a.id, a.code, NULL::date, NULL::text, NULL::uuid,
         abs(round(COALESCE(a.balance, 0), 2) - COALESCE(g.gl, 0)),
         jsonb_build_object('account_name', a.name, 'balance', round(COALESCE(a.balance, 0), 2), 'gl_balance', COALESCE(g.gl, 0))
  FROM public.accounts a
  LEFT JOIN gl g ON g.account_id = a.id
  WHERE abs(round(COALESCE(a.balance, 0), 2) - COALESCE(g.gl, 0)) > public._guard_num(p_params, 'tolerance', 0.01);
$$;

-- A10 the partner ledger (sum of customer debts / supplier debts, LED-1) differs from the
-- receivable (1200) / payable (2100) accounts of the general ledger.
CREATE OR REPLACE FUNCTION public.guard_check_a10(p_params JSONB, p_since TIMESTAMPTZ)
RETURNS TABLE (fingerprint TEXT, severity TEXT, entity_type TEXT, entity_id UUID, doc_no TEXT, doc_date DATE,
               partner_type TEXT, partner_id UUID, amount NUMERIC, details JSONB)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH ledger AS (
    SELECT round(COALESCE(sum(b.receivable), 0), 2) AS receivable, round(COALESCE(sum(b.payable), 0), 2) AS payable
    FROM public.get_partner_balances(public._guard_today()) b
  ),
  gl AS (
    SELECT round(COALESCE(sum(jl.debit - jl.credit) FILTER (WHERE c.code = COALESCE(p_params ->> 'receivable_code', '1200')), 0), 2) AS receivable,
           round(COALESCE(sum(jl.credit - jl.debit) FILTER (WHERE c.code = COALESCE(p_params ->> 'payable_code', '2100')), 0), 2) AS payable
    FROM public.journal_entry_lines jl
    JOIN public.journal_entries je ON je.id = jl.journal_entry_id
    JOIN public.chart_of_accounts c ON c.id = jl.coa_id
    WHERE je.entry_date <= public._guard_today()
  )
  SELECT 'A10:receivable', NULL::text, 'gl_account', NULL::uuid, COALESCE(p_params ->> 'receivable_code', '1200'), public._guard_today(),
         NULL::text, NULL::uuid, abs(l.receivable - g.receivable),
         jsonb_build_object('side', 'receivable', 'partner_ledger', l.receivable, 'general_ledger', g.receivable)
  FROM ledger l, gl g
  WHERE abs(l.receivable - g.receivable) > public._guard_num(p_params, 'tolerance', 0.01)
  UNION ALL
  SELECT 'A10:payable', NULL::text, 'gl_account', NULL::uuid, COALESCE(p_params ->> 'payable_code', '2100'), public._guard_today(),
         NULL::text, NULL::uuid, abs(l.payable - g.payable),
         jsonb_build_object('side', 'payable', 'partner_ledger', l.payable, 'general_ledger', g.payable)
  FROM ledger l, gl g
  WHERE abs(l.payable - g.payable) > public._guard_num(p_params, 'tolerance', 0.01);
$$;

-- ─── 5. Rules: B, documents ─────────────────────────────────────────────────

-- B1 paid more than the total, a stored debt that is not total - paid, or a negative amount.
CREATE OR REPLACE FUNCTION public.guard_check_b1(p_params JSONB, p_since TIMESTAMPTZ)
RETURNS TABLE (fingerprint TEXT, severity TEXT, entity_type TEXT, entity_id UUID, doc_no TEXT, doc_date DATE,
               partner_type TEXT, partner_id UUID, amount NUMERIC, details JSONB)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH tol AS (SELECT public._guard_num(p_params, 'tolerance', 0.01) AS v),
  docs AS (
    SELECT 'sale'::text AS kind, s.id, COALESCE(s.doc_no, s.invoice_number) AS no, s.doc_date, s.partner_id,
           COALESCE(s.total_amount, 0) AS total, COALESCE(s.paid_amount, 0) AS paid,
           s.remaining_balance AS debt, s.created_at, s.updated_at
    FROM public.sales s WHERE s.status = 'posted'
    UNION ALL
    SELECT 'purchase', p.id, p.invoice_number, p.doc_date, p.partner_id,
           COALESCE(p.total_amount, 0), COALESCE(p.paid_amount, 0), p.debt_amount, p.created_at, p.updated_at
    FROM public.purchases p WHERE p.status = 'posted'
  ),
  d AS (SELECT * FROM docs WHERE p_since IS NULL OR created_at >= p_since OR updated_at >= p_since)
  SELECT 'B1:' || d.kind || ':' || d.id || ':overpaid', NULL::text, d.kind, d.id, d.no, d.doc_date, 'partner', d.partner_id,
         round(d.paid - d.total, 2), jsonb_build_object('kind', 'paid_more_than_total', 'total', d.total, 'paid', d.paid)
  FROM d WHERE d.paid > d.total + (SELECT v FROM tol)
  UNION ALL
  SELECT 'B1:' || d.kind || ':' || d.id || ':debt', NULL::text, d.kind, d.id, d.no, d.doc_date, 'partner', d.partner_id,
         round(abs(d.debt - GREATEST(d.total - d.paid, 0)), 2),
         jsonb_build_object('kind', 'debt_not_total_minus_paid', 'total', d.total, 'paid', d.paid, 'debt', d.debt)
  FROM d WHERE d.debt IS NOT NULL AND abs(d.debt - GREATEST(d.total - d.paid, 0)) > (SELECT v FROM tol)
  UNION ALL
  SELECT 'B1:' || d.kind || ':' || d.id || ':negative', NULL::text, d.kind, d.id, d.no, d.doc_date, 'partner', d.partner_id,
         LEAST(d.total, d.paid, COALESCE(d.debt, 0)),
         jsonb_build_object('kind', 'negative_amount', 'total', d.total, 'paid', d.paid, 'debt', d.debt)
  FROM d WHERE d.total < 0 OR d.paid < 0 OR COALESCE(d.debt, 0) < 0;
$$;

-- B2 possible duplicate invoice: same partner, same total, dates within params.days.
CREATE OR REPLACE FUNCTION public.guard_check_b2(p_params JSONB, p_since TIMESTAMPTZ)
RETURNS TABLE (fingerprint TEXT, severity TEXT, entity_type TEXT, entity_id UUID, doc_no TEXT, doc_date DATE,
               partner_type TEXT, partner_id UUID, amount NUMERIC, details JSONB)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH docs AS (
    SELECT 'sale'::text AS kind, s.id, COALESCE(s.doc_no, s.invoice_number) AS no, s.doc_date, s.partner_id,
           round(s.total_amount, 2) AS total, s.created_at, s.updated_at
    FROM public.sales s WHERE s.status = 'posted' AND s.partner_id IS NOT NULL AND COALESCE(s.total_amount, 0) > 0
    UNION ALL
    SELECT 'purchase', p.id, p.invoice_number, p.doc_date, p.partner_id, round(p.total_amount, 2), p.created_at, p.updated_at
    FROM public.purchases p WHERE p.status = 'posted' AND p.partner_id IS NOT NULL AND COALESCE(p.total_amount, 0) > 0
  )
  SELECT 'B2:' || a.kind || ':' || a.id || ':' || b.id, NULL::text, a.kind, a.id, a.no, a.doc_date, 'partner', a.partner_id,
         a.total,
         jsonb_build_object('other_id', b.id, 'other_doc_no', b.no, 'other_doc_date', b.doc_date, 'days_apart', abs(b.doc_date - a.doc_date))
  FROM docs a
  JOIN docs b ON b.kind = a.kind AND b.partner_id = a.partner_id AND b.total = a.total AND a.id < b.id
             AND abs(b.doc_date - a.doc_date) <= public._guard_num(p_params, 'days', 2)
  WHERE p_since IS NULL OR GREATEST(a.created_at, b.created_at) >= p_since OR GREATEST(a.updated_at, b.updated_at) >= p_since;
$$;

-- B3 duplicate document number. sales.doc_no, sales.invoice_number and
-- purchases.invoice_number have unique indexes, so an exact copy cannot be stored; what
-- slips through is the same number written differently (case, spaces): "SS-0005" and
-- "ss-0005 ". Numbers are compared in lower case without any spaces, per document kind.
CREATE OR REPLACE FUNCTION public._guard_doc_no_key(p_no TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(lower(regexp_replace(COALESCE(p_no, ''), '\s+', '', 'g')), '');
$$;

CREATE OR REPLACE FUNCTION public.guard_check_b3(p_params JSONB, p_since TIMESTAMPTZ)
RETURNS TABLE (fingerprint TEXT, severity TEXT, entity_type TEXT, entity_id UUID, doc_no TEXT, doc_date DATE,
               partner_type TEXT, partner_id UUID, amount NUMERIC, details JSONB)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH docs AS (
    SELECT 'sale'::text AS kind, s.id, s.doc_no AS no, s.doc_date, s.created_at
    FROM public.sales s
    WHERE public._guard_doc_no_key(s.doc_no) IS NOT NULL AND COALESCE(s.status, '') NOT IN ('cancelled', 'void', 'voided')
    UNION ALL
    SELECT 'purchase', p.id, p.invoice_number, p.doc_date, p.created_at
    FROM public.purchases p
    WHERE public._guard_doc_no_key(p.invoice_number) IS NOT NULL AND COALESCE(p.status, '') NOT IN ('cancelled', 'void', 'voided')
  )
  SELECT 'B3:' || d.kind || ':' || public._guard_doc_no_key(d.no), NULL::text, d.kind, (array_agg(d.id ORDER BY d.created_at, d.id))[1],
         min(d.no), min(d.doc_date), NULL::text, NULL::uuid, NULL::numeric,
         jsonb_build_object('documents', count(*), 'ids', jsonb_agg(d.id ORDER BY d.created_at, d.id),
                            'numbers', jsonb_agg(d.no ORDER BY d.created_at, d.id))
  FROM docs d
  GROUP BY d.kind, public._guard_doc_no_key(d.no)
  HAVING count(*) > 1 AND (p_since IS NULL OR max(d.created_at) >= p_since);
$$;

-- B4 a payment dated before its invoice, or a document dated in the future.
CREATE OR REPLACE FUNCTION public.guard_check_b4(p_params JSONB, p_since TIMESTAMPTZ)
RETURNS TABLE (fingerprint TEXT, severity TEXT, entity_type TEXT, entity_id UUID, doc_no TEXT, doc_date DATE,
               partner_type TEXT, partner_id UUID, amount NUMERIC, details JSONB)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH pays AS (
    SELECT t.id, t.amount, t.source_type, t.source_id, t.created_at,
           (COALESCE(t.transaction_date, t.created_at) AT TIME ZONE 'Asia/Baku')::date AS pay_date
    FROM public.transactions t
    WHERE t.source_type IN ('sale', 'purchase') AND t.source_id IS NOT NULL
      AND (p_since IS NULL OR t.created_at >= p_since)
  )
  SELECT 'B4:payment_before:' || t.id, NULL::text, 'transaction', t.id, COALESCE(s.doc_no, s.invoice_number), t.pay_date,
         'partner', s.partner_id, t.amount,
         jsonb_build_object('kind', 'payment_before_invoice', 'document_type', 'sale', 'document_id', s.id, 'invoice_date', s.doc_date)
  FROM pays t JOIN public.sales s ON t.source_type = 'sale' AND s.id = t.source_id
  WHERE s.doc_date IS NOT NULL AND t.pay_date < s.doc_date
  UNION ALL
  SELECT 'B4:payment_before:' || t.id, NULL::text, 'transaction', t.id, p.invoice_number, t.pay_date,
         'partner', p.partner_id, t.amount,
         jsonb_build_object('kind', 'payment_before_invoice', 'document_type', 'purchase', 'document_id', p.id, 'invoice_date', p.doc_date)
  FROM pays t JOIN public.purchases p ON t.source_type = 'purchase' AND p.id = t.source_id
  WHERE p.doc_date IS NOT NULL AND t.pay_date < p.doc_date
  UNION ALL
  SELECT 'B4:future:sale:' || s.id, NULL::text, 'sale', s.id, COALESCE(s.doc_no, s.invoice_number), s.doc_date,
         'partner', s.partner_id, s.total_amount, jsonb_build_object('kind', 'future_date')
  FROM public.sales s
  WHERE s.doc_date > public._guard_today() AND COALESCE(s.status, '') NOT IN ('cancelled', 'void', 'voided')
  UNION ALL
  SELECT 'B4:future:purchase:' || p.id, NULL::text, 'purchase', p.id, p.invoice_number, p.doc_date,
         'partner', p.partner_id, p.total_amount, jsonb_build_object('kind', 'future_date')
  FROM public.purchases p
  WHERE p.doc_date > public._guard_today() AND COALESCE(p.status, '') NOT IN ('cancelled', 'void', 'voided')
  UNION ALL
  SELECT 'B4:future:payment:' || py.id, NULL::text, 'payment', py.id, NULL::text, (py.payment_date AT TIME ZONE 'Asia/Baku')::date,
         'partner', py.partner_id, py.amount, jsonb_build_object('kind', 'future_date')
  FROM public.payments py
  WHERE (py.payment_date AT TIME ZONE 'Asia/Baku')::date > public._guard_today()
  UNION ALL
  SELECT 'B4:future:transaction:' || t.id, NULL::text, 'transaction', t.id, NULL::text,
         (t.transaction_date AT TIME ZONE 'Asia/Baku')::date, NULL::text, NULL::uuid, t.amount,
         jsonb_build_object('kind', 'future_date', 'account_id', t.account_id)
  FROM public.transactions t
  WHERE (t.transaction_date AT TIME ZONE 'Asia/Baku')::date > public._guard_today()
  UNION ALL
  SELECT 'B4:future:journal_entry:' || je.id, NULL::text, 'journal_entry', je.id, je.entry_no, je.entry_date,
         NULL::text, NULL::uuid, NULL::numeric, jsonb_build_object('kind', 'future_date', 'document_type', je.document_type)
  FROM public.journal_entries je
  WHERE je.entry_date > public._guard_today();
$$;

-- B5 a document dated more than params.days before it was created (backdated), and
-- every admin date change (invoice_amendments with another doc_date, DATE-1 changes).
CREATE OR REPLACE FUNCTION public.guard_check_b5(p_params JSONB, p_since TIMESTAMPTZ)
RETURNS TABLE (fingerprint TEXT, severity TEXT, entity_type TEXT, entity_id UUID, doc_no TEXT, doc_date DATE,
               partner_type TEXT, partner_id UUID, amount NUMERIC, details JSONB)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  v_days NUMERIC := public._guard_num(p_params, 'days', 30);
BEGIN
  RETURN QUERY
  SELECT 'B5:backdated:sale:' || s.id, NULL::text, 'sale'::text, s.id, COALESCE(s.doc_no, s.invoice_number), s.doc_date,
         'partner'::text, s.partner_id, s.total_amount,
         jsonb_build_object('kind', 'backdated', 'created_on', (s.created_at AT TIME ZONE 'Asia/Baku')::date,
                            'days_before', (s.created_at AT TIME ZONE 'Asia/Baku')::date - s.doc_date)
  FROM public.sales s
  WHERE s.status = 'posted' AND s.doc_date IS NOT NULL
    AND (s.created_at AT TIME ZONE 'Asia/Baku')::date - s.doc_date > v_days
    AND (p_since IS NULL OR s.created_at >= p_since)
  UNION ALL
  SELECT 'B5:backdated:purchase:' || p.id, NULL::text, 'purchase'::text, p.id, p.invoice_number, p.doc_date,
         'partner'::text, p.partner_id, p.total_amount,
         jsonb_build_object('kind', 'backdated', 'created_on', (p.created_at AT TIME ZONE 'Asia/Baku')::date,
                            'days_before', (p.created_at AT TIME ZONE 'Asia/Baku')::date - p.doc_date)
  FROM public.purchases p
  WHERE p.status = 'posted' AND p.doc_date IS NOT NULL
    AND (p.created_at AT TIME ZONE 'Asia/Baku')::date - p.doc_date > v_days
    AND (p_since IS NULL OR p.created_at >= p_since)
  UNION ALL
  SELECT 'B5:amendment:' || ia.id, NULL::text, ia.document_type, ia.document_id,
         COALESCE(ia.new_values ->> 'doc_no', ia.old_values ->> 'doc_no', ia.new_values ->> 'invoice_number'),
         NULLIF(ia.new_values ->> 'doc_date', '')::date, NULL::text, NULL::uuid,
         NULLIF(ia.new_values ->> 'total_amount', '')::numeric,
         jsonb_build_object('kind', 'date_changed_by_amendment', 'old_date', ia.old_values ->> 'doc_date', 'new_date', ia.new_values ->> 'doc_date',
                            'reason', ia.reason, 'changed_by', ia.amended_by, 'changed_by_name', ia.amended_by_name, 'changed_at', ia.amended_at)
  FROM public.invoice_amendments ia
  WHERE (ia.old_values ->> 'doc_date') IS DISTINCT FROM (ia.new_values ->> 'doc_date')
    AND ia.new_values ? 'doc_date'
    AND (p_since IS NULL OR ia.amended_at >= p_since);

  -- DATE-1..3 date changes (document_date_changes), where that table exists.
  IF to_regclass('public.document_date_changes') IS NOT NULL THEN
    RETURN QUERY EXECUTE $q$
      SELECT 'B5:date_change:' || dc.id, NULL::text, dc.document_type, dc.document_id, dc.document_label, dc.new_date,
             NULL::text, NULL::uuid, NULL::numeric,
             jsonb_build_object('kind', 'date_changed', 'old_date', dc.old_date, 'new_date', dc.new_date, 'reason', dc.reason,
                                'changed_by', dc.changed_by, 'changed_by_name', dc.changed_by_name, 'changed_at', dc.changed_at)
      FROM public.document_date_changes dc
      WHERE dc.old_date IS DISTINCT FROM dc.new_date
        AND ($1 IS NULL OR dc.changed_at >= $1)
    $q$ USING p_since;
  END IF;
END;
$$;

-- B6 sale line below cost, at zero price, or with a discount above params.max_discount_pct.
CREATE OR REPLACE FUNCTION public.guard_check_b6(p_params JSONB, p_since TIMESTAMPTZ)
RETURNS TABLE (fingerprint TEXT, severity TEXT, entity_type TEXT, entity_id UUID, doc_no TEXT, doc_date DATE,
               partner_type TEXT, partner_id UUID, amount NUMERIC, details JSONB)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH l AS (
    SELECT si.id AS line_id, si.product_id, si.product_name, si.quantity, si.unit_price, si.discount_percent,
           COALESCE(si.line_total, si.total_price, si.quantity * si.unit_price) AS net, si.cogs_amount,
           s.id AS sale_id, COALESCE(s.doc_no, s.invoice_number) AS no, s.doc_date, s.partner_id
    FROM public.sale_items si
    JOIN public.sales s ON s.id = si.sale_id
    WHERE s.status = 'posted' AND COALESCE(si.quantity, 0) > 0
      AND (p_since IS NULL OR s.created_at >= p_since OR s.updated_at >= p_since OR s.posted_at >= p_since)
  )
  SELECT 'B6:below_cost:' || l.line_id, NULL::text, 'sale', l.sale_id, l.no, l.doc_date, 'partner', l.partner_id,
         round(l.cogs_amount - l.net, 2),
         jsonb_build_object('kind', 'below_cost', 'line_id', l.line_id, 'product_id', l.product_id, 'product_name', l.product_name,
                            'line_net', round(l.net, 2), 'line_cost', round(l.cogs_amount, 2))
  FROM l WHERE COALESCE(l.cogs_amount, 0) > 0 AND l.net < l.cogs_amount - public._guard_num(p_params, 'tolerance', 0.01)
  UNION ALL
  SELECT 'B6:zero_price:' || l.line_id, NULL::text, 'sale', l.sale_id, l.no, l.doc_date, 'partner', l.partner_id,
         NULL::numeric,
         jsonb_build_object('kind', 'zero_price', 'line_id', l.line_id, 'product_id', l.product_id, 'product_name', l.product_name,
                            'quantity', l.quantity)
  FROM l WHERE COALESCE(l.unit_price, 0) = 0
  UNION ALL
  SELECT 'B6:discount:' || l.line_id, NULL::text, 'sale', l.sale_id, l.no, l.doc_date, 'partner', l.partner_id,
         NULL::numeric,
         jsonb_build_object('kind', 'high_discount', 'line_id', l.line_id, 'product_id', l.product_id, 'product_name', l.product_name,
                            'discount_percent', l.discount_percent, 'max_discount_pct', public._guard_num(p_params, 'max_discount_pct', 30))
  FROM l WHERE COALESCE(l.discount_percent, 0) > public._guard_num(p_params, 'max_discount_pct', 30);
$$;

-- B7 total above params.factor x the partner's median of earlier documents (at least
-- params.min_documents earlier ones of the same kind).
CREATE OR REPLACE FUNCTION public.guard_check_b7(p_params JSONB, p_since TIMESTAMPTZ)
RETURNS TABLE (fingerprint TEXT, severity TEXT, entity_type TEXT, entity_id UUID, doc_no TEXT, doc_date DATE,
               partner_type TEXT, partner_id UUID, amount NUMERIC, details JSONB)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH docs AS (
    SELECT 'sale'::text AS kind, s.id, COALESCE(s.doc_no, s.invoice_number) AS no, s.doc_date, s.created_at, s.updated_at,
           s.partner_id, COALESCE(s.total_amount, 0) AS total
    FROM public.sales s WHERE s.status = 'posted' AND s.partner_id IS NOT NULL AND COALESCE(s.total_amount, 0) > 0
    UNION ALL
    SELECT 'purchase', p.id, p.invoice_number, p.doc_date, p.created_at, p.updated_at, p.partner_id, COALESCE(p.total_amount, 0)
    FROM public.purchases p WHERE p.status = 'posted' AND p.partner_id IS NOT NULL AND COALESCE(p.total_amount, 0) > 0
  ),
  stats AS (
    SELECT d.*, h.n, h.median
    FROM docs d
    CROSS JOIN LATERAL (
      SELECT count(*) AS n, percentile_cont(0.5) WITHIN GROUP (ORDER BY e.total) AS median
      FROM docs e
      WHERE e.kind = d.kind AND e.partner_id = d.partner_id AND e.id <> d.id
        AND (e.doc_date < d.doc_date OR (e.doc_date = d.doc_date AND e.created_at < d.created_at))
    ) h
    WHERE p_since IS NULL OR d.created_at >= p_since OR d.updated_at >= p_since
  )
  SELECT 'B7:' || s.kind || ':' || s.id, NULL::text, s.kind, s.id, s.no, s.doc_date, 'partner', s.partner_id, s.total,
         jsonb_build_object('median', round(s.median::numeric, 2), 'earlier_documents', s.n,
                            'factor', round(s.total / NULLIF(s.median::numeric, 0), 2))
  FROM stats s
  WHERE s.n >= public._guard_num(p_params, 'min_documents', 5)
    AND s.median > 0
    AND s.total > public._guard_num(p_params, 'factor', 5) * s.median::numeric;
$$;

-- B8 posted expense paid from a cash desk (accounts.type Kassa / cash) above params.amount
-- with no attachment (expense_attachments).
CREATE OR REPLACE FUNCTION public.guard_check_b8(p_params JSONB, p_since TIMESTAMPTZ)
RETURNS TABLE (fingerprint TEXT, severity TEXT, entity_type TEXT, entity_id UUID, doc_no TEXT, doc_date DATE,
               partner_type TEXT, partner_id UUID, amount NUMERIC, details JSONB)
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
BEGIN
  IF to_regclass('public.expenses') IS NULL OR to_regclass('public.expense_attachments') IS NULL THEN
    RETURN;
  END IF;
  RETURN QUERY EXECUTE $q$
    SELECT 'B8:' || x.id, NULL::text, 'expense'::text, x.id, x.code, COALESCE(x.expense_date, (x.created_at AT TIME ZONE 'Asia/Baku')::date),
           CASE WHEN x.supplier_id IS NOT NULL THEN 'supplier' END, x.supplier_id, x.amount,
           jsonb_build_object('account_id', a.id, 'account_name', a.name, 'category', x.category, 'payee', x.payee, 'limit', $2)
    FROM public.expenses x
    JOIN public.accounts a ON a.id = x.account_id
    WHERE x.status = 'posted' AND COALESCE(x.payment_mode, 'company') = 'company'
      AND lower(COALESCE(a.type, '')) IN ('kassa', 'cash')
      AND COALESCE(x.amount, 0) > $2
      AND NOT EXISTS (SELECT 1 FROM public.expense_attachments ea WHERE ea.expense_id = x.id)
      AND ($1 IS NULL OR x.created_at >= $1 OR x.updated_at >= $1 OR x.posted_at >= $1)
  $q$ USING p_since, public._guard_num(p_params, 'amount', 500);
END;
$$;

-- B9 a posted document deleted or changed (audit_logs, while the rows are retained).
-- Sales and purchases are audited on DELETE; cash rows and expenses on UPDATE too.
CREATE OR REPLACE FUNCTION public.guard_check_b9(p_params JSONB, p_since TIMESTAMPTZ)
RETURNS TABLE (fingerprint TEXT, severity TEXT, entity_type TEXT, entity_id UUID, doc_no TEXT, doc_date DATE,
               partner_type TEXT, partner_id UUID, amount NUMERIC, details JSONB)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT 'B9:' || al.id, NULL::text,
         CASE al.table_name WHEN 'sales' THEN 'sale' WHEN 'purchases' THEN 'purchase' WHEN 'expenses' THEN 'expense'
                            WHEN 'transactions' THEN 'transaction' WHEN 'payments' THEN 'payment' ELSE al.table_name END,
         al.record_id,
         COALESCE(al.old_values_json ->> 'doc_no', al.old_values_json ->> 'invoice_number', al.old_values_json ->> 'code'),
         (al.created_at AT TIME ZONE 'Asia/Baku')::date, NULL::text, NULL::uuid,
         COALESCE(NULLIF(al.old_values_json ->> 'total_amount', '')::numeric, NULLIF(al.old_values_json ->> 'amount', '')::numeric),
         jsonb_build_object('action', al.action, 'table', al.table_name, 'user_id', al.user_id, 'at', al.created_at,
                            'changed_keys', (SELECT jsonb_agg(k ORDER BY k) FROM jsonb_object_keys(COALESCE(al.new_values_json, '{}'::jsonb)) k))
  FROM public.audit_logs al
  WHERE al.table_name IN ('sales', 'purchases', 'expenses', 'transactions', 'payments')
    AND (p_since IS NULL OR al.created_at >= p_since)
    AND (
      (al.action = 'DELETE' AND (al.table_name IN ('transactions', 'payments')
                                 OR COALESCE(al.old_values_json ->> 'status', 'posted') NOT IN ('draft', 'cancelled', 'void', 'voided')))
      OR (al.action = 'UPDATE' AND al.table_name = 'transactions'
          AND (al.new_values_json ?| ARRAY['amount', 'account_id', 'type']))
      OR (al.action = 'UPDATE' AND al.table_name = 'expenses'
          AND COALESCE(al.old_values_json ->> 'status', '') = 'posted'
          AND (al.new_values_json ?| ARRAY['amount', 'account_id', 'expense_date', 'net_amount', 'vat_amount', 'supplier_id']))
    );
$$;

-- ─── 6. Rules: C, cash and bank ─────────────────────────────────────────────

-- C1 a cash / bank running balance below zero on some day. The running balance ends at
-- today's accounts.balance (rows walked back from it), so an opening balance typed
-- without a cash row does not create a false negative.
CREATE OR REPLACE FUNCTION public.guard_check_c1(p_params JSONB, p_since TIMESTAMPTZ)
RETURNS TABLE (fingerprint TEXT, severity TEXT, entity_type TEXT, entity_id UUID, doc_no TEXT, doc_date DATE,
               partner_type TEXT, partner_id UUID, amount NUMERIC, details JSONB)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH t AS (
    SELECT t.account_id, t.id, COALESCE(t.transaction_date, t.created_at) AS at,
           public._guard_tx_signed(t.type, t.amount) AS signed
    FROM public.transactions t
    WHERE t.account_id IS NOT NULL
  ),
  run AS (
    SELECT t.*,
           sum(t.signed) OVER (PARTITION BY t.account_id ORDER BY t.at, t.id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS cum,
           sum(t.signed) OVER (PARTITION BY t.account_id) AS all_rows
    FROM t
  ),
  bal AS (
    SELECT r.account_id, r.id, r.at,
           round(COALESCE(a.balance, 0) - r.all_rows + r.cum, 2) AS running
    FROM run r JOIN public.accounts a ON a.id = r.account_id
  ),
  neg AS (
    SELECT b.account_id, min(b.running) AS lowest, min(b.at) FILTER (WHERE b.running < 0) AS first_at,
           count(*) FILTER (WHERE b.running < 0) AS rows_below
    FROM bal b
    GROUP BY b.account_id
    HAVING min(b.running) < -public._guard_num(p_params, 'tolerance', 0.01)
  )
  SELECT 'C1:' || a.id, NULL::text, 'account', a.id, a.code, (n.first_at AT TIME ZONE 'Asia/Baku')::date, NULL::text, NULL::uuid,
         n.lowest,
         jsonb_build_object('account_name', a.name, 'lowest_balance', n.lowest, 'first_negative_at', n.first_at, 'rows_below_zero', n.rows_below)
  FROM neg n JOIN public.accounts a ON a.id = n.account_id;
$$;

-- C2 accounts.balance differs from the sum of its cash rows (in - out).
CREATE OR REPLACE FUNCTION public.guard_check_c2(p_params JSONB, p_since TIMESTAMPTZ)
RETURNS TABLE (fingerprint TEXT, severity TEXT, entity_type TEXT, entity_id UUID, doc_no TEXT, doc_date DATE,
               partner_type TEXT, partner_id UUID, amount NUMERIC, details JSONB)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH t AS (
    SELECT t.account_id, round(sum(public._guard_tx_signed(t.type, t.amount)), 2) AS total, count(*) AS n
    FROM public.transactions t WHERE t.account_id IS NOT NULL GROUP BY t.account_id
  )
  SELECT 'C2:' || a.id, NULL::text, 'account', a.id, a.code, NULL::date, NULL::text, NULL::uuid,
         abs(round(COALESCE(a.balance, 0), 2) - COALESCE(t.total, 0)),
         jsonb_build_object('account_name', a.name, 'balance', round(COALESCE(a.balance, 0), 2),
                            'transactions_total', COALESCE(t.total, 0), 'transactions', COALESCE(t.n, 0))
  FROM public.accounts a
  LEFT JOIN t ON t.account_id = a.id
  WHERE abs(round(COALESCE(a.balance, 0), 2) - COALESCE(t.total, 0)) > public._guard_num(p_params, 'tolerance', 0.01);
$$;

-- ─── 7. Rules: D, partners (on the LED-1 partner ledger) ───────────────────

-- D1 customer with a credit balance (the receivable side is negative: paid too much,
-- maybe a payment entered twice).
CREATE OR REPLACE FUNCTION public.guard_check_d1(p_params JSONB, p_since TIMESTAMPTZ)
RETURNS TABLE (fingerprint TEXT, severity TEXT, entity_type TEXT, entity_id UUID, doc_no TEXT, doc_date DATE,
               partner_type TEXT, partner_id UUID, amount NUMERIC, details JSONB)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT 'D1:' || b.partner_id, NULL::text, 'partner', b.partner_id, b.partner_name, NULL::date, 'partner', b.partner_id,
         -b.receivable,
         jsonb_build_object('partner_name', b.partner_name, 'receivable', b.receivable, 'payable', b.payable,
                            'last_payment_date', b.last_payment_date)
  FROM public.get_partner_balances(public._guard_today()) b
  WHERE b.receivable < -public._guard_num(p_params, 'tolerance', 0.01);
$$;

-- D2 supplier paid more than invoiced (the payable side is negative).
CREATE OR REPLACE FUNCTION public.guard_check_d2(p_params JSONB, p_since TIMESTAMPTZ)
RETURNS TABLE (fingerprint TEXT, severity TEXT, entity_type TEXT, entity_id UUID, doc_no TEXT, doc_date DATE,
               partner_type TEXT, partner_id UUID, amount NUMERIC, details JSONB)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT 'D2:' || b.partner_id, NULL::text, 'partner', b.partner_id, b.partner_name, NULL::date, 'partner', b.partner_id,
         -b.payable,
         jsonb_build_object('partner_name', b.partner_name, 'receivable', b.receivable, 'payable', b.payable,
                            'last_payment_date', b.last_payment_date)
  FROM public.get_partner_balances(public._guard_today()) b
  WHERE b.payable < -public._guard_num(p_params, 'tolerance', 0.01);
$$;

-- D3 an open item (receivable or payable) older than params.days (LED-4 open items, FIFO).
CREATE OR REPLACE FUNCTION public.guard_check_d3(p_params JSONB, p_since TIMESTAMPTZ)
RETURNS TABLE (fingerprint TEXT, severity TEXT, entity_type TEXT, entity_id UUID, doc_no TEXT, doc_date DATE,
               partner_type TEXT, partner_id UUID, amount NUMERIC, details JSONB)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT 'D3:' || o.partner_id || ':' || o.side || ':' || o.item_key, NULL::text,
         COALESCE(o.doc_kind, 'partner'), COALESCE(o.doc_id, o.partner_id), o.doc_no, o.item_date, 'partner', o.partner_id,
         round(o.remaining, 2),
         jsonb_build_object('side', o.side, 'item_key', o.item_key, 'due_date', o.due_date,
                            'age_days', public._guard_today() - o.item_date, 'as_of', public._guard_today())
  FROM public._partner_open_items(public._guard_today(), NULL) o
  WHERE o.kind = 'item' AND o.remaining > public._guard_num(p_params, 'tolerance', 0.01)
    AND o.item_date IS NOT NULL
    AND public._guard_today() - o.item_date > public._guard_num(p_params, 'days', 90);
$$;

-- Rule functions are internal: only guard_scan (as the owner) calls them.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'guard\_check\_%'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END;
$$;

-- ─── 8. Seed the rules ──────────────────────────────────────────────────────
-- A re-run updates category, severity and description key but keeps enabled / params.

INSERT INTO public.guard_rules (code, category, default_severity, enabled, params, description_key) VALUES
  ('A1',  'ledger',    'critical', TRUE, '{"tolerance": 0.01}', 'guard.rule.A1'),
  ('A2',  'ledger',    'critical', TRUE, '{}', 'guard.rule.A2'),
  ('A3',  'ledger',    'critical', TRUE, '{}', 'guard.rule.A3'),
  ('A4',  'ledger',    'critical', TRUE, '{}', 'guard.rule.A4'),
  ('A5',  'ledger',    'critical', TRUE, '{"tolerance": 0.01}', 'guard.rule.A5'),
  ('A6',  'ledger',    'critical', TRUE, '{"document_types": ["invoice", "sale", "bill", "purchase", "sale_cogs", "payment_receipt", "payment_disbursement", "cash_transaction"]}', 'guard.rule.A6'),
  ('A7',  'ledger',    'high',     TRUE, '{}', 'guard.rule.A7'),
  ('A8',  'ledger',    'high',     TRUE, '{"tolerance": 0.01}', 'guard.rule.A8'),
  ('A9',  'ledger',    'critical', TRUE, '{"tolerance": 0.01, "cash_codes": ["1000", "1100"]}', 'guard.rule.A9'),
  ('A10', 'ledger',    'high',     TRUE, '{"tolerance": 0.01, "receivable_code": "1200", "payable_code": "2100"}', 'guard.rule.A10'),
  ('B1',  'documents', 'high',     TRUE, '{"tolerance": 0.01}', 'guard.rule.B1'),
  ('B2',  'documents', 'medium',   TRUE, '{"days": 2}', 'guard.rule.B2'),
  ('B3',  'documents', 'medium',   TRUE, '{}', 'guard.rule.B3'),
  ('B4',  'documents', 'medium',   TRUE, '{}', 'guard.rule.B4'),
  ('B5',  'documents', 'medium',   TRUE, '{"days": 30}', 'guard.rule.B5'),
  ('B6',  'documents', 'medium',   TRUE, '{"max_discount_pct": 30, "tolerance": 0.01}', 'guard.rule.B6'),
  ('B7',  'documents', 'medium',   TRUE, '{"factor": 5, "min_documents": 5}', 'guard.rule.B7'),
  ('B8',  'documents', 'medium',   TRUE, '{"amount": 500}', 'guard.rule.B8'),
  ('B9',  'documents', 'high',     TRUE, '{}', 'guard.rule.B9'),
  ('C1',  'cash',      'critical', TRUE, '{"tolerance": 0.01}', 'guard.rule.C1'),
  ('C2',  'cash',      'high',     TRUE, '{"tolerance": 0.01}', 'guard.rule.C2'),
  ('D1',  'partners',  'medium',   TRUE, '{"tolerance": 0.01}', 'guard.rule.D1'),
  ('D2',  'partners',  'medium',   TRUE, '{"tolerance": 0.01}', 'guard.rule.D2'),
  ('D3',  'partners',  'low',      TRUE, '{"days": 90, "tolerance": 0.01}', 'guard.rule.D3')
ON CONFLICT (code) DO UPDATE
SET category = EXCLUDED.category,
    default_severity = EXCLUDED.default_severity,
    description_key = EXCLUDED.description_key;

-- ─── 9. The engine ──────────────────────────────────────────────────────────

-- Runs every enabled rule in scope (p_scope: categories and / or rule codes; NULL = all),
-- upserts the findings by fingerprint and returns the run id.
--   new fingerprint                          -> open
--   seen again, open / acknowledged          -> last_seen updated, status kept
--   seen again, resolved / auto_resolved     -> open again (the problem came back)
--   seen again, false_positive               -> stays, unless amount / details changed
--                                               materially (then open again)
--   open / acknowledged, not seen in a run that checked that rule over all data
--   (p_since NULL) and the rule ran without error  -> auto_resolved
-- p_since (GUARD-4): only documents and entries changed since then; no auto-resolve.
-- One failing rule writes its error into the run and the others go on.
CREATE OR REPLACE FUNCTION public.guard_scan(
  p_scope   TEXT[] DEFAULT NULL,
  p_trigger TEXT DEFAULT 'manual',
  p_since   TIMESTAMPTZ DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_run      UUID;
  v_scope    TEXT[];
  v_rule     RECORD;
  v_row      RECORD;
  v_finding  public.guard_findings%ROWTYPE;
  v_hash     TEXT;
  v_sev      TEXT;
  v_new      INTEGER := 0;
  v_resolved INTEGER := 0;
  v_n        INTEGER;
  v_errors   JSONB := '{}'::jsonb;
  v_ran      TEXT[] := '{}';
  v_ok       TEXT[] := '{}';
  v_status   TEXT;
BEGIN
  PERFORM public._guard_authorize();

  IF p_trigger IS NULL OR p_trigger NOT IN ('manual', 'button', 'scheduled') THEN
    RAISE EXCEPTION 'invalid_trigger: %', p_trigger USING ERRCODE = '22023';
  END IF;

  SELECT array_agg(DISTINCT lower(btrim(x))) INTO v_scope FROM unnest(p_scope) x WHERE NULLIF(btrim(x), '') IS NOT NULL;

  INSERT INTO public.guard_runs (trigger, scope, since, started_by)
  VALUES (p_trigger, p_scope, p_since, auth.uid())
  RETURNING id INTO v_run;

  FOR v_rule IN
    SELECT r.* FROM public.guard_rules r
    WHERE r.enabled
      AND (v_scope IS NULL OR lower(r.category) = ANY (v_scope) OR lower(r.code) = ANY (v_scope))
      AND to_regprocedure(format('public.guard_check_%s(jsonb, timestamptz)', lower(r.code))) IS NOT NULL
    ORDER BY r.category, length(r.code), r.code
  LOOP
    v_ran := v_ran || v_rule.code;
    BEGIN
      FOR v_row IN EXECUTE format('SELECT * FROM public.guard_check_%s($1, $2)', lower(v_rule.code))
        USING COALESCE(v_rule.params, '{}'::jsonb), p_since
      LOOP
        CONTINUE WHEN v_row.fingerprint IS NULL;
        v_sev := COALESCE(NULLIF(v_row.severity, ''), v_rule.default_severity);
        v_hash := public._guard_details_hash(v_row.amount, v_row.details);

        SELECT * INTO v_finding FROM public.guard_findings f WHERE f.fingerprint = v_row.fingerprint FOR UPDATE;

        IF NOT FOUND THEN
          INSERT INTO public.guard_findings (
            rule_code, severity, fingerprint, entity_type, entity_id, doc_no, doc_date, partner_type, partner_id,
            amount, details, details_hash, status, first_seen_run, last_seen_run, first_seen_at, last_seen_at
          ) VALUES (
            v_rule.code, v_sev, v_row.fingerprint, v_row.entity_type, v_row.entity_id, v_row.doc_no, v_row.doc_date,
            v_row.partner_type, v_row.partner_id, v_row.amount, COALESCE(v_row.details, '{}'::jsonb), v_hash,
            'open', v_run, v_run, NOW(), NOW()
          )
          RETURNING * INTO v_finding;
          INSERT INTO public.guard_finding_events (finding_id, run_id, actor, from_status, to_status, note)
          VALUES (v_finding.id, v_run, NULL, NULL, 'open', 'found');
          v_new := v_new + 1;
        ELSE
          UPDATE public.guard_findings f
          SET severity = v_sev,
              entity_type = v_row.entity_type,
              entity_id = v_row.entity_id,
              doc_no = v_row.doc_no,
              doc_date = v_row.doc_date,
              partner_type = v_row.partner_type,
              partner_id = v_row.partner_id,
              amount = v_row.amount,
              details = COALESCE(v_row.details, '{}'::jsonb),
              details_hash = v_hash,
              last_seen_run = v_run,
              last_seen_at = NOW(),
              status = CASE
                WHEN f.status IN ('resolved', 'auto_resolved') THEN 'open'
                WHEN f.status = 'false_positive' AND f.details_hash IS DISTINCT FROM v_hash THEN 'open'
                ELSE f.status
              END,
              resolved_by = CASE
                WHEN f.status IN ('resolved', 'auto_resolved')
                  OR (f.status = 'false_positive' AND f.details_hash IS DISTINCT FROM v_hash) THEN NULL
                ELSE f.resolved_by END,
              resolved_at = CASE
                WHEN f.status IN ('resolved', 'auto_resolved')
                  OR (f.status = 'false_positive' AND f.details_hash IS DISTINCT FROM v_hash) THEN NULL
                ELSE f.resolved_at END
          WHERE f.id = v_finding.id;

          IF v_finding.status IN ('resolved', 'auto_resolved')
             OR (v_finding.status = 'false_positive' AND v_finding.details_hash IS DISTINCT FROM v_hash) THEN
            INSERT INTO public.guard_finding_events (finding_id, run_id, actor, from_status, to_status, note)
            VALUES (v_finding.id, v_run, NULL, v_finding.status, 'open',
                    CASE WHEN v_finding.status = 'false_positive' THEN 'changed materially' ELSE 'seen again' END);
          END IF;
        END IF;
      END LOOP;
      v_ok := v_ok || v_rule.code;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_object(v_rule.code, SQLSTATE || ': ' || SQLERRM);
    END;
  END LOOP;

  -- Auto-resolve what a complete check of a rule did not see again.
  IF p_since IS NULL AND cardinality(v_ok) > 0 THEN
    WITH gone AS (
      UPDATE public.guard_findings f
      SET status = 'auto_resolved', resolved_at = NOW(), resolved_by = NULL
      WHERE f.rule_code = ANY (v_ok)
        AND f.status IN ('open', 'acknowledged')
        AND f.last_seen_run IS DISTINCT FROM v_run
      RETURNING f.id
    )
    INSERT INTO public.guard_finding_events (finding_id, run_id, actor, from_status, to_status, note)
    SELECT g.id, v_run, NULL, NULL, 'auto_resolved', 'not seen in this run' FROM gone g;
    GET DIAGNOSTICS v_resolved = ROW_COUNT;
  END IF;

  SELECT count(*) INTO v_n FROM public.guard_findings WHERE status IN ('open', 'acknowledged');

  v_status := CASE
    WHEN v_errors = '{}'::jsonb THEN 'ok'
    WHEN cardinality(v_ok) = 0 THEN 'failed'
    ELSE 'partial'
  END;

  UPDATE public.guard_runs
  SET finished_at = NOW(),
      status = v_status,
      rules_run = v_ran,
      new_count = v_new,
      open_count = v_n,
      resolved_count = v_resolved,
      rule_errors = v_errors,
      error = CASE WHEN v_errors = '{}'::jsonb THEN NULL
                   ELSE (SELECT string_agg(k || ': ' || v, E'\n' ORDER BY k) FROM jsonb_each_text(v_errors) e(k, v)) END
  WHERE id = v_run;

  RETURN v_run;
END;
$$;

-- An admin sets the status of a finding: open (reopen), acknowledged, resolved or
-- false_positive. A note is required for resolved and false_positive. Writes
-- guard_finding_events and audit_logs. Returns the finding.
CREATE OR REPLACE FUNCTION public.guard_set_finding_status(p_id UUID, p_status TEXT, p_note TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old  public.guard_findings%ROWTYPE;
  v_new  public.guard_findings%ROWTYPE;
  v_note TEXT := NULLIF(btrim(COALESCE(p_note, '')), '');
  v_uid  UUID := auth.uid();
BEGIN
  PERFORM public._guard_authorize();

  IF p_status IS NULL OR p_status NOT IN ('open', 'acknowledged', 'resolved', 'false_positive') THEN
    RAISE EXCEPTION 'invalid_status: %', p_status USING ERRCODE = '22023';
  END IF;
  IF p_status IN ('resolved', 'false_positive') AND v_note IS NULL THEN
    RAISE EXCEPTION 'note_required' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_old FROM public.guard_findings WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'finding_not_found' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.guard_findings
  SET status = p_status,
      note = COALESCE(v_note, note),
      resolved_by = CASE WHEN p_status IN ('resolved', 'false_positive') THEN v_uid END,
      resolved_at = CASE WHEN p_status IN ('resolved', 'false_positive') THEN NOW() END
  WHERE id = p_id
  RETURNING * INTO v_new;

  INSERT INTO public.guard_finding_events (finding_id, actor, from_status, to_status, note)
  VALUES (p_id, v_uid, v_old.status, p_status, v_note);

  INSERT INTO public.audit_logs (user_id, action, module, table_name, record_id, old_values_json, new_values_json)
  VALUES (
    public.audit_request_user_id(), 'UPDATE', 'FINANCE', 'guard_findings', p_id,
    jsonb_build_object('status', v_old.status, 'rule_code', v_old.rule_code, 'fingerprint', v_old.fingerprint),
    jsonb_build_object('status', p_status, 'note', v_note)
  );

  RETURN to_jsonb(v_new);
END;
$$;

REVOKE ALL ON FUNCTION public.guard_scan(TEXT[], TEXT, TIMESTAMPTZ) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.guard_set_finding_status(UUID, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public._guard_authorize() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guard_scan(TEXT[], TEXT, TIMESTAMPTZ) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.guard_set_finding_status(UUID, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._guard_is_admin() TO authenticated, service_role;
