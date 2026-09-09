-- Audit trail retention, read-event logging, and high-risk deletion alerts.

INSERT INTO public.system_settings (key, value)
VALUES (
  'audit_config',
  '{
    "log_retention_days": 0,
    "track_read_events": false,
    "alert_on_record_deletion": true
  }'::jsonb
)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.audit_logs DROP CONSTRAINT IF EXISTS audit_logs_action_check;
ALTER TABLE public.audit_logs
  ADD CONSTRAINT audit_logs_action_check
  CHECK (action IN ('CREATE', 'UPDATE', 'DELETE', 'READ'));

CREATE TABLE IF NOT EXISTS public.audit_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_log_id UUID REFERENCES public.audit_logs(id) ON DELETE SET NULL,
  module TEXT NOT NULL,
  table_name TEXT,
  record_id UUID,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  message TEXT NOT NULL,
  email_to TEXT,
  email_status TEXT NOT NULL DEFAULT 'logged'
    CHECK (email_status IN ('logged', 'queued', 'skipped')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_alerts_created_at
  ON public.audit_alerts (created_at DESC);

ALTER TABLE public.audit_alerts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_alerts_select ON public.audit_alerts;
CREATE POLICY audit_alerts_select ON public.audit_alerts
  FOR SELECT TO authenticated
  USING (public.is_active_user() AND public.has_permission('can_manage_settings'));

REVOKE ALL ON TABLE public.audit_alerts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.audit_alerts TO authenticated;

CREATE OR REPLACE FUNCTION public.purge_expired_audit_logs()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cfg JSONB;
  v_days INT;
  v_count INT := 0;
BEGIN
  SELECT value INTO v_cfg
    FROM public.system_settings
   WHERE key = 'audit_config';

  v_days := COALESCE((v_cfg ->> 'log_retention_days')::int, 0);
  IF v_days IS NULL OR v_days <= 0 THEN
    RETURN 0;
  END IF;

  DELETE FROM public.audit_alerts
   WHERE created_at < NOW() - make_interval(days => v_days);

  DELETE FROM public.audit_logs
   WHERE created_at < NOW() - make_interval(days => v_days);
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_expired_audit_logs() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_audit_logs() TO service_role;

CREATE OR REPLACE FUNCTION public.audit_log_read_event(
  p_module TEXT,
  p_table TEXT DEFAULT NULL,
  p_meta JSONB DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cfg JSONB;
  v_track BOOLEAN;
  v_module TEXT;
  v_id UUID;
BEGIN
  IF NOT public.is_active_user() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT value INTO v_cfg
    FROM public.system_settings
   WHERE key = 'audit_config';

  v_track := COALESCE((v_cfg ->> 'track_read_events')::boolean, false);
  IF NOT v_track THEN
    RETURN NULL;
  END IF;

  v_module := upper(COALESCE(NULLIF(p_module, ''), 'FINANCE'));
  IF v_module NOT IN ('FINANCE', 'PRODUCTION', 'INVENTORY', 'PAYROLL', 'SECURITY') THEN
    v_module := 'FINANCE';
  END IF;

  INSERT INTO public.audit_logs (
    user_id,
    action,
    module,
    table_name,
    record_id,
    old_values_json,
    new_values_json,
    ip_address
  )
  VALUES (
    public.audit_request_user_id(),
    'READ',
    v_module,
    NULLIF(btrim(COALESCE(p_table, '')), ''),
    NULL,
    NULL,
    COALESCE(p_meta, '{}'::jsonb),
    public.audit_request_ip()
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.audit_log_read_event(TEXT, TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.audit_log_read_event(TEXT, TEXT, JSONB) TO authenticated;

CREATE OR REPLACE FUNCTION public.audit_log_row_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_module text;
  v_action text;
  v_old jsonb;
  v_new jsonb;
  v_diff jsonb[];
  v_record_id uuid;
  v_payload jsonb;
  v_log_id uuid;
  v_cfg jsonb;
  v_alert boolean;
  v_email text;
BEGIN
  IF TG_TABLE_NAME = 'audit_logs' OR TG_TABLE_NAME = 'audit_alerts' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  v_module := upper(COALESCE(NULLIF(TG_ARGV[0], ''), 'FINANCE'));
  IF v_module NOT IN ('FINANCE', 'PRODUCTION', 'INVENTORY', 'PAYROLL', 'SECURITY') THEN
    v_module := 'FINANCE';
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_action := 'CREATE';
    v_payload := to_jsonb(NEW);
    v_new := public.audit_sanitize_row(v_payload);
    v_old := NULL;
  ELSIF TG_OP = 'UPDATE' THEN
    v_action := 'UPDATE';
    v_payload := to_jsonb(NEW);
    v_old := public.audit_sanitize_row(to_jsonb(OLD));
    v_new := public.audit_sanitize_row(v_payload);
    v_diff := public.audit_json_changed_keys(v_old, v_new);
    IF v_diff[1] = '{}'::jsonb AND v_diff[2] = '{}'::jsonb THEN
      RETURN NEW;
    END IF;
    v_old := v_diff[1];
    v_new := v_diff[2];
  ELSE
    v_action := 'DELETE';
    v_payload := to_jsonb(OLD);
    v_old := public.audit_sanitize_row(v_payload);
    v_new := NULL;
  END IF;

  BEGIN
    IF v_payload ? 'id' AND nullif(v_payload->>'id', '') IS NOT NULL THEN
      v_record_id := (v_payload->>'id')::uuid;
    ELSIF v_payload ? 'product_id' AND nullif(v_payload->>'product_id', '') IS NOT NULL THEN
      v_record_id := (v_payload->>'product_id')::uuid;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    v_record_id := NULL;
  END;

  INSERT INTO public.audit_logs (
    user_id,
    action,
    module,
    table_name,
    record_id,
    old_values_json,
    new_values_json,
    ip_address
  ) VALUES (
    public.audit_request_user_id(),
    v_action,
    v_module,
    TG_TABLE_NAME,
    v_record_id,
    v_old,
    v_new,
    public.audit_request_ip()
  )
  RETURNING id INTO v_log_id;

  IF v_action = 'DELETE' THEN
    SELECT value INTO v_cfg
      FROM public.system_settings
     WHERE key = 'audit_config';
    v_alert := COALESCE((v_cfg ->> 'alert_on_record_deletion')::boolean, true);

    IF v_alert AND v_module IN ('FINANCE', 'INVENTORY') THEN
      SELECT email INTO v_email FROM public.company_settings LIMIT 1;

      INSERT INTO public.audit_alerts (
        audit_log_id,
        module,
        table_name,
        record_id,
        user_id,
        message,
        email_to,
        email_status
      )
      VALUES (
        v_log_id,
        v_module,
        TG_TABLE_NAME,
        v_record_id,
        public.audit_request_user_id(),
        format(
          'High-risk DELETE: %s.%s (%s)',
          v_module,
          TG_TABLE_NAME,
          COALESCE(v_record_id::text, 'no-id')
        ),
        NULLIF(btrim(COALESCE(v_email, '')), ''),
        CASE
          WHEN NULLIF(btrim(COALESCE(v_email, '')), '') IS NULL THEN 'skipped'
          ELSE 'logged'
        END
      );
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

SELECT public.audit_attach_trigger('products', 'trg_audit_products_del', 'DELETE', 'INVENTORY');
SELECT public.audit_attach_trigger('sales', 'trg_audit_sales_del', 'DELETE', 'FINANCE');
SELECT public.audit_attach_trigger('purchases', 'trg_audit_purchases_del', 'DELETE', 'FINANCE');
