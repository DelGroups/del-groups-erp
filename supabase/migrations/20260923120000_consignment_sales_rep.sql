-- Adds Sales Rep tracking to the consignment module (Dispatch + Actual Sale),
-- additive/idempotent so it is safe to run against the live project at any time.
-- sales_rep_name is a denormalized snapshot, matching the existing warehouse_name
-- column on consignment_dispatches, so history/print stay accurate if an
-- employee record is later renamed or deactivated.

ALTER TABLE consignment_dispatches
  ADD COLUMN IF NOT EXISTS sales_rep_id UUID REFERENCES employees(id),
  ADD COLUMN IF NOT EXISTS sales_rep_name TEXT;

ALTER TABLE consignment_monthly_reports
  ADD COLUMN IF NOT EXISTS sales_rep_id UUID REFERENCES employees(id),
  ADD COLUMN IF NOT EXISTS sales_rep_name TEXT;

CREATE INDEX IF NOT EXISTS idx_consignment_dispatches_sales_rep
  ON consignment_dispatches(sales_rep_id);

CREATE INDEX IF NOT EXISTS idx_consignment_monthly_reports_sales_rep
  ON consignment_monthly_reports(sales_rep_id);

NOTIFY pgrst, 'reload schema';
