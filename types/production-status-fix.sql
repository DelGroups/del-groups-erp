-- Run in Supabase SQL Editor when inserts fail with production_orders_status_check.
-- Aligns status CHECK + DEFAULT with the Title-Case keys the app writes:
-- Draft | In-Progress | Ready | Delivered

ALTER TABLE production_orders DROP CONSTRAINT IF EXISTS production_orders_status_check;

UPDATE production_orders
SET status = CASE
  WHEN status IN ('Draft', 'In-Progress', 'Ready', 'Delivered') THEN status
  WHEN lower(regexp_replace(replace(btrim(status), '_', '-'), '\s+', '-', 'g'))
    IN ('in-progress', 'inprogress') THEN 'In-Progress'
  WHEN lower(btrim(status)) IN ('ready', 'hazir') THEN 'Ready'
  WHEN lower(btrim(status)) IN ('delivered') THEN 'Delivered'
  ELSE 'Draft'
END;

ALTER TABLE production_orders ALTER COLUMN status SET DEFAULT 'Draft';

ALTER TABLE production_orders
  ADD CONSTRAINT production_orders_status_check
  CHECK (status IN ('Draft', 'In-Progress', 'Ready', 'Delivered'));

NOTIFY pgrst, 'reload schema';
