-- ============================================================================
-- Accounting Guard, the section for admins (GUARD-3). Needs GUARD-1
-- (20261120100000_accounting_guard_core.sql); GUARD-2 adds rules but is not required.
-- Plan: docs/accounting-guard-plan.md.
--
-- Same hard rule as GUARD-1 and GUARD-2: the guard NEVER posts, edits, reverses or deletes
-- business data. Everything here reads business data or writes the guard's own tables
-- (guard_rules, guard_findings, guard_reports, guard_admin_state) and audit_logs.
--
-- What is added:
--   guard_reports      saved reports: a snapshot of the findings (kind 'scan'), a question an admin
--                      asked, or, from GUARD-5, the accountant agent's daily / monthly report
--   guard_admin_state  per admin: when they last looked at the findings and at the reports (the bell)
--   guard_dashboard()  open findings by severity and category, the last run, the last 30 runs, the
--                      ten worst open findings
--   guard_update_rule()        enable / disable a rule, change its severity and thresholds (validated)
--   guard_bulk_set_status()    acknowledge (or close with a reason) many findings at once
--   guard_create_report()      save a report
--   guard_notification_state() what is new for this admin since they last looked
--   guard_mark_seen()          the admin has looked
-- Admins only, like the rest of the guard; service-role callers (server code, the scheduled job)
-- have no auth.uid() and are trusted. Safe to re-run.
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('public.guard_findings') IS NULL OR to_regprocedure('public.guard_scan(text[], text, timestamp with time zone)') IS NULL THEN
    RAISE EXCEPTION 'Run supabase/migrations/20261120100000_accounting_guard_core.sql (GUARD-1) before 20261120120000_accounting_guard_ui.sql';
  END IF;
END
$$;

-- ─── 1. Tables ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.guard_reports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind            TEXT NOT NULL,
  title           TEXT NOT NULL,
  period_start    DATE,
  period_end      DATE,
  body            TEXT NOT NULL DEFAULT '',
  summary         JSONB NOT NULL DEFAULT '{}'::jsonb,
  model           TEXT,
  tokens_in       INTEGER,
  tokens_out      INTEGER,
  cost_usd        NUMERIC,
  created_by_type TEXT NOT NULL DEFAULT 'user',
  created_by      UUID,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT guard_reports_kind_check CHECK (kind IN ('daily', 'monthly', 'on_demand', 'scan')),
  CONSTRAINT guard_reports_by_check CHECK (created_by_type IN ('system', 'ai', 'user')),
  CONSTRAINT guard_reports_summary_object CHECK (jsonb_typeof(summary) = 'object')
);
CREATE INDEX IF NOT EXISTS idx_guard_reports_created ON public.guard_reports (created_at DESC);

