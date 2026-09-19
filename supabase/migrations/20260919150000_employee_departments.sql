-- HR departments (Şöbə): configurable list for employee assignment.

CREATE TABLE IF NOT EXISTS public.employee_departments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT employee_departments_code_unique UNIQUE (code),
  CONSTRAINT employee_departments_code_format CHECK (code ~ '^[a-z0-9_]+$')
);

CREATE INDEX IF NOT EXISTS idx_employee_departments_active_sort
  ON public.employee_departments (is_active, sort_order, name);

INSERT INTO public.employee_departments (code, name, sort_order)
VALUES
  ('furniture', 'Mebel istehsalı', 10),
  ('design', 'Interyer dizayn', 20),
  ('advertising', 'Reklam', 30),
  ('stationery', 'Dəftərxana satışı', 40),
  ('general', 'Ümumi', 50)
ON CONFLICT (code) DO NOTHING;

ALTER TABLE public.employee_departments ENABLE ROW LEVEL SECURITY;

SELECT public._apply_table_rls(
  'employee_departments',
  'can_view_hr',
  'can_manage_hr',
  'can_manage_hr',
  'can_manage_hr'
);

NOTIFY pgrst, 'reload schema';
