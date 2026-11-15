-- ============================================================================
-- Del Assistant memory (AST-3, docs/assistant/ASSISTANT-plan-and-prompts.md section 4). Needs
-- 20261005140000_ai_native_assistant.sql and 20261121100000_assistant_core.sql.
--
--   assistant_memory            short notes the assistant (or an admin) keeps about the company, each
--                               employee, customers and products. ONLY ADMINS can read the table (Del's
--                               decision, 2026-11-14): employees have no memory screen and cannot read notes.
--   assistant_memory_save       the one way to write a note (validated, forbidden topics refused, capped at
--                               5 000 notes). Admins: any note. Employees (the assistant on their behalf):
--                               only notes about themselves and about customers / products they may see.
--   assistant_memory_update     an admin edits a note (audited)
--   assistant_memory_delete     an admin deletes a note (audited)
--   assistant_memory_for_turn   the notes the server puts in one turn's prompt: company notes, the caller's
--                               own notes and the notes of the record in view that the caller may see. Used
--                               only to build the prompt, never returned to the browser.
--   assistant_memory_recall     the same visibility, searched by text (the recall tool)
--   assistant_memory_touch      marks notes as used (last_used_at, use_count)
--
-- The guard's notes (guard_agent_memory) are copied once into company notes; the old table stays.
-- Service-role callers (the server, the nightly job) have no auth.uid() and are trusted. Safe to re-run.
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('public.ai_conversations') IS NULL OR to_regprocedure('public.assistant_month_cost()') IS NULL THEN
    RAISE EXCEPTION 'Run supabase/migrations/20261121100000_assistant_core.sql (AST-1) before 20261121110000_assistant_memory.sql';
  END IF;
END
$$;

