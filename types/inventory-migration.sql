-- Align inventory_writeoffs with canonical schema (see types/schema.sql)

CREATE TABLE IF NOT EXISTS inventory_writeoffs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_number TEXT NOT NULL,
  warehouse_id UUID REFERENCES warehouses(id),
  checker_name TEXT NOT NULL,
  writeoff_date DATE DEFAULT CURRENT_DATE,
  notes TEXT,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_inventory_writeoffs_document_number ON inventory_writeoffs (document_number);
npm