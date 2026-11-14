-- ============================================================================
-- Accounting Guard, it runs by itself (GUARD-4). Needs GUARD-1
-- (20261120100000_accounting_guard_core.sql) and GUARD-3 (20261120120000_accounting_guard_ui.sql).
-- Plan: docs/accounting-guard-plan.md.
--
-- Same hard rule as the rest of the guard: it NEVER posts, edits, reverses or deletes business data.
-- The scheduled scan only calls guard_scan(), which reads business tables and writes guard_* tables.
-- The only rows this file deletes are the guard's own old findings and runs (retention).
-- No trigger anywhere: nothing runs on a posting path.
--
-- What it adds:
--   system_settings 'accounting_guard'  {enabled, incremental_minutes, nightly_hour_utc, retention_days};
--                                       off by default, so merging changes nothing
--   guard_rules.full_only               checks that must see the whole ledger or all products
--                                       (A8-A10, C1, C2, D1-D3, F1-F5, E1, E2, E4); the other checks
--                                       can look only at what changed
--   guard_scheduled_run(mode)           'incremental': the checks that can, over documents and entries
--                                       changed since the last good scheduled run; 'full': every check,
--                                       with auto-resolve, then the retention clean-up. Does nothing when
--                                       the setting is off
--   guard_apply_schedule()              (re)creates the two pg_cron jobs from the settings
--   guard_schedule_state()              what the Rules tab shows: settings, jobs, next runs, last run
--   guard_set_schedule(...)             an admin turns it on or off and sets the times (validated)
--
-- pg_cron is not required: on a database without it (CI, a new tenant) this file applies, the settings
-- are stored, and a notice says what to do. The jobs are created when pg_cron exists, here or the next
-- time an admin saves the schedule. Safe to re-run.
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('public.guard_findings') IS NULL OR to_regclass('public.guard_reports') IS NULL
     OR to_regprocedure('public.guard_scan(text[], text, timestamp with time zone)') IS NULL THEN
    RAISE EXCEPTION 'Run supabase/migrations/20261120100000_accounting_guard_core.sql (GUARD-1) and 20261120120000_accounting_guard_ui.sql (GUARD-3) before 20261120130000_accounting_guard_cron.sql';
  END IF;
END
$$;

-- ─── 1. Which checks can run on changes only ────────────────────────────────

ALTER TABLE public.guard_rules ADD COLUMN IF NOT EXISTS full_only BOOLEAN NOT NULL DEFAULT FALSE;

-- A check that walks every entry (A8) or totals the whole ledger (A9, A10, C1, C2), the partner ledger
-- (D1-D3), or compares every product (F1-F5, E1, E2, E4) cannot look at changed rows only.
UPDATE public.guard_rules
SET full_only = (code = ANY (ARRAY['A8', 'A9', 'A10', 'C1', 'C2', 'D1', 'D2', 'D3', 'F1', 'F2', 'F3', 'F4', 'F5', 'E1', 'E2', 'E4']));

-- ─── 2. Settings (off by default) ───────────────────────────────────────────

INSERT INTO public.system_settings (key, value)
VALUES ('accounting_guard', '{"enabled": false, "incremental_minutes": 30, "nightly_hour_utc": 22, "retention_days": 365}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- The settings with defaults filled in and every value kept in its range.
CREATE OR REPLACE FUNCTION public._guard_schedule_settings()
RETURNS JSONB
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'enabled', COALESCE((s.value ->> 'enabled')::boolean, FALSE),
    'incremental_minutes', CASE WHEN (s.value ->> 'incremental_minutes')::int IN (10, 15, 30, 60) THEN (s.value ->> 'incremental_minutes')::int ELSE 30 END,
    'nightly_hour_utc', CASE WHEN (s.value ->> 'nightly_hour_utc')::int BETWEEN 0 AND 23 THEN (s.value ->> 'nightly_hour_utc')::int ELSE 22 END,
    'retention_days', CASE WHEN (s.value ->> 'retention_days')::int BETWEEN 30 AND 3650 THEN (s.value ->> 'retention_days')::int ELSE 365 END
  )
  FROM (SELECT COALESCE((SELECT value FROM public.system_settings WHERE key = 'accounting_guard'), '{}'::jsonb) AS value) s;
$$;

-- ─── 3. The scheduled scan ──────────────────────────────────────────────────

-- p_mode 'incremental' | 'full'. Returns the run id, or NULL when nothing ran (the setting is off, a
-- scan is already running, or there was nothing to do). Called by pg_cron, which has no signed-in
-- user: guard_scan treats that as the server. Never writes business data.
CREATE OR REPLACE FUNCTION public.guard_scheduled_run(p_mode TEXT)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cfg    JSONB := public._guard_schedule_settings();
  v_since  TIMESTAMPTZ;
  v_scope  TEXT[];
  v_run    UUID;
  v_days   INTEGER;
