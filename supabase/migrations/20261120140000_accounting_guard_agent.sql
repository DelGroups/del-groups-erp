-- ============================================================================
-- Accounting Guard, the accountant agent (GUARD-5). Needs GUARD-1
-- (20261120100000_accounting_guard_core.sql) and GUARD-3 (20261120120000_accounting_guard_ui.sql,
-- which created guard_reports). Plan: docs/accounting-guard-plan.md.
--
-- The agent (Claude, through the server) reads the findings and the books like a senior accountant
-- and writes saved reports. It NEVER posts, edits, reverses or deletes business data: its tools are
-- read-only, and what it may write is only its own notes (memory), a "this may not be an error"
-- suggestion on a finding, and its reports. An admin confirms or dismisses every suggestion.
--
-- What this file adds:
--   guard_agent_memory      what the agent has learned about the company (and what an admin told it):
--                           short notes with a subject, editable and deletable by admins
--   guard_ai_usage          every call of the agent (reports and chats) with tokens and cost, for the
--                           monthly budget and the cost figures
--   guard_findings.agent_suggestion   the agent's "not an error" suggestion for a finding (an admin confirms)
--   guard_memory_save / guard_memory_delete / guard_set_agent_suggestion / guard_ai_month_cost
-- Admins only, like the rest of the guard; service-role callers (the server, the scheduled job) have no
-- auth.uid() and are trusted. Safe to re-run.
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('public.guard_findings') IS NULL OR to_regclass('public.guard_reports') IS NULL THEN
    RAISE EXCEPTION 'Run supabase/migrations/20261120100000_accounting_guard_core.sql (GUARD-1) and 20261120120000_accounting_guard_ui.sql (GUARD-3) before 20261120140000_accounting_guard_agent.sql';
  END IF;
END
$$;

-- ─── 1. Memory ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.guard_agent_memory (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        TEXT NOT NULL DEFAULT 'fact',
  subject     TEXT NOT NULL,
  body        TEXT NOT NULL,
  source      TEXT NOT NULL DEFAULT 'agent',
  source_ref  UUID,
  entity_type TEXT,
  entity_id   UUID,
  created_by  UUID,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT guard_agent_memory_kind_check CHECK (kind IN ('fact', 'pattern', 'preference')),
  CONSTRAINT guard_agent_memory_source_check CHECK (source IN ('agent', 'admin')),
  CONSTRAINT guard_agent_memory_subject_check CHECK (char_length(btrim(subject)) BETWEEN 3 AND 120),
  CONSTRAINT guard_agent_memory_body_check CHECK (char_length(btrim(body)) BETWEEN 3 AND 2000)
);
-- One note per subject (case and spaces ignored): saving the same subject again updates the note.
CREATE UNIQUE INDEX IF NOT EXISTS uq_guard_agent_memory_subject ON public.guard_agent_memory (lower(btrim(subject)));
CREATE INDEX IF NOT EXISTS idx_guard_agent_memory_updated ON public.guard_agent_memory (updated_at DESC);

-- ─── 2. The agent's calls ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.guard_ai_usage (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  kind               TEXT NOT NULL,
  model              TEXT,
  tier               TEXT,
  input_tokens       INTEGER NOT NULL DEFAULT 0,
  output_tokens      INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens  INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens INTEGER NOT NULL DEFAULT 0,
  cost_usd           NUMERIC,
  tool_calls         INTEGER NOT NULL DEFAULT 0,
  status             TEXT NOT NULL DEFAULT 'ok',
  report_id          UUID REFERENCES public.guard_reports (id) ON DELETE SET NULL,
  user_id            UUID,
  conversation_id    UUID,
  CONSTRAINT guard_ai_usage_kind_check CHECK (kind IN ('daily', 'monthly', 'on_demand', 'chat'))
);
CREATE INDEX IF NOT EXISTS idx_guard_ai_usage_at ON public.guard_ai_usage (at DESC);

-- ─── 3. The agent's suggestion on a finding ─────────────────────────────────

ALTER TABLE public.guard_findings ADD COLUMN IF NOT EXISTS agent_suggestion JSONB;

-- ─── 4. Access ──────────────────────────────────────────────────────────────

ALTER TABLE public.guard_agent_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guard_ai_usage ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS guard_agent_memory_select ON public.guard_agent_memory;
CREATE POLICY guard_agent_memory_select ON public.guard_agent_memory FOR SELECT TO authenticated USING (public._guard_is_admin());
DROP POLICY IF EXISTS guard_ai_usage_select ON public.guard_ai_usage;
CREATE POLICY guard_ai_usage_select ON public.guard_ai_usage FOR SELECT TO authenticated USING (public._guard_is_admin());
REVOKE ALL ON public.guard_agent_memory, public.guard_ai_usage FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.guard_agent_memory, public.guard_ai_usage TO authenticated;
GRANT ALL ON public.guard_agent_memory, public.guard_ai_usage TO service_role;

-- ─── 5. Functions ───────────────────────────────────────────────────────────

