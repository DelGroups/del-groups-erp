-- Upgrade phase 2: Del Groups Studio — custom fields.
--
-- Admins define extra fields per business model in public.studio_fields
-- (Settings → Studio). Values are stored on each record in a new
-- `custom_fields` JSONB column, keyed by the field's technical name (x_...).
-- Validation lives in src/lib/studio/fields.ts; the database only guarantees
-- that custom_fields is a JSON object.
--
-- Field definitions are never deleted, only archived (active = false), so the
-- values already stored on records are never orphaned.
--
-- ADD COLUMN ... DEFAULT '{}' is metadata-only on PostgreSQL 11+, so this is
-- fast on large tables. Idempotent: safe to run more than once.

BEGIN;

CREATE TABLE IF NOT EXISTS public.studio_fields (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_key     TEXT NOT NULL CHECK (model_key IN
                  ('customers', 'suppliers', 'products', 'sales', 'purchases', 'production_orders')),
  name          TEXT NOT NULL CHECK (name ~ '^x_[a-z0-9_]{1,40}$'),
  label         TEXT NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 80),
  field_type    TEXT NOT NULL CHECK (field_type IN
                  ('text', 'textarea', 'integer', 'decimal', 'money', 'date', 'checkbox', 'selection', 'url')),
  -- selection only: [{"value": "urgent", "label": "Təcili"}, ...]
  options       JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(options) = 'array'),
  required      BOOLEAN NOT NULL DEFAULT FALSE,
  show_in_list  BOOLEAN NOT NULL DEFAULT FALSE,
  help          TEXT,
  sequence      INTEGER NOT NULL DEFAULT 100,
  active        BOOLEAN NOT NULL DEFAULT TRUE,
  created_by    UUID DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT studio_fields_model_name_key UNIQUE (model_key, name)
);

CREATE INDEX IF NOT EXISTS idx_studio_fields_model
  ON public.studio_fields (model_key, sequence) WHERE active;

-- ─── custom_fields on the supported models ───────────────────────────────────

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['customers', 'suppliers', 'products', 'sales', 'purchases', 'production_orders'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE NOTICE 'studio: table public.% not found, skipped', t;
      CONTINUE;
    END IF;
    EXECUTE format(
      'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS custom_fields JSONB NOT NULL DEFAULT ''{}''::jsonb',
      t
    );
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conname = t || '_custom_fields_object'
        AND conrelid = ('public.' || t)::regclass
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (jsonb_typeof(custom_fields) = ''object'')',
        t,
        t || '_custom_fields_object'
      );
    END IF;
  END LOOP;
END
$$;

-- ─── RLS: everyone active can read definitions; only settings managers edit ──

ALTER TABLE public.studio_fields ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS studio_fields_select ON public.studio_fields;
CREATE POLICY studio_fields_select ON public.studio_fields
  FOR SELECT TO authenticated
  USING (public.is_active_user());

DROP POLICY IF EXISTS studio_fields_insert ON public.studio_fields;
CREATE POLICY studio_fields_insert ON public.studio_fields
  FOR INSERT TO authenticated
  WITH CHECK ((public.user_is_admin() OR public.require_permission('can_manage_settings')));

DROP POLICY IF EXISTS studio_fields_update ON public.studio_fields;
CREATE POLICY studio_fields_update ON public.studio_fields
  FOR UPDATE TO authenticated
  USING ((public.user_is_admin() OR public.require_permission('can_manage_settings')))
  WITH CHECK ((public.user_is_admin() OR public.require_permission('can_manage_settings')));

-- No DELETE policy: archive instead.

REVOKE ALL ON TABLE public.studio_fields FROM anon;

COMMIT;

NOTIFY pgrst, 'reload schema';
