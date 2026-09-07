-- Sales list UI expects warehouse send tracking + additional expense columns.

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS warehouse_sent BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS warehouse_slip_status TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'sales_warehouse_slip_status_check'
  ) THEN
    ALTER TABLE public.sales
      ADD CONSTRAINT sales_warehouse_slip_status_check
      CHECK (
        warehouse_slip_status IS NULL
        OR warehouse_slip_status IN ('pending', 'approved', 'rejected')
      );
  END IF;
END $$;

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS additional_expenses JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS additional_expenses_total NUMERIC NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_sales_warehouse_sent
  ON public.sales (warehouse_sent);

NOTIFY pgrst, 'reload schema';
