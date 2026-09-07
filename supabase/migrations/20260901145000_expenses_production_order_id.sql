-- Link finance expenses to production orders (create_production_expense_atomic).

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS production_order_id UUID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'expenses_production_order_id_fkey'
  ) THEN
    ALTER TABLE public.expenses
      ADD CONSTRAINT expenses_production_order_id_fkey
      FOREIGN KEY (production_order_id)
      REFERENCES public.production_orders(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_expenses_production_order
  ON public.expenses (production_order_id)
  WHERE production_order_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';