-- Saves a note: a new one, or an update of the note with the same subject. At most 500 notes. Returns its id.
CREATE OR REPLACE FUNCTION public.guard_memory_save(
  p_subject     TEXT,
  p_body        TEXT,
  p_kind        TEXT DEFAULT 'fact',
  p_source      TEXT DEFAULT 'agent',
  p_source_ref  UUID DEFAULT NULL,
  p_entity_type TEXT DEFAULT NULL,
  p_entity_id   UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_subject TEXT := regexp_replace(btrim(COALESCE(p_subject, '')), '[[:space:]]+', ' ', 'g');
  v_body    TEXT := btrim(COALESCE(p_body, ''));
  v_id      UUID;
BEGIN
  PERFORM public._guard_authorize();
  IF char_length(v_subject) NOT BETWEEN 3 AND 120 OR char_length(v_body) NOT BETWEEN 3 AND 2000 THEN
    RAISE EXCEPTION 'invalid_memory' USING ERRCODE = '22023';
  END IF;
  IF p_kind IS NULL OR p_kind NOT IN ('fact', 'pattern', 'preference') OR p_source IS NULL OR p_source NOT IN ('agent', 'admin') THEN
    RAISE EXCEPTION 'invalid_memory' USING ERRCODE = '22023';
  END IF;

  SELECT id INTO v_id FROM public.guard_agent_memory WHERE lower(btrim(subject)) = lower(v_subject) FOR UPDATE;
  IF v_id IS NOT NULL THEN
    UPDATE public.guard_agent_memory
    SET body = v_body, kind = p_kind, source = p_source, source_ref = COALESCE(p_source_ref, source_ref),
        entity_type = COALESCE(p_entity_type, entity_type), entity_id = COALESCE(p_entity_id, entity_id), updated_at = NOW()
    WHERE id = v_id;
    RETURN v_id;
  END IF;
  IF (SELECT count(*) FROM public.guard_agent_memory) >= 500 THEN
    RAISE EXCEPTION 'memory_full' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.guard_agent_memory (kind, subject, body, source, source_ref, entity_type, entity_id, created_by)
  VALUES (p_kind, v_subject, v_body, p_source, p_source_ref, p_entity_type, p_entity_id, auth.uid())
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- An admin (or the server) removes a note. The agent has no tool for this.
CREATE OR REPLACE FUNCTION public.guard_memory_delete(p_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_n INTEGER;
BEGIN
  PERFORM public._guard_authorize();
  DELETE FROM public.guard_agent_memory WHERE id = p_id;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n > 0;
END;
$$;

-- The agent suggests that a finding is not an error (status 'false_positive', with a reason), or an admin
-- dismisses the suggestion (NULL). The finding's own status does not change: only an admin does that.
CREATE OR REPLACE FUNCTION public.guard_set_agent_suggestion(p_id UUID, p_suggestion JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_status TEXT;
  v_reason TEXT;
BEGIN
  PERFORM public._guard_authorize();
  SELECT status INTO v_status FROM public.guard_findings WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'finding_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF p_suggestion IS NULL OR jsonb_typeof(p_suggestion) = 'null' THEN
    UPDATE public.guard_findings SET agent_suggestion = NULL WHERE id = p_id;
    RETURN TRUE;
  END IF;
  IF jsonb_typeof(p_suggestion) <> 'object' OR p_suggestion ->> 'status' IS DISTINCT FROM 'false_positive' THEN
    RAISE EXCEPTION 'invalid_suggestion' USING ERRCODE = '22023';
  END IF;
  v_reason := btrim(COALESCE(p_suggestion ->> 'reason', ''));
  IF char_length(v_reason) NOT BETWEEN 3 AND 500 THEN
    RAISE EXCEPTION 'invalid_suggestion' USING ERRCODE = '22023';
  END IF;
  IF v_status NOT IN ('open', 'acknowledged') THEN
    RETURN FALSE;
  END IF;
  UPDATE public.guard_findings
  SET agent_suggestion = jsonb_build_object('status', 'false_positive', 'reason', v_reason, 'at', NOW(), 'report_id', p_suggestion -> 'report_id')
  WHERE id = p_id;
  RETURN TRUE;
END;
$$;

-- What the agent has cost this month (UTC), for the monthly budget.
CREATE OR REPLACE FUNCTION public.guard_ai_month_cost()
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public._guard_authorize();
  RETURN COALESCE((SELECT sum(cost_usd) FROM public.guard_ai_usage WHERE at >= date_trunc('month', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'), 0);
END;
$$;

REVOKE ALL ON FUNCTION public.guard_memory_save(TEXT, TEXT, TEXT, TEXT, UUID, TEXT, UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.guard_memory_delete(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.guard_set_agent_suggestion(UUID, JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.guard_ai_month_cost() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.guard_memory_save(TEXT, TEXT, TEXT, TEXT, UUID, TEXT, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.guard_memory_delete(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.guard_set_agent_suggestion(UUID, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.guard_ai_month_cost() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
