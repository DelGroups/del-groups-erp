-- Upgrade phase 1: native AI assistant (Claude API) — conversation history and usage log.
--
-- Used by src/lib/ai/native/store.ts through the signed-in user's client, so
-- every policy is "own rows only". Administrators can read everybody's usage
-- log (cost control), but nobody can edit or delete it: it is an audit trail.
--
-- The assistant keeps working without this migration (it only skips history),
-- so it can be applied at any time. Idempotent: safe to run more than once.

BEGIN;

CREATE TABLE IF NOT EXISTS public.ai_conversations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  title       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_conversations_user
  ON public.ai_conversations (user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.ai_messages (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  UUID NOT NULL REFERENCES public.ai_conversations(id) ON DELETE CASCADE,
  user_id          UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  role             TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content          TEXT NOT NULL,
  model            TEXT,
  tier             TEXT,
  -- Tool calls the assistant made for this answer: [{tool, ok, summary}]
  steps            JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_messages_conversation
  ON public.ai_messages (conversation_id, created_at);

CREATE TABLE IF NOT EXISTS public.ai_usage_log (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id     UUID REFERENCES public.ai_conversations(id) ON DELETE SET NULL,
  model               TEXT,
  tier                TEXT,
  route_reason        TEXT,
  input_tokens        INTEGER NOT NULL DEFAULT 0,
  output_tokens       INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens   INTEGER NOT NULL DEFAULT 0,
  cache_write_tokens  INTEGER NOT NULL DEFAULT 0,
  cost_usd            NUMERIC(12, 6),
  tool_calls          INTEGER NOT NULL DEFAULT 0,
  latency_ms          INTEGER,
  status              TEXT NOT NULL DEFAULT 'ok',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_log_created
  ON public.ai_usage_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_usage_log_user
  ON public.ai_usage_log (user_id, created_at DESC);

-- ─── RLS ─────────────────────────────────────────────────────────────────────

ALTER TABLE public.ai_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_usage_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_conversations_select ON public.ai_conversations;
CREATE POLICY ai_conversations_select ON public.ai_conversations
  FOR SELECT TO authenticated
  USING (public.is_active_user() AND user_id = auth.uid());

DROP POLICY IF EXISTS ai_conversations_insert ON public.ai_conversations;
CREATE POLICY ai_conversations_insert ON public.ai_conversations
  FOR INSERT TO authenticated
  WITH CHECK (public.is_active_user() AND user_id = auth.uid());

DROP POLICY IF EXISTS ai_conversations_update ON public.ai_conversations;
CREATE POLICY ai_conversations_update ON public.ai_conversations
  FOR UPDATE TO authenticated
  USING (public.is_active_user() AND user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS ai_conversations_delete ON public.ai_conversations;
CREATE POLICY ai_conversations_delete ON public.ai_conversations
  FOR DELETE TO authenticated
  USING (public.is_active_user() AND user_id = auth.uid());

DROP POLICY IF EXISTS ai_messages_select ON public.ai_messages;
CREATE POLICY ai_messages_select ON public.ai_messages
  FOR SELECT TO authenticated
  USING (public.is_active_user() AND user_id = auth.uid());

-- A message can only be added to one of the user's own conversations.
DROP POLICY IF EXISTS ai_messages_insert ON public.ai_messages;
CREATE POLICY ai_messages_insert ON public.ai_messages
  FOR INSERT TO authenticated
  WITH CHECK (
    public.is_active_user()
    AND user_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.ai_conversations c
      WHERE c.id = conversation_id AND c.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS ai_usage_log_select ON public.ai_usage_log;
CREATE POLICY ai_usage_log_select ON public.ai_usage_log
  FOR SELECT TO authenticated
  USING (public.is_active_user() AND (user_id = auth.uid() OR public.user_is_admin()));

DROP POLICY IF EXISTS ai_usage_log_insert ON public.ai_usage_log;
CREATE POLICY ai_usage_log_insert ON public.ai_usage_log
  FOR INSERT TO authenticated
  WITH CHECK (public.is_active_user() AND user_id = auth.uid());

-- No UPDATE/DELETE policies on ai_messages or ai_usage_log: append-only.

REVOKE ALL ON TABLE public.ai_conversations FROM anon;
REVOKE ALL ON TABLE public.ai_messages FROM anon;
REVOKE ALL ON TABLE public.ai_usage_log FROM anon;

COMMIT;

NOTIFY pgrst, 'reload schema';
