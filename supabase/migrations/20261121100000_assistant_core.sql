-- ============================================================================
-- Del Assistant core (AST-1, docs/assistant/ASSISTANT-plan-and-prompts.md). Needs the native assistant
-- tables (20261005140000_ai_native_assistant.sql).
--
--   ai_conversations.context   what the user was looking at (page, record type and id) when they asked
--   ai_usage_log.source        which assistant wrote the row: 'assistant_v1' (old) or 'assistant_v2'
--   assistant_month_cost()     what Del Assistant cost this month (UTC), for its monthly budget;
--                              admins and the server only
--
-- Adds two columns and one read-only function; changes no data and no existing behaviour. Safe to re-run.
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('public.ai_conversations') IS NULL OR to_regclass('public.ai_usage_log') IS NULL THEN
    RAISE EXCEPTION 'Run supabase/migrations/20261005140000_ai_native_assistant.sql before 20261121100000_assistant_core.sql';
  END IF;
END
$$;

ALTER TABLE public.ai_conversations ADD COLUMN IF NOT EXISTS context JSONB;
ALTER TABLE public.ai_usage_log ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'assistant_v1';
CREATE INDEX IF NOT EXISTS idx_ai_usage_log_source_created ON public.ai_usage_log (source, created_at DESC);

CREATE OR REPLACE FUNCTION public.assistant_month_cost()
RETURNS NUMERIC
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- A signed-in caller must be an active admin; the server (service role, no auth.uid()) is trusted.
  IF auth.uid() IS NOT NULL AND NOT COALESCE(public.is_active_user() AND public.user_is_admin(), FALSE) THEN
    RAISE EXCEPTION '%', 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE((
    SELECT sum(cost_usd) FROM public.ai_usage_log
    WHERE source = 'assistant_v2'
      AND created_at >= date_trunc('month', NOW() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
  ), 0);
END;
$$;

REVOKE ALL ON FUNCTION public.assistant_month_cost() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assistant_month_cost() TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
