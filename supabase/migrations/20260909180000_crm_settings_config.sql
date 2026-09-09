-- CRM quotation template + custom pipeline stages stored in system_settings.
-- Relaxes deals.stage CHECK so custom Kanban columns can be saved.

ALTER TABLE public.deals DROP CONSTRAINT IF EXISTS deals_stage_check;
ALTER TABLE public.deals ALTER COLUMN stage TYPE VARCHAR(40);
ALTER TABLE public.deals ALTER COLUMN stage SET DEFAULT 'LEAD';

INSERT INTO public.system_settings (key, value)
VALUES (
  'crm_config',
  '{
    "quote_prefix": "TKL-2026-",
    "default_validity_days": 14,
    "terms_and_conditions": "",
    "show_bank_details_on_quote": true,
    "company_seal_signature_url": null,
    "stages": [
      { "id": "LEAD", "label": "Lead", "color": "#38bdf8", "kind": "open", "locked": false },
      { "id": "QUALIFIED", "label": "Qualified", "color": "#818cf8", "kind": "open", "locked": false },
      { "id": "PROPOSAL", "label": "Proposal", "color": "#fbbf24", "kind": "proposal", "locked": false },
      { "id": "WON", "label": "Won", "color": "#34d399", "kind": "won", "locked": true },
      { "id": "LOST", "label": "Lost", "color": "#fb7185", "kind": "lost", "locked": true }
    ]
  }'::jsonb
)
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.next_quotation_number()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_n INT;
  v_prefix TEXT;
BEGIN
  v_n := nextval('public.quotation_number_seq');
  SELECT COALESCE(NULLIF(btrim(value ->> 'quote_prefix'), ''), 'TKL-2026-')
    INTO v_prefix
    FROM public.system_settings
    WHERE key = 'crm_config';
  IF v_prefix IS NULL OR btrim(v_prefix) = '' THEN
    v_prefix := 'TKL-2026-';
  END IF;
  RETURN v_prefix || lpad(v_n::TEXT, 4, '0');
END;
$$;

GRANT EXECUTE ON FUNCTION public.next_quotation_number() TO authenticated;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'crm-assets',
  'crm-assets',
  true,
  5242880,
  ARRAY['image/png', 'image/jpeg', 'image/jpg', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS crm_assets_select ON storage.objects;
CREATE POLICY crm_assets_select ON storage.objects
  FOR SELECT TO public
  USING (bucket_id = 'crm-assets');

DROP POLICY IF EXISTS crm_assets_insert ON storage.objects;
CREATE POLICY crm_assets_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'crm-assets');

DROP POLICY IF EXISTS crm_assets_update ON storage.objects;
CREATE POLICY crm_assets_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'crm-assets');

DROP POLICY IF EXISTS crm_assets_delete ON storage.objects;
CREATE POLICY crm_assets_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'crm-assets');