-- One row per admin: what they have seen. Written only by guard_mark_seen().
CREATE TABLE IF NOT EXISTS public.guard_admin_state (
  user_id          UUID PRIMARY KEY,
  findings_seen_at TIMESTAMPTZ,
  reports_seen_at  TIMESTAMPTZ,
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.guard_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guard_admin_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS guard_reports_select ON public.guard_reports;
CREATE POLICY guard_reports_select ON public.guard_reports FOR SELECT TO authenticated USING (public._guard_is_admin());
DROP POLICY IF EXISTS guard_admin_state_select ON public.guard_admin_state;
CREATE POLICY guard_admin_state_select ON public.guard_admin_state FOR SELECT TO authenticated
  USING (public._guard_is_admin() AND user_id = auth.uid());

REVOKE ALL ON public.guard_reports, public.guard_admin_state FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.guard_reports, public.guard_admin_state TO authenticated;
GRANT ALL ON public.guard_reports, public.guard_admin_state TO service_role;

-- ─── 2. The dashboard ───────────────────────────────────────────────────────

-- Open findings (status 'open') by severity and by rule category, how many are acknowledged, the
-- last run, the last 30 runs (oldest first, for the trend) and the ten worst open findings
-- (critical and high, newest first). The health score is computed by the app from the counts.
CREATE OR REPLACE FUNCTION public.guard_dashboard()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_open  JSONB;
  v_cat   JSONB;
  v_last  JSONB;
  v_trend JSONB;
  v_top   JSONB;
  v_ack   INTEGER;
BEGIN
  PERFORM public._guard_authorize();

  SELECT jsonb_build_object(
           'critical', count(*) FILTER (WHERE f.severity = 'critical'),
           'high',     count(*) FILTER (WHERE f.severity = 'high'),
           'medium',   count(*) FILTER (WHERE f.severity = 'medium'),
           'low',      count(*) FILTER (WHERE f.severity = 'low'),
           'total',    count(*))
  INTO v_open
  FROM public.guard_findings f
  WHERE f.status = 'open';

  SELECT count(*) INTO v_ack FROM public.guard_findings WHERE status = 'acknowledged';

  SELECT COALESCE(jsonb_agg(c ORDER BY c ->> 'category'), '[]'::jsonb)
  INTO v_cat
  FROM (
    SELECT jsonb_build_object(
             'category', r.category,
             'critical', count(*) FILTER (WHERE f.severity = 'critical'),
             'high',     count(*) FILTER (WHERE f.severity = 'high'),
             'medium',   count(*) FILTER (WHERE f.severity = 'medium'),
             'low',      count(*) FILTER (WHERE f.severity = 'low'),
             'total',    count(*)) AS c
    FROM public.guard_findings f
    JOIN public.guard_rules r ON r.code = f.rule_code
    WHERE f.status = 'open'
    GROUP BY r.category
  ) x;

  SELECT to_jsonb(r) INTO v_last
  FROM (
    SELECT id, trigger, started_at, finished_at, status, new_count, open_count, resolved_count
    FROM public.guard_runs
    ORDER BY started_at DESC
    LIMIT 1
  ) r;

  SELECT COALESCE(jsonb_agg(t ORDER BY t ->> 'started_at'), '[]'::jsonb)
  INTO v_trend
  FROM (
    SELECT jsonb_build_object('started_at', r.started_at, 'status', r.status, 'new_count', r.new_count, 'open_count', r.open_count) AS t
    FROM public.guard_runs r
    WHERE r.status <> 'running'
    ORDER BY r.started_at DESC
    LIMIT 30
  ) x;

  SELECT COALESCE(jsonb_agg(to_jsonb(top)), '[]'::jsonb)
  INTO v_top
  FROM (
    SELECT f.id, f.rule_code, r.category, f.severity, f.entity_type, f.entity_id, f.doc_no, f.doc_date,
           f.partner_id, f.amount, f.status, f.first_seen_at
    FROM public.guard_findings f
    JOIN public.guard_rules r ON r.code = f.rule_code
    WHERE f.status = 'open' AND f.severity IN ('critical', 'high')
    ORDER BY CASE f.severity WHEN 'critical' THEN 0 ELSE 1 END, f.first_seen_at DESC, f.id
    LIMIT 10
  ) top;

  RETURN jsonb_build_object('open', v_open, 'acknowledged', v_ack, 'by_category', v_cat,
                            'last_run', v_last, 'trend', v_trend, 'top', v_top);
END;
$$;

-- ─── 3. Rules ───────────────────────────────────────────────────────────────

-- Enable / disable a rule, set its severity and thresholds. Thresholds (params) keep the shape
-- the rule was seeded with: the same keys, numbers stay numbers (not negative; a similarity
-- threshold between 0.3 and 1; a percentage up to 1000), lists stay lists of text, text stays
-- text. Writes audit_logs. NULL arguments leave that part as it is.
CREATE OR REPLACE FUNCTION public.guard_update_rule(
  p_code     TEXT,
  p_enabled  BOOLEAN DEFAULT NULL,
  p_severity TEXT DEFAULT NULL,
  p_params   JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old public.guard_rules%ROWTYPE;
  v_new public.guard_rules%ROWTYPE;
  k     TEXT;
  v     JSONB;
  v_cur JSONB;
BEGIN
  PERFORM public._guard_authorize();

  SELECT * INTO v_old FROM public.guard_rules WHERE code = p_code FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'rule_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF p_severity IS NOT NULL AND p_severity NOT IN ('critical', 'high', 'medium', 'low') THEN
    RAISE EXCEPTION 'invalid_severity: %', p_severity USING ERRCODE = '22023';
  END IF;

  IF p_params IS NOT NULL THEN
    IF jsonb_typeof(p_params) <> 'object' THEN
      RAISE EXCEPTION 'invalid_params' USING ERRCODE = '22023';
    END IF;
    FOR k, v IN SELECT * FROM jsonb_each(p_params) LOOP
      v_cur := v_old.params -> k;
      IF v_cur IS NULL THEN
        RAISE EXCEPTION 'unknown_param: %', k USING ERRCODE = '22023';
      END IF;
      IF jsonb_typeof(v) <> jsonb_typeof(v_cur) THEN
        RAISE EXCEPTION 'invalid_param_type: %', k USING ERRCODE = '22023';
      END IF;
      IF jsonb_typeof(v) = 'number' THEN
        IF (v #>> '{}')::numeric < 0 THEN
          RAISE EXCEPTION 'invalid_param_value: %', k USING ERRCODE = '22023';
        END IF;
        IF k = 'threshold' AND ((v #>> '{}')::numeric < 0.3 OR (v #>> '{}')::numeric > 1) THEN
          RAISE EXCEPTION 'invalid_param_value: %', k USING ERRCODE = '22023';
        END IF;
        IF (k = 'pct' OR k LIKE '%\_pct') AND (v #>> '{}')::numeric > 1000 THEN
          RAISE EXCEPTION 'invalid_param_value: %', k USING ERRCODE = '22023';
        END IF;
      ELSIF jsonb_typeof(v) = 'array' THEN
        IF EXISTS (SELECT 1 FROM jsonb_array_elements(v) e WHERE jsonb_typeof(e) <> 'string' OR btrim(e #>> '{}') = '') THEN
          RAISE EXCEPTION 'invalid_param_value: %', k USING ERRCODE = '22023';
        END IF;
      ELSIF jsonb_typeof(v) = 'string' AND btrim(v #>> '{}') = '' THEN
        RAISE EXCEPTION 'invalid_param_value: %', k USING ERRCODE = '22023';
      END IF;
    END LOOP;
  END IF;

  UPDATE public.guard_rules
  SET enabled = COALESCE(p_enabled, enabled),
      default_severity = COALESCE(p_severity, default_severity),
      params = CASE WHEN p_params IS NULL THEN params ELSE params || p_params END,
      updated_at = NOW()
  WHERE code = p_code
  RETURNING * INTO v_new;

  INSERT INTO public.audit_logs (user_id, action, module, table_name, record_id, old_values_json, new_values_json)
  VALUES (
    public.audit_request_user_id(), 'UPDATE', 'FINANCE', 'guard_rules', NULL,
    jsonb_build_object('code', v_old.code, 'enabled', v_old.enabled, 'severity', v_old.default_severity, 'params', v_old.params),
    jsonb_build_object('code', v_new.code, 'enabled', v_new.enabled, 'severity', v_new.default_severity, 'params', v_new.params)
  );

  RETURN to_jsonb(v_new);
END;
$$;

-- ─── 4. Many findings at once ───────────────────────────────────────────────

-- The same rules as guard_set_finding_status (a reason for resolved / false_positive), for up to
-- 500 findings; findings that do not exist are skipped. Returns how many changed.
CREATE OR REPLACE FUNCTION public.guard_bulk_set_status(p_ids UUID[], p_status TEXT, p_note TEXT DEFAULT NULL)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_n  INTEGER := 0;
BEGIN
  PERFORM public._guard_authorize();
  IF p_ids IS NULL OR cardinality(p_ids) = 0 THEN
    RETURN 0;
  END IF;
  IF cardinality(p_ids) > 500 THEN
    RAISE EXCEPTION 'too_many_findings' USING ERRCODE = '22023';
  END IF;
  FOREACH v_id IN ARRAY p_ids LOOP
    IF EXISTS (SELECT 1 FROM public.guard_findings WHERE id = v_id) THEN
      PERFORM public.guard_set_finding_status(v_id, p_status, p_note);
      v_n := v_n + 1;
    END IF;
  END LOOP;
  RETURN v_n;
END;
$$;

-- ─── 5. Reports ─────────────────────────────────────────────────────────────

-- Saves a report. An admin saves kind 'scan' (a dated snapshot of the findings) or 'on_demand';
-- the daily and monthly reports of the accountant agent (GUARD-5) come from the server (service
-- role, no auth.uid()) with created_by_type 'ai' or 'system'.
CREATE OR REPLACE FUNCTION public.guard_create_report(
  p_kind    TEXT,
  p_title   TEXT,
  p_body    TEXT,
  p_summary JSONB DEFAULT '{}'::jsonb,
  p_period_start DATE DEFAULT NULL,
  p_period_end   DATE DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id    UUID;
  v_title TEXT := NULLIF(btrim(COALESCE(p_title, '')), '');
BEGIN
  PERFORM public._guard_authorize();
  IF p_kind IS NULL OR p_kind NOT IN ('daily', 'monthly', 'on_demand', 'scan') THEN
    RAISE EXCEPTION 'invalid_kind: %', p_kind USING ERRCODE = '22023';
  END IF;
  IF auth.uid() IS NOT NULL AND p_kind IN ('daily', 'monthly') THEN
    RAISE EXCEPTION 'invalid_kind: %', p_kind USING ERRCODE = '22023';
  END IF;
  IF v_title IS NULL THEN
    RAISE EXCEPTION 'title_required' USING ERRCODE = '22023';
  END IF;
  IF p_summary IS NOT NULL AND jsonb_typeof(p_summary) <> 'object' THEN
    RAISE EXCEPTION 'invalid_summary' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.guard_reports (kind, title, period_start, period_end, body, summary, created_by_type, created_by)
  VALUES (p_kind, v_title, p_period_start, p_period_end, COALESCE(p_body, ''), COALESCE(p_summary, '{}'::jsonb),
          CASE WHEN auth.uid() IS NULL THEN 'system' ELSE 'user' END, auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- ─── 6. The bell ────────────────────────────────────────────────────────────

-- New for this admin since they last looked: open critical / high findings first seen after
-- findings_seen_at (all of them when they never looked) and reports created after reports_seen_at
-- (by someone else or by the system; their own are not "new" to them).
CREATE OR REPLACE FUNCTION public.guard_notification_state()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s public.guard_admin_state%ROWTYPE;
  v_findings INTEGER;
  v_critical INTEGER;
  v_reports  INTEGER;
BEGIN
  PERFORM public._guard_authorize();
  SELECT * INTO s FROM public.guard_admin_state WHERE user_id = auth.uid();

  SELECT count(*), count(*) FILTER (WHERE severity = 'critical')
  INTO v_findings, v_critical
  FROM public.guard_findings
  WHERE status = 'open' AND severity IN ('critical', 'high')
    AND (s.findings_seen_at IS NULL OR first_seen_at > s.findings_seen_at);

  SELECT count(*) INTO v_reports
  FROM public.guard_reports r
  WHERE (s.reports_seen_at IS NULL OR r.created_at > s.reports_seen_at)
    AND r.created_by IS DISTINCT FROM auth.uid();

  RETURN jsonb_build_object('new_findings', v_findings, 'new_critical', v_critical, 'new_reports', v_reports);
END;
$$;

CREATE OR REPLACE FUNCTION public.guard_mark_seen(p_what TEXT DEFAULT 'all')
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._guard_authorize();
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;
  IF p_what IS NULL OR p_what NOT IN ('findings', 'reports', 'all') THEN
    RAISE EXCEPTION 'invalid_what: %', p_what USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.guard_admin_state (user_id, findings_seen_at, reports_seen_at, updated_at)
  VALUES (auth.uid(),
          CASE WHEN p_what IN ('findings', 'all') THEN NOW() END,
          CASE WHEN p_what IN ('reports', 'all') THEN NOW() END,
          NOW())
  ON CONFLICT (user_id) DO UPDATE
  SET findings_seen_at = CASE WHEN p_what IN ('findings', 'all') THEN NOW() ELSE public.guard_admin_state.findings_seen_at END,
      reports_seen_at  = CASE WHEN p_what IN ('reports', 'all') THEN NOW() ELSE public.guard_admin_state.reports_seen_at END,
      updated_at = NOW();
END;
$$;

-- ─── 7. Access ──────────────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION public.guard_dashboard() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.guard_update_rule(TEXT, BOOLEAN, TEXT, JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.guard_bulk_set_status(UUID[], TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.guard_create_report(TEXT, TEXT, TEXT, JSONB, DATE, DATE) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.guard_notification_state() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.guard_mark_seen(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guard_dashboard() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.guard_update_rule(TEXT, BOOLEAN, TEXT, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.guard_bulk_set_status(UUID[], TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.guard_create_report(TEXT, TEXT, TEXT, JSONB, DATE, DATE) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.guard_notification_state() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.guard_mark_seen(TEXT) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
