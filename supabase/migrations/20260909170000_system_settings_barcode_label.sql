-- Key/value JSON settings. Barcode thermal labels live under key barcode_label_config.

CREATE TABLE IF NOT EXISTS public.system_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.system_settings IS
  'App-wide JSON configuration. barcode_label_config drives thermal sticker layout.';

INSERT INTO public.system_settings (key, value)
VALUES (
  'barcode_label_config',
  '{
    "paper_size": "80x50mm",
    "barcode_type": "CODE128",
    "show_company_logo": true,
    "show_item_code": true,
    "show_price": false,
    "show_dimensions": true,
    "show_warehouse_location": true,
    "header_title": "DEL GROUPS MMC",
    "margin_padding_mm": 2,
    "custom_width_mm": 80,
    "custom_height_mm": 50
  }'::jsonb
)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS system_settings_select ON public.system_settings;
CREATE POLICY system_settings_select ON public.system_settings
  FOR SELECT TO authenticated
  USING (public.is_active_user());

DROP POLICY IF EXISTS system_settings_insert ON public.system_settings;
CREATE POLICY system_settings_insert ON public.system_settings
  FOR INSERT TO authenticated
  WITH CHECK (public.has_permission('can_manage_settings'));

DROP POLICY IF EXISTS system_settings_update ON public.system_settings;
CREATE POLICY system_settings_update ON public.system_settings
  FOR UPDATE TO authenticated
  USING (public.has_permission('can_manage_settings'))
  WITH CHECK (public.has_permission('can_manage_settings'));

GRANT SELECT, INSERT, UPDATE ON TABLE public.system_settings TO authenticated;
REVOKE DELETE ON TABLE public.system_settings FROM PUBLIC, anon, authenticated;
