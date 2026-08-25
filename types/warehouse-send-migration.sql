-- Warehouse send tracking on sales & purchases + send permission
-- Run in Supabase SQL Editor after types/warehouse-slips.sql

ALTER TABLE sales ADD COLUMN IF NOT EXISTS warehouse_sent BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE sales ADD COLUMN IF NOT EXISTS warehouse_slip_status TEXT
  CHECK (warehouse_slip_status IS NULL OR warehouse_slip_status IN ('pending', 'approved', 'rejected'));

ALTER TABLE purchases ADD COLUMN IF NOT EXISTS warehouse_sent BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS warehouse_slip_status TEXT
  CHECK (warehouse_slip_status IS NULL OR warehouse_slip_status IN ('pending', 'approved', 'rejected'));

CREATE INDEX IF NOT EXISTS idx_sales_warehouse_sent ON sales (warehouse_sent);
CREATE INDEX IF NOT EXISTS idx_purchases_warehouse_sent ON purchases (warehouse_sent);

-- Send-to-warehouse permission (Admin + Manager)
UPDATE roles
   SET permissions = permissions || jsonb_build_object('can_send_to_warehouse', TRUE)
 WHERE name IN ('Admin', 'Manager');

UPDATE roles
   SET permissions = permissions || jsonb_build_object('can_send_to_warehouse', FALSE)
 WHERE name = 'User';

-- Allow approvers to insert pre-approved slips (admin direct send)
DROP POLICY IF EXISTS warehouse_slips_insert ON warehouse_slips;
CREATE POLICY warehouse_slips_insert ON warehouse_slips
  FOR INSERT TO authenticated
  WITH CHECK (
    (
      status = 'pending'
      AND approved_at IS NULL
      AND approved_by IS NULL
    )
    OR (
      status = 'approved'
      AND public.require_permission('can_approve_warehouse_slips')
      AND approved_at IS NOT NULL
      AND approved_by IS NOT NULL
    )
  );
