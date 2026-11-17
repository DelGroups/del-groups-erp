-- ============================================================================
-- Del Assistant active watch (AST-5, docs/assistant/ASSISTANT-plan-and-prompts.md section 5). Needs
-- 20261121100000_assistant_core.sql and the Accounting Guard (20261120100000_accounting_guard_core.sql).
--
-- While an employee fills a sales or purchase document, rules in the browser warn at once (no LLM). This
-- migration gives them the few facts they cannot see on the form, and keeps a log of what the warnings did:
--
--   assistant_watch_context(doc_type, partner, products)   one call per form: the guard's thresholds, closed
--                       months, each product's cost (buy price) and this partner's usual price and quantity,
--                       and this partner's recent posted documents (duplicates, unusual totals). Only for a
--                       user who may create that document; cost only for a user who may see products.
--   assistant_watch_events   shown / fixed / ignored / why per warning code (the nightly learning reads it)
--   assistant_my_document_findings(type, id)   open guard findings on a document the caller saved (or any,
--                       for an admin): "the document you just saved has a problem"
--
-- Reads only; writes only the caller's own watch events. Safe to re-run.
-- ============================================================================

DO $$
BEGIN
  IF to_regprocedure('public.assistant_month_cost()') IS NULL THEN
    RAISE EXCEPTION 'Run supabase/migrations/20261121100000_assistant_core.sql (AST-1) before 20261121130000_assistant_watch.sql';
  END IF;
END
$$;

