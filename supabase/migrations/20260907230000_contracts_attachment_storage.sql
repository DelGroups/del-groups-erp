-- Contract signed-document attachments (PDF/JPG) via Supabase Storage

ALTER TABLE contracts ADD COLUMN IF NOT EXISTS attachment_path TEXT;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'contract-attachments',
  'contract-attachments',
  false,
  20971520,
  ARRAY['application/pdf', 'image/jpeg', 'image/jpg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS contract_attachments_select ON storage.objects;
CREATE POLICY contract_attachments_select ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'contract-attachments');

DROP POLICY IF EXISTS contract_attachments_insert ON storage.objects;
CREATE POLICY contract_attachments_insert ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'contract-attachments');

DROP POLICY IF EXISTS contract_attachments_update ON storage.objects;
CREATE POLICY contract_attachments_update ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'contract-attachments');

DROP POLICY IF EXISTS contract_attachments_delete ON storage.objects;
CREATE POLICY contract_attachments_delete ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'contract-attachments');

NOTIFY pgrst, 'reload schema';
