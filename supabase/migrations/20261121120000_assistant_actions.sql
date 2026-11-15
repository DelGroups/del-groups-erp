-- ============================================================================
-- Del Assistant proposals (AST-4, docs/assistant/ASSISTANT-plan-and-prompts.md section 2, principle 2).
-- Needs 20261121100000_assistant_core.sql.
--
-- The assistant never writes documents. It PROPOSES one: the server stores the proposal (only the server
-- can insert), the panel shows every field, and only when the user presses "Create draft" does their own
-- browser save a DRAFT with the same functions the forms use, under their own session. Posting stays a
-- button on the document. No deletes, no reversals, no payments that move money.
--
--   assistant_proposals            one proposal per row: kind, payload, its SHA-256 fingerprint, amount,
--                                  status proposed → confirming → confirmed | failed, or rejected / expired
--   assistant_proposal_claim       the user's "Create draft": own proposal, still proposed, not expired
--                                  (24 h), the fingerprint of what they saw matches, they still have the
--                                  permission, a second confirm above the amount limit. Atomic: one claim
--                                  per proposal, so a double click makes one draft. Returns the stored payload.
--   assistant_proposal_finish      records what happened (the draft's id and number, or the error) and writes
--                                  the audit line "via: assistant"
--   assistant_proposal_reject      the user's "Cancel"
--
-- Users read only their own proposals; nobody writes the table directly. Safe to re-run.
-- ============================================================================

DO $$
BEGIN
  IF to_regclass('public.ai_conversations') IS NULL OR to_regprocedure('public.assistant_month_cost()') IS NULL THEN
    RAISE EXCEPTION 'Run supabase/migrations/20261121100000_assistant_core.sql (AST-1) before 20261121120000_assistant_actions.sql';
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS public.assistant_proposals (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id         UUID REFERENCES public.ai_conversations(id) ON DELETE SET NULL,
  kind                    TEXT NOT NULL,
  payload                 JSONB NOT NULL,
  payload_hash            TEXT NOT NULL,
  summary                 TEXT NOT NULL DEFAULT '',
  amount                  NUMERIC(14, 2) NOT NULL DEFAULT 0,
  second_confirm_required BOOLEAN NOT NULL DEFAULT FALSE,
  idempotency_key         TEXT NOT NULL,
  status                  TEXT NOT NULL DEFAULT 'proposed',
  result                  JSONB,
  error                   TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  decided_at              TIMESTAMPTZ,
  expires_at              TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  CONSTRAINT assistant_proposals_kind_check CHECK (kind IN ('sale_draft', 'purchase_draft', 'customer', 'expense_draft')),
  CONSTRAINT assistant_proposals_status_check CHECK (status IN ('proposed', 'confirming', 'confirmed', 'rejected', 'expired', 'failed')),
  CONSTRAINT assistant_proposals_hash_check CHECK (payload_hash ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_assistant_proposals_idempotency ON public.assistant_proposals (idempotency_key);
CREATE INDEX IF NOT EXISTS idx_assistant_proposals_user ON public.assistant_proposals (user_id, created_at DESC);

ALTER TABLE public.assistant_proposals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS assistant_proposals_select ON public.assistant_proposals;
CREATE POLICY assistant_proposals_select ON public.assistant_proposals
  FOR SELECT TO authenticated USING (public.is_active_user() AND user_id = auth.uid());
REVOKE ALL ON public.assistant_proposals FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.assistant_proposals TO authenticated;
GRANT ALL ON public.assistant_proposals TO service_role;

-- The permission each kind needs: the same one the form's page asks for.
CREATE OR REPLACE FUNCTION public._assistant_proposal_permission(p_kind TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE p_kind
    WHEN 'sale_draft' THEN 'can_create_invoice'
    WHEN 'purchase_draft' THEN 'can_create_purchase'
    WHEN 'customer' THEN 'can_manage_customers'
    WHEN 'expense_draft' THEN 'can_manage_expenses'
  END;
$$;

CREATE OR REPLACE FUNCTION public.assistant_proposal_claim(p_id UUID, p_hash TEXT, p_second_confirm BOOLEAN DEFAULT FALSE)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_p   public.assistant_proposals;
BEGIN
  IF v_uid IS NULL OR NOT COALESCE(public.is_active_user(), FALSE) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_p FROM public.assistant_proposals WHERE id = p_id FOR UPDATE;
  -- Someone else's proposal looks exactly like a missing one.
  IF v_p.id IS NULL OR v_p.user_id <> v_uid THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_p.status <> 'proposed' THEN
    RAISE EXCEPTION 'already_decided' USING ERRCODE = '55000';
  END IF;
  IF v_p.expires_at <= NOW() THEN
    UPDATE public.assistant_proposals SET status = 'expired', decided_at = NOW() WHERE id = p_id;
    RETURN jsonb_build_object('error', 'expired');
  END IF;
  IF p_hash IS NULL OR lower(p_hash) <> v_p.payload_hash THEN
    RAISE EXCEPTION 'hash_mismatch' USING ERRCODE = '22023';
  END IF;
  IF NOT (COALESCE(public.user_is_admin(), FALSE) OR COALESCE(public.has_permission(public._assistant_proposal_permission(v_p.kind)), FALSE)) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_p.second_confirm_required AND NOT COALESCE(p_second_confirm, FALSE) THEN
    RAISE EXCEPTION 'second_confirm_required' USING ERRCODE = '22023';
  END IF;
  UPDATE public.assistant_proposals SET status = 'confirming', decided_at = NOW() WHERE id = p_id;
  RETURN jsonb_build_object('kind', v_p.kind, 'payload', v_p.payload, 'idempotency_key', v_p.idempotency_key);
END;
$$;

CREATE OR REPLACE FUNCTION public.assistant_proposal_finish(p_id UUID, p_ok BOOLEAN, p_result JSONB DEFAULT NULL, p_error TEXT DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_p   public.assistant_proposals;
  v_record UUID;
BEGIN
  IF v_uid IS NULL OR NOT COALESCE(public.is_active_user(), FALSE) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_p FROM public.assistant_proposals WHERE id = p_id FOR UPDATE;
  IF v_p.id IS NULL OR v_p.user_id <> v_uid THEN
    RAISE EXCEPTION 'not_found' USING ERRCODE = 'P0002';
  END IF;
  IF v_p.status <> 'confirming' THEN
    RAISE EXCEPTION 'not_confirming' USING ERRCODE = '55000';
  END IF;
  UPDATE public.assistant_proposals
  SET status = CASE WHEN p_ok THEN 'confirmed' ELSE 'failed' END,
      result = CASE WHEN p_ok THEN COALESCE(p_result, '{}'::jsonb) ELSE NULL END,
      error = CASE WHEN p_ok THEN NULL ELSE left(COALESCE(p_error, 'failed'), 500) END
  WHERE id = p_id;
  IF p_ok THEN
    BEGIN
      v_record := NULLIF(p_result ->> 'id', '')::uuid;
    EXCEPTION WHEN others THEN
      v_record := NULL;
    END;
    INSERT INTO public.audit_logs (user_id, action, module, table_name, record_id, old_values_json, new_values_json)
    VALUES (v_uid, 'CREATE', CASE WHEN v_p.kind = 'customer' THEN 'SECURITY' ELSE 'FINANCE' END, 'assistant_proposals', p_id, NULL,
            jsonb_build_object('via', 'assistant', 'kind', v_p.kind, 'proposal_id', p_id, 'record_id', v_record,
                               'doc_no', p_result ->> 'docNo', 'amount', v_p.amount, 'status', 'draft'));
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.assistant_proposal_reject(p_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL OR NOT COALESCE(public.is_active_user(), FALSE) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  UPDATE public.assistant_proposals SET status = 'rejected', decided_at = NOW()
  WHERE id = p_id AND user_id = v_uid AND status = 'proposed';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'already_decided' USING ERRCODE = '55000';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public._assistant_proposal_permission(TEXT), public.assistant_proposal_claim(UUID, TEXT, BOOLEAN),
  public.assistant_proposal_finish(UUID, BOOLEAN, JSONB, TEXT), public.assistant_proposal_reject(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assistant_proposal_claim(UUID, TEXT, BOOLEAN), public.assistant_proposal_finish(UUID, BOOLEAN, JSONB, TEXT),
  public.assistant_proposal_reject(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._assistant_proposal_permission(TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';
