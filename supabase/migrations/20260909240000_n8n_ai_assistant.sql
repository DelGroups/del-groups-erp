-- n8n AI assistant webhook config + private attachment bucket.
-- Secret token lives in system_settings.n8n_ai_config and is readable only by
-- can_manage_settings (service role / admin actions). Regular users cannot SELECT it.

INSERT INTO public.system_settings (key, value)
VALUES (
  'n8n_ai_config',
  '{"webhook_url":"","secret_token":""}'::jsonb
)
ON CONFLICT (key) DO NOTHING;

DROP POLICY IF EXISTS system_settings_select ON public.system_settings;
CREATE POLICY system_settings_select ON public.system_settings
  FOR SELECT TO authenticated
  USING (
    public.is_active_user()
    AND key <> 'n8n_ai_config'
  );

DROP POLICY IF EXISTS system_settings_select_n8n ON public.system_settings;
CREATE POLICY system_settings_select_n8n ON public.system_settings
  FOR SELECT TO authenticated
  USING (
    key = 'n8n_ai_config'
    AND public.has_permission('can_manage_settings')
  );

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'ai-assistant',
  'ai-assistant',
  false,
  8388608,
  ARRAY[
    'application/pdf',
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/webp',
    'image/gif',
    'audio/webm',
    'audio/mp4',
    'audio/mpeg',
    'audio/wav',
    'audio/ogg'
  ]
)
ON CONFLICT (id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
