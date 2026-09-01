-- Del Groups ERP — Chart of Accounts (Phase 1)
-- Run AFTER types/rbac-migration.sql and types/schema.sql.

CREATE TABLE IF NOT EXISTS public.chart_of_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  account_type TEXT NOT NULL CHECK (
    account_type IN ('asset', 'liability', 'equity', 'income', 'expense', 'contra')
  ),
  parent_id UUID REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_chart_of_accounts_code
  ON public.chart_of_accounts (code);

ALTER TABLE public.accounts
  ADD COLUMN IF NOT EXISTS coa_id UUID REFERENCES public.chart_of_accounts(id) ON DELETE SET NULL;

INSERT INTO public.chart_of_accounts (code, name, account_type)
VALUES
  ('1100', 'Kassa və Bank', 'asset'),
  ('1200', 'Müştəri borcları (AR)', 'asset'),
  ('1300', 'Anbar / Inventar', 'asset'),
  ('2100', 'Təchizatçı borcları (AP)', 'liability'),
  ('3900', 'İlkin qalıq kapitalı', 'equity'),
  ('4100', 'Satış gəliri', 'income'),
  ('4990', 'Digər gəlir', 'income'),
  ('5100', 'Maya dəyəri (COGS)', 'expense'),
  ('6100', 'Əməliyyat xərcləri', 'expense'),
  ('6190', 'Digər xərc', 'expense')
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    account_type = EXCLUDED.account_type,
    is_active = TRUE;

UPDATE public.accounts a
SET coa_id = c.id
FROM public.chart_of_accounts c
WHERE a.coa_id IS NULL
  AND c.code = '1100';

NOTIFY pgrst, 'reload schema';
