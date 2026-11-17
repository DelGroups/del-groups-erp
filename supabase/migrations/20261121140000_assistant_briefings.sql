-- ============================================================================
-- Del Assistant morning briefing (AST-6, docs/assistant/ASSISTANT-plan-and-prompts.md). Needs
-- 20261121100000_assistant_core.sql.
--
-- Every morning a nightly job (the server, service role) writes one short briefing for each active admin
-- and each user who may see financial reports: yesterday's sales against the usual, cash, overdue
-- receivables, stock risks, new guard findings and three suggestions with links. The panel shows it as the
-- first message of the day.
--
--   assistant_briefings            one row per person and day; each person reads only their own
--   assistant_briefing_seen(id)    marks the caller's own briefing as read (nothing else can change)
--
-- Writes only from the server. Safe to re-run.
-- ============================================================================

DO $$
BEGIN
  IF to_regprocedure('public.assistant_month_cost()') IS NULL THEN
    RAISE EXCEPTION 'Run supabase/migrations/20261121100000_assistant_core.sql (AST-1) before 20261121140000_assistant_briefings.sql';
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.assistant_briefings (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  day         DATE NOT NULL,
  language    TEXT NOT NULL,
  body        TEXT NOT NULL,
  all_well    BOOLEAN NOT NULL DEFAULT FALSE,
  facts       JSONB NOT NULL DEFAULT '{}'::jsonb,
  links       JSONB NOT NULL DEFAULT '[]'::jsonb,
  model       TEXT,
  seen_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT assistant_briefings_user_day UNIQUE (user_id, day),
  CONSTRAINT assistant_briefings_language_check CHECK (language IN ('az', 'en', 'ru')),
  CONSTRAINT assistant_briefings_body_check CHECK (char_length(body) BETWEEN 1 AND 6000),
  CONSTRAINT assistant_briefings_links_check CHECK (jsonb_typeof(links) = 'array')
);
CREATE INDEX IF NOT EXISTS idx_assistant_briefings_user_day ON public.assistant_briefings (user_id, day DESC);

ALTER TABLE public.assistant_briefings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS assistant_briefings_select_own ON public.assistant_briefings;
CREATE POLICY assistant_briefings_select_own ON public.assistant_briefings
  FOR SELECT TO authenticated USING (public.is_active_user() AND user_id = auth.uid());
REVOKE ALL ON public.assistant_briefings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.assistant_briefings TO authenticated;
GRANT ALL ON public.assistant_briefings TO service_role;

CREATE OR REPLACE FUNCTION public.assistant_briefing_seen(p_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count INTEGER;
BEGIN
  IF auth.uid() IS NULL OR NOT COALESCE(public.is_active_user(), FALSE) THEN
    RETURN FALSE;
  END IF;
  UPDATE public.assistant_briefings
  SET seen_at = COALESCE(seen_at, NOW())
  WHERE id = p_id AND user_id = auth.uid();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.assistant_briefing_seen(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assistant_briefing_seen(UUID) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
