-- Receipts and invoices (photo/PDF) attached to expense documents.
--
-- Files live in a private bucket. The app reads and writes them only through
-- server actions that check can_view_expenses / can_manage_expenses and use the
-- service role, so the bucket gets no storage.objects policies for
-- authenticated users: nobody can list or download receipts directly.
--
-- Idempotent: safe to run more than once.

BEGIN;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'expense-attachments',
  'expense-attachments',
  false,
  10485760,
  ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.expense_attachments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id   UUID NOT NULL REFERENCES public.expenses(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL UNIQUE,
  file_name    TEXT NOT NULL,
  mime_type    TEXT,
  size_bytes   BIGINT,
  created_by   UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_expense_attachments_expense
  ON public.expense_attachments (expense_id, created_at);

ALTER TABLE public.expense_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS expense_attachments_select ON public.expense_attachments;
CREATE POLICY expense_attachments_select ON public.expense_attachments
  FOR SELECT TO authenticated
  USING (
    public.require_permission('can_view_expenses')
    OR public.require_permission('can_manage_expenses')
  );

-- Inserts and deletes go through server actions (service role) only.

GRANT SELECT ON public.expense_attachments TO authenticated;
GRANT ALL ON public.expense_attachments TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