BEGIN
  IF p_mode IS NULL OR p_mode NOT IN ('incremental', 'full') THEN
    RAISE EXCEPTION 'invalid_mode: %', p_mode USING ERRCODE = '22023';
  END IF;
  IF NOT (v_cfg ->> 'enabled')::boolean THEN
    RETURN NULL;
  END IF;
  -- One scan at a time (a crashed run stops counting after half an hour).
  IF EXISTS (SELECT 1 FROM public.guard_runs WHERE status = 'running' AND started_at > NOW() - INTERVAL '30 minutes') THEN
    RETURN NULL;
  END IF;

  IF p_mode = 'incremental' THEN
    -- Changes since the last good scheduled scan (5 minutes earlier, for documents saved while it ran).
    SELECT r.started_at - INTERVAL '5 minutes' INTO v_since
    FROM public.guard_runs r
    WHERE r.trigger = 'scheduled' AND r.status = 'ok' AND r.finished_at IS NOT NULL
    ORDER BY r.started_at DESC
    LIMIT 1;
    IF v_since IS NOT NULL THEN
      SELECT array_agg(code ORDER BY code) INTO v_scope FROM public.guard_rules WHERE enabled AND NOT full_only;
      IF v_scope IS NULL THEN
        RETURN NULL;
      END IF;
      RETURN public.guard_scan(v_scope, 'scheduled', v_since);
    END IF;
    -- No good scheduled scan yet: the first one is a full one.
  END IF;

  v_run := public.guard_scan(NULL, 'scheduled', NULL);

  IF p_mode = 'full' THEN
    -- Retention: the guard's own old history only (closed findings and old runs).
    v_days := (v_cfg ->> 'retention_days')::int;
    DELETE FROM public.guard_findings f
    WHERE f.status = 'auto_resolved' AND COALESCE(f.resolved_at, f.last_seen_at) < NOW() - make_interval(days => v_days);
    DELETE FROM public.guard_runs r
    WHERE r.started_at < NOW() - make_interval(days => v_days) AND r.id <> v_run;
  END IF;
  RETURN v_run;
END;
$$;

-- ─── 4. The pg_cron jobs ────────────────────────────────────────────────────

-- (Re)creates 'guard-incremental' and 'guard-full' from the settings; the jobs exist even while the
-- setting is off (they then do nothing), so turning it on needs no extension step. Returns FALSE
-- when pg_cron is not there. Idempotent: the old jobs are removed first.
CREATE OR REPLACE FUNCTION public.guard_apply_schedule()
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cfg      JSONB := public._guard_schedule_settings();
  v_minutes  INTEGER := (v_cfg ->> 'incremental_minutes')::int;
  v_hour     INTEGER := (v_cfg ->> 'nightly_hour_utc')::int;
  v_every    TEXT;
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RETURN FALSE;
  END IF;
  v_every := CASE WHEN v_minutes >= 60 THEN '0 * * * *' ELSE format('*/%s * * * *', v_minutes) END;

  EXECUTE $q$SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname IN ('guard-incremental', 'guard-full')$q$;
  EXECUTE format('SELECT cron.schedule(%L, %L, %L)', 'guard-incremental', v_every, $c$SELECT public.guard_scheduled_run('incremental')$c$);
  EXECUTE format('SELECT cron.schedule(%L, %L, %L)', 'guard-full', format('0 %s * * *', v_hour), $c$SELECT public.guard_scheduled_run('full')$c$);
  RETURN TRUE;
END;
$$;

-- ─── 5. What the Rules tab shows ────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.guard_schedule_state()
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cfg     JSONB := public._guard_schedule_settings();
  v_minutes INTEGER := (v_cfg ->> 'incremental_minutes')::int;
  v_hour    INTEGER := (v_cfg ->> 'nightly_hour_utc')::int;
  v_cron    BOOLEAN := to_regclass('cron.job') IS NOT NULL;
  v_jobs    JSONB := '[]'::jsonb;
  v_next_i  TIMESTAMPTZ;
  v_next_f  TIMESTAMPTZ;
  v_last    JSONB;