-- ─── 1. The notes ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.assistant_memory (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scope         TEXT NOT NULL,
  subject_id    UUID,
  kind          TEXT NOT NULL DEFAULT 'fact',
  subject       TEXT NOT NULL,
  body          TEXT NOT NULL,
  source        TEXT NOT NULL DEFAULT 'assistant',
  confidence    NUMERIC(3, 2) NOT NULL DEFAULT 1,
  evidence      JSONB NOT NULL DEFAULT '{}'::jsonb,
  use_count     INTEGER NOT NULL DEFAULT 0,
  last_used_at  TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ,
  created_by    UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT assistant_memory_scope_check CHECK (scope IN ('company', 'user', 'partner', 'product', 'employee_note')),
  CONSTRAINT assistant_memory_kind_check CHECK (kind IN ('fact', 'preference', 'pattern', 'skill_gap', 'routine')),
  CONSTRAINT assistant_memory_source_check CHECK (source IN ('assistant', 'admin', 'user')),
  CONSTRAINT assistant_memory_subject_check CHECK (char_length(btrim(subject)) BETWEEN 3 AND 120),
  CONSTRAINT assistant_memory_body_check CHECK (char_length(btrim(body)) BETWEEN 3 AND 1000),
  CONSTRAINT assistant_memory_confidence_check CHECK (confidence BETWEEN 0 AND 1),
  -- Company notes are about nobody in particular; every other scope names its user / partner / product.
  CONSTRAINT assistant_memory_subject_id_check CHECK ((scope = 'company') = (subject_id IS NULL))
);
-- One note per subject within a scope and its subject (case and spaces ignored): saving again updates it.
CREATE UNIQUE INDEX IF NOT EXISTS uq_assistant_memory_subject
  ON public.assistant_memory (scope, COALESCE(subject_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(btrim(subject)));
CREATE INDEX IF NOT EXISTS idx_assistant_memory_scope_subject ON public.assistant_memory (scope, subject_id);
CREATE INDEX IF NOT EXISTS idx_assistant_memory_updated ON public.assistant_memory (updated_at DESC);

-- Which one-time imports have run (so a re-run never brings back a note an admin deleted).
CREATE TABLE IF NOT EXISTS public.assistant_memory_imports (
  name   TEXT PRIMARY KEY,
  at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  rows   INTEGER NOT NULL DEFAULT 0
);

-- ─── 2. Access: admins read, nobody writes directly ─────────────────────────

ALTER TABLE public.assistant_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assistant_memory_imports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS assistant_memory_select ON public.assistant_memory;
CREATE POLICY assistant_memory_select ON public.assistant_memory
  FOR SELECT TO authenticated USING (public.is_active_user() AND public.user_is_admin());
REVOKE ALL ON public.assistant_memory, public.assistant_memory_imports FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.assistant_memory TO authenticated;
GRANT ALL ON public.assistant_memory, public.assistant_memory_imports TO service_role;

-- ─── 3. Helpers ─────────────────────────────────────────────────────────────

-- The server (service role, no auth.uid()) or an active admin.
CREATE OR REPLACE FUNCTION public._assistant_memory_is_admin()
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN TRUE;
  END IF;
  RETURN COALESCE(public.is_active_user() AND public.user_is_admin(), FALSE);
END;
$$;

-- May the caller see this customer / product? The same permission the screens ask for.
CREATE OR REPLACE FUNCTION public._assistant_memory_can_read(p_scope TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public._assistant_memory_is_admin() THEN
    RETURN TRUE;
  END IF;
  IF NOT COALESCE(public.is_active_user(), FALSE) THEN
    RETURN FALSE;
  END IF;
  RETURN CASE p_scope
    WHEN 'partner' THEN COALESCE(public.user_has_permission('can_view_customers'), FALSE)
    WHEN 'product' THEN COALESCE(public.user_has_permission('can_view_products'), FALSE)
    ELSE FALSE
  END;
END;
$$;

-- Topics that are never remembered (plan section 2.4), in az / en / ru / fa. The application filters the
-- same list first (src/lib/assistant/memory.ts); this is the last line for direct calls.
CREATE OR REPLACE FUNCTION public.assistant_memory_forbidden(p_text TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT lower(COALESCE(p_text, '')) ~ (
    'pass(word|code)|parol|şifr[əe]|пароль|رمز عبور|گذرواژه|api[ _-]?key|secret[ _-]?key|access[ _-]?token|pin[ -]?kod|'
    || 'diagnos|illness|sick leave|pregnan|xəstə|hamilə|болезн|беремен|диагноз|بیماری|باردار|'
    || 'religio|din[iə] |namaz|религи|مذهب|'
    || 'politic|siyasi|полити[кч]|سیاسی|'
    || 'off the record|не для записи|qeydə alma|محرمانه بماند|'
    || 'salary is (too )?(high|low)|maaşı (çox|az)|зарплата (слишком|завышен|занижен)|حقوقش (زیاد|کم)'
  );
$$;

-- ─── 4. Writing ─────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.assistant_memory_save(
  p_scope       TEXT,
  p_subject     TEXT,
  p_body        TEXT,
  p_kind        TEXT DEFAULT 'fact',
  p_subject_id  UUID DEFAULT NULL,
  p_source      TEXT DEFAULT 'assistant',
  p_confidence  NUMERIC DEFAULT 1,
  p_evidence    JSONB DEFAULT '{}'::jsonb,
  p_expires_at  TIMESTAMPTZ DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_admin   BOOLEAN := public._assistant_memory_is_admin();
  v_subject TEXT := regexp_replace(btrim(COALESCE(p_subject, '')), '[[:space:]]+', ' ', 'g');
  v_body    TEXT := btrim(COALESCE(p_body, ''));
  v_scope   TEXT := COALESCE(p_scope, '');
  v_sid     UUID := p_subject_id;
  v_source  TEXT := COALESCE(p_source, 'assistant');
  v_id      UUID;
  v_old     public.assistant_memory;
BEGIN
  IF v_uid IS NOT NULL AND NOT COALESCE(public.is_active_user(), FALSE) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_scope NOT IN ('company', 'user', 'partner', 'product', 'employee_note')
     OR COALESCE(p_kind, '') NOT IN ('fact', 'preference', 'pattern', 'skill_gap', 'routine')
     OR v_source NOT IN ('assistant', 'admin', 'user')
     OR char_length(v_subject) NOT BETWEEN 3 AND 120 OR char_length(v_body) NOT BETWEEN 3 AND 1000
     OR p_confidence IS NULL OR p_confidence NOT BETWEEN 0 AND 1 THEN
    RAISE EXCEPTION 'invalid_memory' USING ERRCODE = '22023';
  END IF;
  IF public.assistant_memory_forbidden(v_subject || ' ' || v_body) THEN
    RAISE EXCEPTION 'forbidden_memory' USING ERRCODE = '22023';
  END IF;
  IF v_scope = 'company' THEN
    v_sid := NULL;
  ELSIF v_scope = 'user' AND v_sid IS NULL THEN
    v_sid := v_uid;
  END IF;
  IF v_scope <> 'company' AND v_sid IS NULL THEN
    RAISE EXCEPTION 'invalid_memory' USING ERRCODE = '22023';
  END IF;

  -- An employee (the assistant on their behalf) writes only about themselves and records they may see.
  IF NOT v_admin THEN
    IF v_scope = 'user' THEN
      IF v_sid <> v_uid THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
      END IF;
    ELSIF v_scope IN ('partner', 'product') THEN
      IF NOT public._assistant_memory_can_read(v_scope) THEN
        RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
      END IF;
    ELSE
      RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
    END IF;
    IF v_source = 'admin' THEN
      v_source := 'user';
    END IF;
  END IF;

  SELECT * INTO v_old FROM public.assistant_memory
  WHERE scope = v_scope AND subject_id IS NOT DISTINCT FROM v_sid AND lower(btrim(subject)) = lower(v_subject)
  FOR UPDATE;
  IF v_old.id IS NOT NULL THEN
    UPDATE public.assistant_memory
    SET body = v_body, kind = p_kind, source = v_source, confidence = p_confidence,
        evidence = COALESCE(evidence, '{}'::jsonb) || COALESCE(p_evidence, '{}'::jsonb),
        expires_at = p_expires_at, updated_at = NOW()
    WHERE id = v_old.id;
    v_id := v_old.id;
  ELSE
    IF (SELECT count(*) FROM public.assistant_memory) >= 5000 THEN
      RAISE EXCEPTION 'memory_full' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.assistant_memory (scope, subject_id, kind, subject, body, source, confidence, evidence, expires_at, created_by)
    VALUES (v_scope, v_sid, p_kind, v_subject, v_body, v_source, p_confidence, COALESCE(p_evidence, '{}'::jsonb), p_expires_at, v_uid)
    RETURNING id INTO v_id;
  END IF;

  -- An admin's own edits are audited (the assistant's notes are many and visible on the memory page).
  IF v_uid IS NOT NULL AND v_admin AND v_source = 'admin' THEN
    INSERT INTO public.audit_logs (user_id, action, module, table_name, record_id, old_values_json, new_values_json)
    VALUES (v_uid, CASE WHEN v_old.id IS NULL THEN 'CREATE' ELSE 'UPDATE' END, 'SECURITY', 'assistant_memory', v_id,
            CASE WHEN v_old.id IS NULL THEN NULL ELSE jsonb_build_object('subject', v_old.subject, 'body', v_old.body) END,
            jsonb_build_object('scope', v_scope, 'subject_id', v_sid, 'subject', v_subject, 'body', v_body));
  END IF;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.assistant_memory_update(p_id UUID, p_subject TEXT, p_body TEXT, p_kind TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old     public.assistant_memory;
  v_subject TEXT := regexp_replace(btrim(COALESCE(p_subject, '')), '[[:space:]]+', ' ', 'g');
  v_body    TEXT := btrim(COALESCE(p_body, ''));
BEGIN
  IF NOT public._assistant_memory_is_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_old FROM public.assistant_memory WHERE id = p_id FOR UPDATE;
  IF v_old.id IS NULL THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  IF char_length(v_subject) NOT BETWEEN 3 AND 120 OR char_length(v_body) NOT BETWEEN 3 AND 1000
     OR (p_kind IS NOT NULL AND p_kind NOT IN ('fact', 'preference', 'pattern', 'skill_gap', 'routine')) THEN
    RAISE EXCEPTION 'invalid_memory' USING ERRCODE = '22023';
  END IF;
  IF public.assistant_memory_forbidden(v_subject || ' ' || v_body) THEN
    RAISE EXCEPTION 'forbidden_memory' USING ERRCODE = '22023';
  END IF;
  UPDATE public.assistant_memory
  SET subject = v_subject, body = v_body, kind = COALESCE(p_kind, kind), source = 'admin', confidence = 1, updated_at = NOW()
  WHERE id = p_id;
  INSERT INTO public.audit_logs (user_id, action, module, table_name, record_id, old_values_json, new_values_json)
  VALUES (auth.uid(), 'UPDATE', 'SECURITY', 'assistant_memory', p_id,
          jsonb_build_object('subject', v_old.subject, 'body', v_old.body, 'kind', v_old.kind),
          jsonb_build_object('subject', v_subject, 'body', v_body, 'kind', COALESCE(p_kind, v_old.kind)));
END;
$$;

CREATE OR REPLACE FUNCTION public.assistant_memory_delete(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old public.assistant_memory;
BEGIN
  IF NOT public._assistant_memory_is_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  DELETE FROM public.assistant_memory WHERE id = p_id RETURNING * INTO v_old;
  IF v_old.id IS NULL THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  INSERT INTO public.audit_logs (user_id, action, module, table_name, record_id, old_values_json, new_values_json)
  VALUES (auth.uid(), 'DELETE', 'SECURITY', 'assistant_memory', p_id,
          jsonb_build_object('scope', v_old.scope, 'subject_id', v_old.subject_id, 'subject', v_old.subject, 'body', v_old.body), NULL);
END;
$$;

-- ─── 5. Reading for a turn (server side only) ───────────────────────────────

-- The partner (customer) a record in view points to: the record itself, or a sale's customer.
CREATE OR REPLACE FUNCTION public._assistant_memory_partner_of(p_record_type TEXT, p_record_id UUID)
RETURNS UUID
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF p_record_id IS NULL THEN
    RETURN NULL;
  END IF;
  IF p_record_type = 'customer' THEN
    RETURN p_record_id;
  END IF;
  IF p_record_type = 'sale' AND to_regclass('public.sales') IS NOT NULL
     AND (public._assistant_memory_is_admin() OR COALESCE(public.user_has_permission('can_view_sales'), FALSE)) THEN
    EXECUTE 'SELECT customer_id FROM public.sales WHERE id = $1' INTO v_id USING p_record_id;
    RETURN v_id;
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.assistant_memory_for_turn(p_record_type TEXT DEFAULT NULL, p_record_id UUID DEFAULT NULL, p_limit INTEGER DEFAULT 40)
RETURNS TABLE (id UUID, scope TEXT, kind TEXT, subject TEXT, body TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     UUID := auth.uid();
  v_partner UUID := public._assistant_memory_partner_of(p_record_type, p_record_id);
  v_product UUID := CASE WHEN p_record_type = 'product' THEN p_record_id END;
BEGIN
  IF v_uid IS NOT NULL AND NOT COALESCE(public.is_active_user(), FALSE) THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT m.id, m.scope, m.kind, m.subject, m.body
  FROM public.assistant_memory m
  WHERE (m.expires_at IS NULL OR m.expires_at > NOW())
    AND (
      m.scope = 'company'
      OR (m.scope IN ('user', 'employee_note') AND m.subject_id = v_uid)
      OR (m.scope = 'partner' AND m.subject_id = v_partner AND public._assistant_memory_can_read('partner'))
      OR (m.scope = 'product' AND m.subject_id = v_product AND public._assistant_memory_can_read('product'))
    )
  ORDER BY (m.scope = 'company') ASC, m.last_used_at DESC NULLS LAST, m.updated_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 40), 1), 80);
END;
$$;

-- The recall tool: the same visibility (an admin sees all), searched by words of the subject and body.
CREATE OR REPLACE FUNCTION public.assistant_memory_recall(p_query TEXT, p_limit INTEGER DEFAULT 10)
RETURNS TABLE (id UUID, scope TEXT, subject_id UUID, kind TEXT, subject TEXT, body TEXT, updated_at TIMESTAMPTZ)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_admin BOOLEAN := public._assistant_memory_is_admin();
  v_q     TEXT := btrim(COALESCE(p_query, ''));
BEGIN
  IF v_uid IS NOT NULL AND NOT COALESCE(public.is_active_user(), FALSE) THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT m.id, m.scope, m.subject_id, m.kind, m.subject, m.body, m.updated_at
  FROM public.assistant_memory m
  WHERE (m.expires_at IS NULL OR m.expires_at > NOW())
    AND (
      v_admin
      OR m.scope = 'company'
      OR (m.scope IN ('user', 'employee_note') AND m.subject_id = v_uid)
      OR (m.scope = 'partner' AND public._assistant_memory_can_read('partner'))
      OR (m.scope = 'product' AND public._assistant_memory_can_read('product'))
    )
    AND (v_q = '' OR (m.subject || ' ' || m.body) ILIKE '%' || replace(replace(v_q, '%', ''), '_', '') || '%')
  ORDER BY m.updated_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 10), 1), 30);
