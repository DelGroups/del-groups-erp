-- Del Groups ERP - Warehouse slips (inbound / outbound / waste)
-- Run in Supabase SQL Editor after types/schema.sql and types/rbac-migration.sql

CREATE TABLE IF NOT EXISTS warehouse_slips (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slip_number TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK (type IN ('inbound', 'outbound', 'waste')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  source_document_id UUID,
  source_document_no TEXT,
  source_type TEXT CHECK (source_type IN ('purchase', 'sale', 'writeoff')),
  warehouse_id UUID REFERENCES warehouses(id) ON DELETE SET NULL,
  warehouse_name TEXT,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  approved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_warehouse_slips_status ON warehouse_slips (status);
CREATE INDEX IF NOT EXISTS idx_warehouse_slips_type ON warehouse_slips (type);
CREATE INDEX IF NOT EXISTS idx_warehouse_slips_created_at ON warehouse_slips (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_warehouse_slips_source ON warehouse_slips (source_type, source_document_id);

-- Extend role permissions (safe to re-run)
UPDATE roles
   SET permissions = permissions
     || jsonb_build_object(
          'can_view_warehouse_slips', TRUE,
          'can_approve_warehouse_slips', TRUE
        )
 WHERE name = 'Admin';

UPDATE roles
   SET permissions = permissions
     || jsonb_build_object(
          'can_view_warehouse_slips', TRUE,
          'can_approve_warehouse_slips', TRUE
        )
 WHERE name = 'Manager';

UPDATE roles
   SET permissions = permissions
     || jsonb_build_object(
          'can_view_warehouse_slips', FALSE,
          'can_approve_warehouse_slips', FALSE
        )
 WHERE name = 'User';

-- Row Level Security
ALTER TABLE warehouse_slips ENABLE ROW LEVEL SECURITY;

-- Admin role bypasses permission checks in RLS (matches app-layer isAdminRole)
CREATE OR REPLACE FUNCTION public.has_permission(perm TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM profiles p
    JOIN roles r ON r.id = p.role_id
    WHERE p.id = auth.uid()
      AND p.is_active IS TRUE
      AND r.name = 'Admin'
  )
  OR COALESCE((public.current_user_permissions() ->> perm)::boolean, FALSE);
$$;

DROP POLICY IF EXISTS warehouse_slips_select ON warehouse_slips;
CREATE POLICY warehouse_slips_select ON warehouse_slips
  FOR SELECT TO authenticated
  USING (public.require_permission('can_view_warehouse_slips'));

DROP POLICY IF EXISTS warehouse_slips_insert ON warehouse_slips;
CREATE POLICY warehouse_slips_insert ON warehouse_slips
  FOR INSERT TO authenticated
  WITH CHECK (
    status = 'pending'
    AND approved_at IS NULL
    AND approved_by IS NULL
  );

DROP POLICY IF EXISTS warehouse_slips_update ON warehouse_slips;
CREATE POLICY warehouse_slips_update ON warehouse_slips
  FOR UPDATE TO authenticated
  USING (public.require_permission('can_approve_warehouse_slips'))
  WITH CHECK (public.require_permission('can_approve_warehouse_slips'));

DROP POLICY IF EXISTS warehouse_slips_delete ON warehouse_slips;
CREATE POLICY warehouse_slips_delete ON warehouse_slips
  FOR DELETE TO authenticated
  USING (public.require_permission('can_approve_warehouse_slips'));
