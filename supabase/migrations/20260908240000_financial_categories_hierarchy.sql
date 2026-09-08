-- Hierarchical expense/income categories (parent + subcategory)

ALTER TABLE public.financial_categories
  ADD COLUMN IF NOT EXISTS parent_id UUID REFERENCES public.financial_categories(id) ON DELETE CASCADE;

DROP INDEX IF EXISTS idx_financial_categories_name_type;

CREATE UNIQUE INDEX IF NOT EXISTS idx_financial_categories_unique_root
  ON public.financial_categories (lower(name), type)
  WHERE parent_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_financial_categories_unique_child
  ON public.financial_categories (parent_id, lower(name))
  WHERE parent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_financial_categories_parent
  ON public.financial_categories (parent_id);

-- Seed production expense parent + subcategories (idempotent)
DO $$
DECLARE
  v_parent_id UUID;
BEGIN
  INSERT INTO public.financial_categories (name, type, is_active, parent_id)
  SELECT 'İstehsalat Xərcləri', 'EXPENSE', true, NULL
  WHERE NOT EXISTS (
    SELECT 1 FROM public.financial_categories
    WHERE lower(name) = lower('İstehsalat Xərcləri') AND type = 'EXPENSE' AND parent_id IS NULL
  );

  SELECT id INTO v_parent_id
  FROM public.financial_categories
  WHERE lower(name) = lower('İstehsalat Xərcləri') AND type = 'EXPENSE' AND parent_id IS NULL
  LIMIT 1;

  IF v_parent_id IS NOT NULL THEN
    INSERT INTO public.financial_categories (name, type, is_active, parent_id)
    SELECT v.name, 'EXPENSE', true, v_parent_id
    FROM (VALUES
      ('Lazer Kəsimi'),
      ('Boya / Rəng'),
      ('Usta Haqqı')
    ) AS v(name)
    WHERE NOT EXISTS (
      SELECT 1 FROM public.financial_categories fc
      WHERE fc.parent_id = v_parent_id AND lower(fc.name) = lower(v.name)
    );
  END IF;
END $$;
