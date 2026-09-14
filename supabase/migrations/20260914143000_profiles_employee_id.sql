-- profiles.employee_id is required by sales invoice audit trigger and issuer delegation.
-- Some environments were provisioned before this column existed in migrations.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS employee_id UUID REFERENCES public.employees(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_employee_id
  ON public.profiles (employee_id)
  WHERE employee_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
