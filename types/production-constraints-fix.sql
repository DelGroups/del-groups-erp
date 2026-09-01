-- Run once in Supabase SQL Editor if production order inserts fail CHECK constraints.
-- Aligns type + status with the Title-Case keys the app writes.

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

ALTER TABLE production_orders DROP CONSTRAINT IF EXISTS production_orders_type_check;
UPDATE production_orders
SET type = CASE
  WHEN type IN ('Custom', 'Series') THEN type
  WHEN lower(btrim(type)) IN ('series', 'seriya', 'seria', 'serial', 'stock') THEN 'Series'
  ELSE 'Custom'
END;
ALTER TABLE production_orders
  ADD CONSTRAINT production_orders_type_check
  CHECK (type IN ('Custom', 'Series'));

NOTIFY pgrst, 'reload schema';