BEGIN
  PERFORM public._guard_authorize();

  IF v_cron THEN
    EXECUTE $q$SELECT COALESCE(jsonb_agg(jsonb_build_object('name', jobname, 'schedule', schedule, 'active', active) ORDER BY jobname), '[]'::jsonb)
                FROM cron.job WHERE jobname IN ('guard-incremental', 'guard-full')$q$ INTO v_jobs;
  END IF;

  -- The next runs worked out from the settings (cron does not tell).
  v_next_i := CASE WHEN v_minutes >= 60
                   THEN date_trunc('hour', NOW()) + INTERVAL '1 hour'
                   ELSE date_trunc('hour', NOW()) + (floor(extract(minute FROM NOW()) / v_minutes) + 1) * v_minutes * INTERVAL '1 minute' END;
  v_next_f := (date_trunc('day', NOW() AT TIME ZONE 'UTC') + v_hour * INTERVAL '1 hour') AT TIME ZONE 'UTC';
  IF v_next_f <= NOW() THEN
    v_next_f := v_next_f + INTERVAL '1 day';
  END IF;

  SELECT to_jsonb(r) INTO v_last
  FROM (SELECT id, started_at, finished_at, status, new_count, open_count, resolved_count, since
        FROM public.guard_runs WHERE trigger = 'scheduled' ORDER BY started_at DESC LIMIT 1) r;

  RETURN jsonb_build_object('pg_cron_available', v_cron, 'settings', v_cfg, 'jobs', v_jobs,
                            'next_incremental', v_next_i, 'next_full', v_next_f, 'last_scheduled_run', v_last);
END;
$$;

-- An admin turns the automatic scan on or off and sets when it runs. Minutes 10, 15, 30 or 60; the
-- nightly hour 0 to 23 (UTC; 22 is 02:00 in Baku); retention 30 to 3650 days. Stores the settings,
-- (re)creates the jobs when pg_cron is there, writes audit_logs, returns the new state.
CREATE OR REPLACE FUNCTION public.guard_set_schedule(
  p_enabled             BOOLEAN,
  p_incremental_minutes INTEGER,
  p_nightly_hour_utc    INTEGER,
  p_retention_days      INTEGER
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old JSONB := public._guard_schedule_settings();
  v_new JSONB;
BEGIN
  PERFORM public._guard_authorize();
  IF p_enabled IS NULL THEN
    RAISE EXCEPTION 'invalid_schedule: enabled' USING ERRCODE = '22023';
  END IF;
  IF p_incremental_minutes IS NULL OR p_incremental_minutes NOT IN (10, 15, 30, 60) THEN
    RAISE EXCEPTION 'invalid_schedule: incremental_minutes' USING ERRCODE = '22023';
  END IF;
  IF p_nightly_hour_utc IS NULL OR p_nightly_hour_utc NOT BETWEEN 0 AND 23 THEN
    RAISE EXCEPTION 'invalid_schedule: nightly_hour_utc' USING ERRCODE = '22023';
  END IF;
  IF p_retention_days IS NULL OR p_retention_days NOT BETWEEN 30 AND 3650 THEN
    RAISE EXCEPTION 'invalid_schedule: retention_days' USING ERRCODE = '22023';
  END IF;

  v_new := jsonb_build_object('enabled', p_enabled, 'incremental_minutes', p_incremental_minutes,
                              'nightly_hour_utc', p_nightly_hour_utc, 'retention_days', p_retention_days);
  INSERT INTO public.system_settings (key, value, updated_at) VALUES ('accounting_guard', v_new, NOW())
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();

  PERFORM public.guard_apply_schedule();

  INSERT INTO public.audit_logs (user_id, action, module, table_name, record_id, old_values_json, new_values_json)
  VALUES (public.audit_request_user_id(), 'UPDATE', 'FINANCE', 'system_settings', NULL,
          jsonb_build_object('key', 'accounting_guard', 'value', v_old), jsonb_build_object('key', 'accounting_guard', 'value', v_new));

  RETURN public.guard_schedule_state();
END;
$$;

-- ─── 6. Access ──────────────────────────────────────────────────────────────

REVOKE ALL ON FUNCTION public._guard_schedule_settings() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_scheduled_run(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_apply_schedule() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.guard_schedule_state() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.guard_set_schedule(BOOLEAN, INTEGER, INTEGER, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._guard_schedule_settings() TO service_role;
GRANT EXECUTE ON FUNCTION public.guard_scheduled_run(TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.guard_apply_schedule() TO service_role;
GRANT EXECUTE ON FUNCTION public.guard_schedule_state() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.guard_set_schedule(BOOLEAN, INTEGER, INTEGER, INTEGER) TO authenticated, service_role;

-- ─── 7. The jobs, when pg_cron is there ─────────────────────────────────────

DO $$
BEGIN
  IF public.guard_apply_schedule() THEN
    RAISE NOTICE 'Accounting Guard: the pg_cron jobs guard-incremental and guard-full are set. They do nothing until an admin switches the automatic scan on (Accounting Guard > Rules > Automatic scan).';
  ELSE
    RAISE NOTICE 'Accounting Guard: pg_cron is not enabled in this database, so nothing is scheduled yet. To schedule: (1) enable pg_cron (Supabase: Database > Extensions > pg_cron); (2) open Accounting Guard > Rules > Automatic scan and press Save, or run SELECT public.guard_apply_schedule(); (3) switch the automatic scan on. Nothing runs by itself until you do.';
  END IF;
END
$$;

NOTIFY pgrst, 'reload schema';
