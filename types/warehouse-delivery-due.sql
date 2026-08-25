-- Add expected delivery datetime to warehouse slips
ALTER TABLE warehouse_slips
  ADD COLUMN IF NOT EXISTS delivery_due_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_warehouse_slips_delivery_due_at
  ON warehouse_slips (delivery_due_at);
