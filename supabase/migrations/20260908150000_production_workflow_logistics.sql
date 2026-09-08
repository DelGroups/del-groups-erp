-- Production workflow: Phase 3 logistics fields + purchase requests for material shortages

ALTER TABLE production_orders
  ADD COLUMN IF NOT EXISTS shipping_date DATE,
  ADD COLUMN IF NOT EXISTS installation_start_date DATE,
  ADD COLUMN IF NOT EXISTS installer_id UUID REFERENCES employees(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS shipping_cost NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS installation_cost NUMERIC NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS shipping_paid_by_customer BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS installation_paid_by_customer BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS installation_address TEXT,
  ADD COLUMN IF NOT EXISTS installation_floor TEXT,
  ADD COLUMN IF NOT EXISTS has_elevator BOOLEAN,
  ADD COLUMN IF NOT EXISTS installation_difficulty_notes TEXT;

CREATE TABLE IF NOT EXISTS purchase_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_no TEXT NOT NULL UNIQUE,
  production_order_id UUID NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  product_code TEXT,
  product_name TEXT NOT NULL,
  warehouse_id UUID REFERENCES warehouses(id) ON DELETE SET NULL,
  quantity NUMERIC NOT NULL CHECK (quantity > 0),
  unit TEXT DEFAULT 'Ədəd',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'ordered', 'received', 'cancelled')),
  purchase_id UUID REFERENCES purchases(id) ON DELETE SET NULL,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_purchase_requests_order
  ON purchase_requests (production_order_id, status);

CREATE INDEX IF NOT EXISTS idx_purchase_requests_status
  ON purchase_requests (status, created_at DESC);