-- ─── 1. What the warnings did ───────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.assistant_watch_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  form        TEXT NOT NULL,
  doc_type    TEXT NOT NULL,
  code        TEXT NOT NULL,
  action      TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT assistant_watch_events_doc_type_check CHECK (doc_type IN ('sale', 'purchase')),
  CONSTRAINT assistant_watch_events_action_check CHECK (action IN ('shown', 'fixed', 'ignored', 'why')),
  CONSTRAINT assistant_watch_events_code_check CHECK (code ~ '^[a-z0-9_]{2,40}$'),
  CONSTRAINT assistant_watch_events_form_check CHECK (char_length(form) BETWEEN 1 AND 60)
);
CREATE INDEX IF NOT EXISTS idx_assistant_watch_events_user ON public.assistant_watch_events (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_assistant_watch_events_code ON public.assistant_watch_events (code, action, created_at DESC);

ALTER TABLE public.assistant_watch_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS assistant_watch_events_insert ON public.assistant_watch_events;
CREATE POLICY assistant_watch_events_insert ON public.assistant_watch_events
  FOR INSERT TO authenticated WITH CHECK (public.is_active_user() AND user_id = auth.uid());
DROP POLICY IF EXISTS assistant_watch_events_select ON public.assistant_watch_events;
CREATE POLICY assistant_watch_events_select ON public.assistant_watch_events
  FOR SELECT TO authenticated USING (public.is_active_user() AND public.user_is_admin());
REVOKE ALL ON public.assistant_watch_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT ON public.assistant_watch_events TO authenticated;
GRANT ALL ON public.assistant_watch_events TO service_role;

-- ─── 2. The facts of one form ───────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public._assistant_watch_allowed(p_permission TEXT)
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
  RETURN COALESCE(public.is_active_user(), FALSE) AND (COALESCE(public.user_is_admin(), FALSE) OR COALESCE(public.has_permission(p_permission), FALSE));
END;
$$;

CREATE OR REPLACE FUNCTION public.assistant_watch_context(p_doc_type TEXT, p_partner_id UUID DEFAULT NULL, p_product_ids UUID[] DEFAULT '{}')
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_params   JSONB := '{}'::jsonb;
  v_closed   JSONB := '[]'::jsonb;
  v_products JSONB := '{}'::jsonb;
  v_partner  JSONB := NULL;
  v_cost_ok  BOOLEAN;
  v_ids      UUID[] := COALESCE(p_product_ids[1:100], '{}');
BEGIN
  IF p_doc_type NOT IN ('sale', 'purchase') THEN
    RAISE EXCEPTION 'invalid_doc_type' USING ERRCODE = '22023';
  END IF;
  IF NOT public._assistant_watch_allowed(CASE p_doc_type WHEN 'sale' THEN 'can_create_invoice' ELSE 'can_create_purchase' END) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_cost_ok := public._assistant_watch_allowed('can_view_products');

  -- The guard's thresholds, so "before save" and "after save" agree.
  IF to_regclass('public.guard_rules') IS NOT NULL THEN
    SELECT COALESCE(jsonb_object_agg(code, jsonb_build_object('enabled', enabled, 'params', params)), '{}'::jsonb)
    INTO v_params FROM public.guard_rules WHERE code IN ('B1', 'B2', 'B4', 'B6', 'B7');
  END IF;

  -- Closed months (accounting periods), as "YYYY-MM".
  IF to_regclass('public.accounting_periods') IS NOT NULL THEN
    SELECT COALESCE(jsonb_agg(format('%s-%s', period_year, lpad(period_month::text, 2, '0')) ORDER BY period_year, period_month), '[]'::jsonb)
    INTO v_closed FROM public.accounting_periods WHERE status = 'closed';
  END IF;

  -- Each product: unit, sale price, cost (buy price, only with the products permission) and this partner's
  -- usual price and quantity over their last 10 posted lines.
  IF cardinality(v_ids) > 0 THEN
    IF p_doc_type = 'sale' THEN
      SELECT COALESCE(jsonb_object_agg(p.id, jsonb_build_object(
               'unit', p.unit,
               'sell_price', p.sell_price,
               'cost', CASE WHEN v_cost_ok THEN p.buy_price END,
               'usual_price', u.price,
               'usual_qty', u.qty,
               'times', COALESCE(u.n, 0))), '{}'::jsonb)
      INTO v_products
      FROM public.products p
      LEFT JOIN LATERAL (
        SELECT round(avg(x.unit_price), 2) AS price, round(avg(x.quantity), 3) AS qty, count(*) AS n
        FROM (
          SELECT si.unit_price, si.quantity
          FROM public.sale_items si JOIN public.sales s ON s.id = si.sale_id
          WHERE p_partner_id IS NOT NULL AND s.status = 'posted' AND s.customer_id = p_partner_id AND si.product_id = p.id
          ORDER BY s.doc_date DESC NULLS LAST, s.created_at DESC
          LIMIT 10
        ) x
      ) u ON TRUE
      WHERE p.id = ANY (v_ids);
    -- Purchases is a module: a tenant without it has no purchase tables (and no purchase form).
    ELSIF to_regclass('public.purchase_items') IS NOT NULL AND to_regclass('public.purchases') IS NOT NULL THEN
      SELECT COALESCE(jsonb_object_agg(p.id, jsonb_build_object(
               'unit', p.unit,
               'sell_price', p.sell_price,
               'cost', CASE WHEN v_cost_ok THEN p.buy_price END,
               'usual_price', u.price,
               'usual_qty', u.qty,
               'times', COALESCE(u.n, 0))), '{}'::jsonb)
      INTO v_products
      FROM public.products p
      LEFT JOIN LATERAL (
        SELECT round(avg(x.unit_price), 2) AS price, round(avg(x.quantity), 3) AS qty, count(*) AS n
        FROM (
          SELECT pi.unit_price, pi.quantity
          FROM public.purchase_items pi JOIN public.purchases pu ON pu.id = pi.purchase_id
          WHERE p_partner_id IS NOT NULL AND pu.status = 'posted' AND pu.supplier_id = p_partner_id AND pi.product_id = p.id
          ORDER BY pu.doc_date DESC NULLS LAST, pu.created_at DESC
          LIMIT 10
        ) x
      ) u ON TRUE
      WHERE p.id = ANY (v_ids);
    END IF;
  END IF;

  -- This partner's posted documents: how many, the median total, the last 30 days (possible duplicates).
  IF p_partner_id IS NOT NULL THEN
    IF p_doc_type = 'sale' THEN
      SELECT jsonb_build_object(
               'documents', count(*),
               'median_total', round((percentile_cont(0.5) WITHIN GROUP (ORDER BY s.total_amount))::numeric, 2),
               'recent', COALESCE(jsonb_agg(jsonb_build_object('doc_no', COALESCE(s.doc_no, s.invoice_number), 'doc_date', s.doc_date, 'total', round(s.total_amount, 2)))
                                    FILTER (WHERE s.doc_date >= CURRENT_DATE - 30), '[]'::jsonb))
      INTO v_partner
      FROM public.sales s
      WHERE s.status = 'posted' AND s.customer_id = p_partner_id AND COALESCE(s.total_amount, 0) > 0;
    ELSIF to_regclass('public.purchases') IS NOT NULL THEN
      SELECT jsonb_build_object(
               'documents', count(*),
               'median_total', round((percentile_cont(0.5) WITHIN GROUP (ORDER BY pu.total_amount))::numeric, 2),
               'recent', COALESCE(jsonb_agg(jsonb_build_object('doc_no', pu.invoice_number, 'doc_date', pu.doc_date, 'total', round(pu.total_amount, 2)))
                                    FILTER (WHERE pu.doc_date >= CURRENT_DATE - 30), '[]'::jsonb))
      INTO v_partner
      FROM public.purchases pu
      WHERE pu.status = 'posted' AND pu.supplier_id = p_partner_id AND COALESCE(pu.total_amount, 0) > 0;
    END IF;
  END IF;

  RETURN jsonb_build_object('rules', v_params, 'closed_months', v_closed, 'products', v_products, 'partner', v_partner);
END;
$$;

-- ─── 3. "The document you just saved has a problem" ─────────────────────────

CREATE OR REPLACE FUNCTION public.assistant_my_document_findings(p_entity_type TEXT, p_entity_id UUID)
RETURNS TABLE (rule_code TEXT, severity TEXT, doc_no TEXT, first_seen_at TIMESTAMPTZ)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_owner UUID;
BEGIN
  IF p_entity_type NOT IN ('sale', 'purchase') OR p_entity_id IS NULL OR to_regclass('public.guard_findings') IS NULL THEN
    RETURN;
  END IF;
  IF v_uid IS NOT NULL THEN
    IF NOT COALESCE(public.is_active_user(), FALSE) THEN
      RETURN;
    END IF;
    IF NOT COALESCE(public.user_is_admin(), FALSE) THEN
      -- Only the person who saved the document hears about it.
      IF p_entity_type = 'sale' THEN
        SELECT created_by INTO v_owner FROM public.sales WHERE id = p_entity_id;
      ELSE
        SELECT created_by INTO v_owner FROM public.purchases WHERE id = p_entity_id;
      END IF;
      IF v_owner IS DISTINCT FROM v_uid THEN
        RETURN;
      END IF;
    END IF;
  END IF;
  RETURN QUERY
  SELECT f.rule_code, f.severity, f.doc_no, f.first_seen_at
  FROM public.guard_findings f
  WHERE f.entity_type = p_entity_type AND f.entity_id = p_entity_id AND f.status = 'open'
  ORDER BY f.first_seen_at DESC
  LIMIT 10;
END;
$$;

REVOKE ALL ON FUNCTION public._assistant_watch_allowed(TEXT), public.assistant_watch_context(TEXT, UUID, UUID[]),
  public.assistant_my_document_findings(TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assistant_watch_context(TEXT, UUID, UUID[]), public.assistant_my_document_findings(TEXT, UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._assistant_watch_allowed(TEXT) TO service_role;

NOTIFY pgrst, 'reload schema';