END;
$$;

CREATE OR REPLACE FUNCTION public.assistant_memory_touch(p_ids UUID[])
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NOT NULL AND NOT COALESCE(public.is_active_user(), FALSE) THEN
    RETURN;
  END IF;
  IF p_ids IS NULL OR cardinality(p_ids) = 0 THEN
    RETURN;
  END IF;
  UPDATE public.assistant_memory
  SET last_used_at = NOW(), use_count = use_count + 1
  WHERE id = ANY (p_ids[1:80]);
END;
$$;

REVOKE ALL ON FUNCTION public._assistant_memory_is_admin(), public._assistant_memory_can_read(TEXT),
  public._assistant_memory_partner_of(TEXT, UUID), public.assistant_memory_forbidden(TEXT),
  public.assistant_memory_save(TEXT, TEXT, TEXT, TEXT, UUID, TEXT, NUMERIC, JSONB, TIMESTAMPTZ),
  public.assistant_memory_update(UUID, TEXT, TEXT, TEXT), public.assistant_memory_delete(UUID),
  public.assistant_memory_for_turn(TEXT, UUID, INTEGER), public.assistant_memory_recall(TEXT, INTEGER),
  public.assistant_memory_touch(UUID[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assistant_memory_forbidden(TEXT),
  public.assistant_memory_save(TEXT, TEXT, TEXT, TEXT, UUID, TEXT, NUMERIC, JSONB, TIMESTAMPTZ),
  public.assistant_memory_update(UUID, TEXT, TEXT, TEXT), public.assistant_memory_delete(UUID),
  public.assistant_memory_for_turn(TEXT, UUID, INTEGER), public.assistant_memory_recall(TEXT, INTEGER),
  public.assistant_memory_touch(UUID[]) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._assistant_memory_is_admin(), public._assistant_memory_can_read(TEXT),
  public._assistant_memory_partner_of(TEXT, UUID) TO service_role;

-- ─── 6. The guard's notes become company notes (once) ───────────────────────

DO $$
DECLARE
  v_rows INTEGER := 0;
BEGIN
  IF to_regclass('public.guard_agent_memory') IS NULL THEN
    RETURN;
  END IF;
  INSERT INTO public.assistant_memory_imports (name) VALUES ('guard_agent_memory') ON CONFLICT (name) DO NOTHING;
  IF NOT FOUND THEN
    RETURN; -- already copied: a re-run never brings back a note an admin deleted
  END IF;
  INSERT INTO public.assistant_memory (scope, subject_id, kind, subject, body, source, confidence, evidence, created_by, created_at, updated_at)
  SELECT 'company', NULL, g.kind, left(btrim(g.subject), 120), left(btrim(g.body), 1000),
         CASE WHEN g.source = 'admin' THEN 'admin' ELSE 'assistant' END, 1,
         jsonb_build_object('guard_memory_id', g.id), g.created_by, g.created_at, g.updated_at
  FROM public.guard_agent_memory g
  WHERE char_length(btrim(g.body)) >= 3
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  UPDATE public.assistant_memory_imports SET rows = v_rows WHERE name = 'guard_agent_memory';
END
$$;

NOTIFY pgrst, 'reload schema';
