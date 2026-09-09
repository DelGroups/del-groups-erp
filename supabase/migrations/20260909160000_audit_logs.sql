-- System audit trail: append-only log of critical CREATE / UPDATE / DELETE actions.
-- Viewer: /settings/audit (can_manage_settings).

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (action IN ('CREATE', 'UPDATE', 'DELETE')),
  module TEXT NOT NULL CHECK (module IN ('FINANCE', 'PRODUCTION', 'INVENTORY', 'PAYROLL', 'SECURITY')),
  table_name TEXT,
  record_id UUID,
  old_values_json JSONB,
  new_values_json JSONB,
  ip_address INET,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON public.audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_module_action ON public.audit_logs (module, action);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON public.audit_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_record_id ON public.audit_logs (record_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_table_name ON public.audit_logs (table_name);

COMMENT ON TABLE public.audit_logs IS
  'Append-only security audit trail. Inserts come only from audit_log_row_change().';

-- ─── Sanitize + diff helpers ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.audit_sanitize_row(p_row jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO public
AS $$
BEGIN
  IF p_row IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN p_row
    - 'password'
    - 'hashed_password'
    - 'encrypted_password'
    - 'token'
    - 'access_token'
    - 'refresh_token'
    - 'secret'
    - 'api_key'
    - 'service_role_key';
END;
$$;

CREATE OR REPLACE FUNCTION public.audit_json_changed_keys(p_old jsonb, p_new jsonb)
RETURNS jsonb[]
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO public
AS $$
DECLARE
  v_old jsonb := COALESCE(p_old, '{}'::jsonb);
  v_new jsonb := COALESCE(p_new, '{}'::jsonb);
  v_old_diff jsonb := '{}'::jsonb;
  v_new_diff jsonb := '{}'::jsonb;
  k text;
BEGIN
  FOR k IN
    SELECT DISTINCT key
    FROM (
      SELECT jsonb_object_keys(v_old) AS key
      UNION
      SELECT jsonb_object_keys(v_new) AS key
    ) keys
  LOOP
    IF k IN ('updated_at') THEN
      CONTINUE;
    END IF;
    IF (v_old -> k) IS DISTINCT FROM (v_new -> k) THEN
      v_old_diff := v_old_diff || jsonb_build_object(k, v_old -> k);
      v_new_diff := v_new_diff || jsonb_build_object(k, v_new -> k);
    END IF;
  END LOOP;
  RETURN ARRAY[v_old_diff, v_new_diff];
END;
$$;

CREATE OR REPLACE FUNCTION public.audit_request_ip()
RETURNS inet
LANGUAGE plpgsql
STABLE
SET search_path TO public
AS $$
DECLARE
  v_headers jsonb;
  v_xff text;
  v_ip inet;
BEGIN
  BEGIN
    v_headers := current_setting('request.headers', true)::jsonb;
  EXCEPTION WHEN OTHERS THEN
    v_headers := NULL;
  END;

  IF v_headers IS NOT NULL THEN
    v_xff := COALESCE(
      v_headers ->> 'x-forwarded-for',
      v_headers ->> 'x-real-ip',
      v_headers ->> 'cf-connecting-ip'
    );
    IF v_xff IS NOT NULL AND btrim(v_xff) <> '' THEN
      BEGIN
        v_ip := split_part(btrim(v_xff), ',', 1)::inet;
        RETURN v_ip;
      EXCEPTION WHEN OTHERS THEN
        v_ip := NULL;
      END;
    END IF;
  END IF;

  RETURN inet_client_addr();
END;
$$;

CREATE OR REPLACE FUNCTION public.audit_request_user_id()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SET search_path TO public
AS $$
DECLARE
  v_uid uuid;
  v_sub text;
BEGIN
  BEGIN
    v_uid := auth.uid();
  EXCEPTION WHEN OTHERS THEN
    v_uid := NULL;
  END;
  IF v_uid IS NOT NULL THEN
    RETURN v_uid;
  END IF;

  BEGIN
    v_sub := nullif(current_setting('request.jwt.claim.sub', true), '');
    IF v_sub IS NOT NULL THEN
      RETURN v_sub::uuid;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  RETURN NULL;
END;
$$;

-- Generic row-change hook. TG_ARGV[0] = module (FINANCE / PRODUCTION / …).
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
BEGIN
  IF TG_TABLE_NAME = 'audit_logs' THEN
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
  );

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.audit_log_row_change() FROM PUBLIC, anon, authenticated;

-- ─── Trigger installer (skips missing tables) ────────────────────────────────

CREATE OR REPLACE FUNCTION public.audit_attach_trigger(
  p_table text,
  p_name text,
  p_events text,
  p_module text,
  p_when text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
BEGIN
  IF to_regclass(format('public.%I', p_table)) IS NULL THEN
    RAISE NOTICE 'audit_logs: skip missing table %', p_table;
    RETURN;
  END IF;

  EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', p_name, p_table);

  IF p_when IS NULL OR btrim(p_when) = '' THEN
    EXECUTE format(
      'CREATE TRIGGER %I AFTER %s ON public.%I FOR EACH ROW EXECUTE FUNCTION public.audit_log_row_change(%L)',
      p_name,
      p_events,
      p_table,
      p_module
    );
  ELSE
    EXECUTE format(
      'CREATE TRIGGER %I AFTER %s ON public.%I FOR EACH ROW WHEN (%s) EXECUTE FUNCTION public.audit_log_row_change(%L)',
      p_name,
      p_events,
      p_table,
      p_when,
      p_module
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.audit_attach_trigger(text, text, text, text, text) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.audit_when_columns_changed(
  p_table text,
  p_columns text[]
)
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path TO public
AS $$
DECLARE
  v_col text;
  v_parts text := '';
BEGIN
  FOREACH v_col IN ARRAY p_columns LOOP
    IF EXISTS (
      SELECT 1
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = p_table
        AND column_name = v_col
    ) THEN
      IF v_parts <> '' THEN
        v_parts := v_parts || ' OR ';
      END IF;
      v_parts := v_parts || format('OLD.%I IS DISTINCT FROM NEW.%I', v_col, v_col);
    END IF;
  END LOOP;
  RETURN NULLIF(v_parts, '');
END;
$$;

-- FINANCE: deleting / altering ledger rows and expense records
SELECT public.audit_attach_trigger('transactions', 'trg_audit_transactions', 'UPDATE OR DELETE', 'FINANCE');
SELECT public.audit_attach_trigger('expenses', 'trg_audit_expenses', 'INSERT OR UPDATE OR DELETE', 'FINANCE');

-- PRODUCTION: cost / fee / material / contractor mutations
SELECT public.audit_attach_trigger(
  'production_orders',
  'trg_audit_production_orders',
  'UPDATE',
  'PRODUCTION',
  public.audit_when_columns_changed(
    'production_orders',
    ARRAY[
      'total_project_price',
      'remaining_balance',
      'advance_payment',
      'installation_fee',
      'contractor_fee',
      'subcontractor_fee_amount',
      'subcontractor_fee_percent',
      'additional_cost',
      'additional_expenses_total',
      'total_cost',
      'total_expense_cost',
      'total_material_cost',
      'total_outsourcing_cost',
      'net_profit',
      'profit_margin'
    ]
  )
);
SELECT public.audit_attach_trigger(
  'production_materials',
  'trg_audit_production_materials',
  'UPDATE OR DELETE',
  'PRODUCTION'
);
SELECT public.audit_attach_trigger(
  'production_expenses',
  'trg_audit_production_expenses',
  'INSERT OR UPDATE OR DELETE',
  'PRODUCTION'
);
SELECT public.audit_attach_trigger(
  'production_contractors',
  'trg_audit_production_contractors',
  'UPDATE OR DELETE',
  'PRODUCTION'
);
SELECT public.audit_attach_trigger(
  'production_outsourcing',
  'trg_audit_production_outsourcing',
  'UPDATE OR DELETE',
  'PRODUCTION'
);

-- INVENTORY: stock / price / write-off / warehouse balance / adjustment vouchers
SELECT public.audit_attach_trigger(
  'products',
  'trg_audit_products',
  'UPDATE',
  'INVENTORY',
  public.audit_when_columns_changed(
    'products',
    ARRAY['stock', 'min_stock', 'min_stock_level', 'buy_price']
  )
);
SELECT public.audit_attach_trigger(
  'warehouse_stocks',
  'trg_audit_warehouse_stocks_upd',
  'UPDATE',
  'INVENTORY',
  public.audit_when_columns_changed(
    'warehouse_stocks',
    ARRAY['current_stock', 'min_stock_level']
  )
);
SELECT public.audit_attach_trigger(
  'warehouse_stocks',
  'trg_audit_warehouse_stocks_del',
  'DELETE',
  'INVENTORY'
);
SELECT public.audit_attach_trigger(
  'inventory_writeoffs',
  'trg_audit_inventory_writeoffs',
  'INSERT OR UPDATE OR DELETE',
  'INVENTORY'
);
SELECT public.audit_attach_trigger(
  'inventory_adjustment_vouchers',
  'trg_audit_inventory_adjustments',
  'INSERT OR UPDATE OR DELETE',
  'INVENTORY'
);

-- PAYROLL
SELECT public.audit_attach_trigger('payrolls', 'trg_audit_payrolls', 'INSERT OR UPDATE OR DELETE', 'PAYROLL');
SELECT public.audit_attach_trigger(
  'salary_payments',
  'trg_audit_salary_payments',
  'INSERT OR UPDATE OR DELETE',
  'PAYROLL'
);

-- SECURITY: roles and permission / activation changes
SELECT public.audit_attach_trigger('roles', 'trg_audit_roles', 'INSERT OR UPDATE OR DELETE', 'SECURITY');
SELECT public.audit_attach_trigger(
  'profiles',
  'trg_audit_profiles',
  'UPDATE',
  'SECURITY',
  public.audit_when_columns_changed(
    'profiles',
    ARRAY['role_id', 'permission_overrides', 'scope_overrides', 'is_active']
  )
);

-- ─── RLS: readable by settings admins; never writable from the API ───────────

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS audit_logs_select ON public.audit_logs;
CREATE POLICY audit_logs_select ON public.audit_logs
  FOR SELECT TO authenticated
  USING (public.is_active_user() AND public.has_permission('can_manage_settings'));

REVOKE ALL ON TABLE public.audit_logs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.audit_logs TO authenticated;
